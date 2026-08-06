// Pure, I/O-free classifier for reconciling a stuck `inflight` sync_operations
// row against the live state of its target table. See
// docs/superpowers/plans/2026-08-06-rem-ws1-ledger-reaper.md for the ledger
// write shape this reads/writes.

export type SyncOperationKind =
  | 'pause_command'
  | 'resume_command'
  | 'complete_command'
  | 'archive_command'
  | 'take_command'
  | 'skip_command'
  | 'snooze_command';

export type SyncOperationEntityType = 'active_protocol' | 'protocol' | 'scheduled_dose';

export interface SyncOperationLedgerRow {
  id: string;
  user_id: string;
  operation_kind: SyncOperationKind;
  entity_type: SyncOperationEntityType;
  entity_id: string;
  payload: Record<string, unknown>;
  status: 'inflight' | 'succeeded' | 'failed';
  updated_at: string;
}

// Live row from the target table (`active_protocols` / `protocols` / ...),
// shape varies by entity_type — only the fields the classifier compares
// against are relevant here.
export type LedgerTargetRow = Record<string, unknown> | null;

export type LedgerReconciliationVerdict = 'succeeded' | 'failed' | 'skip';

// Default staleness window a reaper should use before touching an `inflight`
// row — matches WS1 plan's `reconcileStuckLedgerOps` default.
export const DEFAULT_STALE_AFTER_MS = 10 * 60 * 1000;

// Does the live target row already reflect the ledger op's intended state?
function targetMatchesIntent(op: SyncOperationLedgerRow, target: Record<string, unknown>): boolean {
  // archive_command's payload uses `{status:'abandoned'}` as intent
  // shorthand, but `protocols` has no `status` column — the real signal is
  // `is_archived`.
  if (op.entity_type === 'protocol' && op.operation_kind === 'archive_command') {
    return target.is_archived === true;
  }

  const expectedStatus = op.payload?.status;
  if (typeof expectedStatus === 'string' && typeof target.status === 'string') {
    return target.status === expectedStatus;
  }

  return false;
}

// Decide the correct terminal status for a stuck `inflight` ledger row by
// comparing its payload's intended state to the live target row. Pure: no
// I/O, no clock reads — `now` is injected.
export function classifyLedgerReconciliation(
  op: SyncOperationLedgerRow,
  targetRow: LedgerTargetRow,
  now: Date,
): LedgerReconciliationVerdict {
  const updatedAtMs = new Date(op.updated_at).getTime();
  if (now.getTime() - updatedAtMs < DEFAULT_STALE_AFTER_MS) {
    return 'skip';
  }

  if (!targetRow) {
    return 'failed';
  }

  return targetMatchesIntent(op, targetRow) ? 'succeeded' : 'failed';
}
