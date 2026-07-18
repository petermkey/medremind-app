// GET /api/cron/notify
// Triggered every minute by an external scheduler (cron-job.org job
// #7402449), not Vercel Cron — see docs/project_push_notifications memory.
// Finds doses due for push notification and delivers them.
//
// Lifecycle contract rules honored:
//   - Only pending/overdue doses for active protocols fire.
//   - Paused, completed, abandoned protocols are excluded.
//   - Doses beyond activeProtocol.end_date are excluded.
//   - Snooze replacement doses fire at their scheduled_time (original snoozed rows excluded).
//   - lead_time_min is applied: notification fires leadTimeMin before scheduled_time.
//   - Pass A (initial): fires once per dose when it first enters the window.
//   - Pass B (reminders): re-fires every REMINDER_INTERVAL_MINUTES while dose is still pending/overdue.
//   - Fire window: doses due in [now - 1 min, now + 1 min] (scheduler cadence tolerance).
//
import * as Sentry from '@sentry/nextjs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

import { computeEatingWindow } from '@/lib/nutrition/eatingWindow';
import { isInQuietHours } from '@/lib/push/quietHours';
import {
  SMART_SHIFT_CAP_MINUTES,
  computeAdjustedReminderTime,
  deriveEatingPattern,
  firesInSegments,
  hhmmFromMinutes,
  minutesFromHHMM,
  resolveSmartTimingActive,
  type EatingPattern,
} from '@/lib/push/foodTiming';
import { isVapidConfigured, sendPushToUser } from '@/lib/push/sendToUser';
import { computeWindowSegments, segmentsToOrFilter } from '@/lib/push/scheduleWindow';

// Notification fire window: ±1 minute around the current UTC time.
// Cron runs every minute via cron-job.org (job #7402449).
const WINDOW_MINUTES = 1;

// How often to re-notify for unactioned (pending/overdue) doses.
const REMINDER_INTERVAL_MINUTES = 10;

// Maximum total notifications per dose (1 initial + N-1 reminders).
// After this cap, no further reminders are sent regardless of dose status.
const MAX_NOTIFICATIONS = 3;

const ACTIONED_EVENT_TYPES = new Set(['taken', 'skipped']);

// ── W4-A smart food timing ──────────────────────────────────────────────
// Eating pattern = medians over per-day computeEatingWindow outputs from the
// last 14 days of food_entries. Any failure returns null → feature inert for
// this user on this tick (reminders must never be blocked by food data).
const FOOD_LOOKBACK_DAYS = 14;

function localDateFor(iso: string, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date(iso));
    const map = new Map(parts.map(part => [part.type, part.value]));
    const date = `${map.get('year')}-${map.get('month')}-${map.get('day')}`;
    return date.length === 10 ? date : iso.slice(0, 10);
  } catch {
    return iso.slice(0, 10);
  }
}

