import assert from 'node:assert/strict';
import test from 'node:test';

import { completedWeekRange } from './weekRange.ts';

test('Monday 06:00 UTC → the week that ended yesterday (Mon..Sun)', () => {
  // 2026-07-13 is a Monday.
  const range = completedWeekRange(new Date('2026-07-13T06:00:00.000Z'), 'UTC');
  assert.deepEqual(range, { weekStart: '2026-07-06', weekEnd: '2026-07-12' });
});

test('mid-week run still reviews the last COMPLETED week', () => {
  // 2026-07-16 is a Thursday → completed week is still Jul 6–12.
  const range = completedWeekRange(new Date('2026-07-16T12:00:00.000Z'), 'UTC');
  assert.deepEqual(range, { weekStart: '2026-07-06', weekEnd: '2026-07-12' });
});

test('timezone shifts the local date across midnight', () => {
  // 06:00 UTC Monday is already Monday 18:00 in Pacific/Auckland (+12/+13);
  // but Sunday 20:00 UTC is MONDAY 09:00 in Auckland → completed week moves.
  const range = completedWeekRange(new Date('2026-07-12T20:00:00.000Z'), 'Pacific/Auckland');
  assert.deepEqual(range, { weekStart: '2026-07-06', weekEnd: '2026-07-12' });
  // Same instant in UTC is still Sunday → the week BEFORE is the completed one.
  const utcRange = completedWeekRange(new Date('2026-07-12T20:00:00.000Z'), 'UTC');
  assert.deepEqual(utcRange, { weekStart: '2026-06-29', weekEnd: '2026-07-05' });
});

test('invalid timezone falls back to UTC instead of throwing', () => {
  const range = completedWeekRange(new Date('2026-07-13T06:00:00.000Z'), 'Not/AZone');
  assert.deepEqual(range, { weekStart: '2026-07-06', weekEnd: '2026-07-12' });
});
