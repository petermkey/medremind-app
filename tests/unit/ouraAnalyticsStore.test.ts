import assert from 'node:assert/strict';

import {
  buildDailyHealthFeatureUpsertPayload,
  getOuraRawRetentionCutoffDate,
  hashOuraPayload,
} from '../../src/lib/oura/analyticsStore';
import {
  buildOuraAnalyticsSyncPayloads,
} from '../../src/lib/oura/analyticsSync';

{
  assert.equal(
    hashOuraPayload({ b: 2, a: { d: 4, c: 3 } }),
    hashOuraPayload({ a: { c: 3, d: 4 }, b: 2 }),
  );
}

{
  assert.equal(
    getOuraRawRetentionCutoffDate(new Date('2026-04-26T23:59:59.999Z')),
    '2026-01-27',
  );
}

{
  assert.deepEqual(buildDailyHealthFeatureUpsertPayload({
    userId: 'user-1',
    date: '2026-04-26',
    sleepScore: 92,
    sourcePayloadHashes: { daily_sleep: 'hash-1' },
  }), {
    user_id: 'user-1',
    date: '2026-04-26',
    sleep_score: 92,
    source_payload_hashes: { daily_sleep: 'hash-1' },
  });
}

{
  assert.deepEqual(buildDailyHealthFeatureUpsertPayload({
    userId: 'user-1',
    date: '2026-04-26',
    sleepScore: null,
  }), {
    user_id: 'user-1',
    date: '2026-04-26',
    sleep_score: null,
  });
}

{
  buildDailyHealthFeatureUpsertPayload({
    userId: 'user-1',
    date: '2026-04-26',
    // @ts-expect-error dataQuality maps to a not-null jsonb object column.
    dataQuality: null,
  });

  buildDailyHealthFeatureUpsertPayload({
    userId: 'user-1',
    date: '2026-04-26',
    // @ts-expect-error sourcePayloadHashes maps to a not-null jsonb object column.
    sourcePayloadHashes: null,
  });
}

{
  const payloads = buildOuraAnalyticsSyncPayloads({
    userId: 'user-1',
    connectionId: 'connection-1',
    syncRunId: 'sync-run-1',
    rangeStart: '2026-04-25',
    rangeEnd: '2026-04-26',
    collections: {
      daily_sleep: {
        required: true,
        data: [{ id: 'sleep-1', day: '2026-04-26', score: 91 }],
      },
      daily_readiness: {
        required: true,
        data: [{ id: 'readiness-1', day: '2026-04-26', score: 84 }],
      },
      daily_activity: {
        required: true,
        data: [{ id: 'activity-1', day: '2026-04-26', score: 77, steps: 8123, active_calories: 540 }],
      },
      daily_spo2: {
        required: true,
        data: [{ id: 'spo2-1', day: '2026-04-26', spo2_percentage: { average: 97.4 } }],
      },
      daily_stress: {
        required: true,
        data: [{ id: 'stress-1', day: '2026-04-26', stress_high: 600, recovery_high: 1800 }],
      },
      workout: {
        required: true,
        data: [
          { id: 'workout-1', day: '2026-04-26', activity: 'running' },
          { id: 'workout-2', day: '2026-04-26', activity: 'strength_training' },
        ],
      },
      heart_health: {
        required: false,
        data: [{ id: 'heart-1', day: '2026-04-26', resting_heart_rate: 52 }],
      },
    },
  });

  assert.equal(payloads.endpointCoverage.length, 7);
  assert.deepEqual(
    payloads.endpointCoverage.map(row => [row.endpoint, row.status, row.documentCount, row.required]),
    [
      ['daily_sleep', 'success', 1, true],
      ['daily_readiness', 'success', 1, true],
      ['daily_activity', 'success', 1, true],
      ['daily_spo2', 'success', 1, true],
      ['daily_stress', 'success', 1, true],
      ['workout', 'success', 2, true],
      ['heart_health', 'success', 1, false],
    ],
  );
  assert.equal(payloads.rawDocuments.length, 8);
  assert.deepEqual(payloads.rawDocuments[0], {
    userId: 'user-1',
    connectionId: 'connection-1',
    syncRunId: 'sync-run-1',
    endpoint: 'daily_sleep',
    ouraDocumentId: 'sleep-1',
    localDate: '2026-04-26',
    startDatetime: null,
    endDatetime: null,
    payload: { id: 'sleep-1', day: '2026-04-26', score: 91 },
    payloadHash: hashOuraPayload({ id: 'sleep-1', day: '2026-04-26', score: 91 }),
    schemaVersion: 1,
  });
  assert.deepEqual(payloads.dailyHealthFeatures, [{
    userId: 'user-1',
    date: '2026-04-26',
    sleepScore: 91,
    readinessScore: 84,
    activityScore: 77,
    stressSummary: {
      stressHighSeconds: 600,
      recoveryHighSeconds: 1800,
    },
    spo2Average: 97.4,
    restingHeartRate: 52,
    hrvAverage: null,
    steps: 8123,
    activeCalories: 540,
    workoutCount: 2,
    bedtimeStart: null,
    bedtimeEnd: null,
    dataQuality: {
      availableEndpoints: ['daily_activity', 'daily_readiness', 'daily_sleep', 'daily_spo2', 'daily_stress', 'heart_health', 'workout'],
      missingRequiredEndpoints: [],
    },
    sourcePayloadHashes: {
      daily_activity: hashOuraPayload({ id: 'activity-1', day: '2026-04-26', score: 77, steps: 8123, active_calories: 540 }),
      daily_readiness: hashOuraPayload({ id: 'readiness-1', day: '2026-04-26', score: 84 }),
      daily_sleep: hashOuraPayload({ id: 'sleep-1', day: '2026-04-26', score: 91 }),
      daily_spo2: hashOuraPayload({ id: 'spo2-1', day: '2026-04-26', spo2_percentage: { average: 97.4 } }),
      daily_stress: hashOuraPayload({ id: 'stress-1', day: '2026-04-26', stress_high: 600, recovery_high: 1800 }),
      heart_health: hashOuraPayload({ id: 'heart-1', day: '2026-04-26', resting_heart_rate: 52 }),
    },
  }]);
}

{
  const payloads = buildOuraAnalyticsSyncPayloads({
    userId: 'user-1',
    connectionId: 'connection-1',
    syncRunId: 'sync-run-1',
    rangeStart: '2026-04-25',
    rangeEnd: '2026-04-26',
    collections: {
      daily_sleep: { required: true, data: [] },
      daily_readiness: { required: true, data: [], error: { status: 429, message: 'rate limited' } },
    },
  });

  assert.deepEqual(
    payloads.endpointCoverage.map(row => [row.endpoint, row.status, row.documentCount, row.error]),
    [
      ['daily_sleep', 'success', 0, undefined],
      ['daily_readiness', 'failed', 0, { status: 429, message: 'rate limited' }],
    ],
  );
  assert.deepEqual(payloads.dailyHealthFeatures, []);
}
