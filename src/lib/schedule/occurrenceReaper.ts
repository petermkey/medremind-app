// Pure predicate deciding whether a planned_occurrences row is eligible for
// the reaper to transition to a terminal status. Kept dependency-free so it
// can run inside the strip-types test-runner and be reused by the (later)
// bounded reaper without any Supabase types leaking in here.

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
