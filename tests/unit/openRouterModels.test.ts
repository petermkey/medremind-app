import assert from 'node:assert/strict';
import {
  getOpenRouterFoodVisionModels,
  shouldFallbackOpenRouterFoodModel,
} from '../../src/lib/food/analyze/openRouterModels';

{
  const models = getOpenRouterFoodVisionModels({});

  assert.deepEqual(models, ['openai/gpt-4o-mini']);
}

{
  const models = getOpenRouterFoodVisionModels({
    OPENROUTER_FOOD_VISION_MODEL: 'google/gemma-4-26b-a4b-it:free',
    OPENROUTER_FOOD_VISION_FALLBACK_MODEL: 'openai/gpt-4o-mini',
  });

  assert.deepEqual(models, [
    'google/gemma-4-26b-a4b-it:free',
    'openai/gpt-4o-mini',
  ]);
}

{
  const models = getOpenRouterFoodVisionModels({
    OPENROUTER_FOOD_VISION_MODEL: 'google/gemma-4-31b-it:free',
    OPENROUTER_FOOD_VISION_FALLBACK_MODEL: 'google/gemma-4-31b-it:free',
  });

  // The code default is always appended as a terminal fallback, even when
  // primary and fallback are identical.
  assert.deepEqual(models, ['google/gemma-4-31b-it:free', 'openai/gpt-4o-mini']);
}

{
  // Regression for the 2026-07-09 incident: both env-pinned models were
  // retired by OpenRouter (404), so the chain must still end on a live model.
  const models = getOpenRouterFoodVisionModels({
    OPENROUTER_FOOD_VISION_MODEL: 'google/dead-pinned-model',
    OPENROUTER_FOOD_VISION_FALLBACK_MODEL: 'google/another-dead-model',
  });

  assert.deepEqual(models, [
    'google/dead-pinned-model',
    'google/another-dead-model',
    'openai/gpt-4o-mini',
  ]);
}

{
  assert.equal(
    shouldFallbackOpenRouterFoodModel(429, 'google/gemma-4-31b-it:free', 'openai/gpt-4o-mini'),
    true,
  );
  assert.equal(
    shouldFallbackOpenRouterFoodModel(404, 'google/gemma-4-31b-it:free', 'openai/gpt-4o-mini'),
    true,
  );
  assert.equal(
    shouldFallbackOpenRouterFoodModel(401, 'google/gemma-4-31b-it:free', 'openai/gpt-4o-mini'),
    false,
  );
  assert.equal(
    shouldFallbackOpenRouterFoodModel(429, 'google/gemma-4-31b-it:free', 'google/gemma-4-31b-it:free'),
    false,
  );
}
