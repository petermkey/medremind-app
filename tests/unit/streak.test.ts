import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeStreak } from '../../src/lib/store/streak';

test('all-taken consecutive days → streak counts them', () => {
  const days = [
    { scheduled: 2, taken: 2 },
    { scheduled: 2, taken: 2 },
    { scheduled: 2, taken: 2 },
  ];
  assert.equal(computeStreak(days), 3);
});

test('a rest day in the middle does NOT break and does NOT add', () => {
  const days = [
    { scheduled: 2, taken: 2 },
    { scheduled: 0, taken: 0 }, // rest day
    { scheduled: 2, taken: 2 },
  ];
  assert.equal(computeStreak(days), 2);
});

test('a past miss ends the streak but keeps the run before it', () => {
  const days = [
    { scheduled: 2, taken: 2 }, // today 100%
    { scheduled: 2, taken: 2 }, // yesterday 100%
    { scheduled: 2, taken: 1 }, // incomplete past day → ends the streak here
  ];
  assert.equal(computeStreak(days), 2);
});

test('days before a past miss do not count toward the streak', () => {
  const days = [
    { scheduled: 2, taken: 2 }, // today 100%
    { scheduled: 2, taken: 1 }, // miss → stop here
    { scheduled: 2, taken: 2 }, // beyond the break — must NOT count
    { scheduled: 2, taken: 2 },
  ];
  assert.equal(computeStreak(days), 1);
});

test('today incomplete does NOT break', () => {
  const days = [
    { scheduled: 2, taken: 1 }, // today, incomplete
    { scheduled: 2, taken: 2 },
    { scheduled: 2, taken: 2 },
  ];
  assert.equal(computeStreak(days), 2);
});

test('today all-taken counts', () => {
  const days = [
    { scheduled: 2, taken: 2 }, // today, complete
    { scheduled: 2, taken: 2 },
  ];
  assert.equal(computeStreak(days), 2);
});

test('leading rest days then 100% days', () => {
  const days = [
    { scheduled: 0, taken: 0 }, // rest
    { scheduled: 0, taken: 0 }, // rest
    { scheduled: 2, taken: 2 },
    { scheduled: 2, taken: 2 },
  ];
  assert.equal(computeStreak(days), 2);
});

test('empty array returns 0', () => {
  assert.equal(computeStreak([]), 0);
});

test('only rest days returns 0', () => {
  const days = [
    { scheduled: 0, taken: 0 },
    { scheduled: 0, taken: 0 },
  ];
  assert.equal(computeStreak(days), 0);
});

test('today incomplete with all-taken history counts the history', () => {
  const days = [
    { scheduled: 3, taken: 1 }, // today, incomplete
    { scheduled: 2, taken: 2 },
    { scheduled: 2, taken: 2 },
    { scheduled: 2, taken: 2 },
  ];
  assert.equal(computeStreak(days), 3);
});
