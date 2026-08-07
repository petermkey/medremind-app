import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateNutrientFact } from '../../src/lib/nutrientBalance/validateFacts';

test('validateNutrientFact verifies a plausible omega-3 fact', () => {
  const result = validateNutrientFact({
    normalizedName: 'omega-3 fish oil',
    doseAmount: 1000,
    doseUnit: 'mg',
    nutrients: { omega3EpaDhaMg: 500 },
  });
  assert.equal(result.status, 'verified');
  assert.deepEqual(result.reasons, []);
});

test('validateNutrientFact rejects a nutrient at 50x its UL with a reason', () => {
  // zincMg UL is 40mg (see limits.ts); 50x = 2000mg, well past any plausible dose.
  const result = validateNutrientFact({
    normalizedName: 'zinc picolinate',
    doseAmount: 2000,
    doseUnit: 'mg',
    nutrients: { zincMg: 2000 },
  });
  assert.equal(result.status, 'rejected');
  assert.ok(result.reasons.length > 0);
  assert.match(result.reasons[0], /zincMg/);
});

test('validateNutrientFact rejects negative or NaN nutrient values', () => {
  const negative = validateNutrientFact({
    normalizedName: 'magnesium glycinate',
    doseAmount: 200,
    doseUnit: 'mg',
    nutrients: { magnesiumMg: -5 },
  });
  assert.equal(negative.status, 'rejected');
  assert.ok(negative.reasons.length > 0);

  const notFinite = validateNutrientFact({
    normalizedName: 'magnesium glycinate',
    doseAmount: 200,
    doseUnit: 'mg',
    nutrients: { magnesiumMg: Number.NaN },
  });
  assert.equal(notFinite.status, 'rejected');
  assert.ok(notFinite.reasons.length > 0);

  const infinite = validateNutrientFact({
    normalizedName: 'magnesium glycinate',
    doseAmount: 200,
    doseUnit: 'mg',
    nutrients: { magnesiumMg: Number.POSITIVE_INFINITY },
  });
  assert.equal(infinite.status, 'rejected');
  assert.ok(infinite.reasons.length > 0);
});

test('validateNutrientFact rejects an empty nutrients object', () => {
  const result = validateNutrientFact({
    normalizedName: 'mystery pill',
    doseAmount: 1,
    doseUnit: 'mg',
    nutrients: {},
  });
  assert.equal(result.status, 'rejected');
  assert.deepEqual(result.reasons, ['no extractable nutrients']);
});
