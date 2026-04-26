import assert from 'node:assert/strict';
import test from 'node:test';

import { mapOuraDailyPayloadToHealthSnapshot } from './ouraDailyMapper.ts';

test('mapOuraDailyPayloadToHealthSnapshot maps daily sleep/readiness/activity/stress fields', () => {
  const snapshot = mapOuraDailyPayloadToHealthSnapshot({
    userId: 'u-1',
    localDate: '2026-04-25',
    timezone: 'Europe/London',
    dailySleep: { score: 82, contributors: { restfulness: 78 } },
    dailyReadiness: { score: 77 },
    dailyActivity: { score: 74, steps: 8600, active_calories: 520, total_calories: 2420 },
    dailyStress: { stress_high: 3600, recovery_high: 7200 },
    dailySpO2: { spo2_percentage: { average: 97.2 }, breathing_disturbance_index: 2 },
    heartHealth: { vo2_max: 42.4, resting_heart_rate: 54, hrv_balance: 'fair' },
  });

  assert.equal(snapshot.source, 'oura');
  assert.equal(snapshot.userId, 'u-1');
  assert.equal(snapshot.localDate, '2026-04-25');
  assert.equal(snapshot.sleepScore, 82);
  assert.equal(snapshot.readinessScore, 77);
  assert.equal(snapshot.activityScore, 74);
  assert.equal(snapshot.stressHighSeconds, 3600);
  assert.equal(snapshot.recoveryHighSeconds, 7200);
  assert.equal(snapshot.steps, 8600);
  assert.equal(snapshot.averageSpo2, 97.2);
  assert.equal(snapshot.breathingDisturbanceIndex, 2);
  assert.equal(snapshot.restingHeartRate, 54);
  assert.equal(snapshot.hrvBalance, 'fair');
});
