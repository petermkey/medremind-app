// GET /api/cron/weekly-review
// W4-B (B2): Monday synthesis of the completed week. Triggered weekly
// (Mon 06:00 UTC) by a cron-job.org job the OWNER creates after deploy —
// never by an implementing agent (master plan, decision 3).
//
// Discipline: fail-closed CRON_SECRET; Sentry check-in + monitorConfig upsert
// (cron/oura-sync pattern, PR #93); idempotent via unique(user_id, week_start)
// — a double fire finds the row and does nothing; generation is gated on the
// weekly_review_enabled opt-in (LLM cost control — plan Spec, req. 8); skip
// users with <3 logged days; ONE OpenRouter call per user per week over
// aggregates only; push dedupe via notification_log keyed by the review row's
// uuid; sent===0 is a failure signal (system-audit 2026-07-09 §2) but the
// stored review still counts as success (generated-no-push).
import * as Sentry from '@sentry/nextjs';
import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

import { computeEatingWindow } from '@/lib/nutrition/eatingWindow';
import { isInQuietHours } from '@/lib/push/quietHours';
import { isVapidConfigured, sendPushToUser } from '@/lib/push/sendToUser';
import {
  buildWeeklyAggregate,
  type WeeklyEatingWindowDay,
  type WeeklyFoodRow,
  type WeeklyOccurrenceRow,
  type WeeklyOuraRow,
  type WeeklyWaterRow,
} from '@/lib/weeklyReview/aggregate';
import { generateWeeklyReview } from '@/lib/weeklyReview/provider';
import { completedWeekRange } from '@/lib/weeklyReview/weekRange';

export const runtime = 'nodejs';
export const maxDuration = 300;

const MONITOR_SLUG = 'cron-weekly-review';
const MIN_LOGGED_DAYS = 3;

type Row = Record<string, unknown>;

