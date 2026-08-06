import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyLedgerReconciliation } from '../../src/lib/supabase/reconcileLedger';
import type { SyncOperationLedgerRow } from '../../src/lib/supabase/reconcileLedger';

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
