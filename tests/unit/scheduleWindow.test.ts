import assert from 'node:assert/strict';
import test from 'node:test';

import {
  computeWindowSegments,
  segmentsToOrFilter,
} from '../../src/lib/push/scheduleWindow';

test('single segment for a midday window in UTC', () => {
  // now=08:00 UTC, lead 0, ±1 min → 07:59:00..08:01:59 on the same date.
  const now = new Date('2026-06-10T08:00:00.000Z');
  const segments = computeWindowSegments(now, 0, 'UTC', 1);
  assert.deepEqual(segments, [
    { date: '2026-06-10', startTime: '07:59:00', endTime: '08:01:59' },
  ]);
});

test('lead time shifts the window forward', () => {
  // now=07:45 UTC, lead 15 → target 08:00, window 07:59..08:01.
  const now = new Date('2026-06-10T07:45:00.000Z');
  const segments = computeWindowSegments(now, 15, 'UTC', 1);
  assert.deepEqual(segments, [
    { date: '2026-06-10', startTime: '07:59:00', endTime: '08:01:59' },
  ]);
});

test('second-inclusive upper bound catches doses with non-zero seconds', () => {
  // A dose at 08:01:30 must be matched: endTime is :59, not :00.
  const now = new Date('2026-06-10T08:00:00.000Z');
  const [seg] = computeWindowSegments(now, 0, 'UTC', 1);
  assert.ok('08:01:30' >= seg.startTime && '08:01:30' <= seg.endTime);
});

test('window straddling local midnight splits into two dated segments', () => {
  // now=00:00 UTC, lead 0, ±1 min → 23:59 (prev day) .. 00:01 (this day).
  const now = new Date('2026-06-10T00:00:00.000Z');
  const segments = computeWindowSegments(now, 0, 'UTC', 1);
  assert.deepEqual(segments, [
    { date: '2026-06-09', startTime: '23:59:00', endTime: '23:59:59' },
    { date: '2026-06-10', startTime: '00:00:00', endTime: '00:01:59' },
  ]);
});

test('a dose at 23:59:30 is covered by the pre-midnight segment', () => {
  const now = new Date('2026-06-10T00:00:00.000Z');
  const [pre] = computeWindowSegments(now, 0, 'UTC', 1);
  assert.equal(pre.date, '2026-06-09');
  assert.ok('23:59:30' >= pre.startTime && '23:59:30' <= pre.endTime);
});

test('timezone offset projects UTC into local calendar fields', () => {
  // now=22:30 UTC, lead 0, in Asia/Bangkok (UTC+7) → local 05:30 next day.
  const now = new Date('2026-06-10T22:30:00.000Z');
  const segments = computeWindowSegments(now, 0, 'Asia/Bangkok', 1);
  assert.deepEqual(segments, [
    { date: '2026-06-11', startTime: '05:29:00', endTime: '05:31:59' },
  ]);
});

test('segmentsToOrFilter builds AND groups joined by comma', () => {
  const filter = segmentsToOrFilter([
    { date: '2026-06-09', startTime: '23:59:00', endTime: '23:59:59' },
    { date: '2026-06-10', startTime: '00:00:00', endTime: '00:01:59' },
  ]);
  assert.equal(
    filter,
    'and(scheduled_date.eq.2026-06-09,scheduled_time.gte.23:59:00,scheduled_time.lte.23:59:59),' +
      'and(scheduled_date.eq.2026-06-10,scheduled_time.gte.00:00:00,scheduled_time.lte.00:01:59)',
  );
});
