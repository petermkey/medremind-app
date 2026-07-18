import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  computeEatingWindow,
  computeEatingWindowStreak,
  formatWindowDuration,
} from '../../src/lib/nutrition/eatingWindow';

test('two meals in UTC produce first/last/window and no late flag', () => {
  const result = computeEatingWindow(
    [
      { consumedAt: '2026-07-01T11:20:00.000Z' },
      { consumedAt: '2026-07-01T19:05:00.000Z' },
    ],
    '2026-07-01',
    'UTC',
  );
  assert.equal(result.firstMeal, '11:20');
  assert.equal(result.lastMeal, '19:05');
  assert.equal(result.firstMealHour, 11.33);
  assert.equal(result.lastMealHour, 19.08);
  assert.equal(result.windowHours, 7.75);
  assert.equal(result.lateFlag, false);
  assert.equal(result.mealCount, 2);
});

test('meal order in the input array does not matter', () => {
  const result = computeEatingWindow(
    [
      { consumedAt: '2026-07-01T19:05:00.000Z' },
      { consumedAt: '2026-07-01T11:20:00.000Z' },
      { consumedAt: '2026-07-01T14:00:00.000Z' },
    ],
    '2026-07-01',
    'UTC',
  );
  assert.equal(result.firstMeal, '11:20');
  assert.equal(result.lastMeal, '19:05');
  assert.equal(result.mealCount, 3);
});

test('single-meal day has a zero-hour window', () => {
  const result = computeEatingWindow(
    [{ consumedAt: '2026-07-01T13:00:00.000Z' }],
    '2026-07-01',
    'UTC',
  );
  assert.equal(result.windowHours, 0);
  assert.equal(result.firstMeal, '13:00');
  assert.equal(result.lastMeal, '13:00');
  assert.equal(result.mealCount, 1);
});

test('empty day returns null window fields', () => {
  const result = computeEatingWindow([], '2026-07-01', 'UTC');
  assert.equal(result.firstMeal, null);
  assert.equal(result.lastMeal, null);
  assert.equal(result.windowHours, null);
  assert.equal(result.lateFlag, false);
  assert.equal(result.mealCount, 0);
});

test('late flag is true when the last meal is at or after 21:00 local time', () => {
  const late = computeEatingWindow(
    [
      { consumedAt: '2026-07-01T12:00:00.000Z' },
      { consumedAt: '2026-07-01T21:05:00.000Z' },
    ],
    '2026-07-01',
    'UTC',
  );
  assert.equal(late.lateFlag, true);

  const notLate = computeEatingWindow(
    [{ consumedAt: '2026-07-01T20:59:00.000Z' }],
    '2026-07-01',
    'UTC',
  );
  assert.equal(notLate.lateFlag, false);
});

test('midnight crossing counts a UTC-late meal toward the next eastern local date', () => {
  const entries = [
    { consumedAt: '2026-07-01T05:00:00.000Z' },
    { consumedAt: '2026-07-01T22:30:00.000Z' },
  ];
  const day1 = computeEatingWindow(entries, '2026-07-01', 'Asia/Novosibirsk');
  assert.equal(day1.mealCount, 1);
  assert.equal(day1.firstMeal, '12:00');
  assert.equal(day1.windowHours, 0);

  const day2 = computeEatingWindow(entries, '2026-07-02', 'Asia/Novosibirsk');
  assert.equal(day2.mealCount, 1);
  assert.equal(day2.firstMeal, '05:30');
});

test('per-entry timezone overrides the fallback timezone argument', () => {
  const entries = [{ consumedAt: '2026-07-01T23:30:00.000Z', timezone: 'Europe/Moscow' }];
  assert.equal(computeEatingWindow(entries, '2026-07-01', 'UTC').mealCount, 0);
  assert.equal(computeEatingWindow(entries, '2026-07-02', 'UTC').mealCount, 1);
});

test('invalid timestamps are ignored', () => {
  const result = computeEatingWindow(
    [{ consumedAt: 'not-a-date' }, { consumedAt: '2026-07-01T10:00:00.000Z' }],
    '2026-07-01',
    'UTC',
  );
  assert.equal(result.mealCount, 1);
});

test('streak counts consecutive days with a window of ten hours or less', () => {
  const entries = [
    { consumedAt: '2026-07-03T10:00:00.000Z' },
    { consumedAt: '2026-07-03T19:00:00.000Z' },
    { consumedAt: '2026-07-02T11:00:00.000Z' },
    { consumedAt: '2026-07-02T19:00:00.000Z' },
    { consumedAt: '2026-07-01T08:00:00.000Z' },
    { consumedAt: '2026-07-01T20:00:00.000Z' },
  ];
  assert.equal(computeEatingWindowStreak(entries, '2026-07-03', 'UTC'), 2);
});

test('a day with no meals breaks the streak', () => {
  const entries = [
    { consumedAt: '2026-07-03T10:00:00.000Z' },
    { consumedAt: '2026-07-03T18:00:00.000Z' },
    { consumedAt: '2026-07-01T10:00:00.000Z' },
    { consumedAt: '2026-07-01T18:00:00.000Z' },
  ];
  assert.equal(computeEatingWindowStreak(entries, '2026-07-03', 'UTC'), 1);
});

test('streak is zero when endDate has no meals', () => {
  assert.equal(computeEatingWindowStreak([], '2026-07-03', 'UTC'), 0);
});

test('streak respects maxDays cap', () => {
  const entries: { consumedAt: string }[] = [];
  for (let day = 1; day <= 9; day += 1) {
    const d = `2026-07-0${day}`;
    entries.push({ consumedAt: `${d}T10:00:00.000Z` }, { consumedAt: `${d}T18:00:00.000Z` });
  }
  assert.equal(computeEatingWindowStreak(entries, '2026-07-09', 'UTC', 5), 5);
});

test('formatWindowDuration renders hours and minutes', () => {
  assert.equal(formatWindowDuration(7.75), '7h45m');
  assert.equal(formatWindowDuration(0), '0h');
  assert.equal(formatWindowDuration(10), '10h');
  assert.equal(formatWindowDuration(0.5), '0h30m');
});
