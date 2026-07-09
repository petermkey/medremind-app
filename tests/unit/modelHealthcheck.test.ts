import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkOpenRouterModelAvailable } from '../../src/lib/food/analyze/modelHealthcheck';

test('reports ok for a model that returns 200', async () => {
  const fakeFetch = (async () => new Response('{}', { status: 200 })) as typeof fetch;
  const result = await checkOpenRouterModelAvailable('openai/gpt-4o-mini', 'key', fakeFetch);
  assert.deepEqual(result, { model: 'openai/gpt-4o-mini', ok: true, status: 200 });
});

test('reports the guardrail/data-policy error message for a blocked model', async () => {
  const body = JSON.stringify({
    error: { message: 'No endpoints available matching your guardrail restrictions and data policy.', code: 404 },
  });
  const fakeFetch = (async () => new Response(body, { status: 404 })) as typeof fetch;
  const result = await checkOpenRouterModelAvailable('google/gemini-2.5-flash', 'key', fakeFetch);
  assert.equal(result.ok, false);
  assert.equal(result.status, 404);
  assert.equal(result.error, 'No endpoints available matching your guardrail restrictions and data policy.');
});

test('reports not-ok without a parseable error body', async () => {
  const fakeFetch = (async () => new Response('not json', { status: 500 })) as typeof fetch;
  const result = await checkOpenRouterModelAvailable('openai/gpt-4o-mini', 'key', fakeFetch);
  assert.equal(result.ok, false);
  assert.equal(result.status, 500);
  assert.equal(result.error, undefined);
});

test('reports not-ok when the fetch itself throws', async () => {
  const fakeFetch = (async () => {
    throw new Error('network down');
  }) as typeof fetch;
  const result = await checkOpenRouterModelAvailable('openai/gpt-4o-mini', 'key', fakeFetch);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'network down');
});
