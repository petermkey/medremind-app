import assert from 'node:assert/strict';
import test from 'node:test';

import { generateCorrelationInsightCards } from './engine.ts';

function snapshots(days, featureValue) {
  return Array.from({ length: days }, (_, index) => {
    const day = String(index + 1).padStart(2, '0');
    return {
      userId: 'user-1',
      localDate: `2026-03-${day}`,
      fiberG: featureValue(index),
      sleepScore: 70 + index,
      sourcePayload: {},
    };
  });
}

test('generateCorrelationInsightCards creates no card below 14 paired days', () => {
  const cards = generateCorrelationInsightCards({
    userId: 'user-1',
    snapshots: snapshots(13, index => index),
    now: new Date('2026-04-01T00:00:00.000Z'),
  });

  assert.equal(cards.length, 0);
});

test('generateCorrelationInsightCards marks weak correlations as tracking prompts', () => {
  const cards = generateCorrelationInsightCards({
    userId: 'user-1',
    snapshots: snapshots(20, index => (index % 2 === 0 ? 10 : 11)),
    now: new Date('2026-04-01T00:00:00.000Z'),
  });

  assert.ok(cards.length > 0);
  assert.equal(cards[0].recommendationKind, 'tracking_prompt');
});
