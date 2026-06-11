-- MedRemind — 014: restore occurrences for orphan execution_events.
--
-- After 013, 173 events remained unlinked because no planned_occurrences
-- row exists at their slot at all (rows deleted by dose regeneration before
-- events were ever linked). All 173 reference live active_protocols and
-- protocol_items and carry past effective dates (2026-03-18 … 2026-06-06) —
-- they are real user history. Recreate one occurrence per taken/skipped
-- slot and link every orphan event matching that slot. Snoozed-only slots
-- stay unlinked deliberately: their lineage is gone and a restored row
-- would surface as a stale superseded slot.
--
-- Idempotent. Apply manually (SQL editor / Management API).
--
-- NOTE: re-run the dedupe section of 013 after this migration — restored
-- slots can collide across duplicate protocol instances (two events for the
-- same slot from different active_protocol_ids each restore a row).

begin;

-- ── 1) Recreate occurrences for orphan taken/skipped slots ──────────────────
insert into planned_occurrences (
  id, user_id, active_protocol_id, protocol_id, protocol_item_id,
  occurrence_date, occurrence_time, occurrence_key, revision, status,
  source_generation
)
select gen_random_uuid(),
       s.user_id,
       s.active_protocol_id,
       pi.protocol_id,
       s.protocol_item_id,
       s.effective_date,
       s.effective_time,
       s.active_protocol_id::text || '|' || s.protocol_item_id::text || '|'
         || s.effective_date::text || '|' || to_char(s.effective_time, 'HH24:MI'),
       1,
       'planned',
       'orphan_event_restore_014'
  from (
    select distinct ee.user_id, ee.active_protocol_id, ee.protocol_item_id,
           ee.effective_date, ee.effective_time
      from execution_events ee
     where ee.planned_occurrence_id is null
       and ee.event_type in ('taken', 'skipped')
       and ee.effective_date is not null
       and ee.effective_time is not null
  ) s
  join protocol_items pi on pi.id = s.protocol_item_id
on conflict (user_id, occurrence_key, revision) do nothing;

-- ── 2) Link remaining orphan events to the restored (or any live) slot row ──
with pick as (
  select ee.id as event_id,
         (select po.id
            from planned_occurrences po
           where po.user_id = ee.user_id
             and po.protocol_item_id = ee.protocol_item_id
             and po.occurrence_date = ee.effective_date
             and po.occurrence_time = ee.effective_time
           order by (po.superseded_by_occurrence_id is not null) asc,
                    po.created_at desc
           limit 1) as occ_id
    from execution_events ee
   where ee.planned_occurrence_id is null
     and ee.effective_date is not null
     and ee.effective_time is not null
)
update execution_events ee
   set planned_occurrence_id = pick.occ_id
  from pick
 where ee.id = pick.event_id
   and pick.occ_id is not null;

commit;

-- ── Verification (run separately) ───────────────────────────────────────────
-- select event_type, count(*) from execution_events
--  where planned_occurrence_id is null group by 1;  -- expect snoozed-only
