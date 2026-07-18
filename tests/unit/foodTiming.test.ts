import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MIN_FOOD_DAYS,
  SMART_SHIFT_CAP_MINUTES,
  computeAdjustedReminderTime,
  deriveEatingPattern,
  firesInSegments,
  hhmmFromMinutes,
  minutesFromHHMM,
  resolveSmartTimingActive,
  type EatingPattern,
} from '../../src/lib/push/foodTiming';

const PATTERN: EatingPattern = { daysWithData: 10, medianFirstMealMinutes: 540, medianLastMealMinutes: 1200 }; // 09:00–20:00

function adjust(overrides: Partial<Parameters<typeof computeAdjustedReminderTime>[0]>) {
  return computeAdjustedReminderTime({
    occurrenceMinutes: 585, withFood: 'no', pattern: PATTERN,
    isSnoozeReplacement: false, quietWindow: null, ...overrides,
  });
}

test('constants match the spec caps', () => {
  assert.equal(SMART_SHIFT_CAP_MINUTES, 90);
  assert.equal(MIN_FOOD_DAYS, 7);
});

test('deriveEatingPattern: medians over days, skipping empty days', () => {
  const days = [
    { firstMeal: '09:00', lastMeal: '20:00' },
    { firstMeal: '08:30', lastMeal: '19:00' },
    { firstMeal: null, lastMeal: null },
    { firstMeal: '09:30', lastMeal: '21:00' },
  ];
  const pattern = deriveEatingPattern(days);
  assert.equal(pattern.daysWithData, 3);
  assert.equal(pattern.medianFirstMealMinutes, 540);  // 09:00
  assert.equal(pattern.medianLastMealMinutes, 1200);  // 20:00
});

test('deriveEatingPattern: even count averages the middle pair', () => {
  const pattern = deriveEatingPattern([
    { firstMeal: '08:00', lastMeal: '19:00' },
    { firstMeal: '10:00', lastMeal: '21:00' },
  ]);
  assert.equal(pattern.medianFirstMealMinutes, 540);
  assert.equal(pattern.medianLastMealMinutes, 1200);
});

test('empty-stomach dose inside the eating window shifts to 30min before first meal', () => {
  // 09:45 inside [09:00, 20:00] → target 08:30 (510), delta -75 within cap
  assert.equal(adjust({ occurrenceMinutes: 585 }), 510);
});

test('empty-stomach dose already in the fasting window → no adjustment', () => {
  assert.equal(adjust({ occurrenceMinutes: 500 }), null);  // 08:20 < first meal
  assert.equal(adjust({ occurrenceMinutes: 1260 }), null); // 21:00 > last meal
});

test('cap: if ±90min cannot escape the eating window, do not adjust', () => {
  // 13:00 → target 08:30 needs -270; clamped -90 lands at 11:30, still inside → null
  assert.equal(adjust({ occurrenceMinutes: 780 }), null);
});

test('with-food dose far from any typical meal aligns toward the nearest meal, capped', () => {
  // 11:00, nearest meal 09:00 (dist 120 > 60) → shift by cap −90 → 09:30 (570)
  assert.equal(adjust({ occurrenceMinutes: 660, withFood: 'yes' }), 570);
});

test('with-food dose near a typical meal → no adjustment', () => {
  assert.equal(adjust({ occurrenceMinutes: 570, withFood: 'yes' }), null); // 30min from 09:00
});

test("withFood 'any'/null/unknown → never adjusted", () => {
  assert.equal(adjust({ withFood: 'any' }), null);
  assert.equal(adjust({ withFood: null }), null);
  assert.equal(adjust({ withFood: 'sometimes' }), null);
});

test('quiet-hours collision rejects the adjustment', () => {
  // pattern first meal 07:00; dose 07:30 → target 06:30 (390 min = 23400s),
  // quiet window 22:00→07:00 = [-7200, 25200] contains it → null
  const early: EatingPattern = { daysWithData: 10, medianFirstMealMinutes: 420, medianLastMealMinutes: 1200 };
  const result = computeAdjustedReminderTime({
    occurrenceMinutes: 450, withFood: 'no', pattern: early,
    isSnoozeReplacement: false, quietWindow: { start_offset: -7200, end_offset: 25200 },
  });
  assert.equal(result, null);
});

test('snooze replacements are never adjusted', () => {
  assert.equal(adjust({ isSnoozeReplacement: true }), null);
});

test('inert under 7 days of food data', () => {
  const thin: EatingPattern = { ...PATTERN, daysWithData: 6 };
  assert.equal(adjust({ pattern: thin }), null);
});

test('degenerate patterns are inert', () => {
  assert.equal(adjust({ pattern: { daysWithData: 10, medianFirstMealMinutes: null, medianLastMealMinutes: 1200 } }), null);
  assert.equal(adjust({ pattern: { daysWithData: 10, medianFirstMealMinutes: 600, medianLastMealMinutes: 600 } }), null);
});

test('resolveSmartTimingActive: strict-true setting AND enough data', () => {
  assert.equal(resolveSmartTimingActive(true, PATTERN), true);
  assert.equal(resolveSmartTimingActive(true, { ...PATTERN, daysWithData: 6 }), false);
  assert.equal(resolveSmartTimingActive(true, null), false);
  assert.equal(resolveSmartTimingActive(false, PATTERN), false);
  assert.equal(resolveSmartTimingActive(undefined, PATTERN), false); // 030 not applied → inert
});

test('firesInSegments: minute-granular inclusive match on the right date', () => {
  const segments = [{ date: '2026-07-18', startTime: '08:29:00', endTime: '08:31:59' }];
  assert.equal(firesInSegments('2026-07-18', 510, segments), true);   // 08:30
  assert.equal(firesInSegments('2026-07-18', 512, segments), false);  // 08:32
  assert.equal(firesInSegments('2026-07-17', 510, segments), false);  // wrong date
});

test('hhmm round-trip', () => {
  assert.equal(minutesFromHHMM('08:30'), 510);
  assert.equal(minutesFromHHMM('08:30:15'), 510);
  assert.equal(minutesFromHHMM('25:00'), null);
  assert.equal(minutesFromHHMM(undefined), null);
  assert.equal(hhmmFromMinutes(510), '08:30');
});
