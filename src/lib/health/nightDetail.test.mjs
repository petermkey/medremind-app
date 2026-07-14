import assert from 'node:assert/strict';
import test from 'node:test';

import { hrvRecoveryDelta, parseSleepPhaseFeatures } from './nightDetail.ts';

test('parseSleepPhaseFeatures counts deep epochs in the first third and time to first deep', () => {
  const result = parseSleepPhaseFeatures('221112341234');
  assert.equal(result.deepSleepFirstThirdMinutes, 1);
  assert.equal(result.minutesToFirstDeepSleep, 1);
});

test('parseSleepPhaseFeatures returns null minutesToFirstDeepSleep when no deep sleep', () => {
  const result = parseSleepPhaseFeatures('222333444222');
  assert.equal(result.deepSleepFirstThirdMinutes, 0);
  assert.equal(result.minutesToFirstDeepSleep, null);
});

test('parseSleepPhaseFeatures rejects non-string and malformed input', () => {
  assert.deepEqual(parseSleepPhaseFeatures(undefined), {
    deepSleepFirstThirdMinutes: null,
    minutesToFirstDeepSleep: null,
  });
  assert.deepEqual(parseSleepPhaseFeatures('12x4'), {
    deepSleepFirstThirdMinutes: null,
    minutesToFirstDeepSleep: null,
  });
  assert.deepEqual(parseSleepPhaseFeatures(''), {
    deepSleepFirstThirdMinutes: null,
    minutesToFirstDeepSleep: null,
  });
});

test('hrvRecoveryDelta is second-half mean minus first-half mean, ignoring nulls', () => {
  const sample = { interval: 300, items: [30, 40, 50, 60, 70, 80], timestamp: '2026-07-01T23:00:00+03:00' };
  assert.equal(hrvRecoveryDelta(sample), 30);
});

test('hrvRecoveryDelta needs at least 3 non-null samples per half', () => {
  assert.equal(hrvRecoveryDelta({ interval: 300, items: [30, null, 50, 60, 70, 80] }), null);
  assert.equal(hrvRecoveryDelta({ interval: 300, items: [1, 2, 3] }), null);
  assert.equal(hrvRecoveryDelta(null), null);
  assert.equal(hrvRecoveryDelta({ items: 'nope' }), null);
});
