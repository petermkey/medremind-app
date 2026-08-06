import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyLedgerReconciliation, reconcileStuckLedgerOps } from '../../src/lib/supabase/reconcileLedger';
import type { SyncOperationLedgerRow } from '../../src/lib/supabase/reconcileLedger';
import type { getSupabaseClient } from '../../src/lib/supabase/client';

function makeOp(overrides: Partial<SyncOperationLedgerRow> = {}): SyncOperationLedgerRow {
  return {
    id: 'op-1',
    user_id: 'user-1',
    operation_kind: 'pause_command',
    entity_type: 'active_protocol',
    entity_id: 'active-1',
    payload: { status: 'paused' },
    status: 'inflight',
    updated_at: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

test('pause_command reconciles to succeeded when target status matches payload', () => {
  const now = new Date('2026-08-06T00:00:00.000Z');
  const op = makeOp({ operation_kind: 'pause_command', payload: { status: 'paused' } });
  const target = { status: 'paused' };
  assert.equal(classifyLedgerReconciliation(op, target, now), 'succeeded');
});

test('pause_command reconciles to failed when target status diverges from payload', () => {
  const now = new Date('2026-08-06T00:00:00.000Z');
  const op = makeOp({ operation_kind: 'pause_command', payload: { status: 'paused' } });
  const target = { status: 'active' };
  assert.equal(classifyLedgerReconciliation(op, target, now), 'failed');
});

test('archive_command reconciles to succeeded when target is_archived is true', () => {
  const now = new Date('2026-08-06T00:00:00.000Z');
  const op = makeOp({
    operation_kind: 'archive_command',
    entity_type: 'protocol',
    entity_id: 'protocol-1',
    payload: { status: 'abandoned' },
  });
  const target = { is_archived: true };
  assert.equal(classifyLedgerReconciliation(op, target, now), 'succeeded');
});

test('missing target row reconciles to failed', () => {
  const now = new Date('2026-08-06T00:00:00.000Z');
  const op = makeOp({ operation_kind: 'pause_command', payload: { status: 'paused' } });
  assert.equal(classifyLedgerReconciliation(op, null, now), 'failed');
});

test('row updated more recently than the stale threshold is skipped', () => {
  const now = new Date('2026-08-06T00:00:00.000Z');
  const op = makeOp({
    operation_kind: 'pause_command',
    payload: { status: 'paused' },
    updated_at: new Date(now.getTime() - 1000).toISOString(),
  });
  const target = { status: 'active' };
  assert.equal(classifyLedgerReconciliation(op, target, now), 'skip');
});

// --- reconcileStuckLedgerOps (I/O wrapper) -------------------------------
//
// Minimal in-memory fake of the subset of the @supabase/supabase-js query
// builder this module actually calls:
//   .from(table).select(cols).eq(...).eq(...).lt(...)         (stale ops)
//   .from(table).select(cols).eq(...).maybeSingle()           (target row)
//   .from(table).update(patch).eq(...).eq(...)                (terminal update)
// The real PostgrestFilterBuilder is thenable at every step and chainable
// via eq(); this fake mirrors that shape so it structurally satisfies the
// module's client parameter without depending on supabase-js's generics.

type FakeRow = Record<string, unknown>;
type FakeDb = { sync_operations: FakeRow[]; active_protocols: FakeRow[]; protocols: FakeRow[] };

function createFakeSupabaseClient(db: FakeDb, updateErrorForIds: Set<string> = new Set()) {
  function makeSelectBuilder(rows: FakeRow[]) {
    let filtered = rows;
    const builder = {
      eq(col: string, val: unknown) {
        filtered = filtered.filter(r => r[col] === val);
        return builder;
      },
      lt(col: string, val: unknown) {
        filtered = filtered.filter(r => String(r[col]) < String(val));
        return Promise.resolve({ data: filtered, error: null as { message: string } | null });
      },
      maybeSingle() {
        return Promise.resolve({ data: filtered[0] ?? null, error: null as { message: string } | null });
      },
    };
    return builder;
  }

  function makeUpdateBuilder(rows: FakeRow[], patch: FakeRow) {
    let filtered = rows;
    const builder = {
      eq(col: string, val: unknown) {
        filtered = filtered.filter(r => r[col] === val);
        return builder;
      },
      then<TResult1, TResult2 = never>(
        onFulfilled?: ((value: { error: { message: string } | null }) => TResult1 | PromiseLike<TResult1>) | null,
        onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ) {
        const erroring = filtered.find(r => updateErrorForIds.has(String(r.id)));
        if (erroring) {
          return Promise.resolve({ error: { message: 'boom' } }).then(onFulfilled, onRejected);
        }
        for (const row of filtered) Object.assign(row, patch);
        return Promise.resolve({ error: null }).then(onFulfilled, onRejected);
      },
    };
    return builder;
  }

  return {
    from(table: string) {
      const rows = db[table as keyof FakeDb] ?? [];
      return {
        select(_cols: string) {
          return makeSelectBuilder(rows);
        },
        update(patch: FakeRow) {
          return makeUpdateBuilder(rows, patch);
        },
      };
    },
    // Cast: this fake implements only the chain shapes reconcileLedger.ts
    // calls, not the full generic @supabase/supabase-js client surface.
  } as unknown as ReturnType<typeof getSupabaseClient>;
}

async function withCapturedWarnings<T>(fn: () => Promise<T>): Promise<{ result: T; warnings: unknown[][] }> {
  const warnings: unknown[][] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args);
  };
  try {
    const result = await fn();
    return { result, warnings };
  } finally {
    console.warn = original;
  }
}

