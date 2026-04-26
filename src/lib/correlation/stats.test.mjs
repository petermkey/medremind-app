import assert from 'node:assert/strict';
import test from 'node:test';

import { pearsonCorrelation, rankByAbsoluteCorrelation } from './stats.ts';

test('pearsonCorrelation returns 1 for aligned values', () => {
  assert.equal(pearsonCorrelation([1, 2, 3, 4], [2, 4, 6, 8]), 1);
});

test('pearsonCorrelation returns null with fewer than four paired values', () => {
  assert.equal(pearsonCorrelation([1, 2, 3], [2, 4, 6]), null);
});

test('rankByAbsoluteCorrelation sorts strongest abs(r) first', () => {
  const ranked = rankByAbsoluteCorrelation([
    { feature: 'fiberG', outcome: 'sleepScore', r: 0.3, n: 22 },
    { feature: 'waterMl', outcome: 'readinessScore', r: -0.7, n: 20 },
    { feature: 'proteinG', outcome: 'activityScore', r: 0.5, n: 21 },
  ]);

  assert.deepEqual(ranked.map(item => item.feature), ['waterMl', 'proteinG', 'fiberG']);
});
