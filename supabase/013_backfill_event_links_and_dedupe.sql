-- MedRemind — 013: backfill execution_event → planned_occurrence links,
-- dedupe duplicate occurrence slots, purge V1-era ledger noise.
--
-- Context (audit 2026-06-11): client dose commands wrote execution_events
-- with planned_occurrence_id = NULL (389 of 391 rows), so the boot pull —
-- which derives dose status from events nested under occurrences — reset
-- statuses on every app open. Separately, the V1→V2 backfill created
-- occurrences keyed 'legacy-dose:<uuid>' alongside write-through rows keyed
-- '<active>|<item>|<date>|<time>' for the same slot (52 duplicate groups).
--
-- Idempotent: re-running is a no-op. Apply manually (SQL editor /
-- Management API) — this project has no migration tracking table.

begin;

-- ── 1) Tier 1 backfill: exact slot match including active_protocol_id ──────
-- Prefer live, canonical-keyed (non-legacy) rows, newest first.
with pick as (
  select ee.id as event_id,
         (select po.id
            from planned_occurrences po
           where po.user_id = ee.user_id
             and po.active_protocol_id = ee.active_protocol_id
             and po.protocol_item_id = ee.protocol_item_id
             and po.occurrence_date = ee.effective_date
             and po.occurrence_time = ee.effective_time
           order by (po.superseded_by_occurrence_id is not null) asc,
                    (po.occurrence_key like 'legacy-dose:%') asc,
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

-- ── 2) Tier 2 backfill: same without active_protocol_id ────────────────────
-- Covers events whose active id diverged from the occurrence's instance
-- (cloud-pull canonicalization aliased duplicate instances).
with pick as (
  select ee.id as event_id,
         (select po.id
            from planned_occurrences po
           where po.user_id = ee.user_id
             and po.protocol_item_id = ee.protocol_item_id
             and po.occurrence_date = ee.effective_date
             and po.occurrence_time = ee.effective_time
           order by (po.superseded_by_occurrence_id is not null) asc,
                    (po.occurrence_key like 'legacy-dose:%') asc,
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

-- ── 3) Dedupe live duplicate slots ──────────────────────────────────────────
-- Winner per (user, item, date, time): has linked events > canonical key >
-- newest. Losers are superseded by the winner; their events re-pointed.
create temp table dup_ranked on commit drop as
select id, user_id, protocol_item_id, occurrence_date, occurrence_time, rn
  from (
    select po.id, po.user_id, po.protocol_item_id, po.occurrence_date, po.occurrence_time,
           row_number() over (
             partition by po.user_id, po.protocol_item_id, po.occurrence_date, po.occurrence_time
             order by po.has_events desc, po.is_legacy asc, po.created_at desc, po.id
           ) as rn,
           count(*) over (
             partition by po.user_id, po.protocol_item_id, po.occurrence_date, po.occurrence_time
           ) as n
      from (
        select po.*,
               exists (select 1 from execution_events ee where ee.planned_occurrence_id = po.id) as has_events,
               (po.occurrence_key like 'legacy-dose:%') as is_legacy
          from planned_occurrences po
         where po.superseded_by_occurrence_id is null
      ) po
  ) t
 where t.n > 1;

create temp table dup_pairs on commit drop as
select l.id as loser_id, w.id as winner_id
  from dup_ranked l
  join dup_ranked w
    on w.user_id = l.user_id
   and w.protocol_item_id = l.protocol_item_id
   and w.occurrence_date = l.occurrence_date
   and w.occurrence_time = l.occurrence_time
   and w.rn = 1
 where l.rn > 1;

update execution_events ee
   set planned_occurrence_id = dp.winner_id
  from dup_pairs dp
 where ee.planned_occurrence_id = dp.loser_id;

update planned_occurrences po
   set status = 'superseded',
       superseded_by_occurrence_id = dp.winner_id,
       superseded_at = now()
  from dup_pairs dp
 where po.id = dp.loser_id;

-- ── 4) Purge V1-era failed ledger rows (reference dropped tables) ───────────
delete from sync_operations
 where status = 'failed'
   and updated_at < '2026-06-01';

commit;

-- ── Verification (run separately) ───────────────────────────────────────────
-- select count(*) from execution_events where planned_occurrence_id is null;
-- select count(*) from (
--   select 1 from planned_occurrences
--    where superseded_by_occurrence_id is null
--    group by user_id, protocol_item_id, occurrence_date, occurrence_time
--   having count(*) > 1) g;
