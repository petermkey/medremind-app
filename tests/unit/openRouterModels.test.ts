import assert from 'node:assert/strict';
import {
  getOpenRouterFoodVisionModels,
  shouldFallbackOpenRouterFoodModel,
} from '../../src/lib/food/analyze/openRouterModels';

{
  const models = getOpenRouterFoodVisionModels({});

  assert.deepEqual(models, [
    'google/gemma-4-31b-it:free',
    'google/gemini-2.5-flash',
  ]);
}

{
  const models = getOpenRouterFoodVisionModels({
    OPENROUTER_FOOD_VISION_MODEL: 'google/gemma-4-26b-a4b-it:free',
    OPENROUTER_FOOD_VISION_FALLBACK_MODEL: 'google/gemini-2.5-flash',
  });

  assert.deepEqual(models, [
    'google/gemma-4-26b-a4b-it:free',
    'google/gemini-2.5-flash',
  ]);
}

{
  const models = getOpenRouterFoodVisionModels({
    OPENROUTER_FOOD_VISION_MODEL: 'google/gemma-4-31b-it:free',
    OPENROUTER_FOOD_VISION_FALLBACK_MODEL: 'google/gemma-4-31b-it:free',
  });

  assert.deepEqual(models, ['google/gemma-4-31b-it:free']);
}

{
  assert.equal(
    shouldFallbackOpenRouterFoodModel(429, 'google/gemma-4-31b-it:free', 'google/gemini-2.5-flash'),
    true,
  );
  assert.equal(
    shouldFallbackOpenRouterFoodModel(404, 'google/gemma-4-31b-it:free', 'google/gemini-2.5-flash'),
    true,
  );
  assert.equal(
    shouldFallbackOpenRouterFoodModel(401, 'google/gemma-4-31b-it:free', 'google/gemini-2.5-flash'),
    false,
  );
  assert.equal(
    shouldFallbackOpenRouterFoodModel(429, 'google/gemma-4-31b-it:free', 'google/gemma-4-31b-it:free'),
    false,
  );
}
