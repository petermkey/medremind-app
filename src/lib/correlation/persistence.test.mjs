import assert from 'node:assert/strict';
import test from 'node:test';

import { listConsentedCorrelationUserIds } from './persistence.ts';

// Minimal in-memory fake of the subset of the @supabase/supabase-js query
// builder listConsentedCorrelationUserIds calls:
//   .from('correlation_consents').select('user_id')
//     .eq('enabled', true)
//     .eq('includes_medication_patterns', true)
//     .eq('includes_health_data', true)
//     .eq('acknowledged_no_med_changes', true)
// The real PostgrestFilterBuilder is thenable once fully built and supports
// chaining .eq() any number of times, narrowing the result set on each call.
// This fake mirrors that by threading the accumulated filter columns through
// every .eq() call and only resolving (via a thenable) once awaited.
function createFakeSupabaseClient(consentRows) {
  const ALLOWED_COLUMNS = new Set([
    'enabled',
    'includes_medication_patterns',
    'includes_health_data',
    'acknowledged_no_med_changes',
  ]);

  function makeQuery(filterColumns) {
    return {
      eq(column, value) {
        assert.ok(ALLOWED_COLUMNS.has(column), `unexpected column: ${column}`);
        assert.equal(value, true);
        return makeQuery([...filterColumns, column]);
      },
      then(resolve) {
        const data = consentRows
          .filter((row) => filterColumns.every((column) => row[column] === true))
          .map((row) => ({ user_id: row.user_id }));
        resolve({ data, error: null });
      },
    };
  }

  return {
    from(table) {
      assert.equal(table, 'correlation_consents');
      return {
        select(columns) {
          assert.equal(columns, 'user_id');
          return makeQuery([]);
        },
      };
    },
  };
}

test('listConsentedCorrelationUserIds returns only users with full consent', async () => {
  const supabase = createFakeSupabaseClient([
    {
      user_id: 'user-1',
      enabled: true,
      includes_medication_patterns: true,
      includes_health_data: true,
      acknowledged_no_med_changes: true,
    },
    {
      user_id: 'user-2',
      enabled: false,
      includes_medication_patterns: true,
      includes_health_data: true,
      acknowledged_no_med_changes: true,
    },
    {
      user_id: 'user-3',
      enabled: true,
      includes_medication_patterns: true,
      includes_health_data: true,
      acknowledged_no_med_changes: true,
    },
  ]);

  const userIds = await listConsentedCorrelationUserIds(supabase);

  assert.deepEqual(userIds, ['user-1', 'user-3']);
});

test('listConsentedCorrelationUserIds excludes a user who only ticked the acknowledgement checkbox', async () => {
  // The Progress page UI sets enabled: checked || consent.enabled when the
  // user ticks only the acknowledgement checkbox, so enabled=true can occur
  // without the other three consent flags being set. The cron enumerator
  // must not treat that as full consent (hasActiveCorrelationConsent
  // requires all four flags).
  const supabase = createFakeSupabaseClient([
    {
      user_id: 'user-ack-only',
      enabled: true,
      includes_medication_patterns: false,
      includes_health_data: false,
      acknowledged_no_med_changes: false,
    },
  ]);

  const userIds = await listConsentedCorrelationUserIds(supabase);

  assert.deepEqual(userIds, []);
});

test('listConsentedCorrelationUserIds excludes a user missing exactly one of the four flags', async () => {
  const supabase = createFakeSupabaseClient([
    {
      user_id: 'user-missing-health-data',
      enabled: true,
      includes_medication_patterns: true,
      includes_health_data: false,
      acknowledged_no_med_changes: true,
    },
  ]);

  const userIds = await listConsentedCorrelationUserIds(supabase);

  assert.deepEqual(userIds, []);
});

test('listConsentedCorrelationUserIds returns an empty array when no consents are enabled', async () => {
  const supabase = createFakeSupabaseClient([
    {
      user_id: 'user-1',
      enabled: false,
      includes_medication_patterns: false,
      includes_health_data: false,
      acknowledged_no_med_changes: false,
    },
  ]);

  const userIds = await listConsentedCorrelationUserIds(supabase);

  assert.deepEqual(userIds, []);
});
