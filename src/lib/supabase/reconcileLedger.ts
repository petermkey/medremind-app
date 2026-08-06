// Pure, I/O-free classifier for reconciling a stuck `inflight` sync_operations
// row against the live state of its target table, plus the I/O wrapper that
// sweeps the ledger and applies the classifier's verdict. See
// docs/superpowers/plans/2026-08-06-rem-ws1-ledger-reaper.md for the ledger
// write shape this reads/writes.

import { getSupabaseClient } from './client';

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
// row — matches WS1 plan's `reconcileStuckLedgerOps` default. Threaded
// through as `classifyLedgerReconciliation`'s `staleAfterMs` param so the
// I/O wrapper's SQL-level threshold (`reconcileStuckLedgerOps`'s
// `opts.staleAfterMs`, used in its `.lt('updated_at', ...)` filter) and this
// classifier's own skip check always agree on the same value — do not let
// them diverge, or a caller-supplied `staleAfterMs` narrower than this
// default becomes a silent no-op (rows get selected by SQL but then
// re-skipped here).
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
// I/O, no clock reads — `now` is injected. `staleAfterMs` defaults to
// DEFAULT_STALE_AFTER_MS but callers with their own staleness window (e.g.
// `reconcileStuckLedgerOps`) must pass the same value they used to select
// the row, so this skip check agrees with theirs.
export function classifyLedgerReconciliation(
  op: SyncOperationLedgerRow,
  targetRow: LedgerTargetRow,
  now: Date,
  staleAfterMs: number = DEFAULT_STALE_AFTER_MS,
): LedgerReconciliationVerdict {
  const updatedAtMs = new Date(op.updated_at).getTime();
  if (now.getTime() - updatedAtMs < staleAfterMs) {
    return 'skip';
  }

  if (!targetRow) {
    return 'failed';
  }

  return targetMatchesIntent(op, targetRow) ? 'succeeded' : 'failed';
}

// --- I/O wrapper -----------------------------------------------------------

const TARGET_TABLE_BY_ENTITY_TYPE: Partial<Record<SyncOperationEntityType, string>> = {
  active_protocol: 'active_protocols',
  protocol: 'protocols',
};

export interface ReconcileStuckLedgerOpsOptions {
  staleAfterMs?: number;
  now?: Date;
  // Test-injection point: the real client (getSupabaseClient()) is used by
  // default. Tests pass an in-memory fake that implements only the chain
  // shapes this module calls.
  client?: ReturnType<typeof getSupabaseClient>;
}

export interface ReconcileStuckLedgerOpsResult {
  reconciled: number;
  succeeded: number;
  failed: number;
}

// Sweeps a user's `sync_operations` for `inflight` rows stuck past the
// stale threshold, reconciles each against its live target row via
// classifyLedgerReconciliation, and writes back the terminal status. A
// single row's failure (fetch/update error, unexpected throw) is logged and
// skipped rather than aborting the sweep.
export async function reconcileStuckLedgerOps(
  userId: string,
  opts?: ReconcileStuckLedgerOpsOptions,
): Promise<ReconcileStuckLedgerOpsResult> {
  const now = opts?.now ?? new Date();
  const staleAfterMs = opts?.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  const supabase = opts?.client ?? getSupabaseClient();
  const thresholdIso = new Date(now.getTime() - staleAfterMs).toISOString();

  const result: ReconcileStuckLedgerOpsResult = { reconciled: 0, succeeded: 0, failed: 0 };

  const { data: staleOps, error: selectError } = await supabase
    .from('sync_operations')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'inflight')
    .lt('updated_at', thresholdIso);

  if (selectError) {
    console.warn('[reconcile-ledger] failed to select stale inflight ops', selectError.message);
    return result;
  }

  const ops = (staleOps ?? []) as unknown as SyncOperationLedgerRow[];

  for (const op of ops) {
    try {
      const targetTable = TARGET_TABLE_BY_ENTITY_TYPE[op.entity_type];
      if (!targetTable) {
        // No known target table for this entity_type (e.g. scheduled_dose) —
        // nothing to reconcile against yet, leave the row untouched.
        continue;
      }

      let targetRow: LedgerTargetRow = null;
      const { data: targetData, error: targetError } = await supabase
        .from(targetTable)
        .select('*')
        .eq('id', op.entity_id)
        .maybeSingle();
      if (targetError) {
        console.warn('[reconcile-ledger] failed to fetch target row', op.id, targetError.message);
      } else {
        targetRow = (targetData as LedgerTargetRow) ?? null;
      }

      const verdict = classifyLedgerReconciliation(op, targetRow, now, staleAfterMs);
      if (verdict === 'skip') continue;

      const patch = {
        status: verdict,
        last_error: verdict === 'failed' ? 'reconciled: target state diverged' : null,
        completed_at: verdict === 'succeeded' ? now.toISOString() : null,
        updated_at: now.toISOString(),
      };

      const { error: updateError } = await supabase
        .from('sync_operations')
        .update(patch)
        .eq('id', op.id)
        .eq('user_id', userId);

      if (updateError) {
        console.warn('[reconcile-ledger] failed to update ledger row', op.id, updateError.message);
        continue;
      }

      result.reconciled += 1;
      if (verdict === 'succeeded') result.succeeded += 1;
      else result.failed += 1;
    } catch (err) {
      console.warn(
        '[reconcile-ledger] unexpected error reconciling row',
        op.id,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return result;
}