async function loadEatingPattern(
  supabase: SupabaseClient,
  userId: string,
  tz: string,
  now: Date,
): Promise<EatingPattern | null> {
  try {
    const since = new Date(now.getTime() - FOOD_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const { data: rows, error } = await supabase
      .from('food_entries')
      .select('consumed_at, timezone')
      .eq('user_id', userId)
      .gte('consumed_at', since);
    if (error || !rows || rows.length === 0) return null;
    const entries = rows.map((row) => ({
      consumedAt: String(row.consumed_at),
      timezone: typeof row.timezone === 'string' ? row.timezone : tz,
    }));
    const dates = [...new Set(entries.map((entry) => localDateFor(entry.consumedAt, tz)))];
    const days = dates.map((date) => {
      const window = computeEatingWindow(entries, date, tz);
      return { firstMeal: window.firstMeal, lastMeal: window.lastMeal };
    });
    return deriveEatingPattern(days);
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  // Fail closed: reject unless CRON_SECRET is configured and matches.
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Heartbeat: lets Sentry alert if this route stops being invoked by the
  // external cron-job.org scheduler, independent of any in-request error.
  const checkInId = Sentry.captureCheckIn({
    monitorSlug: 'cron-notify',
    status: 'in_progress',
  });

  if (!isVapidConfigured()) {
    Sentry.captureCheckIn({ checkInId, monitorSlug: 'cron-notify', status: 'error' });
    return NextResponse.json({ error: 'VAPID not configured' }, { status: 500 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const now = new Date();
  const results: Array<{ userId: string; doseId: string; status: string; pass: string }> = [];

  // ── 1. Find users who have push enabled ────────────────────────────────────
  const { data: notifRows, error: notifErr } = await supabase
    .from('notification_settings')
    .select('user_id, lead_time_min')
    .eq('push_enabled', true);

  if (notifErr) {
    Sentry.captureException(notifErr, { tags: { route: 'cron/notify', stage: 'notification_settings' } });
    Sentry.captureCheckIn({ checkInId, monitorSlug: 'cron-notify', status: 'error' });
    console.error('[cron/notify] notification_settings fetch failed', notifErr);
    return NextResponse.json({ error: 'DB error' }, { status: 500 });
  }

  if (!notifRows || notifRows.length === 0) {
    Sentry.captureCheckIn({ checkInId, monitorSlug: 'cron-notify', status: 'ok' });
    return NextResponse.json({ processed: 0 });
  }

  // W4-A: separate guarded query so the route keeps working when migration 030
  // is not applied yet (undefined-column error → smart timing globally inert).
  const { data: smartRows, error: smartErr } = await supabase
    .from('notification_settings')
    .select('user_id')
    .eq('push_enabled', true)
    .eq('smart_food_timing', true);
  const smartUserIds = smartErr
    ? new Set<string>()
    : new Set((smartRows ?? []).map((row) => String(row.user_id)));

  // Helper: send one push notification and return success boolean.
  // Calls the delivery core directly — no self-fetch over the public URL.
  // sent===0 (no subscriptions on file, or every one was stale and pruned)
  // must NOT be treated as success — it silently marked reminders "delivered"
  // to nobody until this fix (docs/system-audit-2026-07-09.md §2).
  async function sendPush(userId: string, title: string, body: string, tag: string): Promise<boolean> {
    try {
      const result = await sendPushToUser(supabase, userId, { title, body, url: '/app', tag });
      if (result.sent === 0) {
        Sentry.captureMessage('[cron/notify] push_enabled user has zero deliverable subscriptions', {
          level: 'warning',
          tags: { route: 'cron/notify', userId },
        });
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  // ── 2. For each user, run Pass A (initial) then Pass B (reminders) ─────────
  await Promise.all(
    notifRows.map(async ({ user_id: userId, lead_time_min: leadTimeMin }) => {

      // Fetch user timezone from profiles to compute the local date.
      const { data: profileRow } = await supabase
        .from('profiles')
        .select('timezone')
        .eq('id', userId)
        .maybeSingle();

      const tz = profileRow?.timezone ?? 'UTC';
      const { data: connRow } = await supabase
        .from('external_health_connections')
        .select('sleep_window')
        .eq('user_id', userId)
        .eq('source', 'oura')
        .maybeSingle();
      const optimalBedtime = (connRow?.sleep_window as { optimal_bedtime?: unknown } | null)?.optimal_bedtime;
      const quietNow = isInQuietHours(now, tz, optimalBedtime);

      // W4-A smart food timing — pattern only when the user opted in.
      const smartToggleOn = smartUserIds.has(userId);
      const eatingPattern = smartToggleOn ? await loadEatingPattern(supabase, userId, tz, now) : null;
      const smartActive = resolveSmartTimingActive(smartToggleOn, eatingPattern);

      // ── Stale-claim recovery ─────────────────────────────────────────────
      // Pass A writes an in-flight claim (notification_count=0) before sending
      // and promotes it to 1 only after successful delivery. If a cron worker
      // crashed between claim and delivery, the count=0 row stays and blocks
      // retries indefinitely. Treat any count=0 claim whose sent_at is older
      // than 2× the fire window (i.e. the writer is clearly gone) as stale and
      // delete it so the next Pass A window can re-claim it. Delivered rows
      // (count>=1) are never touched — Pass B needs them for reminders.
      {
        const staleCutoff = new Date(now.getTime() - WINDOW_MINUTES * 2 * 60 * 1000);
        await supabase
          .from('notification_log')
          .delete()
          .eq('user_id', userId)
          .eq('notification_count', 0)
          .lt('sent_at', staleCutoff.toISOString());
      }

      // ── Pass A: Initial scheduled notifications ──────────────────────────
      {
        // V2: query planned_occurrences in the fire window, exclude actioned.
        // Smart timing widens the DB query by the shift cap; each candidate is
        // then re-checked in TS against the true ±1 min window at its
        // EFFECTIVE (adjusted-or-original) time. With smart timing off the two
        // segment sets are identical and behavior is unchanged.
        const segments = computeWindowSegments(
          now, leadTimeMin ?? 0, tz, WINDOW_MINUTES + (smartActive ? SMART_SHIFT_CAP_MINUTES : 0),
        );
        const narrowSegments = smartActive
          ? computeWindowSegments(now, leadTimeMin ?? 0, tz, WINDOW_MINUTES)
          : segments;

        const { data: occurrences, error: occErr } = await supabase
          .from('planned_occurrences')
          .select(`
            id,
            occurrence_date,
            occurrence_time,
            protocol_item_id,
            supersedes_occurrence_id,
            active_protocols!inner (
              status,
              end_date,
              protocols!inner ( name )
            ),
            execution_events ( event_type )
          `)
          .eq('user_id', userId)
          .eq('status', 'planned')
          .or(segmentsToOrFilter(segments, 'occurrence_date', 'occurrence_time'))
          .eq('active_protocols.status', 'active');

        if (occErr) {
          console.error('[cron/notify] Pass A V2 occurrences fetch failed', userId, occErr);
        } else if (occurrences && occurrences.length > 0) {
          const eligibleOccurrences = occurrences.filter((occ) => {
            const ap = Array.isArray(occ.active_protocols) ? occ.active_protocols[0] : occ.active_protocols;
            if (!ap) return false;
            if (ap.end_date && occ.occurrence_date > ap.end_date) return false;
            const events = (occ.execution_events as Array<{ event_type: string }> | null) ?? [];
            return !events.some(e => ACTIONED_EVENT_TYPES.has(e.event_type));
          });

          if (eligibleOccurrences.length > 0) {
            const itemIds = [...new Set(eligibleOccurrences.map(o => o.protocol_item_id))];
            const { data: items } = await supabase
              .from('protocol_items')
              .select('id, name, with_food')
              .in('id', itemIds);
            const itemNameMap = new Map((items ?? []).map(i => [i.id, i.name]));
            const itemWithFoodMap = new Map((items ?? []).map(i => [i.id, i.with_food]));

            for (const occ of eligibleOccurrences) {
              const logKey = occ.id;

              // W4-A: effective fire time = adjusted (when smart timing applies)
              // or the scheduled time. Only occurrences whose effective time is
              // inside the true ±1 min window fire on this tick — everything
              // else in the widened query is a future/past candidate.
              const scheduledMinutes = minutesFromHHMM(String(occ.occurrence_time).slice(0, 5));
              if (scheduledMinutes === null) continue;
              let adjustedMinutes: number | null = null;
              if (smartActive && eatingPattern) {
                adjustedMinutes = computeAdjustedReminderTime({
                  occurrenceMinutes: scheduledMinutes,
                  withFood: itemWithFoodMap.get(occ.protocol_item_id) ?? null,
                  pattern: eatingPattern,
                  isSnoozeReplacement: occ.supersedes_occurrence_id !== null,
                  quietWindow: optimalBedtime,
                });
              }
              const effectiveMinutes = adjustedMinutes ?? scheduledMinutes;
              if (!firesInSegments(String(occ.occurrence_date), effectiveMinutes, narrowSegments)) {
                continue;
              }

              const { data: lockRows, error: lockErr } = await supabase
                .from('notification_log')
                .upsert(
                  {
                    user_id: userId,
                    scheduled_dose_id: logKey,
                    sent_at: now.toISOString(),
                    notification_count: 0,
                  },
                  { onConflict: 'user_id,scheduled_dose_id', ignoreDuplicates: true },
                )
                .select('scheduled_dose_id');

              if (lockErr) {
                console.error('[cron/notify] Pass A V2 lock failed', userId, occ.id, lockErr);
                continue;
              }

              if (!lockRows || lockRows.length === 0) {
                results.push({ userId, doseId: logKey, status: 'already-locked', pass: 'A' });
                continue;
              }

              const ap = Array.isArray(occ.active_protocols) ? occ.active_protocols[0] : occ.active_protocols;
              const protocolName: string = (ap?.protocols as { name?: string } | null)?.name ?? 'Medication';
              const itemName = itemNameMap.get(occ.protocol_item_id) ?? 'dose';
              const time = String(occ.occurrence_time).slice(0, 5);
              const displayTime = adjustedMinutes !== null ? hhmmFromMinutes(adjustedMinutes) : time;
              const smartNote = adjustedMinutes === null
                ? ''
                : itemWithFoodMap.get(occ.protocol_item_id) === 'no'
                  ? ' · ⏱ adjusted before your usual first meal'
                  : ' · ⏱ adjusted toward your usual meal time';

              const title = `MedRemind — ${displayTime}`;
              const body = `${itemName} (${protocolName})${smartNote}`;
              const tag = `dose-${logKey}`;

              const ok = await sendPush(userId, title, body, tag);
              if (ok) {
                await supabase
                  .from('notification_log')
                  .update({ notification_count: 1 })
                  .eq('user_id', userId)
                  .eq('scheduled_dose_id', logKey)
                  .eq('notification_count', 0);
                results.push({ userId, doseId: logKey, status: 'sent', pass: 'A' });
              } else {
                await supabase
                  .from('notification_log')
                  .delete()
                  .eq('user_id', userId)
                  .eq('scheduled_dose_id', logKey)
                  .eq('notification_count', 0);
                results.push({ userId, doseId: logKey, status: 'send-failed', pass: 'A' });
              }
            }
          }
        }
      }
      // ── Pass B: Reminder notifications for unactioned doses ──────────────
      {
        const reminderCutoff = new Date(now.getTime() - REMINDER_INTERVAL_MINUTES * 60 * 1000);

        // Find log rows for this user where last notification was sent >= REMINDER_INTERVAL_MINUTES ago
        // and the dose has not yet reached MAX_NOTIFICATIONS.
        const { data: logRows, error: logErr } = await supabase
          .from('notification_log')
          .select('scheduled_dose_id, notification_count, sent_at')
          .eq('user_id', userId)
          .lte('sent_at', reminderCutoff.toISOString())
          .gte('notification_count', 1) // exclude in-flight Pass A claims
          .lt('notification_count', MAX_NOTIFICATIONS);

        if (logErr) {
          console.error('[cron/notify] Pass B log fetch failed', userId, logErr);
          return;
        }

        if (!logRows || logRows.length === 0) return;

        const candidateDoseIds = logRows.map(r => r.scheduled_dose_id);
        const logCountMap = new Map(logRows.map(r => [r.scheduled_dose_id, r.notification_count as number]));
        const logSentAtMap = new Map(logRows.map(r => [r.scheduled_dose_id, r.sent_at as string]));

        {
          // V2: look up planned_occurrences by id, check action status.
          const { data: stillPending, error: pendingErr } = await supabase
            .from('planned_occurrences')
            .select(`
              id,
              occurrence_date,
              occurrence_time,
              protocol_item_id,
              active_protocols!inner (
                status,
                end_date,
                protocols!inner ( name )
              ),
              execution_events ( event_type )
            `)
            .eq('user_id', userId)
            .eq('status', 'planned')
            .in('id', candidateDoseIds)
            .eq('active_protocols.status', 'active');

          if (pendingErr) {
            console.error('[cron/notify] Pass B V2 pending fetch failed', userId, pendingErr);
            return;
          }

          if (!stillPending || stillPending.length === 0) return;

          // Exclude occurrences that have been actioned or are beyond end_date.
          const remindable = stillPending.filter((occ) => {
            const ap = Array.isArray(occ.active_protocols) ? occ.active_protocols[0] : occ.active_protocols;
            if (!ap) return false;
            if (ap.end_date && occ.occurrence_date > ap.end_date) return false;
            const events = (occ.execution_events as Array<{ event_type: string }> | null) ?? [];
            return !events.some(e => ACTIONED_EVENT_TYPES.has(e.event_type));
          });

          if (remindable.length === 0) return;
          if (quietNow) {
            for (const occ of remindable) {
              results.push({ userId, doseId: occ.id, status: 'quiet-hours', pass: 'B' });
            }
            return;
          }

          const itemIds = [...new Set(remindable.map(o => o.protocol_item_id))];
          const { data: items } = await supabase
            .from('protocol_items')
            .select('id, name')
            .in('id', itemIds);
          const itemNameMap = new Map((items ?? []).map(i => [i.id, i.name]));

          for (const occ of remindable) {
            const logKey = occ.id;
            const ap = Array.isArray(occ.active_protocols) ? occ.active_protocols[0] : occ.active_protocols;
            const protocolName: string = (ap?.protocols as { name?: string } | null)?.name ?? 'Medication';
            const itemName = itemNameMap.get(occ.protocol_item_id) ?? 'dose';
            const time = String(occ.occurrence_time).slice(0, 5);
            const count = logCountMap.get(logKey) ?? 1;

            // Atomic Pass B reservation: move sent_at/notification_count forward
            // only if the row is still eligible for reminder.
            const { data: reservedRows, error: reserveErr } = await supabase
              .from('notification_log')
              .update({
                sent_at: now.toISOString(),
                notification_count: count + 1,
              })
              .eq('user_id', userId)
              .eq('scheduled_dose_id', logKey)
              .lte('sent_at', reminderCutoff.toISOString())
              .eq('notification_count', count)
              .select('scheduled_dose_id');

            if (reserveErr) {
              console.error('[cron/notify] Pass B V2 reserve failed', userId, occ.id, reserveErr);
              continue;
            }

            if (!reservedRows || reservedRows.length === 0) {
              results.push({ userId, doseId: logKey, status: 'already-locked', pass: 'B' });
              continue;
            }

            const title = `⏰ Reminder — ${time}`;
            const body = `${itemName} (${protocolName})`;
            const tag = `dose-${logKey}`;

            const ok = await sendPush(userId, title, body, tag);
            if (ok) {
              results.push({ userId, doseId: logKey, status: 'sent', pass: 'B' });
            } else {
              // Rollback the reservation so the next cron window can retry.
              const prevSentAt = logSentAtMap.get(logKey);
              if (prevSentAt) {
                await supabase
                  .from('notification_log')
                  .update({ sent_at: prevSentAt, notification_count: count })
                  .eq('user_id', userId)
                  .eq('scheduled_dose_id', logKey);
              }
              results.push({ userId, doseId: logKey, status: 'send-failed', pass: 'B' });
            }
          }
        }
      }
    }),
  );

  Sentry.captureCheckIn({ checkInId, monitorSlug: 'cron-notify', status: 'ok' });
  return NextResponse.json({ processed: results.length, results });
}
