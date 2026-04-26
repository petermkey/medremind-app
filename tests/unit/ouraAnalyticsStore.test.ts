import assert from 'node:assert/strict';

import {
  buildDailyHealthFeatureUpsertPayload,
  getOuraRawRetentionCutoffDate,
  hashOuraPayload,
} from '../../src/lib/oura/analyticsStore';

{
  assert.equal(
    hashOuraPayload({ b: 2, a: { d: 4, c: 3 } }),
    hashOuraPayload({ a: { c: 3, d: 4 }, b: 2 }),
  );
}

{
  assert.equal(
    getOuraRawRetentionCutoffDate(new Date('2026-04-26T23:59:59.999Z')),
    '2026-01-27',
  );
}

{
  assert.deepEqual(buildDailyHealthFeatureUpsertPayload({
    userId: 'user-1',
    date: '2026-04-26',
    sleepScore: 92,
    sourcePayloadHashes: { daily_sleep: 'hash-1' },
  }), {
    user_id: 'user-1',
    date: '2026-04-26',
    sleep_score: 92,
    source_payload_hashes: { daily_sleep: 'hash-1' },
  });
}

{
  assert.deepEqual(buildDailyHealthFeatureUpsertPayload({
    userId: 'user-1',
    date: '2026-04-26',
    sleepScore: null,
  }), {
    user_id: 'user-1',
    date: '2026-04-26',
    sleep_score: null,
  });
}
