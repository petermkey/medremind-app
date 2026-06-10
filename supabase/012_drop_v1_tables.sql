-- Phase 3: drop V1 lifecycle tables.
-- All data has been migrated to planned_occurrences + execution_events (Phase 1–2).
--
-- Drop order matters:
--   1. Drop legacy FK bridge columns from V2 tables (they point into V1 tables).
--   2. Drop dose_records before scheduled_doses — dose_records.scheduled_dose_id
--      has a RESTRICT FK (no cascade), so it must go first.
--   3. Drop scheduled_doses.

ALTER TABLE execution_events
  DROP COLUMN IF EXISTS legacy_scheduled_dose_id,
  DROP COLUMN IF EXISTS legacy_dose_record_id;

ALTER TABLE planned_occurrences
  DROP COLUMN IF EXISTS legacy_scheduled_dose_id;

DROP TABLE IF EXISTS dose_records;
DROP TABLE IF EXISTS scheduled_doses;
