import assert from 'node:assert/strict';
import test from 'node:test';

import { deterministicNotificationUuid } from './notificationKey.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test('produces a valid RFC-4122-shaped uuid', () => {
  assert.match(deterministicNotificationUuid('morning-briefing', '2026-07-18'), UUID_RE);
});

test('same inputs always produce the same uuid (dedupe key stability)', () => {
  assert.equal(
    deterministicNotificationUuid('morning-briefing', '2026-07-18'),
    deterministicNotificationUuid('morning-briefing', '2026-07-18'),
  );
});

test('different date or kind produces a different uuid', () => {
  const a = deterministicNotificationUuid('morning-briefing', '2026-07-18');
  const b = deterministicNotificationUuid('morning-briefing', '2026-07-19');
  const c = deterministicNotificationUuid('weekly-review', '2026-07-18');
  assert.notEqual(a, b);
  assert.notEqual(a, c);
});
