import assert from 'node:assert/strict';
import test from 'node:test';

import { buildWeeklyAggregate } from './aggregate.ts';

const WEEK = { weekStart: '2026-07-06', timezone: 'UTC' }; // Mon Jul 6 – Sun Jul 12

function food(dateTime, kcal, protein, fiber, sugars) {
  return { consumed_at: dateTime, calories_kcal: kcal, protein_g: protein, fiber_g: fiber, sugars_g: sugars };
}

test('food totals group by LOCAL day and average over logged days only', () => {
  const aggregate = buildWeeklyAggregate({
    ...WEEK,
    foodEntries: [
      food('2026-07-06T09:00:00.000Z', 500, 30, 8, 10),
      food('2026-07-06T19:00:00.000Z', 700, 40, 6, 20),
      food('2026-07-07T12:00:00.000Z', 900, 50, 10, 15),
      // outside the week — must be ignored:
      food('2026-07-13T09:00:00.000Z', 999, 99, 99, 99),
    ],
    waterEntries: [
      { consumed_at: '2026-07-06T10:00:00.000Z', amount_ml: 500 },
      { consumed_at: '2026-07-07T10:00:00.000Z', amount_ml: 1500 },
    ],
    occurrences: [],
    ouraDays: [],
    eatingWindows: [],
  });
  assert.equal(aggregate.weekStart, '2026-07-06');
  assert.equal(aggregate.weekEnd, '2026-07-12');
  assert.equal(aggregate.food.days.length, 2);
  assert.deepEqual(aggregate.food.days[0], { date: '2026-07-06', kcal: 1200, proteinG: 70, fiberG: 14, sugarsG: 30, meals: 2 });
  assert.deepEqual(aggregate.food.weekAvg, { kcal: 1050, proteinG: 60, fiberG: 12, sugarsG: 23 });
  assert.equal(aggregate.waterAvgMlPerDay, 1000);
});

test('timezone assigns a late-UTC entry to the correct local day', () => {
  const aggregate = buildWeeklyAggregate({
    weekStart: '2026-07-06',
    timezone: 'Europe/Moscow', // UTC+3
    foodEntries: [food('2026-07-06T22:30:00.000Z', 300, 10, 2, 5)], // 01:30 Jul 7 local
    waterEntries: [], occurrences: [], ouraDays: [], eatingWindows: [],
  });
  assert.equal(aggregate.food.days[0].date, '2026-07-07');
});

test('adherence percent and per-day counts from derived statuses', () => {
  const aggregate = buildWeeklyAggregate({
    ...WEEK,
    foodEntries: [], waterEntries: [], ouraDays: [], eatingWindows: [],
    occurrences: [
      { occurrence_date: '2026-07-06', derived_status: 'taken' },
      { occurrence_date: '2026-07-06', derived_status: 'taken' },
      { occurrence_date: '2026-07-07', derived_status: 'skipped' },
      { occurrence_date: '2026-07-08', derived_status: 'planned' },
    ],
  });
  assert.equal(aggregate.adherence.plannedCount, 4);
  assert.equal(aggregate.adherence.takenCount, 2);
  assert.equal(aggregate.adherence.skippedCount, 1);
  assert.equal(aggregate.adherence.adherencePct, 50);
  assert.deepEqual(aggregate.adherence.byDay[0], { date: '2026-07-06', planned: 2, taken: 2 });
});

test('oura splits review week vs previous week and reports deltas', () => {
  const aggregate = buildWeeklyAggregate({
    ...WEEK,
    foodEntries: [], waterEntries: [], occurrences: [], eatingWindows: [],
    ouraDays: [
      { local_date: '2026-06-30', readiness_score: 70, sleep_score: 70, sleep_avg_hrv: 50, steps: 8000 },
      { local_date: '2026-07-01', readiness_score: 74, sleep_score: 72, sleep_avg_hrv: 54, steps: 10000 },
      { local_date: '2026-07-06', readiness_score: 80, sleep_score: 78, sleep_avg_hrv: 60, steps: 12000 },
      { local_date: '2026-07-07', readiness_score: 84, sleep_score: 80, sleep_avg_hrv: 64, steps: 14000 },
    ],
  });
  assert.deepEqual(aggregate.oura.reviewWeek, { readinessAvg: 82, sleepAvg: 79, hrvAvg: 62, stepsAvg: 13000 });
  assert.deepEqual(aggregate.oura.previousWeek, { readinessAvg: 72, sleepAvg: 71, hrvAvg: 52, stepsAvg: 9000 });
  assert.deepEqual(aggregate.oura.delta, { readiness: 10, sleep: 8, hrv: 10, steps: 4000 });
});

test('eating window stats: average hours and late-meal day count', () => {
  const aggregate = buildWeeklyAggregate({
    ...WEEK,
    foodEntries: [], waterEntries: [], occurrences: [], ouraDays: [],
    eatingWindows: [
      { localDate: '2026-07-06', windowHours: 10, lateFlag: false },
      { localDate: '2026-07-07', windowHours: 12, lateFlag: true },
      { localDate: '2026-07-08', windowHours: null, lateFlag: false },
    ],
  });
  assert.deepEqual(aggregate.eatingWindow, { avgWindowHours: 11, lateMealDays: 1 });
});

test('loggedDaysCount counts days with food OR an actioned dose; sparse weeks are flagged by the caller', () => {
  const aggregate = buildWeeklyAggregate({
    ...WEEK,
    foodEntries: [food('2026-07-06T09:00:00.000Z', 500, 30, 8, 10)],
    waterEntries: [],
    occurrences: [
      { occurrence_date: '2026-07-06', derived_status: 'taken' }, // same day as food — still 1 logged day
      { occurrence_date: '2026-07-09', derived_status: 'skipped' },
      { occurrence_date: '2026-07-10', derived_status: 'planned' }, // unactioned → not a logged day
    ],
    ouraDays: [], eatingWindows: [],
  });
  assert.equal(aggregate.loggedDaysCount, 2);
});

test('empty blocks come back null, not fabricated zeros', () => {
  const aggregate = buildWeeklyAggregate({
    ...WEEK, foodEntries: [], waterEntries: [], occurrences: [], ouraDays: [], eatingWindows: [],
  });
  assert.equal(aggregate.food, null);
  assert.equal(aggregate.waterAvgMlPerDay, null);
  assert.equal(aggregate.oura, null);
  assert.equal(aggregate.eatingWindow, null);
  assert.equal(aggregate.adherence.plannedCount, 0);
  assert.equal(aggregate.loggedDaysCount, 0);
});
