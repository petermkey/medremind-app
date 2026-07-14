import assert from 'node:assert/strict';
import test from 'node:test';

import { isInQuietHours } from './quietHours.ts';

const eveningWindow = { start_offset: -5400, end_offset: -1800 };

test('inside an evening window before midnight', () => {
  assert.equal(isInQuietHours(new Date('2026-07-13T23:00:00Z'), 'UTC', eveningWindow), true);
});

test('outside the window', () => {
  assert.equal(isInQuietHours(new Date('2026-07-13T21:00:00Z'), 'UTC', eveningWindow), false);
  assert.equal(isInQuietHours(new Date('2026-07-13T12:00:00Z'), 'UTC', eveningWindow), false);
});

test('window straddling midnight matches on both sides', () => {
  const straddle = { start_offset: -3600, end_offset: 1800 };
  assert.equal(isInQuietHours(new Date('2026-07-13T23:30:00Z'), 'UTC', straddle), true);
  assert.equal(isInQuietHours(new Date('2026-07-14T00:15:00Z'), 'UTC', straddle), true);
  assert.equal(isInQuietHours(new Date('2026-07-14T01:00:00Z'), 'UTC', straddle), false);
});

test('timezone projection uses the user local clock', () => {
  assert.equal(isInQuietHours(new Date('2026-07-13T20:00:00Z'), 'Europe/Moscow', eveningWindow), true);
  assert.equal(isInQuietHours(new Date('2026-07-13T20:00:00Z'), 'UTC', eveningWindow), false);
});

test('malformed or oversized windows are never quiet', () => {
  assert.equal(isInQuietHours(new Date(), 'UTC', null), false);
  assert.equal(isInQuietHours(new Date(), 'UTC', {}), false);
  assert.equal(isInQuietHours(new Date(), 'UTC', { start_offset: 'x', end_offset: 0 }), false);
  assert.equal(isInQuietHours(new Date(), 'UTC', { start_offset: -50000, end_offset: 50000 }), false);
  assert.equal(isInQuietHours(new Date(), 'UTC', { start_offset: 1800, end_offset: -1800 }), false);
});
