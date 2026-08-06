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

  // Strict structured-output mode (OpenAI/OpenRouter/Gemini) requires `required`
  // to exactly match `Object.keys(properties)` at every level. A drift here
  // (e.g. a 9th micronutrient added to `properties` but not `required`, or
  // vice versa) would still leave the two assertions above green while every
  // production food-analysis call starts getting rejected with a 400 — a full
  // outage, worse than the original silent-empty-object bug this fixes.
  assert.deepEqual([...extendedSchema.required].sort(), [...extendedKeys].sort());
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

function draftWithExtended(extended: Record<string, unknown>) {
  return validateFoodAnalysisDraft({
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
      extended,
    },
    uncertainties: [],
    estimationConfidence: 0.5,
    model: 'test-model',
    schemaVersion: 'food-analysis-v1',
  });
}

// Now that `required` forces the model to emit all 8 keys on every response,
// most of them will legitimately be `null` for a typical meal. This exercises
// the null-drop path (cleanNumber/cleanNumericValue) that is newly load-bearing
// as a direct consequence of this workstream's schema fix.
test('validateFoodAnalysisDraft drops null extended keys and keeps only numeric ones', () => {
  const draft = draftWithExtended({
    vitaminCMg: 12.5,
    vitaminDMcg: null,
    vitaminAMcg: null,
    calciumMg: 200,
    ironMg: null,
    potassiumMg: null,
    magnesiumMg: 50,
    zincMg: null,
  });

  assert.deepEqual(draft.nutrients.extended, {
    vitaminCMg: 12.5,
    calciumMg: 200,
    magnesiumMg: 50,
  });
});

// When the model can't estimate any micronutrient for a meal, all 8 keys come
// back null. cleanNutrients must drop the whole `extended` object (not set an
// empty one), so foodSync.ts's `nutrients.extended ?? {}` still writes `{}` —
// same behavior as before this workstream, no regression.
test('validateFoodAnalysisDraft drops extended entirely when every key is null', () => {
  const draft = draftWithExtended({
    vitaminCMg: null,
    vitaminDMcg: null,
    vitaminAMcg: null,
    calciumMg: null,
    ironMg: null,
    potassiumMg: null,
    magnesiumMg: null,
    zincMg: null,
  });

  assert.equal(draft.nutrients.extended, undefined);
});
