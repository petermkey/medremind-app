import assert from 'node:assert/strict';
import test from 'node:test';

import { buildDailyMedicationExposure } from './features.ts';

test('buildDailyMedicationExposure derives medication class signals and adherence counts', () => {
  const exposure = buildDailyMedicationExposure({
    userId: 'u-1',
    localDate: '2026-04-20',
    mapItems: [
      {
        id: 'map-glp1',
        userId: 'u-1',
        activeProtocolId: 'ap-1',
        protocolItemId: 'pi-1',
        displayName: 'Ozempic',
        genericName: 'semaglutide',
        frequencyType: 'weekly',
        times: ['08:00'],
        withFood: 'any',
        startDate: '2026-04-10',
        endDate: null,
        status: 'active',
        sourceHash: 'h-1',
      },
      {
        id: 'map-t',
        userId: 'u-1',
        activeProtocolId: 'ap-2',
        protocolItemId: 'pi-2',
        displayName: 'Testosterone',
        genericName: 'testosterone cypionate',
        frequencyType: 'weekly',
        times: ['09:00'],
        withFood: 'any',
        startDate: '2026-04-17',
        endDate: null,
        status: 'active',
        sourceHash: 'h-2',
      },
      {
        id: 'map-thyroid',
        userId: 'u-1',
        activeProtocolId: 'ap-3',
        protocolItemId: 'pi-3',
        displayName: 'Levothyroxine',
        genericName: 'levothyroxine',
        frequencyType: 'daily',
        times: ['07:00'],
        withFood: 'no',
        startDate: '2026-04-01',
        endDate: null,
        status: 'active',
        sourceHash: 'h-3',
      },
    ],
    normalizations: [
      {
        medicationMapItemId: 'map-glp1',
        ingredients: ['semaglutide'],
        classLabels: ['GLP-1 receptor agonist'],
      },
      {
        medicationMapItemId: 'map-t',
        ingredients: ['testosterone'],
        classLabels: ['Androgen'],
      },
      {
        medicationMapItemId: 'map-thyroid',
        ingredients: ['levothyroxine'],
        classLabels: ['Thyroid hormone'],
      },
    ],
    doseSignals: [
      {
        medicationMapItemId: 'map-thyroid',
        scheduledDate: '2026-04-20',
        scheduledTime: '07:00',
        status: 'taken',
        recordedAt: '2026-04-20T08:00:00.000Z',
        withFoodTaken: true,
      },
      {
        medicationMapItemId: 'map-glp1',
        scheduledDate: '2026-04-20',
        scheduledTime: '08:00',
        status: 'skipped',
      },
    ],
    reviewSignals: [{ medicationMapItemId: 'map-t', recommendationKind: 'clinician_review' }],
  });

  assert.equal(exposure.hasGlp1Active, true);
  assert.equal(exposure.daysSinceGlp1Start, 10);
  assert.equal(exposure.hasTestosteroneActive, true);
  assert.equal(exposure.testosteroneInjectionDayOffset, 3);
  assert.equal(exposure.hasThyroidMedActive, true);
  assert.equal(exposure.withFoodMismatchCount, 1);
  assert.equal(exposure.lateMedicationCount, 1);
  assert.equal(exposure.missedMedicationCount, 1);
  assert.equal(exposure.medicationReviewSignalCount, 1);
  assert.equal(exposure.medicationClassExposureScore, 3);
});

test('buildDailyMedicationExposure returns false and null defaults without matching classes', () => {
  const exposure = buildDailyMedicationExposure({
    userId: 'u-1',
    localDate: '2026-04-20',
    mapItems: [],
    normalizations: [],
    doseSignals: [],
    reviewSignals: [],
  });

  assert.equal(exposure.hasGlp1Active, false);
  assert.equal(exposure.daysSinceGlp1Start, null);
  assert.equal(exposure.hasTestosteroneActive, false);
  assert.equal(exposure.testosteroneInjectionDayOffset, null);
  assert.equal(exposure.hasBetaBlockerActive, false);
  assert.equal(exposure.hasThyroidMedActive, false);
  assert.equal(exposure.hasSsriActive, false);
  assert.equal(exposure.withFoodMismatchCount, 0);
  assert.equal(exposure.lateMedicationCount, 0);
  assert.equal(exposure.missedMedicationCount, 0);
});

test('buildDailyMedicationExposure ignores dose signals outside the requested local date', () => {
  const exposure = buildDailyMedicationExposure({
    userId: 'u-1',
    localDate: '2026-04-20',
    mapItems: [
      {
        id: 'map-1',
        userId: 'u-1',
        activeProtocolId: 'ap-1',
        protocolItemId: 'pi-1',
        displayName: 'Levothyroxine',
        genericName: 'levothyroxine',
        frequencyType: 'daily',
        times: ['07:00'],
        withFood: 'no',
        startDate: '2026-04-01',
        endDate: null,
        status: 'active',
        sourceHash: 'h-1',
      },
    ],
    normalizations: [],
    doseSignals: [
      {
        medicationMapItemId: 'map-1',
        scheduledDate: '2026-04-19',
        scheduledTime: '07:00',
        status: 'taken',
        recordedAt: '2026-04-19T08:00:00.000Z',
        withFoodTaken: true,
      },
      {
        medicationMapItemId: 'map-1',
        scheduledDate: '2026-04-21',
        scheduledTime: '07:00',
        status: 'skipped',
      },
    ],
    reviewSignals: [],
  });

  assert.equal(exposure.withFoodMismatchCount, 0);
  assert.equal(exposure.lateMedicationCount, 0);
  assert.equal(exposure.missedMedicationCount, 0);
});

test('buildDailyMedicationExposure counts review signals only for active map items on the local date', () => {
  const exposure = buildDailyMedicationExposure({
    userId: 'u-1',
    localDate: '2026-04-20',
    mapItems: [
      {
        id: 'map-active',
        userId: 'u-1',
        activeProtocolId: 'ap-1',
        protocolItemId: 'pi-1',
        displayName: 'Testosterone',
        genericName: 'testosterone',
        frequencyType: 'weekly',
        times: ['09:00'],
        withFood: 'any',
        startDate: '2026-04-01',
        endDate: null,
        status: 'active',
        sourceHash: 'h-1',
      },
      {
        id: 'map-inactive',
        userId: 'u-1',
        activeProtocolId: 'ap-2',
        protocolItemId: 'pi-2',
        displayName: 'Prior medication',
        genericName: null,
        frequencyType: 'daily',
        times: ['09:00'],
        withFood: 'any',
        startDate: '2026-03-01',
        endDate: '2026-03-31',
        status: 'active',
        sourceHash: 'h-2',
      },
    ],
    normalizations: [],
    doseSignals: [],
    reviewSignals: [
      { medicationMapItemId: 'map-active', recommendationKind: 'clinician_review' },
      { medicationMapItemId: 'map-inactive', recommendationKind: 'clinician_review' },
    ],
  });

  assert.equal(exposure.medicationReviewSignalCount, 1);
});
