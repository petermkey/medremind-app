import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FOOD_ANALYSIS_SCHEMA } from '../../src/lib/food/analyze/providers';
import { validateFoodAnalysisDraft } from '../../src/lib/food/analysisSchema';

// WS5 regression coverage: src/lib/food/analyze/providers.ts's FOOD_ANALYSIS_SCHEMA
// once defined `extended` as `{ additionalProperties: false, properties: {}, required: [] }`,
// which under strict structured-output JSON-Schema only ever validates a zero-key
// object — the model was structurally forbidden from ever reporting a micronutrient.
const EXPECTED_EXTENDED_KEYS = [
  'vitaminCMg',
  'vitaminDMcg',
  'vitaminAMcg',
  'calciumMg',
  'ironMg',
  'potassiumMg',
  'magnesiumMg',
  'zincMg',
];

test('FOOD_ANALYSIS_SCHEMA exposes the bounded extended micronutrient keys', () => {
  const extendedSchema = FOOD_ANALYSIS_SCHEMA.properties.nutrients.properties.extended;
  const extendedKeys = Object.keys(extendedSchema.properties);

  for (const key of EXPECTED_EXTENDED_KEYS) {
    assert.ok(extendedKeys.includes(key), `expected extended schema to include "${key}"`);
  }
  assert.equal(extendedKeys.length, EXPECTED_EXTENDED_KEYS.length);
  assert.equal(extendedSchema.additionalProperties, false);
});

// Regression guard: analysisSchema.ts's cleanNutrients (reached here through the
// exported validateFoodAnalysisDraft) already handles arbitrary `extended` key/value
// pairs correctly — this was true before this fix and must remain true after it.
test('validateFoodAnalysisDraft carries populated extended nutrients through unchanged', () => {
  const draft = validateFoodAnalysisDraft({
    title: 'Test meal',
    summary: 'A test meal used for extended-nutrients regression coverage.',
    mealLabel: 'lunch',
    components: [
      {
        name: 'Test component',
        category: 'test',
        estimatedQuantity: 1,
        estimatedUnit: 'serving',
        gramsEstimate: 100,
        confidence: 0.5,
        notes: null,
      },
    ],
    nutrients: {
      caloriesKcal: 100,
      extended: { vitaminCMg: 12.5, ironMg: 3 },
    },
    uncertainties: [],
    estimationConfidence: 0.5,
    model: 'test-model',
    schemaVersion: 'food-analysis-v1',
  });

  assert.deepEqual(draft.nutrients.extended, { vitaminCMg: 12.5, ironMg: 3 });
});