test('reconcileStuckLedgerOps updates a stale pause_command op to succeeded when target matches', async () => {
  const now = new Date('2026-08-06T00:00:00.000Z');
  const staleUpdatedAt = new Date(now.getTime() - 11 * 60 * 1000).toISOString();
  const db: FakeDb = {
    sync_operations: [
      {
        id: 'op-1',
        user_id: 'user-1',
        operation_kind: 'pause_command',
        entity_type: 'active_protocol',
        entity_id: 'active-1',
        payload: { status: 'paused' },
        status: 'inflight',
        updated_at: staleUpdatedAt,
      },
    ],
    active_protocols: [{ id: 'active-1', status: 'paused' }],
    protocols: [],
  };
  const client = createFakeSupabaseClient(db);

  const result = await reconcileStuckLedgerOps('user-1', { now, client });

  assert.deepEqual(result, { reconciled: 1, succeeded: 1, failed: 0 });
  const row = db.sync_operations[0];
  assert.equal(row.status, 'succeeded');
  assert.equal(row.last_error, null);
  assert.equal(row.completed_at, now.toISOString());
  assert.equal(row.updated_at, now.toISOString());
});

test('reconcileStuckLedgerOps marks a diverged active_protocol op as failed', async () => {
  const now = new Date('2026-08-06T00:00:00.000Z');
  const staleUpdatedAt = new Date(now.getTime() - 11 * 60 * 1000).toISOString();
  const db: FakeDb = {
    sync_operations: [
      {
        id: 'op-1',
        user_id: 'user-1',
        operation_kind: 'pause_command',
        entity_type: 'active_protocol',
        entity_id: 'active-1',
        payload: { status: 'paused' },
        status: 'inflight',
        updated_at: staleUpdatedAt,
      },
    ],
    active_protocols: [{ id: 'active-1', status: 'active' }],
    protocols: [],
  };
  const client = createFakeSupabaseClient(db);

  const result = await reconcileStuckLedgerOps('user-1', { now, client });

  assert.deepEqual(result, { reconciled: 1, succeeded: 0, failed: 1 });
  const row = db.sync_operations[0];
  assert.equal(row.status, 'failed');
  assert.equal(row.last_error, 'reconciled: target state diverged');
  assert.equal(row.completed_at, null);
});

