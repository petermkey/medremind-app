// GET /api/cron/morning-briefing
// Daily readiness-aware briefing push (W3-B). Triggered once per day (06:30
// Europe/London) by an external cron-job.org job that the owner creates after
// deploy.
import * as Sentry from '@sentry/nextjs';
import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

import {
  baselineAverage,
  buildBriefing,
  type BriefingSnapshot,
} from '@/lib/briefing/briefing';
import { deterministicNotificationUuid } from '@/lib/push/notificationKey';
import { isInQuietHours } from '@/lib/push/quietHours';
import { isVapidConfigured, sendPushToUser } from '@/lib/push/sendToUser';

export const runtime = 'nodejs';
export const maxDuration = 300;

const BASELINE_DAYS = 30;
const MONITOR_SLUG = 'cron-morning-briefing';

type Status =
  | 'sent'
  | 'already-sent'
  | 'quiet-hours'
  | 'no-subscriptions'
  | 'send-failed'
  | 'error';

type Result = { userId: string; status: Status };
type SnapshotRow = {
  local_date: string;
  readiness_score: unknown;
  sleep_score: unknown;
  sleep_avg_hrv: unknown;
  temperature_deviation: unknown;
};

function localDateFor(now: Date, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);
    const map = new Map(parts.map((part) => [part.type, part.value]));
    const date = `${map.get('year')}-${map.get('month')}-${map.get('day')}`;
    if (date.length === 10) return date;
  } catch {
    // Invalid timezone in profile: fall through to UTC.
  }
  return now.toISOString().slice(0, 10);
}

