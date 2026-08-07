-- WS7 remediation: the occurrence reaper (src/lib/schedule/occurrenceReaper.ts)
-- needs a terminal status for stale/forgotten planned_occurrences rows that is
-- distinct from 'cancelled'. Elsewhere in the codebase, status='cancelled'
-- with no linked execution_events means the user deliberately removed the
-- slot (src/lib/supabase/cloudStore.ts derives removedSlotKeys from that
-- pattern, and src/lib/correlation/persistence.ts /
-- src/app/api/medication-knowledge/refresh/route.ts derive a 'skipped'
-- adherence signal from it). Reaping a merely-forgotten occurrence into
-- 'cancelled' would silently conflate it with real removals in history and
-- adherence analytics. Adding 'expired' keeps the reaper's terminal
-- transition out of that collision. Idempotent.
alter table planned_occurrences drop constraint if exists planned_occurrences_status_check;
alter table planned_occurrences add constraint planned_occurrences_status_check
  check (status in ('planned', 'cancelled', 'superseded', 'expired'));
