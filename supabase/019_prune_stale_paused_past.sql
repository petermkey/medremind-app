-- MedRemind — 019: tombstone stale PAST planned occurrences of paused
-- protocol instances.
--
-- Context (2026-06-13): migration 018 cleaned terminal (abandoned/completed)
-- instances but deliberately spared paused ones (resume must restore them).
-- However the PAST rows of a paused instance serve no purpose:
--   • resumeProtocol() flips status to active but does NOT regenerate, so on
--     resume every past pending row renders as a fake "overdue" — a latent
--     flood for protocols paused months ago.
--   • they have no execution_events (never actioned), so there is no history
--     to preserve.
--   • they are pulled on every boot (this user: 1,874 stale past rows of
--     ~3,657 total) and only hidden client-side — pure payload weight.
--
-- Future paused rows (occurrence_date >= today) are untouched: resume should
-- restore the going-forward schedule.
--
-- Cancelled-no-event rows are removal tombstones the pull already drops
-- (PR #56), so these simply disappear from the schedule.
--
-- Idempotent. Apply manually (SQL editor / Management API).

update planned_occurrences po
   set status = 'cancelled'
  from active_protocols ap
 where ap.id = po.active_protocol_id
   and po.user_id = ap.user_id
   and ap.status = 'paused'
   and po.status = 'planned'
   and po.superseded_by_occurrence_id is null
   and po.occurrence_date < current_date
   and not exists (
     select 1 from execution_events ee where ee.planned_occurrence_id = po.id
   );

-- Verification (run separately):
-- select count(*) from planned_occurrences po
--   join active_protocols ap on ap.id = po.active_protocol_id
--  where ap.status = 'paused' and po.status = 'planned'
--    and po.superseded_by_occurrence_id is null
--    and po.occurrence_date < current_date;  -- expect only rows with events
