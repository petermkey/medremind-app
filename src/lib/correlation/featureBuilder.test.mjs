import assert from 'node:assert/strict';
import test from 'node:test';

import { buildDailyLifestyleSnapshots } from './featureBuilder.ts';

test('buildDailyLifestyleSnapshots aggregates food, water, health, and medication exposure without raw payloads', () => {
  const snapshots = buildDailyLifestyleSnapshots({
    userId: 'user-1',
    startDate: '2026-04-01',
    endDate: '2026-04-01',
    foodEntries: [
      {
        user_id: 'user-1',
        consumed_at: '2026-04-01T08:30:00.000Z',
        timezone: 'Europe/London',
        calories_kcal: 300,
        protein_g: 20,
        fiber_g: 4,
      },
      {
        user_id: 'user-1',
        consumed_at: '2026-04-01T13:00:00.000Z',
        timezone: 'Europe/London',
        calories_kcal: 450,
        protein_g: 30,
        fiber_g: 6,
      },
    ],
    waterEntries: [
      { user_id: 'user-1', consumed_at: '2026-04-01T09:00:00.000Z', timezone: 'Europe/London', amount_ml: 500 },
      { user_id: 'user-1', consumed_at: '2026-04-01T15:00:00.000Z', timezone: 'Europe/London', amount_ml: 750 },
    ],
    scheduledDoses: [
      { user_id: 'user-1', scheduled_date: '2026-04-01', status: 'taken' },
      { user_id: 'user-1', scheduled_date: '2026-04-01', status: 'skipped' },
      { user_id: 'user-1', scheduled_date: '2026-04-01', status: 'pending' },
    ],
    doseRecords: [],
    healthSnapshots: [
      {
        user_id: 'user-1',
        local_date: '2026-04-01',
        sleep_score: 82,
        readiness_score: 75,
        activity_score: 64,
        stress_high_seconds: 120,
        recovery_high_seconds: 300,
        steps: 8400,
        average_spo2: 97.5,
        raw_payload: { shouldNotLeak: true },
      },
    ],
    medicationExposures: [
      {
        user_id: 'user-1',
        local_date: '2026-04-01',
        has_glp1_active: true,
        late_medication_count: 1,
        missed_medication_count: 2,
        medication_class_exposure_score: 3,
        source_payload: { medicationName: 'private' },
      },
    ],
  });

  assert.equal(snapshots.length, 1);
  assert.deepEqual(snapshots[0], {
    userId: 'user-1',
    localDate: '2026-04-01',
    caloriesKcal: 750,
    proteinG: 50,
    fiberG: 10,
    waterMl: 1250,
    takenCount: 1,
    skippedCount: 1,
    missedCount: 1,
    adherencePct: 33.33333333333333,
    sleepScore: 82,
    readinessScore: 75,
    activityScore: 64,
    stressHighSeconds: 120,
    recoveryHighSeconds: 300,
    steps: 8400,
    averageSpo2: 97.5,
    hasGlp1Active: true,
    daysSinceGlp1Start: null,
    glp1DoseEscalationPhase: false,
    hasTestosteroneActive: false,
    testosteroneInjectionDayOffset: null,
    hasBetaBlockerActive: false,
    hasThyroidMedActive: false,
    hasSsriActive: false,
    withFoodMismatchCount: 0,
    lateMedicationCount: 1,
    missedMedicationCount: 2,
    medicationClassExposureScore: 3,
    medicationReviewSignalCount: 0,
    sourcePayload: {
      foodEntryCount: 2,
      waterEntryCount: 2,
      scheduledDoseCount: 3,
      doseRecordCount: 0,
      healthSnapshotCount: 1,
      medicationExposureCount: 1,
    },
  });
});

test('buildDailyLifestyleSnapshots buckets food and water by row timezone local date', () => {
  const snapshots = buildDailyLifestyleSnapshots({
    userId: 'user-1',
    startDate: '2026-04-01',
    endDate: '2026-04-01',
    foodEntries: [
      {
        user_id: 'user-1',
        consumed_at: '2026-04-02T06:30:00.000Z',
        timezone: 'America/Los_Angeles',
        calories_kcal: 250,
        protein_g: 12,
        fiber_g: 3,
      },
    ],
    waterEntries: [
      {
        user_id: 'user-1',
        consumed_at: '2026-04-02T06:45:00.000Z',
        timezone: 'America/Los_Angeles',
        amount_ml: 400,
      },
    ],
  });

  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].localDate, '2026-04-01');
  assert.equal(snapshots[0].caloriesKcal, 250);
  assert.equal(snapshots[0].waterMl, 400);
});

test('buildDailyLifestyleSnapshots does not double count taken dose records for scheduled rows', () => {
  const snapshots = buildDailyLifestyleSnapshots({
    userId: 'user-1',
    startDate: '2026-04-01',
    endDate: '2026-04-01',
    scheduledDoses: [
      { id: 'dose-1', user_id: 'user-1', scheduled_date: '2026-04-01', status: 'taken' },
    ],
    doseRecords: [
      {
        user_id: 'user-1',
        scheduled_dose_id: 'dose-1',
        action: 'taken',
        recorded_at: '2026-04-01T08:05:00.000Z',
      },
    ],
  });

  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].takenCount, 1);
  assert.equal(snapshots[0].adherencePct, 100);
});
