import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  DEFAULT_REAP_BATCH_SIZE,
  REAP_TERMINAL_STATUS,
  isReapableOccurrence,
  reapStaleOccurrences,
} from '../../src/lib/schedule/occurrenceReaper';

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

// --- reapStaleOccurrences (I/O wrapper) -------------------------------------
//
// Minimal in-memory fake of the subset of the @supabase/supabase-js query
// builder this module actually calls:
//   .from('planned_occurrences').select('id').eq(...).lt(...).limit(...)
//   .from('planned_occurrences').update(patch).in(...).eq(...)
// mirrors the fake used in reconcileLedger.test.ts for the same reason: it
// structurally satisfies the module's client parameter without depending on
// supabase-js's generics.

type FakeRow = { id: string; status: string; occurrence_date: string };

function makeUpdateBuilder(rows: FakeRow[], patch: Partial<FakeRow>, shouldError: boolean) {
  let ids: string[] = [];
  let statusFilter: unknown;
  const builder = {
    in(_col: string, vals: string[]) {
      ids = vals;
      return builder;
    },
    eq(col: string, val: unknown) {
      if (col === 'status') statusFilter = val;
      return builder;
    },
    then<TResult1, TResult2 = never>(
      onFulfilled?: ((value: { error: { message: string } | null }) => TResult1 | PromiseLike<TResult1>) | null,
      onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) {
      if (shouldError) {
        return Promise.resolve({ error: { message: 'update boom' } }).then(onFulfilled, onRejected);
      }
      for (const row of rows) {
        if (ids.includes(row.id) && (statusFilter === undefined || row.status === statusFilter)) {
          Object.assign(row, patch);
        }
      }
      return Promise.resolve({ error: null }).then(onFulfilled, onRejected);
    },
  };
  return builder;
}

function createFakeSupabaseClient(
  rows: FakeRow[],
  opts: { selectError?: boolean; updateError?: boolean } = {},
) {
  return {
    from(_table: string) {
      return {
        select(_cols: string) {
          let filtered = rows;
          const builder = {
            eq(col: string, val: unknown) {
              filtered = filtered.filter((r) => (r as unknown as Record<string, unknown>)[col] === val);
              return builder;
            },
            lt(col: string, val: unknown) {
              filtered = filtered.filter(
                (r) => String((r as unknown as Record<string, unknown>)[col]) < String(val),
              );
              return builder;
            },
            limit(n: number) {
              filtered = filtered.slice(0, n);
              if (opts.selectError) {
                return Promise.resolve({ data: null, error: { message: 'select boom' } });
              }
              return Promise.resolve({ data: filtered.map((r) => ({ id: r.id })), error: null });
            },
          };
          return builder;
        },
        update(patch: Partial<FakeRow>) {
          return makeUpdateBuilder(rows, patch, Boolean(opts.updateError));
        },
      };
    },
    // Cast: this fake implements only the chain shapes occurrenceReaper.ts
    // calls, not the full generic @supabase/supabase-js client surface.
  } as unknown as SupabaseClient;
}

test('reapStaleOccurrences transitions reapable rows to the terminal status and leaves the rest', async () => {
  const rows: FakeRow[] = [
    { id: 'occ-old', status: 'planned', occurrence_date: '2026-08-01' },
    { id: 'occ-recent', status: 'planned', occurrence_date: '2026-08-06' },
    { id: 'occ-done', status: 'completed', occurrence_date: '2026-01-01' },
  ];
  const client = createFakeSupabaseClient(rows);

  const result = await reapStaleOccurrences(client, { today: '2026-08-07', graceDays: 2 });

  assert.deepEqual(result, { reaped: 1 });
  assert.equal(rows.find((r) => r.id === 'occ-old')?.status, REAP_TERMINAL_STATUS);
  assert.equal(rows.find((r) => r.id === 'occ-recent')?.status, 'planned');
  assert.equal(rows.find((r) => r.id === 'occ-done')?.status, 'completed');
});

test('reapStaleOccurrences reaps nothing and makes no update call when no rows qualify', async () => {
  const rows: FakeRow[] = [{ id: 'occ-recent', status: 'planned', occurrence_date: '2026-08-06' }];
  const client = createFakeSupabaseClient(rows);

  const result = await reapStaleOccurrences(client, { today: '2026-08-07', graceDays: 2 });

  assert.deepEqual(result, { reaped: 0 });
  assert.equal(rows[0].status, 'planned');
});

test('reapStaleOccurrences caps the number of rows transitioned at batchSize', async () => {
  const rows: FakeRow[] = Array.from({ length: 5 }, (_, i) => ({
    id: `occ-${i}`,
    status: 'planned',
    occurrence_date: '2026-01-01',
  }));
  const client = createFakeSupabaseClient(rows);

  const result = await reapStaleOccurrences(client, { today: '2026-08-07', graceDays: 2, batchSize: 3 });

  assert.deepEqual(result, { reaped: 3 });
  const reapedCount = rows.filter((r) => r.status === REAP_TERMINAL_STATUS).length;
  assert.equal(reapedCount, 3);
});

test('reapStaleOccurrences defaults batchSize to DEFAULT_REAP_BATCH_SIZE', async () => {
  const rows: FakeRow[] = Array.from({ length: DEFAULT_REAP_BATCH_SIZE + 10 }, (_, i) => ({
    id: `occ-${i}`,
    status: 'planned',
    occurrence_date: '2026-01-01',
  }));
  const client = createFakeSupabaseClient(rows);

  const result = await reapStaleOccurrences(client, { today: '2026-08-07', graceDays: 2 });

  assert.deepEqual(result, { reaped: DEFAULT_REAP_BATCH_SIZE });
});

test('reapStaleOccurrences returns reaped:0 and does not throw when the select fails', async () => {
  const rows: FakeRow[] = [{ id: 'occ-old', status: 'planned', occurrence_date: '2026-01-01' }];
  const client = createFakeSupabaseClient(rows, { selectError: true });

  const original = console.warn;
  const warnings: unknown[][] = [];
  console.warn = (...args: unknown[]) => warnings.push(args);
  try {
    const result = await reapStaleOccurrences(client, { today: '2026-08-07', graceDays: 2 });
    assert.deepEqual(result, { reaped: 0 });
    assert.equal(rows[0].status, 'planned');
    assert.ok(warnings.length > 0);
  } finally {
    console.warn = original;
  }
});

test('reapStaleOccurrences returns reaped:0 and does not throw when the update fails', async () => {
  const rows: FakeRow[] = [{ id: 'occ-old', status: 'planned', occurrence_date: '2026-01-01' }];
  const client = createFakeSupabaseClient(rows, { updateError: true });

  const original = console.warn;
  const warnings: unknown[][] = [];
  console.warn = (...args: unknown[]) => warnings.push(args);
  try {
    const result = await reapStaleOccurrences(client, { today: '2026-08-07', graceDays: 2 });
    assert.deepEqual(result, { reaped: 0 });
    assert.equal(rows[0].status, 'planned');
    assert.ok(warnings.length > 0);
  } finally {
    console.warn = original;
  }
});