function addDaysIso(localDate: string, days: number): string {
  const date = new Date(`${localDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const checkInId = Sentry.captureCheckIn(
    { monitorSlug: MONITOR_SLUG, status: 'in_progress' },
    {
      schedule: { type: 'crontab', value: '30 6 * * *' },
      checkinMargin: 60,
      maxRuntime: 10,
      timezone: 'Europe/London',
    },
  );

  if (!isVapidConfigured()) {
    Sentry.captureCheckIn({ checkInId, monitorSlug: MONITOR_SLUG, status: 'error' });
    return NextResponse.json({ error: 'VAPID not configured' }, { status: 500 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    Sentry.captureCheckIn({ checkInId, monitorSlug: MONITOR_SLUG, status: 'error' });
    return NextResponse.json({ error: 'Supabase env not configured' }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const now = new Date();
  const results: Result[] = [];

  const { data: settingRows, error: settingsError } = await supabase
    .from('notification_settings')
    .select('user_id')
    .eq('push_enabled', true)
    .eq('morning_briefing_enabled', true);

  if (settingsError) {
    Sentry.captureException(settingsError, {
      tags: { route: 'cron/morning-briefing', stage: 'notification_settings' },
    });
    Sentry.captureCheckIn({ checkInId, monitorSlug: MONITOR_SLUG, status: 'error' });
    return NextResponse.json({ error: 'DB error' }, { status: 500 });
  }

  for (const { user_id: userId } of settingRows ?? []) {
    try {
      const { data: profileRow } = await supabase
        .from('profiles')
        .select('timezone')
        .eq('id', userId)
        .maybeSingle();
      const timeZone = typeof profileRow?.timezone === 'string' ? profileRow.timezone : 'UTC';

      const { data: connRow } = await supabase
        .from('external_health_connections')
        .select('sleep_window')
        .eq('user_id', userId)
        .eq('source', 'oura')
        .maybeSingle();
      const optimalBedtime = (
        connRow?.sleep_window as { optimal_bedtime?: unknown } | null
      )?.optimal_bedtime;
      if (isInQuietHours(now, timeZone, optimalBedtime)) {
        results.push({ userId, status: 'quiet-hours' });
        continue;
      }

      const localDate = localDateFor(now, timeZone);
      const dedupeKey = deterministicNotificationUuid('morning-briefing', localDate);
      const { data: lockRows, error: lockError } = await supabase
        .from('notification_log')
        .upsert(
          {
            user_id: userId,
            scheduled_dose_id: dedupeKey,
            sent_at: now.toISOString(),
            notification_count: 0,
          },
          { onConflict: 'user_id,scheduled_dose_id', ignoreDuplicates: true },
        )
        .select('scheduled_dose_id');

      if (lockError) {
        console.error('[cron/morning-briefing] lock failed', userId, lockError);
        results.push({ userId, status: 'error' });
        continue;
      }
      if (!lockRows || lockRows.length === 0) {
        results.push({ userId, status: 'already-sent' });
        continue;
      }

      const releaseClaim = () =>
        supabase
          .from('notification_log')
          .delete()
          .eq('user_id', userId)
          .eq('scheduled_dose_id', dedupeKey)
          .eq('notification_count', 0);

      const { data: snapshotRows, error: snapshotError } = await supabase
        .from('external_health_daily_snapshots')
        .select('local_date, readiness_score, sleep_score, sleep_avg_hrv, temperature_deviation')
        .eq('user_id', userId)
        .eq('source', 'oura')
        .gte('local_date', addDaysIso(localDate, -BASELINE_DAYS))
        .lte('local_date', localDate)
        .order('local_date', { ascending: true });
      if (snapshotError) {
        console.error('[cron/morning-briefing] snapshots fetch failed', userId, snapshotError);
        await releaseClaim();
        results.push({ userId, status: 'error' });
        continue;
      }

      const rows = ((snapshotRows ?? []) as SnapshotRow[]);
      const todayRow = rows.find((row) => row.local_date === localDate) ?? null;
      const baselineRows = rows.filter((row) => row.local_date !== localDate);
      const snapshot: BriefingSnapshot | null = todayRow
        ? {
            readinessScore: numberOrNull(todayRow.readiness_score),
            sleepScore: numberOrNull(todayRow.sleep_score),
            sleepAvgHrv: numberOrNull(todayRow.sleep_avg_hrv),
            temperatureDeviation: numberOrNull(todayRow.temperature_deviation),
          }
        : null;
      const baseline = {
        readinessAvg30: baselineAverage(baselineRows.map((row) => numberOrNull(row.readiness_score))),
        hrvAvg30: baselineAverage(baselineRows.map((row) => numberOrNull(row.sleep_avg_hrv))),
      };

      const { data: occRows, error: occError } = await supabase
        .from('planned_occurrences')
        .select('id, active_protocols!inner ( status )')
        .eq('user_id', userId)
        .eq('occurrence_date', localDate)
        .eq('status', 'planned')
        .eq('active_protocols.status', 'active');
      if (occError) {
        console.error('[cron/morning-briefing] occurrences fetch failed', userId, occError);
        await releaseClaim();
        results.push({ userId, status: 'error' });
        continue;
      }

      const briefing = buildBriefing(snapshot, baseline, (occRows ?? []).length);
      const sendResult = await sendPushToUser(supabase, userId, {
        title: briefing.title,
        body: briefing.body,
        url: '/app',
        tag: `briefing-${localDate}`,
      });

      if (sendResult.sent === 0) {
        Sentry.captureMessage(
          '[cron/morning-briefing] briefing user has zero deliverable subscriptions',
          { level: 'warning', tags: { route: 'cron/morning-briefing', userId } },
        );
        await releaseClaim();
        results.push({ userId, status: 'no-subscriptions' });
        continue;
      }

      const { error: promoteError } = await supabase
        .from('notification_log')
        .update({ notification_count: 1 })
        .eq('user_id', userId)
        .eq('scheduled_dose_id', dedupeKey)
        .eq('notification_count', 0);
      if (promoteError) {
        Sentry.captureException(promoteError, {
          tags: { route: 'cron/morning-briefing', stage: 'promote', userId },
        });
      }

      results.push({ userId, status: 'sent' });
    } catch (err) {
      console.error('[cron/morning-briefing] user failed', userId, err);
      Sentry.captureException(err, { tags: { route: 'cron/morning-briefing', userId } });
      results.push({ userId, status: 'error' });
    }
  }

  Sentry.captureCheckIn({ checkInId, monitorSlug: MONITOR_SLUG, status: 'ok' });
  return NextResponse.json({ processed: results.length, results });
}
