import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyTagType,
  dayRangeUtc,
  downsampleHeartrate,
  MAX_PULSE_POINTS,
} from './heartrateDay.ts';

test('dayRangeUtc builds the UTC window for a local calendar day', () => {
  assert.deepEqual(dayRangeUtc('2026-07-18', -180), {
    startIso: '2026-07-17T21:00:00.000Z',
    endIso: '2026-07-18T21:00:00.000Z',
  });
  assert.deepEqual(dayRangeUtc('2026-07-18', 0), {
    startIso: '2026-07-18T00:00:00.000Z',
    endIso: '2026-07-19T00:00:00.000Z',
  });
});

test('dayRangeUtc rejects malformed input', () => {
  assert.equal(dayRangeUtc('18-07-2026', 0), null);
  assert.equal(dayRangeUtc('2026-07-18T00:00', 0), null);
  assert.equal(dayRangeUtc(null, 0), null);
  assert.equal(dayRangeUtc('2026-07-18', Number.NaN), null);
  assert.equal(dayRangeUtc('2026-07-18', 'later'), null);
  assert.equal(dayRangeUtc('2026-07-18', 900), null);
});

test('downsampleHeartrate passes small series through sorted and rounded', () => {
  const points = downsampleHeartrate([
    { ts: '2026-07-18T10:05:00.000Z', bpm: 71.6 },
    { ts: '2026-07-18T10:00:00.000Z', bpm: 64 },
  ]);
  assert.deepEqual(points, [
    { ts: '2026-07-18T10:00:00.000Z', bpm: 64 },
    { ts: '2026-07-18T10:05:00.000Z', bpm: 72 },
  ]);
});

test('downsampleHeartrate bucket-averages long series down to maxPoints', () => {
  const base = Date.parse('2026-07-18T08:00:00.000Z');
  const samples = Array.from({ length: 10 }, (_, index) => ({
    ts: new Date(base + index * 1000).toISOString(),
    bpm: 60 + index,
  }));
  const points = downsampleHeartrate(samples, 3);
  assert.deepEqual(points, [
    { ts: '2026-07-18T08:00:00.000Z', bpm: 62 },
    { ts: '2026-07-18T08:00:04.000Z', bpm: 65 },
    { ts: '2026-07-18T08:00:07.000Z', bpm: 68 },
  ]);
});

test('downsampleHeartrate never exceeds MAX_PULSE_POINTS by default', () => {
  const base = Date.parse('2026-07-18T00:00:00.000Z');
  const samples = Array.from({ length: 5000 }, (_, index) => ({
    ts: new Date(base + index * 17_000).toISOString(),
    bpm: 60 + (index % 40),
  }));
  const points = downsampleHeartrate(samples);
  assert.ok(points.length <= MAX_PULSE_POINTS, `got ${points.length}`);
  assert.ok(points.length > 200, 'should keep real resolution');
});

test('downsampleHeartrate filters malformed rows and non-arrays', () => {
  assert.deepEqual(downsampleHeartrate('nope'), []);
  assert.deepEqual(
    downsampleHeartrate([
      null,
      { ts: 'not-a-date', bpm: 60 },
      { ts: '2026-07-18T10:00:00.000Z', bpm: 'high' },
      { ts: '2026-07-18T10:00:00.000Z', bpm: 61 },
    ]),
    [{ ts: '2026-07-18T10:00:00.000Z', bpm: 61 }],
  );
});

test('classifyTagType maps Oura tag ids to marker kinds', () => {
  assert.equal(classifyTagType('tag_generic_caffeine'), 'caffeine');
  assert.equal(classifyTagType('tag_generic_coffee'), 'caffeine');
  assert.equal(classifyTagType('tag_generic_alcohol'), 'alcohol');
  assert.equal(classifyTagType('tag_generic_sauna'), 'sauna');
  assert.equal(classifyTagType('tag_generic_nap'), 'other');
  assert.equal(classifyTagType(null), 'other');
});
