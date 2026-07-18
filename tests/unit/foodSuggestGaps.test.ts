import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  computeNutrientGaps,
  gapsBucket,
  GAP_THRESHOLDS,
  hasMeaningfulGaps,
  localDateForTimestamp,
  localHourForTimestamp,
  SUGGEST_FROM_HOUR,
} from '../../src/lib/food/suggest/gaps';

const targets = {
  caloriesKcal: 2400,
  proteinG: 150,
  fatG: 80,
  carbsG: 250,
  fiberG: 35,
  waterMl: 2500,
};

test('gaps are target minus consumed, rounded, clamped at zero', () => {
  const gaps = computeNutrientGaps(
    { caloriesKcal: 1800.4, proteinG: 160, totalFatG: 50, carbsG: 200, fiberG: 20.6 },
    3000,
    targets,
  );
  assert.deepEqual(gaps, {
    caloriesKcal: 600,
    proteinG: 0,
    fatG: 30,
    carbsG: 50,
    fiberG: 14,
    waterMl: 0,
  });
});

test('missing totals count as zero consumed', () => {
  const gaps = computeNutrientGaps({}, 0, targets);
  assert.equal(gaps.caloriesKcal, 2400);
  assert.equal(gaps.proteinG, 150);
  assert.equal(gaps.waterMl, 2500);
});

test('hasMeaningfulGaps triggers on any single threshold', () => {
  const none = { caloriesKcal: 0, proteinG: 0, fatG: 0, carbsG: 0, fiberG: 0, waterMl: 0 };
  assert.equal(hasMeaningfulGaps(none), false);
  assert.equal(hasMeaningfulGaps({ ...none, caloriesKcal: GAP_THRESHOLDS.caloriesKcal }), true);
  assert.equal(hasMeaningfulGaps({ ...none, caloriesKcal: GAP_THRESHOLDS.caloriesKcal - 1 }), false);
  assert.equal(hasMeaningfulGaps({ ...none, proteinG: GAP_THRESHOLDS.proteinG }), true);
  assert.equal(hasMeaningfulGaps({ ...none, fiberG: GAP_THRESHOLDS.fiberG }), true);
  assert.equal(hasMeaningfulGaps({ ...none, waterMl: GAP_THRESHOLDS.waterMl }), true);
  assert.equal(hasMeaningfulGaps({ ...none, fatG: 80, carbsG: 250 }), false);
});

test('gapsBucket is stable under small fluctuations and changes under big ones', () => {
  const a = gapsBucket({ caloriesKcal: 610, proteinG: 42, fatG: 12, carbsG: 55, fiberG: 11, waterMl: 740 });
  const b = gapsBucket({ caloriesKcal: 640, proteinG: 44, fatG: 14, carbsG: 61, fiberG: 12, waterMl: 790 });
  const c = gapsBucket({ caloriesKcal: 900, proteinG: 44, fatG: 14, carbsG: 61, fiberG: 12, waterMl: 790 });
  assert.equal(a, b);
  assert.notEqual(b, c);
});

test('localDateForTimestamp converts across timezones (midnight crossing)', () => {
  assert.equal(localDateForTimestamp('2026-07-01T22:30:00.000Z', 'UTC'), '2026-07-01');
  assert.equal(localDateForTimestamp('2026-07-01T22:30:00.000Z', 'Asia/Novosibirsk'), '2026-07-02');
  assert.equal(localDateForTimestamp('garbage', 'UTC'), null);
});

test('localHourForTimestamp returns the local hour', () => {
  assert.equal(localHourForTimestamp('2026-07-01T14:59:00.000Z', 'UTC'), 14);
  assert.equal(localHourForTimestamp('2026-07-01T12:30:00.000Z', 'Europe/Moscow'), 15);
  assert.equal(localHourForTimestamp('garbage', 'UTC'), null);
  assert.equal(SUGGEST_FROM_HOUR, 15);
});
