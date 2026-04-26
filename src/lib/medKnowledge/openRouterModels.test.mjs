import assert from 'node:assert/strict';
import test from 'node:test';

import { getMedicationKnowledgeModelConfig } from './openRouterModels.ts';

test('requires OpenRouter API key', () => {
  assert.throws(
    () => getMedicationKnowledgeModelConfig({}),
    /OPENROUTER_API_KEY is required/,
  );
});

test('uses default medication knowledge model names', () => {
  const config = getMedicationKnowledgeModelConfig({ OPENROUTER_API_KEY: 'test-key' });

  assert.equal(config.baseUrl, 'https://openrouter.ai/api/v1');
  assert.equal(config.apiKey, 'test-key');
  assert.equal(config.appReferer, null);
  assert.equal(config.appTitle, 'MedRemind');
  assert.equal(config.fastModel, 'google/gemini-2.5-flash');
  assert.equal(config.reasoningModel, 'anthropic/claude-sonnet-4.5');
  assert.equal(config.secondOpinionModel, 'google/gemini-2.5-pro');
  assert.equal(config.nanoModel, 'google/gemini-2.5-flash-lite');
  assert.equal(config.longContextModel, 'qwen/qwen3.6-plus');
  assert.equal(config.fallbackModel, 'openrouter/auto');
});
