import assert from 'node:assert/strict';
import test from 'node:test';

import { chunkRows, parseHeartrateRows } from './heartrateSamples.ts';

test('parseHeartrateRows keeps valid rows and drops malformed ones', () => {
  const rows = parseHeartrateRows([
    { timestamp: '2026-07-13T09:05:00+00:00', bpm: 62, source: 'awake' },
    { timestamp: '2026-07-13T09:10:00+00:00', bpm: 300, source: 'awake' },
    { timestamp: 'not-a-date', bpm: 60, source: 'rest' },
    { timestamp: '2026-07-13T09:15:00+00:00', bpm: 58, source: 'martian' },
    'garbage',
    { timestamp: '2026-07-13T09:20:00+00:00', bpm: 71, source: 'workout' },
  ]);
  assert.deepEqual(rows, [
    { ts: '2026-07-13T09:05:00+00:00', bpm: 62, source: 'awake' },
    { ts: '2026-07-13T09:20:00+00:00', bpm: 71, source: 'workout' },
  ]);
});

test('parseHeartrateRows tolerates non-array input', () => {
  assert.deepEqual(parseHeartrateRows(undefined), []);
  assert.deepEqual(parseHeartrateRows({ data: [] }), []);
});

test('chunkRows splits into fixed-size chunks', () => {
  assert.deepEqual(chunkRows([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunkRows([], 2), []);
});
