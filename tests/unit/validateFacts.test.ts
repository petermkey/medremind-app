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

test('validateNutrientFact verifies a mainstream OTC dose of a supplemental-scope nutrient', () => {
  // niacinMg UL is 35mg but ulScope is 'supplemental' (see limits.ts): the UL
  // applies only to the supplemental-intake portion, so common OTC niacin
  // products (e.g. 500mg) legitimately sit far above it. At the old flat 10x
  // multiplier this would have wrongly been rejected (10x ceiling = 350mg);
  // with the 100x supplemental ceiling (3500mg) it must verify.
  const result = validateNutrientFact({
    normalizedName: 'niacin 500mg',
    doseAmount: 500,
    doseUnit: 'mg',
    nutrients: { niacinMg: 500 },
  });
  assert.equal(result.status, 'verified');
  assert.deepEqual(result.reasons, []);
});

test('validateNutrientFact rejects a supplemental-scope nutrient far past its 100x ceiling', () => {
  // niacinMg UL is 35mg, ulScope 'supplemental' -> 100x ceiling = 3500mg.
  // 10000mg is well past that, representative of a unit-confusion error.
  const result = validateNutrientFact({
    normalizedName: 'niacin mislabeled',
    doseAmount: 10000,
    doseUnit: 'mg',
    nutrients: { niacinMg: 10000 },
  });
  assert.equal(result.status, 'rejected');
  assert.ok(result.reasons.length > 0);
  assert.match(result.reasons[0], /niacinMg/);
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
