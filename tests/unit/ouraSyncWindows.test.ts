import assert from 'node:assert/strict';

import {
  getOuraBackfillWindow,
  getOuraDailySyncWindow,
  getOuraManualRefreshWindow,
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
