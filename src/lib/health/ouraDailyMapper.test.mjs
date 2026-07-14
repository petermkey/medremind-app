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

test('maps merged heart endpoints including cardiovascular age', () => {
  const snapshot = mapOuraDailyPayloadToHealthSnapshot({
    userId: 'u1',
    localDate: '2026-07-01',
    heartHealth: { vo2_max: 41.2, resilience_level: 'solid', cardiovascular_age: 33 },
  });
  assert.equal(snapshot.vo2Max, 41.2);
  assert.equal(snapshot.resilienceLevel, 'solid');
  assert.equal(snapshot.cardiovascularAge, 33);
});

test('maps main sleep period detail and sources RHR from it', () => {
  const snapshot = mapOuraDailyPayloadToHealthSnapshot({
    userId: 'u1',
    localDate: '2026-07-01',
    sleepDetail: {
      average_hrv: 52,
      efficiency: 91,
      latency: 540,
      deep_sleep_duration: 5400,
      rem_sleep_duration: 6600,
      average_breath: 13.5,
      lowest_heart_rate: 47,
    },
  });
  assert.equal(snapshot.sleepAvgHrv, 52);
  assert.equal(snapshot.sleepEfficiency, 91);
  assert.equal(snapshot.sleepLatencySeconds, 540);
  assert.equal(snapshot.deepSleepMinutes, 90);
  assert.equal(snapshot.remSleepMinutes, 110);
  assert.equal(snapshot.respiratoryRate, 13.5);
  assert.equal(snapshot.restingHeartRate, 47);
});

test('maps temperature deviation, non-wear minutes, and night detail', () => {
  const snapshot = mapOuraDailyPayloadToHealthSnapshot({
    userId: 'user-1',
    localDate: '2026-07-13',
    dailyReadiness: { score: 80, temperature_deviation: 0.35, temperature_trend_deviation: -0.1 },
    dailyActivity: { score: 70, non_wear_time: 5400 },
    nightDetail: {
      deep_sleep_first_third_minutes: 1,
      minutes_to_first_deep_sleep: 1,
      hrv_recovery_delta: 30,
    },
  });
  assert.equal(snapshot.temperatureDeviation, 0.35);
  assert.equal(snapshot.temperatureTrendDeviation, -0.1);
  assert.equal(snapshot.nonWearMinutes, 90);
  assert.equal(snapshot.deepSleepFirstThirdMinutes, 1);
  assert.equal(snapshot.minutesToFirstDeepSleep, 1);
  assert.equal(snapshot.hrvRecoveryDelta, 30);
});

test('night detail fields are null when sleep detail is absent', () => {
  const snapshot = mapOuraDailyPayloadToHealthSnapshot({ userId: 'user-1', localDate: '2026-07-13' });
  assert.equal(snapshot.temperatureDeviation, null);
  assert.equal(snapshot.nonWearMinutes, null);
  assert.equal(snapshot.deepSleepFirstThirdMinutes, null);
  assert.equal(snapshot.minutesToFirstDeepSleep, null);
  assert.equal(snapshot.hrvRecoveryDelta, null);
});
