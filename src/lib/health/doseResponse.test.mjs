import assert from 'node:assert/strict';
import test from 'node:test';

import { dailyDoseResponseRows, daytimeAvgHr, postDoseHrDelta } from './doseResponse.ts';

const s = (iso, bpm, source = 'awake') => ({ ts: iso, bpm, source });

test('postDoseHrDelta: median(post) - median(pre) per dose, averaged', () => {
  const dose = '2026-07-13T09:00:00Z';
  const samples = [
    s('2026-07-13T08:10:00Z', 70), s('2026-07-13T08:30:00Z', 72), s('2026-07-13T08:50:00Z', 74),
    s('2026-07-13T09:20:00Z', 62), s('2026-07-13T10:00:00Z', 64), s('2026-07-13T10:40:00Z', 66),
  ];
  assert.equal(postDoseHrDelta(samples, [dose]), -8);
});

test('postDoseHrDelta ignores workout/sleep samples and thin windows', () => {
  const dose = '2026-07-13T09:00:00Z';
  const samples = [
    s('2026-07-13T08:10:00Z', 70), s('2026-07-13T08:30:00Z', 72), s('2026-07-13T08:50:00Z', 74),
    s('2026-07-13T09:20:00Z', 130, 'workout'), s('2026-07-13T10:00:00Z', 64), s('2026-07-13T10:40:00Z', 66),
  ];
  assert.equal(postDoseHrDelta(samples, [dose]), null);
  assert.equal(postDoseHrDelta([], [dose]), null);
  assert.equal(postDoseHrDelta(samples, []), null);
});

test('daytimeAvgHr averages awake/rest samples in the 08:00-22:00 local window', () => {
  const samples = [];
  for (let i = 0; i < 12; i += 1) {
    samples.push(s(`2026-07-13T${String(9 + Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}:00Z`, 60 + i));
  }
  samples.push(s('2026-07-13T02:00:00Z', 45, 'sleep'));
  samples.push(s('2026-07-13T09:05:00Z', 150, 'workout'));
  const result = daytimeAvgHr(samples, '2026-07-13', 'UTC');
  assert.equal(result, 65.5);
});

test('daytimeAvgHr needs at least 12 qualifying samples', () => {
  assert.equal(daytimeAvgHr([s('2026-07-13T09:00:00Z', 60)], '2026-07-13', 'UTC'), null);
});

test('dailyDoseResponseRows emits one row per date in range', () => {
  const samples = [
    s('2026-07-13T08:10:00Z', 70), s('2026-07-13T08:30:00Z', 72), s('2026-07-13T08:50:00Z', 74),
    s('2026-07-13T09:20:00Z', 62), s('2026-07-13T10:00:00Z', 64), s('2026-07-13T10:40:00Z', 66),
  ];
  const rows = dailyDoseResponseRows(samples, ['2026-07-13T09:00:00Z'], '2026-07-12', '2026-07-13', 'UTC');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { local_date: '2026-07-12', post_dose_hr_delta_bpm: null, daytime_avg_hr: null });
  assert.equal(rows[1].local_date, '2026-07-13');
  assert.equal(rows[1].post_dose_hr_delta_bpm, -8);
});