test('reconcileStuckLedgerOps reconciles archive_command via protocols.is_archived', async () => {
  const now = new Date('2026-08-06T00:00:00.000Z');
  const staleUpdatedAt = new Date(now.getTime() - 11 * 60 * 1000).toISOString();
  const db: FakeDb = {
    sync_operations: [
      {
        id: 'op-2',
        user_id: 'user-1',
        operation_kind: 'archive_command',
        entity_type: 'protocol',
        entity_id: 'protocol-1',
        payload: { status: 'abandoned' },
        status: 'inflight',
        updated_at: staleUpdatedAt,
      },
    ],
    active_protocols: [],
    protocols: [{ id: 'protocol-1', is_archived: true }],
  };
  const client = createFakeSupabaseClient(db);

  const result = await reconcileStuckLedgerOps('user-1', { now, client });

  assert.deepEqual(result, { reconciled: 1, succeeded: 1, failed: 0 });
  assert.equal(db.sync_operations[0].status, 'succeeded');
});

test('reconcileStuckLedgerOps skips rows newer than the stale threshold and leaves them untouched', async () => {
  const now = new Date('2026-08-06T00:00:00.000Z');
  const freshUpdatedAt = new Date(now.getTime() - 1000).toISOString();
  const db: FakeDb = {
    sync_operations: [
      {
        id: 'op-1',
        user_id: 'user-1',
        operation_kind: 'pause_command',
        entity_type: 'active_protocol',
        entity_id: 'active-1',
        payload: { status: 'paused' },
        status: 'inflight',
        updated_at: freshUpdatedAt,
      },
    ],
    active_protocols: [{ id: 'active-1', status: 'active' }],
    protocols: [],
  };
  const client = createFakeSupabaseClient(db);

  const result = await reconcileStuckLedgerOps('user-1', { now, client });

  assert.deepEqual(result, { reconciled: 0, succeeded: 0, failed: 0 });
  assert.equal(db.sync_operations[0].status, 'inflight');
});

test('reconcileStuckLedgerOps marks failed when the target row is missing, without throwing', async () => {
  const now = new Date('2026-08-06T00:00:00.000Z');
  const staleUpdatedAt = new Date(now.getTime() - 11 * 60 * 1000).toISOString();
  const db: FakeDb = {
    sync_operations: [
      {
        id: 'op-1',
        user_id: 'user-1',
        operation_kind: 'pause_command',
        entity_type: 'active_protocol',
        entity_id: 'active-missing',
        payload: { status: 'paused' },
        status: 'inflight',
        updated_at: staleUpdatedAt,
      },
    ],
    active_protocols: [],
    protocols: [],
  };
  const client = createFakeSupabaseClient(db);

  const result = await reconcileStuckLedgerOps('user-1', { now, client });

  assert.deepEqual(result, { reconciled: 1, succeeded: 0, failed: 1 });
  assert.equal(db.sync_operations[0].status, 'failed');
});

test('reconcileStuckLedgerOps does not abort the sweep when one row errors on update', async () => {
  const now = new Date('2026-08-06T00:00:00.000Z');
  const staleUpdatedAt = new Date(now.getTime() - 11 * 60 * 1000).toISOString();
  const db: FakeDb = {
    sync_operations: [
      {
        id: 'op-bad',
        user_id: 'user-1',
        operation_kind: 'pause_command',
        entity_type: 'active_protocol',
        entity_id: 'active-1',
        payload: { status: 'paused' },
        status: 'inflight',
        updated_at: staleUpdatedAt,
      },
      {
        id: 'op-good',
        user_id: 'user-1',
        operation_kind: 'pause_command',
        entity_type: 'active_protocol',
        entity_id: 'active-2',
        payload: { status: 'paused' },
        status: 'inflight',
        updated_at: staleUpdatedAt,
      },
    ],
    active_protocols: [
      { id: 'active-1', status: 'paused' },
      { id: 'active-2', status: 'paused' },
    ],
    protocols: [],
  };
  const client = createFakeSupabaseClient(db, new Set(['op-bad']));

  const { result, warnings } = await withCapturedWarnings(() => reconcileStuckLedgerOps('user-1', { now, client }));

  assert.deepEqual(result, { reconciled: 1, succeeded: 1, failed: 0 });
  assert.equal(db.sync_operations.find(r => r.id === 'op-bad')?.status, 'inflight');
  assert.equal(db.sync_operations.find(r => r.id === 'op-good')?.status, 'succeeded');
  assert.ok(warnings.length >= 1, 'expected a console.warn call for the erroring row');
});
