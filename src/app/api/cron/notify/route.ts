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
//   - Deduplication: notification_log prevents re-send for the same dose.
//   - Fire window: doses due in [now - 1 min, now + 1 min] (scheduler cadence tolerance).

import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

// Notification fire window: ±1 minute around the current UTC time.
const WINDOW_MINUTES = 1;

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
  const results: Array<{ userId: string; doseId: string; status: string }> = [];

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

  // ── 2. For each user, find doses due in the fire window ────────────────────
  await Promise.all(
    notifRows.map(async ({ user_id: userId, lead_time_min: leadTimeMin }) => {
      // Compute the target scheduled_time that maps to "now" given leadTimeMin.
      // If lead_time = 15, we want doses whose scheduled_time = now + 15 min.
      // We use a ±WINDOW_MINUTES tolerance around that target.
      const targetUtc = new Date(now.getTime() + (leadTimeMin ?? 0) * 60 * 1000);

      // Fetch user timezone from profiles to compute the local date.
      const { data: profileRow } = await supabase
        .from('profiles')
        .select('timezone')
        .eq('id', userId)
        .maybeSingle();

      const tz = profileRow?.timezone ?? 'UTC';

      // Local calendar date for the user (YYYY-MM-DD).
      const localDate = new Date(
        targetUtc.toLocaleString('en-CA', { timeZone: tz }),
      ).toISOString().slice(0, 10);

      // Local HH:MM time window.
      const windowStart = new Date(targetUtc.getTime() - WINDOW_MINUTES * 60 * 1000);
      const windowEnd   = new Date(targetUtc.getTime() + WINDOW_MINUTES * 60 * 1000);

      function toHHMM(d: Date, timezone: string): string {
        return d.toLocaleString('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false });
      }

      const windowStartHHMM = toHHMM(windowStart, tz);
      const windowEndHHMM   = toHHMM(windowEnd, tz);

      // Query due doses for this user that match the window.
      // Join active_protocols to enforce lifecycle state guards.
      // Exclude: snoozed original rows, terminal states, paused/completed/abandoned protocols.
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
        console.error('[cron/notify] doses fetch failed', userId, dosesErr);
        return;
      }

      if (!doses || doses.length === 0) return;

      // Filter: exclude doses beyond end_date (lifecycle contract §3.12).
      const eligibleDoses = doses.filter((d) => {
        const ap = Array.isArray(d.active_protocols) ? d.active_protocols[0] : d.active_protocols;
        if (!ap) return false;
        if (ap.end_date && d.scheduled_date > ap.end_date) return false;
        return true;
      });

      if (eligibleDoses.length === 0) return;

      // ── 3. Deduplication: filter out already-notified doses ───────────────
      const doseIds = eligibleDoses.map(d => d.id);

      const { data: alreadySent } = await supabase
        .from('notification_log')
        .select('scheduled_dose_id')
        .eq('user_id', userId)
        .in('scheduled_dose_id', doseIds);

      const sentSet = new Set((alreadySent ?? []).map(r => r.scheduled_dose_id));
      const toNotify = eligibleDoses.filter(d => !sentSet.has(d.id));

      if (toNotify.length === 0) return;

      // ── 4. Fetch protocol item names for notification body ─────────────────
      const itemIds = [...new Set(toNotify.map(d => d.protocol_item_id))];
      const { data: items } = await supabase
        .from('protocol_items')
        .select('id, name')
        .in('id', itemIds);

      const itemNameMap = new Map((items ?? []).map(i => [i.id, i.name]));

      // ── 5. Send notification and record in log ────────────────────────────
      for (const dose of toNotify) {
        const ap = Array.isArray(dose.active_protocols) ? dose.active_protocols[0] : dose.active_protocols;
        const protocolName: string = (ap?.protocols as { name?: string } | null)?.name ?? 'Medication';
        const itemName = itemNameMap.get(dose.protocol_item_id) ?? 'dose';
        const time = dose.scheduled_time.slice(0, 5);

        const title = `MedRemind — ${time}`;
        const body = `${itemName} (${protocolName})`;
        const tag = `dose-${dose.id}`;

        try {
          const resp = await fetch(`${appUrl}/api/push/send`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${process.env.CRON_SECRET}`,
            },
            body: JSON.stringify({ userId, title, body, url: '/app', tag }),
          });

          if (resp.ok) {
            // Record sent — deduplicates future scheduler runs.
            await supabase.from('notification_log').upsert(
              { user_id: userId, scheduled_dose_id: dose.id },
              { onConflict: 'user_id,scheduled_dose_id' },
            );
            results.push({ userId, doseId: dose.id, status: 'sent' });
          } else {
            results.push({ userId, doseId: dose.id, status: 'send-failed' });
          }
        } catch (err) {
          console.error('[cron/notify] send call failed', dose.id, err);
          results.push({ userId, doseId: dose.id, status: 'error' });
        }
      }
    }),
  );

  return NextResponse.json({ processed: results.length, results });
}
