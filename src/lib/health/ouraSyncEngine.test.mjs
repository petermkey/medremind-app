import assert from 'node:assert/strict';
import test from 'node:test';

import { mergeHeartHealth } from './ouraSyncEngine.ts';

// Real Oura API shape for a daily_readiness document, per Task 0's live DB
// query — contributors.hrv_balance is a numeric 0-100 score, not a string.
test('mergeHeartHealth includes hrv_balance from daily_readiness contributors as a string', () => {
  const vo2 = { data: [] };
  const resilience = { data: [] };
  const cardioAge = { data: [] };
  const readiness = {
    data: [
      {
        day: '2026-07-01',
        score: 77,
        contributors: {
          activity_balance: 85,
          body_temperature: 89,
          hrv_balance: 100,
          previous_day_activity: null,
          previous_night: 53,
          recovery_index: 98,
          resting_heart_rate: 59,
          sleep_balance: 56,
          sleep_regularity: 76,
        },
      },
    ],
  };

  const merged = mergeHeartHealth(vo2, resilience, cardioAge, readiness);
  const entry = merged.get('2026-07-01');

  assert.ok(entry, 'expected a merged heartHealth entry for 2026-07-01');
  assert.equal(entry.hrv_balance, '100');
});

test('mergeHeartHealth leaves hrv_balance absent when contributors.hrv_balance is missing', () => {
  const vo2 = { data: [] };
  const resilience = { data: [] };
  const cardioAge = { data: [] };
  const readiness = {
    data: [
      {
        day: '2026-07-02',
        score: 70,
        contributors: {
          activity_balance: 80,
          // hrv_balance intentionally absent
        },
      },
    ],
  };

  const merged = mergeHeartHealth(vo2, resilience, cardioAge, readiness);
  const entry = merged.get('2026-07-02');

  assert.ok(!entry || !('hrv_balance' in entry), 'hrv_balance should be absent, not present or crashing');
});
