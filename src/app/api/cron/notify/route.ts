// GET /api/cron/notify
// Vercel Cron Job — runs every minute.
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
import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

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

export async function GET(request: NextRequest) {
  // Fail closed: reject unless CRON_SECRET is configured and matches.
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!isVapidConfigured()) {
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
    console.error('[cron/notify] notification_settings fetch failed', notifErr);
    return NextResponse.json({ error: 'DB error' }, { status: 500 });
  }

  if (!notifRows || notifRows.length === 0) {
    return NextResponse.json({ processed: 0 });
  }

  // Helper: send one push notification and return success boolean.
  // Calls the delivery core directly — no self-fetch over the public URL.
  async function sendPush(userId: string, title: string, body: string, tag: string): Promise<boolean> {
    try {
      await sendPushToUser(supabase, userId, { title, body, url: '/app', tag });
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
        const segments = computeWindowSegments(now, leadTimeMin ?? 0, tz, WINDOW_MINUTES);

        const { data: occurrences, error: occErr } = await supabase
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
              .select('id, name')
              .in('id', itemIds);
            const itemNameMap = new Map((items ?? []).map(i => [i.id, i.name]));

            for (const occ of eligibleOccurrences) {
              const logKey = occ.id;

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

              const title = `MedRemind — ${time}`;
              const body = `${itemName} (${protocolName})`;
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

  return NextResponse.json({ processed: results.length, results });
}
