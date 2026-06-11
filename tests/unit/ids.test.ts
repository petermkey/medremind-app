import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stableUuid, isUuid } from '../../src/lib/ids';

test('stableUuid is deterministic and stable across refactors', () => {
  const value = stableUuid('planned-occurrence:u1', 'a|b|2026-01-01|08:00');
  assert.equal(value, 'ef4c21b0-a78c-40c4-a232-c8cee822fc60');
  assert.ok(isUuid(value));
});
