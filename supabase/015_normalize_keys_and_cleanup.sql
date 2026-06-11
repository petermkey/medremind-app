-- MedRemind — 015: normalize legacy occurrence keys, purge ledger/user noise.
--
-- Context (audit 2026-06-11): the V1→V2 backfill left planned_occurrences
-- rows keyed 'legacy-dose:<uuid>' instead of the canonical
-- '<active>|<item>|<date>|<HH:MM>' format; key-based lookups miss them.
-- Also: 4 sync_operations rows stuck 'inflight' since Mar–Apr 2026, and 49
-- throwaway E2E accounts created by register-flow test runs.
--
-- Idempotent. Apply manually (SQL editor / Management API) — this project
-- has no migration tracking table.

begin;

-- 1) Normalize live legacy-keyed occurrences to the canonical key format so
--    every code path (incl. key-based lookups) finds them. Guarded: skip when
--    a row with the canonical key already exists for that user.
update planned_occurrences po
   set occurrence_key = po.active_protocol_id::text || '|' || po.protocol_item_id::text
         || '|' || po.occurrence_date::text || '|' || to_char(po.occurrence_time, 'HH24:MI')
 where po.occurrence_key like 'legacy-dose:%'
   and po.superseded_by_occurrence_id is null
   and not exists (
     select 1 from planned_occurrences other
      where other.user_id = po.user_id
        and other.occurrence_key = po.active_protocol_id::text || '|' || po.protocol_item_id::text
              || '|' || po.occurrence_date::text || '|' || to_char(po.occurrence_time, 'HH24:MI')
   );

-- 2) Expire ledger rows stuck inflight for over a week (3 archive + 1
--    complete from Mar–Apr 2026; their effects already landed or were retried).
update sync_operations
   set status = 'failed',
       last_error = 'expired stale inflight (migration 015)',
       updated_at = now()
 where status = 'inflight'
   and updated_at < now() - interval '7 days';

-- 3) Remove throwaway E2E accounts (register-flow runs without E2E_EMAIL).
--    profiles.id → auth.users(id) cascade removes all dependent app data.
delete from auth.users where email like 'e2e-%@example.com';

commit;

-- Verification (run separately):
-- select count(*) from planned_occurrences
--   where occurrence_key like 'legacy-dose:%' and superseded_by_occurrence_id is null;
-- select count(*) from sync_operations where status = 'inflight';
-- select count(*) from auth.users where email like 'e2e-%@example.com';
