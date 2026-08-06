-- MedRemind — one-off: reconcile 43 stuck `inflight` sync_operations rows
-- (WS1 ledger reaper). Owner-run only — NOT applied by any agent, NOT part
-- of the numbered migration chain, NOT idempotent-by-construction beyond the
-- `status = 'inflight'` guard (see note below).
--
-- Context: `sync_operations` rows are written `status='inflight'` then
-- flipped to `succeeded`/`failed` by the same client call that wrote the
-- underlying `active_protocols`/`protocols` change. If the client was
-- interrupted between the two writes, the ledger row is orphaned `inflight`
-- forever — `next_attempt_at` is always NULL, so nothing sweeps it (that's
-- what migration 031's reaper index + `reconcileStuckLedgerOps` fix for
-- FUTURE rows). This script applies the same classifier logic
-- (`classifyLedgerReconciliation` in src/lib/supabase/reconcileLedger.ts) as
-- raw SQL, once, to the EXISTING 43 orphans already in production.
--
-- Investigated 2026-08-06 via:
--   npx supabase db query --linked "select operation_kind, entity_type, entity_id, payload, updated_at from sync_operations where status = 'inflight' order by updated_at;" < /dev/null
-- Distribution confirmed (43 total, all protocol-lifecycle, matches plan):
--   active_protocol / pause_command    :  8
--   active_protocol / resume_command   :  8
--   active_protocol / complete_command :  8
--   protocol        / archive_command  : 19
-- No `scheduled_dose` or other unmapped entity_type/operation_kind rows
-- present. No row had a missing payload `status`/`isArchived` field, and
-- every row's target row (`active_protocols`/`protocols` by `entity_id`)
-- exists (no NULL joins) — so every row below resolves to `succeeded` or
-- `failed`, never left `inflight`.
--
-- Classifier logic reproduced in SQL:
--   entity_type='active_protocol' (pause/resume/complete_command): match
--     when active_protocols.status = payload->>'status'.
--   entity_type='protocol' (archive_command): payload uses
--     {status:'abandoned'} as intent shorthand, but `protocols` has no
--     `status` column — match when protocols.is_archived = true.
--   Match  -> status='succeeded', completed_at=now(), last_error=NULL
--   No match (incl. target row somehow missing) -> status='failed',
--     last_error='reconciled 2026-08-06: target diverged'
--
-- Idempotency: every UPDATE below is scoped to `so.status = 'inflight'`, so
-- once a row is flipped to succeeded/failed, re-running this script is a
-- no-op for it (it simply won't be selected again). Safe to re-run.
--
-- Usage: run the SELECT first and eyeball it, then run the two UPDATEs.

-- ============================================================================
-- Step 1 (read-only) — preview exactly what will change, per row, before
-- running anything below. Re-run any time; safe.
-- ============================================================================
select
  so.id,
  so.operation_kind,
  so.entity_type,
  so.entity_id,
  so.payload,
  so.updated_at,
  ap.status as active_protocol_status,
  p.is_archived as protocol_is_archived,
  case
    when so.entity_type = 'protocol' then
      case when p.is_archived is true then 'succeeded' else 'failed' end
    when so.entity_type = 'active_protocol' then
      case when ap.status = so.payload->>'status' then 'succeeded' else 'failed' end
    else 'UNMAPPED — left untouched by this script'
  end as would_become_status
from sync_operations so
left join active_protocols ap
  on so.entity_type = 'active_protocol' and ap.id = so.entity_id
left join protocols p
  on so.entity_type = 'protocol' and p.id = so.entity_id
where so.status = 'inflight'
order by so.updated_at;

-- ============================================================================
-- Step 2 — apply. Two statement-pairs, one per entity_type, since the
-- target join and match condition differ. All scoped to status='inflight'
-- only. Scope note: this script only touches entity_type='active_protocol'
-- and entity_type='protocol'+operation_kind='archive_command' — the two
-- mapped shapes confirmed present in production (43/43 rows, see Step 1).
-- It does not touch entity_type='scheduled_dose' or any other unmapped
-- combination; none exist today, but if one is ever selected by the Step 1
-- preview with would_become_status='UNMAPPED — left untouched by this
-- script', it is intentionally left `inflight` — consistent with
-- reconcileStuckLedgerOps' behavior of skipping entity_types with no known
-- target table (see TARGET_TABLE_BY_ENTITY_TYPE in reconcileLedger.ts).
-- ============================================================================

-- 2a. entity_type='active_protocol' (pause_command / resume_command /
--     complete_command): succeeded when the live active_protocols.status
--     already equals the ledger row's intended status.
update sync_operations so
set
  status = 'succeeded',
  last_error = null,
  completed_at = now(),
  updated_at = now(),
  next_attempt_at = null
from active_protocols ap
where so.status = 'inflight'
  and so.entity_type = 'active_protocol'
  and ap.id = so.entity_id
  and ap.status = so.payload->>'status'
returning so.id, so.operation_kind, so.entity_id, so.status, so.completed_at;

update sync_operations so
set
  status = 'failed',
  last_error = 'reconciled 2026-08-06: target diverged',
  completed_at = null,
  updated_at = now(),
  next_attempt_at = null
where so.status = 'inflight'
  and so.entity_type = 'active_protocol'
  and (
    not exists (select 1 from active_protocols ap where ap.id = so.entity_id)
    or exists (
      select 1 from active_protocols ap
      where ap.id = so.entity_id
        and ap.status is distinct from so.payload->>'status'
    )
  )
returning so.id, so.operation_kind, so.entity_id, so.status, so.last_error;

-- 2b. entity_type='protocol' (archive_command): payload intent is
--     {status:'abandoned'} shorthand — succeeded when protocols.is_archived
--     is true (protocols has no `status` column).
update sync_operations so
set
  status = 'succeeded',
  last_error = null,
  completed_at = now(),
  updated_at = now(),
  next_attempt_at = null
from protocols p
where so.status = 'inflight'
  and so.entity_type = 'protocol'
  and so.operation_kind = 'archive_command'
  and p.id = so.entity_id
  and p.is_archived = true
returning so.id, so.operation_kind, so.entity_id, so.status, so.completed_at;

update sync_operations so
set
  status = 'failed',
  last_error = 'reconciled 2026-08-06: target diverged',
  completed_at = null,
  updated_at = now(),
  next_attempt_at = null
where so.status = 'inflight'
  and so.entity_type = 'protocol'
  and so.operation_kind = 'archive_command'
  and (
    not exists (select 1 from protocols p where p.id = so.entity_id)
    or exists (
      select 1 from protocols p
      where p.id = so.entity_id
        and p.is_archived is distinct from true
    )
  )
returning so.id, so.operation_kind, so.entity_id, so.status, so.last_error;

-- ============================================================================
-- Verification (run separately after the UPDATEs above):
-- select status, count(*) from sync_operations group by 1;
--   -> expect inflight = 0 (or only rows <10 min old, written after this
--      script ran)
-- ============================================================================
