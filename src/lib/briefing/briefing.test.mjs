import assert from 'node:assert/strict';
import test from 'node:test';

import { baselineAverage, buildBriefing, pctDelta, ruPlural } from './briefing.ts';

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

test('ruPlural picks the correct Russian plural form', () => {
  assert.equal(ruPlural(1, 'приём', 'приёма', 'приёмов'), 'приём');
  assert.equal(ruPlural(2, 'приём', 'приёма', 'приёмов'), 'приёма');
  assert.equal(ruPlural(5, 'приём', 'приёма', 'приёмов'), 'приёмов');
  assert.equal(ruPlural(11, 'приём', 'приёма', 'приёмов'), 'приёмов');
  assert.equal(ruPlural(21, 'приём', 'приёма', 'приёмов'), 'приём');
});

const BASELINE = { readinessAvg30: 75, hrvAvg30: 60 };

test('good day: readiness >= 85 -> severity good with full copy', () => {
  const briefing = buildBriefing(
    { readinessScore: 88, sleepScore: 82, sleepAvgHrv: 66, temperatureDeviation: 0.1 },
    BASELINE,
    3,
  );
  assert.equal(briefing.severity, 'good');
  assert.equal(briefing.title, 'Утренний брифинг: отличная готовность');
  assert.equal(
    briefing.body,
    'Готовность 88 · сон 82. HRV 66 мс — +10% к 30-дневной норме. Сегодня по расписанию: 3 приёма.',
  );
});

test('HRV >= 15% below baseline -> severity caution', () => {
  const briefing = buildBriefing(
    { readinessScore: 78, sleepScore: 70, sleepAvgHrv: 51, temperatureDeviation: null },
    BASELINE,
    1,
  );
  assert.equal(briefing.severity, 'caution');
  assert.equal(briefing.title, 'Утренний брифинг: день восстановления');
  assert.equal(
    briefing.body,
    'Готовность 78 · сон 70. HRV 51 мс — -15% к 30-дневной норме. Сегодня по расписанию: 1 приём.',
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
    'Готовность 55 · сон 60. HRV 60 мс — 0% к 30-дневной норме. На сегодня приёмов не запланировано.',
  );
});

test('temperature deviation >= +0.5 C -> severity warning and wins over good readiness', () => {
  const briefing = buildBriefing(
    { readinessScore: 90, sleepScore: 85, sleepAvgHrv: 70, temperatureDeviation: 0.6 },
    BASELINE,
    2,
  );
  assert.equal(briefing.severity, 'warning');
  assert.equal(briefing.title, 'Утренний брифинг: поберегите себя');
  assert.equal(
    briefing.body,
    'Готовность 90 · сон 85. HRV 70 мс — +17% к 30-дневной норме. Температура тела выше обычной на 0.6 °C — прислушайтесь к самочувствию. Сегодня по расписанию: 2 приёма.',
  );
});

test('middling day -> severity info', () => {
  const briefing = buildBriefing(
    { readinessScore: 72, sleepScore: 68, sleepAvgHrv: 58, temperatureDeviation: 0.2 },
    BASELINE,
    4,
  );
  assert.equal(briefing.severity, 'info');
  assert.equal(briefing.title, 'Утренний брифинг');
  assert.equal(
    briefing.body,
    'Готовность 72 · сон 68. HRV 58 мс — -3% к 30-дневной норме. Сегодня по расписанию: 4 приёма.',
  );
});

test('no snapshot -> info briefing that still reports the dose count', () => {
  const briefing = buildBriefing(null, { readinessAvg30: null, hrvAvg30: null }, 5);
  assert.equal(briefing.severity, 'info');
  assert.equal(briefing.title, 'Утренний брифинг');
  assert.equal(
    briefing.body,
    'Данных Oura за эту ночь пока нет. Сегодня по расписанию: 5 приёмов.',
  );
});

test('missing HRV baseline omits the HRV line; missing sleep omits the sleep half', () => {
  const briefing = buildBriefing(
    { readinessScore: 80, sleepScore: null, sleepAvgHrv: 62, temperatureDeviation: null },
    { readinessAvg30: 75, hrvAvg30: null },
    1,
  );
  assert.equal(briefing.severity, 'info');
  assert.equal(briefing.body, 'Готовность 80. Сегодня по расписанию: 1 приём.');
});
