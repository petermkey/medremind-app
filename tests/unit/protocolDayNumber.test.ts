import assert from 'node:assert/strict';
import { test } from 'node:test';
import { protocolDayNumber } from '../../src/lib/store/daySchedule';

test('day number of protocol start date is 1', () => {
  assert.equal(protocolDayNumber('2026-03-01', '2026-03-01'), 1);
});

test('day number advances correctly same-month', () => {
  assert.equal(protocolDayNumber('2026-03-01', '2026-03-02'), 2);
  assert.equal(protocolDayNumber('2026-03-01', '2026-03-05'), 5);
});

test('day number across DST spring-forward (no offset due to UTC math)', () => {
  // 2026-03-08 is the last day before DST spring-forward (2026-03-09 at 02:00)
  // in America/New_York. This test uses pure UTC math so it correctly counts
  // calendar days regardless of local timezone.
  // The regression: old formula used local midnight ms-subtraction which
  // yielded dayNum=8 for 2026-03-09 instead of correct dayNum=9.
  assert.equal(protocolDayNumber('2026-03-01', '2026-03-09'), 9);
  assert.equal(protocolDayNumber('2026-03-01', '2026-03-10'), 10);
});

test('day number after DST transition in March', () => {
  // Verify the entire March month (covers spring-forward 2026-03-09)
  assert.equal(protocolDayNumber('2026-03-01', '2026-03-31'), 31);
});

test('day number across DST fall-back (November)', () => {
  // 2026-11-01 is before fall-back; 2026-11-10 is after.
  // Fall-back on 2026-11-01 at 02:00 (clocks go back to 01:00).
  assert.equal(protocolDayNumber('2026-11-01', '2026-11-01'), 1);
  assert.equal(protocolDayNumber('2026-11-01', '2026-11-10'), 10);
});

test('multi-month protocol crossing DST boundaries', () => {
  // From Jan through March (covers spring-forward)
  assert.equal(protocolDayNumber('2026-01-01', '2026-01-31'), 31);
  assert.equal(protocolDayNumber('2026-01-01', '2026-02-28'), 59); // Jan 31 + Feb 28
  assert.equal(protocolDayNumber('2026-01-01', '2026-03-31'), 90); // Jan 31 + Feb 28 + Mar 31
});

test('future dates far from start', () => {
  assert.equal(protocolDayNumber('2026-01-01', '2026-06-13'), 164);
});
