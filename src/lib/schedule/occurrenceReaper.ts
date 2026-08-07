import type { SupabaseClient } from '@supabase/supabase-js';

// Pure predicate deciding whether a planned_occurrences row is eligible for
// the reaper to transition to a terminal status, plus the bounded I/O sweep
// that applies it. The predicate stays dependency-free so it can run inside
// the strip-types test-runner; the sweep below is the only part of this file
// that imports Supabase types.
//
// Status-domain finding (WS7 Task 2): the plan requires confirming the
// `planned_occurrences.status` CHECK constraint before picking a terminal
// status, via `npx supabase db query --linked "select ... pg_constraint ..."`.
// That command could not complete in this worktree — `~/.supabase/profile`
// does not exist here, so the CLI has no cached auth/access-token, and
// `db query --linked` (which authenticates against the Management API) hangs
// waiting on an interactive login flow that never resolves non-interactively
// (`--debug` confirms: `NotFound: FileSystem.readFile
// (~/.supabase/profile)`). Per project rules the fix for that is `supabase
// login`/a documented `SUPABASE_ACCESS_TOKEN` env var, not scanning the
// keychain for a token, so that path is not available here either.
// Per the plan's own constraint ("No new enum value without confirming the
// domain first"), the safe choice when confirmation is unavailable is to NOT
// introduce `'expired'` and instead reuse `'cancelled'` — already a known
// non-planned status in this table (Task 1's own predicate tests exercise it
// as a valid status alongside `'completed'`/`'planned'`). See
// REAP_TERMINAL_STATUS below.

/**
 * Add `days` (may be negative) to a `YYYY-MM-DD` local-date string and
 * return the resulting `YYYY-MM-DD` string. Parses/formats via UTC so the
 * arithmetic is immune to DST shifts — mirrors the approach used in
 * src/lib/weeklyReview/weekRange.ts.
 */
function addDaysIso(localDate: string, days: number): string {
  const date = new Date(`${localDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * True when `occ` is a stale `planned` occurrence the reaper should sweep:
 * status is exactly `'planned'` and `occurrence_date` is earlier than
 * `today` minus `graceDays` days.
 *
 * Boundary is exclusive: an occurrence_date exactly `graceDays` days before
 * `today` is still within the grace period (not reapable). Only dates
 * strictly earlier than that cutoff qualify — matching the plan's "earlier
 * than today - graceDays" wording as a strict `<` comparison.
 *
 * `today` and `occurrence_date` are both `YYYY-MM-DD` local-date strings, so
 * this is a plain lexicographic string comparison (safe for ISO dates).
 */
export function isReapableOccurrence(
  occ: { status: string; occurrence_date: string },
  today: string,
  graceDays = 2,
): boolean {
  if (occ.status !== 'planned') return false;
  const cutoff = addDaysIso(today, -graceDays);
  return occ.occurrence_date < cutoff;
}

// --- Bounded reaper (I/O wrapper) -------------------------------------------

// Terminal status the reaper transitions reapable rows to. See the
// status-domain finding at the top of this file for why this reuses
// `'cancelled'` rather than introducing a new `'expired'` value.
export const REAP_TERMINAL_STATUS = 'cancelled';

// Default grace period, mirrors isReapableOccurrence's own default so a
// caller that doesn't override either stays consistent.
export const DEFAULT_REAP_GRACE_DAYS = 2;

// Cap on rows transitioned per run, per the plan's "500/run" suggestion —
// bounds both the SELECT and the UPDATE cost regardless of backlog size.
export const DEFAULT_REAP_BATCH_SIZE = 500;

export interface ReapStaleOccurrencesOptions {
  today?: string; // YYYY-MM-DD, defaults to the current UTC date
  graceDays?: number;
  batchSize?: number;
}

export interface ReapStaleOccurrencesResult {
  reaped: number;
}

// Sweeps `planned_occurrences` for rows matching isReapableOccurrence's
// logic — pushed directly into the query (`status.eq.planned` AND
// `occurrence_date.lt.cutoff`) rather than fetched broadly and filtered in
// TS, so the cap on rows-per-run (`.limit(batchSize)`) actually bounds what
// leaves the database, not just what this function looks at afterward.
//
// The SELECT-then-UPDATE-by-id shape (rather than a single filtered UPDATE,
// as reconcileStuckLedgerOps uses per-row) is deliberate here: PostgREST has
// no way to LIMIT a bare UPDATE, so bounding the batch size requires
// resolving the id set first. Because every reapable row gets the same
// terminal status (no per-row branching, unlike reconcileStuckLedgerOps'
// per-entity-type classification), a single batched `.in('id', ids)` UPDATE
// is used instead of a per-row loop — cheaper and just as safe. The update
// re-asserts `.eq('status', 'planned')` so a row that changed status between
// the select and the update (e.g. the user actioned it) is left untouched
// rather than clobbered.
export async function reapStaleOccurrences(
  client: SupabaseClient,
  opts?: ReapStaleOccurrencesOptions,
): Promise<ReapStaleOccurrencesResult> {
  const today = opts?.today ?? new Date().toISOString().slice(0, 10);
  const graceDays = opts?.graceDays ?? DEFAULT_REAP_GRACE_DAYS;
  const batchSize = opts?.batchSize ?? DEFAULT_REAP_BATCH_SIZE;
  const cutoff = addDaysIso(today, -graceDays);

  const { data: rows, error: selectError } = await client
    .from('planned_occurrences')
    .select('id')
    .eq('status', 'planned')
    .lt('occurrence_date', cutoff)
    .limit(batchSize);

  if (selectError) {
    console.warn('[occurrence-reaper] failed to select reapable rows', selectError.message);
    return { reaped: 0 };
  }

  const ids = (rows ?? []).map((row) => (row as { id: string }).id);
  if (ids.length === 0) return { reaped: 0 };

  const { error: updateError } = await client
    .from('planned_occurrences')
    .update({ status: REAP_TERMINAL_STATUS })
    .in('id', ids)
    .eq('status', 'planned');

  if (updateError) {
    console.warn('[occurrence-reaper] failed to update reapable rows', updateError.message);
    return { reaped: 0 };
  }

  return { reaped: ids.length };
}
