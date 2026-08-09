import assert from 'node:assert/strict';

import {
  computeOuraCronSyncRange,
  getOuraBackfillWindow,
  getOuraDailySyncWindow,
  getOuraManualRefreshWindow,
  heartrateDatetimeRange,
  incrementalHeartrateDatetimeRange,
} from '../../src/lib/oura/syncWindows';

{
  const now = new Date('2026-04-26T23:59:59.999Z');

  assert.deepEqual(getOuraBackfillWindow(now), {
    startDate: '2026-01-27',
    endDate: '2026-04-26',
    days: 90,
  });
}

{
  const now = new Date('2026-04-26T00:00:00.000Z');

  assert.deepEqual(getOuraDailySyncWindow(now), {
    startDate: '2026-04-20',
    endDate: '2026-04-26',
    days: 7,
  });
}

{
  const now = new Date('2026-03-01T12:00:00.000Z');

  assert.deepEqual(getOuraManualRefreshWindow(now), {
    startDate: '2026-02-16',
    endDate: '2026-03-01',
    days: 14,
  });
}

{
  const now = new Date('2026-07-10T12:00:00.000Z');
  assert.deepEqual(computeOuraCronSyncRange(now, null), {
    start_date: '2026-07-03',
    end_date: '2026-07-10',
  });
}

{
  const now = new Date('2026-07-10T12:00:00.000Z');
  assert.deepEqual(computeOuraCronSyncRange(now, '2026-06-25T10:00:00.000Z'), {
    start_date: '2026-06-23',
    end_date: '2026-07-10',
  });
}

{
  const now = new Date('2026-07-10T12:00:00.000Z');
  assert.deepEqual(computeOuraCronSyncRange(now, '2026-04-26T23:33:21.000Z'), {
    start_date: '2026-06-10',
    end_date: '2026-07-10',
  });
}

{
  assert.deepEqual(
    heartrateDatetimeRange({ start_date: '2026-07-07', end_date: '2026-07-14' }),
    { start_datetime: '2026-07-07T00:00:00Z', end_datetime: '2026-07-14T23:59:59Z' },
  );
}

// ── incrementalHeartrateDatetimeRange ────────────────────────────────────
// Heartrate samples are immutable point telemetry, so the hourly cron only
// needs the tail since the newest stored sample — not a full restatement of
// the 7-day aggregate window.
const HR_RANGE = { start_date: '2026-07-07', end_date: '2026-07-14' };

// No watermark (first sync for this user) — must fall back to the full window
// so an initial backfill still pulls everything.
{
  assert.deepEqual(incrementalHeartrateDatetimeRange(HR_RANGE, null), {
    start_datetime: '2026-07-07T00:00:00Z',
    end_datetime: '2026-07-14T23:59:59Z',
  });
}

// Unparseable watermark degrades to the full window rather than guessing.
{
  assert.deepEqual(incrementalHeartrateDatetimeRange(HR_RANGE, 'not-a-timestamp'), {
    start_datetime: '2026-07-07T00:00:00Z',
    end_datetime: '2026-07-14T23:59:59Z',
  });
}

// Watermark well inside the window — start rewinds by the overlap only.
{
  assert.deepEqual(
    incrementalHeartrateDatetimeRange(HR_RANGE, '2026-07-14T09:30:00.000Z'),
    { start_datetime: '2026-07-14T03:30:00.000Z', end_datetime: '2026-07-14T23:59:59Z' },
  );
}

// Watermark so old that watermark-minus-overlap predates the window start —
// never widen past the range the caller asked for.
{
  assert.deepEqual(incrementalHeartrateDatetimeRange(HR_RANGE, '2026-07-07T02:00:00.000Z'), {
    start_datetime: '2026-07-07T00:00:00Z',
    end_datetime: '2026-07-14T23:59:59Z',
  });
}

// Stale connection: watermark days back but still inside the window — we catch
// up from there, which is self-limiting and never skips unsynced samples.
{
  assert.deepEqual(
    incrementalHeartrateDatetimeRange(HR_RANGE, '2026-07-11T12:00:00.000Z'),
    { start_datetime: '2026-07-11T06:00:00.000Z', end_datetime: '2026-07-14T23:59:59Z' },
  );
}
