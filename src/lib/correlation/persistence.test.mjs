import assert from 'node:assert/strict';
import test from 'node:test';

import { listConsentedCorrelationUserIds } from './persistence.ts';

// Minimal in-memory fake of the subset of the @supabase/supabase-js query
// builder listConsentedCorrelationUserIds calls:
//   .from('correlation_consents').select('user_id').eq('enabled', true)
// The real PostgrestFilterBuilder is thenable once fully built; this fake
// mirrors that by resolving in .eq() so it structurally satisfies the
// module's optional client parameter without depending on supabase-js's
// generics.
function createFakeSupabaseClient(consentRows) {
  return {
    from(table) {
      assert.equal(table, 'correlation_consents');
      return {
        select(columns) {
          assert.equal(columns, 'user_id');
          return {
            eq(column, value) {
              assert.equal(column, 'enabled');
              assert.equal(value, true);
              const data = consentRows
                .filter((row) => row.enabled === true)
                .map((row) => ({ user_id: row.user_id }));
              return Promise.resolve({ data, error: null });
            },
          };
        },
      };
    },
  };
}

test('listConsentedCorrelationUserIds returns only enabled=true user_ids', async () => {
  const supabase = createFakeSupabaseClient([
    { user_id: 'user-1', enabled: true },
    { user_id: 'user-2', enabled: false },
    { user_id: 'user-3', enabled: true },
  ]);

  const userIds = await listConsentedCorrelationUserIds(supabase);

  assert.deepEqual(userIds, ['user-1', 'user-3']);
});

test('listConsentedCorrelationUserIds returns an empty array when no consents are enabled', async () => {
  const supabase = createFakeSupabaseClient([{ user_id: 'user-1', enabled: false }]);

  const userIds = await listConsentedCorrelationUserIds(supabase);

  assert.deepEqual(userIds, []);
});
