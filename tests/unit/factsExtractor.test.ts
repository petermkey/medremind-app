import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  normalizeSupplementName,
  validateSupplementFacts,
} from '../../src/lib/nutrientBalance/factsSchema';
import { extractSupplementFacts } from '../../src/lib/nutrientBalance/factsExtractor';
import type { MedicationKnowledgeModelConfig } from '../../src/lib/medKnowledge/openRouterModels';

const config: MedicationKnowledgeModelConfig = {
  baseUrl: 'https://openrouter.test/api/v1',
  apiKey: 'test-key',
  appReferer: null,
  appTitle: 'MedRemind-Test',
  fastModel: 'model-fast',
  reasoningModel: 'model-reasoning',
  secondOpinionModel: 'model-second',
  nanoModel: 'model-nano',
  longContextModel: 'model-long',
  fallbackModel: 'model-fallback',
};

function openRouterResponse(content: unknown, model = 'model-fast'): Response {
  return new Response(
    JSON.stringify({ model, choices: [{ message: { content: JSON.stringify(content) } }] }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

test('normalizeSupplementName lowercases and strips punctuation', () => {
  assert.equal(normalizeSupplementName('  Magnesium Glycinate (Now Foods) '), 'magnesium glycinate now foods');
  assert.equal(normalizeSupplementName('Omega-3 1000mg'), 'omega 3 1000mg');
});

test('validateSupplementFacts keeps canonical keys, maps aliases, drops junk', () => {
  const nutrients = validateSupplementFacts({
    nutrients: { magnesium: 200, vitamin_d: 12.5, zincMg: -3, mystery: 9, epaDha: 'oops' },
    confidence: 0.9,
    notes: null,
  });
  assert.deepEqual(nutrients, { magnesiumMg: 200, vitaminDMcg: 12.5 });
});

test('validateSupplementFacts throws on a non-object payload', () => {
  assert.throws(() => validateSupplementFacts(null));
  assert.throws(() => validateSupplementFacts({ confidence: 1 }));
});

test('extractSupplementFacts returns validated nutrients from the first model', async () => {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    const body = JSON.parse(String(init?.body)) as { model: string };
    calls.push(body.model);
    return openRouterResponse({ nutrients: { magnesiumMg: 200 }, confidence: 0.9, notes: null });
  };
  const result = await extractSupplementFacts(
    { normalizedName: 'magnesium glycinate', doseAmount: 200, doseUnit: 'mg' },
    { config, fetchImpl },
  );
  assert.deepEqual(result.nutrients, { magnesiumMg: 200 });
  assert.equal(result.model, 'model-fast');
  assert.deepEqual(calls, ['model-fast']);
});

test('extractSupplementFacts falls back to the second model and then exhausts', async () => {
  const calls: string[] = [];
  const failingThenOk: typeof fetch = async (url, init) => {
    const body = JSON.parse(String(init?.body)) as { model: string };
    calls.push(body.model);
    if (body.model === 'model-fast') return new Response('{}', { status: 500 });
    return openRouterResponse({ nutrients: { zincMg: 15 }, confidence: 0.8, notes: null }, 'model-fallback');
  };
  const result = await extractSupplementFacts(
    { normalizedName: 'zinc picolinate', doseAmount: 15, doseUnit: 'mg' },
    { config, fetchImpl: failingThenOk },
  );
  assert.deepEqual(result.nutrients, { zincMg: 15 });
  assert.deepEqual(calls, ['model-fast', 'model-fallback']);

  const alwaysFailing: typeof fetch = async () => new Response('{}', { status: 500 });
  await assert.rejects(
    () =>
      extractSupplementFacts(
        { normalizedName: 'zinc picolinate', doseAmount: 15, doseUnit: 'mg' },
        { config, fetchImpl: alwaysFailing },
      ),
    /nutrient_balance_provider_exhausted/,
  );
});
