import assert from 'node:assert/strict';

import {
  computeOuraCronSyncRange,
  getOuraBackfillWindow,
  getOuraDailySyncWindow,
  getOuraManualRefreshWindow,
  heartrateDatetimeRange,
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
