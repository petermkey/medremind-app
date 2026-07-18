import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  aggregateFoodDailyAverages,
  buildNutrientBalanceReport,
  dosesPerDay,
} from '../../src/lib/nutrientBalance/engine';

function findingFor(
  report: ReturnType<typeof buildNutrientBalanceReport>,
  bucket: 'deficits' | 'covered' | 'excess',
  key: string,
) {
  return report.buckets[bucket].find(finding => finding.nutrientKey === key);
}

test('dosesPerDay maps frequency types conservatively', () => {
  assert.equal(dosesPerDay('daily', ['08:00']), 1);
  assert.equal(dosesPerDay('daily', ['08:00', '20:00']), 2);
  assert.equal(dosesPerDay('daily', null), 1);
  assert.equal(dosesPerDay('twice_daily', null), 2);
  assert.equal(dosesPerDay('three_times_daily', null), 3);
  assert.equal(Math.round(dosesPerDay('weekly', null) * 1000) / 1000, 0.143);
  assert.equal(dosesPerDay('every_n_hours', null), 1);
  assert.equal(dosesPerDay('custom', null), 1);
});

test('aggregateFoodDailyAverages reads typed columns and extended aliases', () => {
  const avg = aggregateFoodDailyAverages(
    [
      { protein_g: 40, fiber_g: 10, extended_nutrients: { magnesium: 100, vitamin_d: 5 } },
      { protein_g: 60, fiber_g: 10, extended_nutrients: { magnesiumMg: 100, unknownStuff: 9 } },
    ],
    2,
  );
  assert.equal(avg.proteinG, 50);
  assert.equal(avg.fiberG, 10);
  assert.equal(avg.magnesiumMg, 100);
  assert.equal(avg.vitaminDMcg, 2.5);
  assert.equal(avg.unknownStuff, undefined);
});

test('deficit: total below 70% of target lands in deficits (profile target overrides RDA)', () => {
  const report = buildNutrientBalanceReport({
    foodDailyAvg: { fiberG: 12 },
    stack: [],
    targets: { fiberG: 35 },
  });
  const fiber = findingFor(report, 'deficits', 'fiberG');
  assert.ok(fiber);
  assert.equal(fiber.target, 35);
  assert.equal(fiber.totalPerDay, 12);

  const boundary = buildNutrientBalanceReport({
    foodDailyAvg: { fiberG: 24.5 },
    stack: [],
    targets: { fiberG: 35 },
  });
  assert.equal(findingFor(boundary, 'deficits', 'fiberG'), undefined);
});

test('covered/redundant: food supplies >=75% of target AND a supplement adds more', () => {
  const report = buildNutrientBalanceReport({
    foodDailyAvg: { omega3EpaDhaMg: 220 },
    stack: [
      { displayName: 'Omega-3', nutrients: { omega3EpaDhaMg: 600 }, dosesPerDay: 1, validationStatus: 'verified' },
    ],
    targets: {},
  });
  const omega = findingFor(report, 'covered', 'omega3EpaDhaMg');
  assert.ok(omega);
  assert.equal(omega.stackPerDay, 600);
  assert.equal(omega.unverified, false);
  assert.deepEqual(omega.contributors, [
    { displayName: 'Omega-3', amountPerDay: 600, validationStatus: 'verified' },
  ]);
});

test('excess with supplemental UL scope uses stack-only basis (magnesium)', () => {
  const report = buildNutrientBalanceReport({
    foodDailyAvg: { magnesiumMg: 200 },
    stack: [
      { displayName: 'Mg glycinate', nutrients: { magnesiumMg: 150 }, dosesPerDay: 2, validationStatus: 'pending' },
    ],
    targets: {},
  });
  const magnesium = findingFor(report, 'excess', 'magnesiumMg');
  assert.ok(magnesium);
  assert.equal(magnesium.stackPerDay, 300);
  assert.equal(magnesium.unverified, true);
});

test('excess with total UL scope uses food+stack basis (zinc)', () => {
  const report = buildNutrientBalanceReport({
    foodDailyAvg: { zincMg: 10 },
    stack: [{ displayName: 'Zinc', nutrients: { zincMg: 25 }, dosesPerDay: 1, validationStatus: 'verified' }],
    targets: {},
  });
  assert.ok(findingFor(report, 'excess', 'zincMg'));

  const below = buildNutrientBalanceReport({
    foodDailyAvg: { zincMg: 5 },
    stack: [{ displayName: 'Zinc', nutrients: { zincMg: 10 }, dosesPerDay: 1, validationStatus: 'verified' }],
    targets: {},
  });
  assert.equal(findingFor(below, 'excess', 'zincMg'), undefined);
});

test('nutrients with zero data everywhere are skipped (no data is not a deficit)', () => {
  const report = buildNutrientBalanceReport({ foodDailyAvg: {}, stack: [], targets: {} });
  assert.equal(report.buckets.deficits.length, 0);
  assert.equal(report.buckets.covered.length, 0);
  assert.equal(report.buckets.excess.length, 0);
});

test('rejected facts are excluded from the math entirely', () => {
  const report = buildNutrientBalanceReport({
    foodDailyAvg: {},
    stack: [
      { displayName: 'Bad extract', nutrients: { zincMg: 500 }, dosesPerDay: 1, validationStatus: 'rejected' },
    ],
    targets: {},
  });
  assert.equal(findingFor(report, 'excess', 'zincMg'), undefined);
});

test('deficits sort by severity (lowest % of target first)', () => {
  const report = buildNutrientBalanceReport({
    foodDailyAvg: { fiberG: 20, proteinG: 30 },
    stack: [],
    targets: { fiberG: 35, proteinG: 150 },
  });
  assert.equal(report.buckets.deficits[0].nutrientKey, 'proteinG');
});
