import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_WEEKLY_REVIEW_MODEL,
  getWeeklyReviewModels,
  shouldFallbackWeeklyReviewModel,
} from './models.ts';

test('default chain is just the code default', () => {
  assert.deepEqual(getWeeklyReviewModels({}), [DEFAULT_WEEKLY_REVIEW_MODEL]);
});

test('env primary + fallback, code default always terminal, deduplicated', () => {
  assert.deepEqual(
    getWeeklyReviewModels({
      OPENROUTER_WEEKLY_REVIEW_MODEL: 'anthropic/claude-sonnet-4.5',
      OPENROUTER_WEEKLY_REVIEW_FALLBACK_MODEL: 'openrouter/auto',
    }),
    ['anthropic/claude-sonnet-4.5', 'openrouter/auto', DEFAULT_WEEKLY_REVIEW_MODEL],
  );
  assert.deepEqual(
    getWeeklyReviewModels({ OPENROUTER_WEEKLY_REVIEW_MODEL: DEFAULT_WEEKLY_REVIEW_MODEL }),
    [DEFAULT_WEEKLY_REVIEW_MODEL],
  );
});

test('fallback only on retryable statuses and when a next model exists', () => {
  assert.equal(shouldFallbackWeeklyReviewModel(429, 'a', 'b'), true);
  assert.equal(shouldFallbackWeeklyReviewModel(404, 'a', 'b'), true);
  assert.equal(shouldFallbackWeeklyReviewModel(400, 'a', 'b'), false);
  assert.equal(shouldFallbackWeeklyReviewModel(429, 'a', undefined), false);
  assert.equal(shouldFallbackWeeklyReviewModel(429, 'a', 'a'), false);
});
