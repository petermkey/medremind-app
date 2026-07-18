import assert from 'node:assert/strict';
import test from 'node:test';

import { baselineAverage, buildBriefing, doseLabel, pctDelta } from './briefing.ts';

test('baselineAverage is the mean of finite samples, 1-decimal rounded', () => {
  assert.equal(baselineAverage([50, 60, 70, 55, 65, 60, 60]), 60);
  assert.equal(baselineAverage([50, 60, 70, 55, 65, 60, 61]), 60.1);
});

test('baselineAverage ignores null/undefined/NaN samples', () => {
  assert.equal(baselineAverage([50, null, 60, undefined, 70, NaN, 55, 65, 60, 60]), 60);
});

test('baselineAverage needs at least 7 finite samples', () => {
  assert.equal(baselineAverage([50, 60, 70, 55, 65, 60]), null);
  assert.equal(baselineAverage([]), null);
});

test('pctDelta is the integer percent change vs baseline', () => {
  assert.equal(pctDelta(51, 60), -15);
  assert.equal(pctDelta(66, 60), 10);
  assert.equal(pctDelta(60, 60), 0);
});

test('pctDelta is null on missing current or missing/zero baseline', () => {
  assert.equal(pctDelta(null, 60), null);
  assert.equal(pctDelta(60, null), null);
  assert.equal(pctDelta(60, 0), null);
  assert.equal(pctDelta(Number.NaN, 60), null);
});

test('doseLabel picks the singular/plural English label', () => {
  assert.equal(doseLabel(1), 'dose');
  assert.equal(doseLabel(2), 'doses');
  assert.equal(doseLabel(0), 'doses');
});

const BASELINE = { readinessAvg30: 75, hrvAvg30: 60 };

test('good day: readiness >= 85 -> severity good with full copy', () => {
  const briefing = buildBriefing(
    { readinessScore: 88, sleepScore: 82, sleepAvgHrv: 66, temperatureDeviation: 0.1 },
    BASELINE,
    3,
  );
  assert.equal(briefing.severity, 'good');
  assert.equal(briefing.title, 'Morning briefing: strong readiness');
  assert.equal(
    briefing.body,
    'Readiness 88 · sleep 82. HRV 66 ms — +10% vs your 30-day baseline. Scheduled today: 3 doses.',
  );
});

test('HRV >= 15% below baseline -> severity caution', () => {
  const briefing = buildBriefing(
    { readinessScore: 78, sleepScore: 70, sleepAvgHrv: 51, temperatureDeviation: null },
    BASELINE,
    1,
  );
  assert.equal(briefing.severity, 'caution');
  assert.equal(briefing.title, 'Morning briefing: recovery day');
  assert.equal(
    briefing.body,
    'Readiness 78 · sleep 70. HRV 51 ms — -15% vs your 30-day baseline. Scheduled today: 1 dose.',
  );
});

test('low readiness < 60 -> severity caution even with normal HRV', () => {
  const briefing = buildBriefing(
    { readinessScore: 55, sleepScore: 60, sleepAvgHrv: 60, temperatureDeviation: null },
    BASELINE,
    0,
  );
  assert.equal(briefing.severity, 'caution');
  assert.equal(
    briefing.body,
    'Readiness 55 · sleep 60. HRV 60 ms — 0% vs your 30-day baseline. No doses are scheduled for today.',
  );
});

test('temperature deviation >= +0.5 C -> severity warning and wins over good readiness', () => {
  const briefing = buildBriefing(
    { readinessScore: 90, sleepScore: 85, sleepAvgHrv: 70, temperatureDeviation: 0.6 },
    BASELINE,
    2,
  );
  assert.equal(briefing.severity, 'warning');
  assert.equal(briefing.title, 'Morning briefing: take it easy');
  assert.equal(
    briefing.body,
    'Readiness 90 · sleep 85. HRV 70 ms — +17% vs your 30-day baseline. Body temperature is 0.6 °C above usual — pay attention to how you feel. Scheduled today: 2 doses.',
  );
});

test('middling day -> severity info', () => {
  const briefing = buildBriefing(
    { readinessScore: 72, sleepScore: 68, sleepAvgHrv: 58, temperatureDeviation: 0.2 },
    BASELINE,
    4,
  );
  assert.equal(briefing.severity, 'info');
  assert.equal(briefing.title, 'Morning briefing');
  assert.equal(
    briefing.body,
    'Readiness 72 · sleep 68. HRV 58 ms — -3% vs your 30-day baseline. Scheduled today: 4 doses.',
  );
});

test('no snapshot -> info briefing that still reports the dose count', () => {
  const briefing = buildBriefing(null, { readinessAvg30: null, hrvAvg30: null }, 5);
  assert.equal(briefing.severity, 'info');
  assert.equal(briefing.title, 'Morning briefing');
  assert.equal(
    briefing.body,
    'No Oura data is available for last night yet. Scheduled today: 5 doses.',
  );
});

test('missing HRV baseline omits the HRV line; missing sleep omits the sleep half', () => {
  const briefing = buildBriefing(
    { readinessScore: 80, sleepScore: null, sleepAvgHrv: 62, temperatureDeviation: null },
    { readinessAvg30: 75, hrvAvg30: null },
    1,
  );
  assert.equal(briefing.severity, 'info');
  assert.equal(briefing.body, 'Readiness 80. Scheduled today: 1 dose.');
});
