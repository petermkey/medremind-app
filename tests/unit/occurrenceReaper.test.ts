import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isReapableOccurrence } from '../../src/lib/schedule/occurrenceReaper';

test('a planned occurrence well past the grace period is reapable', () => {
  const occ = { status: 'planned', occurrence_date: '2026-07-01' };
  assert.equal(isReapableOccurrence(occ, '2026-08-07', 2), true);
});

test('a planned occurrence within the grace period is not reapable', () => {
  const occ = { status: 'planned', occurrence_date: '2026-08-06' };
  assert.equal(isReapableOccurrence(occ, '2026-08-07', 2), false);
});

test('a non-planned status is never reapable, even if old', () => {
  const completed = { status: 'completed', occurrence_date: '2026-01-01' };
  const cancelled = { status: 'cancelled', occurrence_date: '2026-01-01' };
  assert.equal(isReapableOccurrence(completed, '2026-08-07', 2), false);
  assert.equal(isReapableOccurrence(cancelled, '2026-08-07', 2), false);
});

test('boundary: occurrence_date exactly graceDays before today is NOT reapable (exclusive)', () => {
  // today=2026-08-07, graceDays=2 -> cutoff=2026-08-05. "earlier than" the
  // cutoff is a strict inequality, so a date exactly ON the cutoff is still
  // within the grace period and must not be reaped yet.
  const occ = { status: 'planned', occurrence_date: '2026-08-05' };
  assert.equal(isReapableOccurrence(occ, '2026-08-07', 2), false);
});

test('boundary: one day earlier than the cutoff is reapable', () => {
  const occ = { status: 'planned', occurrence_date: '2026-08-04' };
  assert.equal(isReapableOccurrence(occ, '2026-08-07', 2), true);
});

test('default graceDays is 2 when not specified', () => {
  const withinGrace = { status: 'planned', occurrence_date: '2026-08-05' };
  const pastGrace = { status: 'planned', occurrence_date: '2026-08-04' };
  assert.equal(isReapableOccurrence(withinGrace, '2026-08-07'), false);
  assert.equal(isReapableOccurrence(pastGrace, '2026-08-07'), true);
});
