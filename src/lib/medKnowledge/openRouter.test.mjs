import assert from 'node:assert/strict';
import test from 'node:test';

import { MEDICATION_CLASSIFICATION_SCHEMA } from './aiSchemas.ts';
import { callOpenRouterStructuredJson } from './openRouter.ts';

test('sends strict schema requests with provider parameter requirements', async () => {
  let capturedUrl;
  let capturedRequest;
  const fetchImpl = async (url, request) => {
    capturedUrl = url;
    capturedRequest = request;
    return new Response(JSON.stringify({
      model: 'google/gemini-2.5-flash',
      usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 },
      choices: [{ message: { content: '{"label":"glp1","confidence":0.93,"rationale":"matched class"}' } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  const result = await callOpenRouterStructuredJson({
    config: {
      baseUrl: 'https://openrouter.test/api/v1',
      apiKey: 'test-key',
      appReferer: 'https://example.test',
      appTitle: 'MedRemind Test',
      fastModel: 'google/gemini-2.5-flash',
      reasoningModel: 'anthropic/claude-sonnet-4.5',
      secondOpinionModel: 'google/gemini-2.5-pro',
      nanoModel: 'google/gemini-2.5-flash-lite',
      longContextModel: 'qwen/qwen3.6-plus',
      fallbackModel: 'openrouter/auto',
    },
    model: 'google/gemini-2.5-flash',
    schemaName: 'MedicationClassificationCandidate',
    schema: MEDICATION_CLASSIFICATION_SCHEMA,
    messages: [{ role: 'user', content: 'Classify the provided medication metadata.' }],
    fetchImpl,
  });

  assert.equal(capturedUrl, 'https://openrouter.test/api/v1/chat/completions');
  assert.equal(capturedRequest.method, 'POST');
  assert.equal(capturedRequest.headers.Authorization, 'Bearer test-key');
  assert.equal(capturedRequest.headers['Content-Type'], 'application/json');
  assert.equal(capturedRequest.headers['HTTP-Referer'], 'https://example.test');
  assert.equal(capturedRequest.headers['X-OpenRouter-Title'], 'MedRemind Test');

  const body = JSON.parse(capturedRequest.body);
  assert.equal(body.model, 'google/gemini-2.5-flash');
  assert.equal(body.response_format.type, 'json_schema');
  assert.equal(body.response_format.json_schema.name, 'MedicationClassificationCandidate');
  assert.equal(body.response_format.json_schema.strict, true);
  assert.equal(body.response_format.json_schema.schema.additionalProperties, false);
  assert.deepEqual(body.provider, { require_parameters: true });
  assert.deepEqual(result.output, { label: 'glp1', confidence: 0.93, rationale: 'matched class' });
  assert.equal(result.model, 'google/gemini-2.5-flash');
  assert.equal(result.usage.total_tokens, 17);
});

test('rejects malformed structured JSON responses', async () => {
  const fetchImpl = async () => new Response(JSON.stringify({
    model: 'google/gemini-2.5-flash',
    choices: [{ message: { content: '{not json' } }],
  }), { status: 200 });

  await assert.rejects(
    () => callOpenRouterStructuredJson({
      config: {
        baseUrl: 'https://openrouter.test/api/v1',
        apiKey: 'test-key',
        appReferer: null,
        appTitle: 'MedRemind',
        fastModel: 'google/gemini-2.5-flash',
        reasoningModel: 'anthropic/claude-sonnet-4.5',
        secondOpinionModel: 'google/gemini-2.5-pro',
        nanoModel: 'google/gemini-2.5-flash-lite',
        longContextModel: 'qwen/qwen3.6-plus',
        fallbackModel: 'openrouter/auto',
      },
      model: 'google/gemini-2.5-flash',
      schemaName: 'MedicationClassificationCandidate',
      schema: MEDICATION_CLASSIFICATION_SCHEMA,
      messages: [{ role: 'user', content: 'Classify metadata.' }],
      fetchImpl,
    }),
    /OpenRouter returned malformed structured JSON/,
  );
});
