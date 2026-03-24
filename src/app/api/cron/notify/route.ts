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

import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

// Notification fire window: ±1 minute around the current UTC time.
// Cron runs every minute via cron-job.org (job #7402449).
const WINDOW_MINUTES = 1;

// How often to re-notify for unactioned (pending/overdue) doses.
const REMINDER_INTERVAL_MINUTES = 10;

// Maximum total notifications per dose (1 initial + N-1 reminders).
// After this cap, no further reminders are sent regardless of dose status.
const MAX_NOTIFICATIONS = 3;

export async function GET(request: NextRequest) {
  // Vercel sets this header on cron invocations; also accept CRON_SECRET bearer.
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

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
    console.error('[cron/notify] notification_settings fetch failed', notifErr);
    return NextResponse.json({ error: 'DB error' }, { status: 500 });
  }

  if (!notifRows || notifRows.length === 0) {
    return NextResponse.json({ processed: 0 });
  }

  // Helper: send one push notification and return success boolean.
  async function sendPush(userId: string, title: string, body: string, tag: string): Promise<boolean> {
    try {
      const resp = await fetch(`${appUrl}/api/push/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.CRON_SECRET}`,
        },
        body: JSON.stringify({ userId, title, body, url: '/app', tag }),
      });
      return resp.ok;
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

      // ── Pass A: Initial scheduled notifications ──────────────────────────
      {
        // Compute the target scheduled_time that maps to "now" given leadTimeMin.
        // If lead_time = 15, we want doses whose scheduled_time = now + 15 min.
        const targetUtc = new Date(now.getTime() + (leadTimeMin ?? 0) * 60 * 1000);

        // Local calendar date for the user (YYYY-MM-DD).
        const localDateParts = new Intl.DateTimeFormat('en-CA', {
          timeZone: tz,
          year: 'numeric', month: '2-digit', day: '2-digit',
        }).formatToParts(targetUtc);
        const localDate = `${localDateParts.find(p => p.type === 'year')!.value}-${localDateParts.find(p => p.type === 'month')!.value}-${localDateParts.find(p => p.type === 'day')!.value}`;

        // Local HH:MM time window.
        const windowStart = new Date(targetUtc.getTime() - WINDOW_MINUTES * 60 * 1000);
        const windowEnd   = new Date(targetUtc.getTime() + WINDOW_MINUTES * 60 * 1000);

        function toHHMM(d: Date, timezone: string): string {
          return d.toLocaleString('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false });
        }

        const windowStartHHMM = toHHMM(windowStart, tz);
        const windowEndHHMM   = toHHMM(windowEnd, tz);

        // Query due doses for this user that match the window.
        const { data: doses, error: dosesErr } = await supabase
          .from('scheduled_doses')
          .select(`
            id,
            scheduled_date,
            scheduled_time,
            status,
            protocol_item_id,
            active_protocol_id,
            active_protocols!inner (
              status,
              end_date,
              protocol_id,
              protocols!inner ( name )
            )
          `)
          .eq('user_id', userId)
          .eq('scheduled_date', localDate)
          .in('status', ['pending', 'overdue'])
          .gte('scheduled_time', windowStartHHMM)
          .lte('scheduled_time', windowEndHHMM)
          .eq('active_protocols.status', 'active');

        if (dosesErr) {
          console.error('[cron/notify] Pass A doses fetch failed', userId, dosesErr);
        } else if (doses && doses.length > 0) {
          // Filter: exclude doses beyond end_date (lifecycle contract §3.12).
          const eligibleDoses = doses.filter((d) => {
            const ap = Array.isArray(d.active_protocols) ? d.active_protocols[0] : d.active_protocols;
            if (!ap) return false;
            if (ap.end_date && d.scheduled_date > ap.end_date) return false;
            return true;
          });

          if (eligibleDoses.length > 0) {
            // Deduplication: filter out already-notified doses (initial not yet sent).
            const doseIds = eligibleDoses.map(d => d.id);
            const { data: alreadySent } = await supabase
              .from('notification_log')
              .select('scheduled_dose_id')
              .eq('user_id', userId)
              .in('scheduled_dose_id', doseIds);

            const sentSet = new Set((alreadySent ?? []).map(r => r.scheduled_dose_id));
            const toNotify = eligibleDoses.filter(d => !sentSet.has(d.id));

            if (toNotify.length > 0) {
              // Fetch protocol item names for notification body.
              const itemIds = [...new Set(toNotify.map(d => d.protocol_item_id))];
              const { data: items } = await supabase
                .from('protocol_items')
                .select('id, name')
                .in('id', itemIds);

              const itemNameMap = new Map((items ?? []).map(i => [i.id, i.name]));

              for (const dose of toNotify) {
                const ap = Array.isArray(dose.active_protocols) ? dose.active_protocols[0] : dose.active_protocols;
                const protocolName: string = (ap?.protocols as { name?: string } | null)?.name ?? 'Medication';
                const itemName = itemNameMap.get(dose.protocol_item_id) ?? 'dose';
                const time = dose.scheduled_time.slice(0, 5);

                const title = `MedRemind — ${time}`;
                const body = `${itemName} (${protocolName})`;
                const tag = `dose-${dose.id}`;

                const ok = await sendPush(userId, title, body, tag);
                if (ok) {
                  // Insert log row; update sent_at and notification_count on conflict
                  // (safety net in case a row exists from a previous run edge case).
                  await supabase.from('notification_log').upsert(
                    { user_id: userId, scheduled_dose_id: dose.id, sent_at: now.toISOString(), notification_count: 1 },
                    { onConflict: 'user_id,scheduled_dose_id' },
                  );
                  results.push({ userId, doseId: dose.id, status: 'sent', pass: 'A' });
                } else {
                  results.push({ userId, doseId: dose.id, status: 'send-failed', pass: 'A' });
                }
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
          .select('scheduled_dose_id, notification_count')
          .eq('user_id', userId)
          .lte('sent_at', reminderCutoff.toISOString())
          .lt('notification_count', MAX_NOTIFICATIONS);

        if (logErr) {
          console.error('[cron/notify] Pass B log fetch failed', userId, logErr);
          return;
        }

        if (!logRows || logRows.length === 0) return;

        const candidateDoseIds = logRows.map(r => r.scheduled_dose_id);
        const logCountMap = new Map(logRows.map(r => [r.scheduled_dose_id, r.notification_count as number]));

        // Check which of those doses are still pending/overdue with an active protocol.
        const { data: stillPending, error: pendingErr } = await supabase
          .from('scheduled_doses')
          .select(`
            id,
            scheduled_date,
            scheduled_time,
            status,
            protocol_item_id,
            active_protocols!inner (
              status,
              end_date,
              protocols!inner ( name )
            )
          `)
          .eq('user_id', userId)
          .in('id', candidateDoseIds)
          .in('status', ['pending', 'overdue'])
          .eq('active_protocols.status', 'active');

        if (pendingErr) {
          console.error('[cron/notify] Pass B pending fetch failed', userId, pendingErr);
          return;
        }

        if (!stillPending || stillPending.length === 0) return;

        // Filter: exclude doses beyond end_date.
        const remindable = stillPending.filter((d) => {
          const ap = Array.isArray(d.active_protocols) ? d.active_protocols[0] : d.active_protocols;
          if (!ap) return false;
          if (ap.end_date && d.scheduled_date > ap.end_date) return false;
          return true;
        });

        if (remindable.length === 0) return;

        // Fetch protocol item names.
        const itemIds = [...new Set(remindable.map(d => d.protocol_item_id))];
        const { data: items } = await supabase
          .from('protocol_items')
          .select('id, name')
          .in('id', itemIds);

        const itemNameMap = new Map((items ?? []).map(i => [i.id, i.name]));

        for (const dose of remindable) {
          const ap = Array.isArray(dose.active_protocols) ? dose.active_protocols[0] : dose.active_protocols;
          const protocolName: string = (ap?.protocols as { name?: string } | null)?.name ?? 'Medication';
          const itemName = itemNameMap.get(dose.protocol_item_id) ?? 'dose';
          const time = dose.scheduled_time.slice(0, 5);
          const count = logCountMap.get(dose.id) ?? 1;

          const title = `⏰ Reminder — ${time}`;
          const body = `${itemName} (${protocolName})`;
          const tag = `dose-${dose.id}`;

          const ok = await sendPush(userId, title, body, tag);
          if (ok) {
            // Update sent_at and increment notification_count.
            await supabase.from('notification_log').upsert(
              {
                user_id: userId,
                scheduled_dose_id: dose.id,
                sent_at: now.toISOString(),
                notification_count: count + 1,
              },
              { onConflict: 'user_id,scheduled_dose_id' },
            );
            results.push({ userId, doseId: dose.id, status: 'sent', pass: 'B' });
          } else {
            results.push({ userId, doseId: dose.id, status: 'send-failed', pass: 'B' });
          }
        }
      }
    }),
  );

  return NextResponse.json({ processed: results.length, results });
}
