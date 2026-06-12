-- MedRemind — 018: tombstone never-actioned planned occurrences of
-- terminal (abandoned/completed) protocol instances.
--
-- Context (2026-06-13): protocols activated in March generated 90 days of
-- occurrences; instances abandoned/completed since then still carry
-- thousands of 'planned' rows through mid-June. They can never become
-- actionable (terminal instances are not resumable), inflate every boot
-- pull, and rendered as fake "overdue" history before the display fix.
-- Cancelled-no-event rows are removal tombstones the pull already drops.
--
-- Paused instances are deliberately untouched: resume makes their rows
-- relevant again; the client hides them while paused.
--
-- Idempotent. Apply manually (SQL editor / Management API).

update planned_occurrences po
   set status = 'cancelled'
  from active_protocols ap
 where ap.id = po.active_protocol_id
   and po.user_id = ap.user_id
   and ap.status in ('abandoned', 'completed')
   and po.status = 'planned'
   and po.superseded_by_occurrence_id is null
   and not exists (
     select 1 from execution_events ee where ee.planned_occurrence_id = po.id
   );

-- Verification (run separately):
-- select ap.status, count(*) from planned_occurrences po
--   join active_protocols ap on ap.id = po.active_protocol_id
--  where po.status = 'planned' and po.superseded_by_occurrence_id is null
--  group by 1;  -- expect no abandoned/completed rows