function addDaysIso(localDate: string, days: number): string {
  const date = new Date(`${localDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const checkInId = Sentry.captureCheckIn(
    { monitorSlug: MONITOR_SLUG, status: 'in_progress' },
    {
      schedule: { type: 'crontab', value: '0 6 * * 1' },
      checkinMargin: 60,
      maxRuntime: 10,
      timezone: 'UTC',
    },
  );

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const now = new Date();
  const results: Array<{ userId: string; status: string }> = [];

  const { data: settingRows, error: settingsError } = await supabase
    .from('notification_settings')
    .select('user_id, push_enabled')
    .eq('weekly_review_enabled', true);

  if (settingsError) {
    Sentry.captureException(settingsError, {
      tags: { route: 'cron/weekly-review', stage: 'notification_settings' },
    });
    Sentry.captureCheckIn({ checkInId, monitorSlug: MONITOR_SLUG, status: 'error' });
    return NextResponse.json({ error: 'DB error' }, { status: 500 });
  }

  for (const { user_id: userId, push_enabled: pushEnabled } of settingRows ?? []) {
    try {
      const { data: profileRow } = await supabase
        .from('profiles')
        .select('timezone')
        .eq('id', userId)
        .maybeSingle();
      const tz = profileRow?.timezone ?? 'UTC';
      const { weekStart, weekEnd } = completedWeekRange(now, tz);

      // Idempotency: unique(user_id, week_start). Double fire → nothing to do.
      const { data: existing } = await supabase
        .from('weekly_reviews')
        .select('id')
        .eq('user_id', userId)
        .eq('week_start', weekStart)
        .maybeSingle();
      if (existing) {
        results.push({ userId, status: 'already-generated' });
        continue;
      }

      // Week rows. Timestamp ranges are widened ±1 day so timezone-local
      // bucketing inside the aggregator never loses edge entries
      // (correlation/persistence.ts precedent).
      const widenedStartTs = `${addDaysIso(weekStart, -1)}T00:00:00.000Z`;
      const widenedEndTs = `${addDaysIso(weekEnd, 1)}T23:59:59.999Z`;

      const [foodRes, waterRes, occRes, ouraRes] = await Promise.all([
        supabase
          .from('food_entries')
          .select('consumed_at, calories_kcal, protein_g, fiber_g, sugars_g')
          .eq('user_id', userId)
          .gte('consumed_at', widenedStartTs)
          .lte('consumed_at', widenedEndTs),
        supabase
          .from('water_entries')
          .select('consumed_at, amount_ml')
          .eq('user_id', userId)
          .gte('consumed_at', widenedStartTs)
          .lte('consumed_at', widenedEndTs),
        supabase
          .from('planned_occurrences')
          .select('occurrence_date, status, execution_events(event_type, event_at)')
          .eq('user_id', userId)
          .gte('occurrence_date', weekStart)
          .lte('occurrence_date', weekEnd)
          .is('superseded_by_occurrence_id', null),
        supabase
          .from('external_health_daily_snapshots')
          .select('local_date, readiness_score, sleep_score, sleep_avg_hrv, steps')
          .eq('user_id', userId)
          .eq('source', 'oura')
          .gte('local_date', addDaysIso(weekStart, -7))
          .lte('local_date', weekEnd),
      ]);
      const firstError = foodRes.error ?? waterRes.error ?? occRes.error ?? ouraRes.error;
      if (firstError) throw firstError;

      const foodEntries = (foodRes.data ?? []) as unknown as Array<Row & WeeklyFoodRow>;
      const waterEntries = (waterRes.data ?? []) as unknown as WeeklyWaterRow[];

      // planned_occurrences.status is structural; derive the action status from
      // the latest execution event (correlation/persistence.ts precedent).
      const occurrences: WeeklyOccurrenceRow[] = ((occRes.data ?? []) as unknown as Row[]).map((row) => {
        const events = (row.execution_events as Row[] | null) ?? [];
        const latestEvent = [...events].sort((a, b) =>
          String(b.event_at ?? '').localeCompare(String(a.event_at ?? '')),
        )[0];
        return {
          occurrence_date: String(row.occurrence_date),
          derived_status: latestEvent ? String(latestEvent.event_type) : String(row.status),
        };
      });

      const ouraDays: WeeklyOuraRow[] = ((ouraRes.data ?? []) as unknown as Row[]).map((row) => ({
        local_date: String(row.local_date),
        readiness_score: numberOrNull(row.readiness_score),
        sleep_score: numberOrNull(row.sleep_score),
        sleep_avg_hrv: numberOrNull(row.sleep_avg_hrv),
        steps: numberOrNull(row.steps),
      }));

      // Eating-window stats via W1-B's pure module, one call per week day.
      // ADAPTATION (Task 0, Step 2): the real computeEatingWindow signature is
      // computeEatingWindow(entries: EatingWindowEntry[], date, timezone) →
      // { windowHours, lateFlag, ... } — entries need { consumedAt } (not the
      // WeeklyFoodRow's consumed_at), and the result field is `windowHours`,
      // not the plan's placeholder `windowH`.
      const eatingWindowEntries = foodEntries.map((entry) => ({ consumedAt: entry.consumed_at }));
      const eatingWindows: WeeklyEatingWindowDay[] = [];
      for (let offset = 0; offset < 7; offset += 1) {
        const day = addDaysIso(weekStart, offset);
        const window = computeEatingWindow(eatingWindowEntries, day, tz);
        eatingWindows.push({
          localDate: day,
          windowHours: numberOrNull(window.windowHours),
          lateFlag: window.lateFlag === true,
        });
      }

      const aggregate = buildWeeklyAggregate({
        weekStart,
        timezone: tz,
        foodEntries,
        waterEntries,
        occurrences,
        ouraDays,
        eatingWindows,
      });

      if (aggregate.loggedDaysCount < MIN_LOGGED_DAYS) {
        results.push({ userId, status: 'skipped-sparse' });
        continue;
      }

      const review = await generateWeeklyReview(aggregate);

      const { data: upserted, error: upsertError } = await supabase
        .from('weekly_reviews')
        .upsert(
          {
            user_id: userId,
            week_start: weekStart,
            payload: review.payload,
            model: review.model,
          },
          { onConflict: 'user_id,week_start' },
        )
        .select('id')
        .single();
      if (upsertError) throw upsertError;
      const reviewId = String(upserted.id);

      // ── push (optional layer on top of the stored review) ──
      if (!pushEnabled || !isVapidConfigured()) {
        results.push({ userId, status: 'generated-no-push' });
        continue;
      }
      const { data: connRow } = await supabase
        .from('external_health_connections')
        .select('sleep_window')
        .eq('user_id', userId)
        .eq('source', 'oura')
        .maybeSingle();
      const optimalBedtime = (
        connRow?.sleep_window as { optimal_bedtime?: unknown } | null
      )?.optimal_bedtime;
      if (isInQuietHours(now, tz, optimalBedtime)) {
        results.push({ userId, status: 'generated-no-push' });
        continue;
      }

      // Dedupe: the review row's uuid is the notification_log key
      // (scheduled_dose_id is `uuid not null`, 003_web_push.sql).
      const { data: lockRows, error: lockError } = await supabase
        .from('notification_log')
        .upsert(
          {
            user_id: userId,
            scheduled_dose_id: reviewId,
            sent_at: now.toISOString(),
            notification_count: 0,
          },
          { onConflict: 'user_id,scheduled_dose_id', ignoreDuplicates: true },
        )
        .select('scheduled_dose_id');
      if (lockError) throw lockError;
      if (!lockRows || lockRows.length === 0) {
        results.push({ userId, status: 'generated-no-push' });
        continue;
      }

      const sendResult = await sendPushToUser(supabase, userId, {
        title: 'MedRemind',
        body: 'Ваш недельный разбор готов',
        url: '/app/progress',
        tag: `weekly-review-${weekStart}`,
      });
      if (sendResult.sent === 0) {
        Sentry.captureMessage(
          '[cron/weekly-review] review user has zero deliverable subscriptions',
          { level: 'warning', tags: { route: 'cron/weekly-review', userId } },
        );
        await supabase
          .from('notification_log')
          .delete()
          .eq('user_id', userId)
          .eq('scheduled_dose_id', reviewId)
          .eq('notification_count', 0);
        results.push({ userId, status: 'generated-no-push' });
        continue;
      }
      await supabase
        .from('notification_log')
        .update({ notification_count: 1 })
        .eq('user_id', userId)
        .eq('scheduled_dose_id', reviewId)
        .eq('notification_count', 0);
      results.push({ userId, status: 'generated-and-sent' });
    } catch (err) {
      console.error('[cron/weekly-review] user failed', userId, err);
      Sentry.captureException(err, { tags: { route: 'cron/weekly-review', userId } });
      results.push({ userId, status: 'error' });
    }
  }

  Sentry.captureCheckIn({ checkInId, monitorSlug: MONITOR_SLUG, status: 'ok' });
  return NextResponse.json({ processed: results.length, results });
}
