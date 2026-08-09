export type OuraSyncWindow = {
  startDate: string;
  endDate: string;
  days: number;
};

const BACKFILL_DAYS = 90;
const DAILY_SYNC_DAYS = 7;
const MANUAL_REFRESH_DAYS = 14;

function toUtcDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function getWindowEndingOn(days: number, now = new Date()): OuraSyncWindow {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const start = new Date(end);
  start.setUTCDate(end.getUTCDate() - days + 1);

  return {
    startDate: toUtcDateString(start),
    endDate: toUtcDateString(end),
    days,
  };
}

export function getOuraBackfillWindow(now?: Date): OuraSyncWindow {
  return getWindowEndingOn(BACKFILL_DAYS, now);
}

export function getOuraDailySyncWindow(now?: Date): OuraSyncWindow {
  return getWindowEndingOn(DAILY_SYNC_DAYS, now);
}

export function getOuraManualRefreshWindow(now?: Date): OuraSyncWindow {
  return getWindowEndingOn(MANUAL_REFRESH_DAYS, now);
}

// Cron sync window: at minimum the trailing 7 days (daily_activity/stress
// keep updating through the day; readiness finalizes next morning), extended
// back to lastSync - 2d when the connection stalled, floored at 30 days back
// so a very stale connection doesn't trigger a huge re-fetch on first cron run.
export function computeOuraCronSyncRange(
  now: Date,
  lastSyncAt: string | null,
): { start_date: string; end_date: string } {
  const dayString = (d: Date) => d.toISOString().slice(0, 10);
  const shift = (d: Date, days: number) => {
    const next = new Date(d);
    next.setUTCDate(next.getUTCDate() + days);
    return next;
  };
  let start = shift(now, -7);
  if (lastSyncAt) {
    const parsed = new Date(lastSyncAt);
    if (!Number.isNaN(parsed.getTime())) {
      const overlap = shift(parsed, -2);
      if (overlap < start) start = overlap;
    }
  }
  const floor = shift(now, -30);
  if (start < floor) start = floor;
  return { start_date: dayString(start), end_date: dayString(now) };
}

// heartrate + ring_battery_level use datetime params, not date params.
export function heartrateDatetimeRange(
  range: { start_date: string; end_date: string },
): { start_datetime: string; end_datetime: string } {
  return {
    start_datetime: `${range.start_date}T00:00:00Z`,
    end_datetime: `${range.end_date}T23:59:59Z`,
  };
}

// How far back before the newest stored sample the incremental fetch restarts.
// Covers samples the ring uploads out of order around the boundary; anything
// older than this is healed by a manual refresh (14-day window) or backfill.
export const HEARTRATE_WATERMARK_OVERLAP_MINUTES = 360;

// Incremental variant of heartrateDatetimeRange for the recurring cron sync.
//
// The cron range is sized for the DAILY AGGREGATES, which keep mutating for
// days (daily_activity/stress update through the day, readiness finalizes next
// morning) — hence the 7-day floor in computeOuraCronSyncRange. Heartrate
// samples are the opposite: immutable point telemetry, keyed (user_id, ts),
// that never changes once written. Re-upserting the whole aggregate window
// every hour rewrote ~7.2k unchanged rows per run (~173k row-updates/day for
// ~500 genuinely new samples) and made oura_heartrate_samples the single
// largest WAL producer in the database — the root cause of the Supabase Disk
// IO Budget warning on 2026-08-09.
//
// Given a watermark (newest stored sample), fetch only from there minus a
// small overlap. Falls back to the full window whenever the watermark is
// missing or unusable, so a first sync/backfill still pulls everything, and
// never widens beyond the range the caller asked for.
export function incrementalHeartrateDatetimeRange(
  range: { start_date: string; end_date: string },
  watermark: string | null,
): { start_datetime: string; end_datetime: string } {
  const full = heartrateDatetimeRange(range);
  if (!watermark) return full;

  const parsed = new Date(watermark);
  if (Number.isNaN(parsed.getTime())) return full;

  const from = new Date(parsed.getTime() - HEARTRATE_WATERMARK_OVERLAP_MINUTES * 60 * 1000);
  if (from <= new Date(full.start_datetime)) return full;

  return { start_datetime: from.toISOString(), end_datetime: full.end_datetime };
}
