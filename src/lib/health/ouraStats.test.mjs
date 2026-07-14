import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyDelta,
  medianOfPreviousDays,
  normalizeBars,
  pickDisplayNight,
  weeklyBuckets,
} from './ouraStats.ts';

const days = Array.from({ length: 40 }, (_, index) => ({
  localDate: `2026-06-${String(index + 1).padStart(2, '0')}`,
  sleepScore: index + 1,
  temperatureDeviation: index % 2 === 0 ? 0.2 : -0.2,
  nonWearMinutes: index === 38 ? 600 : 0,
}));

test('medianOfPreviousDays requires seven prior values and excludes the displayed day', () => {
  assert.equal(medianOfPreviousDays(days, 5, 'sleepScore'), null);
  assert.equal(medianOfPreviousDays(days, 10, 'sleepScore'), 5.5);
});

test('classifyDelta respects direction and noise floor', () => {
  assert.equal(classifyDelta('sleepScore', 83, 80).tone, 'positive');
  assert.equal(classifyDelta('sleepScore', 81, 80).tone, 'neutral');
  assert.equal(classifyDelta('restingHeartRate', 55, 60).tone, 'positive');
  assert.equal(classifyDelta('restingHeartRate', 63, 60).tone, 'negative');
  assert.equal(classifyDelta('temperatureDeviation', 0.2, 0).tone, 'neutral');
  assert.equal(classifyDelta('temperatureDeviation', 0.4, 0).tone, 'warning');
  assert.equal(classifyDelta('temperatureDeviation', -0.6, 0).tone, 'negative');
});

test('pickDisplayNight falls back to the latest day with sleep data', () => {
  const result = pickDisplayNight([
    { localDate: '2026-07-12', sleepScore: 82, deepSleepMinutes: null },
    { localDate: '2026-07-13', sleepScore: null, deepSleepMinutes: null },
  ]);
  assert.deepEqual(result, {
    day: { localDate: '2026-07-12', sleepScore: 82, deepSleepMinutes: null },
    index: 0,
    isFallback: true,
  });
});

test('weeklyBuckets groups by Monday-start calendar weeks across month boundaries', () => {
  const buckets = weeklyBuckets([
    { localDate: '2026-06-29', vo2Max: 40 },
    { localDate: '2026-06-30', vo2Max: 42 },
    { localDate: '2026-07-05', vo2Max: 44 },
    { localDate: '2026-07-06', vo2Max: 50 },
  ], 'vo2Max');
  assert.deepEqual(buckets, [
    { startDate: '2026-06-29', endDate: '2026-07-05', average: 42 },
    { startDate: '2026-07-06', endDate: '2026-07-12', average: 50 },
  ]);
});

test('normalizeBars preserves missing values, fixed domains, and low-wear opacity', () => {
  const bars = normalizeBars({
    values: [null, 0, 50, 100],
    lowWearMask: [false, false, true, false],
    fixedDomain: [0, 100],
  });
  assert.deepEqual(bars, [
    { value: null, y: 0, height: 0, opacity: 0 },
    { value: 0, y: 1, height: 0, opacity: 0.8 },
    { value: 50, y: 0.5, height: 0.5, opacity: 0.3 },
    { value: 100, y: 0, height: 1, opacity: 1 },
  ]);
});
