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
