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
