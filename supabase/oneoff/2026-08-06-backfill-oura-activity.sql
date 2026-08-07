-- One-off backfill: external_health_daily_snapshots.activity_score / non_wear_minutes
-- for 2026-07-24 through 2026-07-30 (WS4, task 3).
--
-- OWNER-RUN ONLY. Do not run this from an agent session. Not part of any migration
-- or automated pipeline — this is a single manual data-repair script.
--
-- Background:
--   A fix that populates activity_score/non_wear_minutes from the Oura
--   daily_activity payload landed ~2026-07-31, but nothing backfilled the
--   preceding week, so external_health_daily_snapshots rows for 2026-07-24
--   through 2026-07-30 have activity_score = NULL and non_wear_minutes = NULL
--   even though the raw Oura payload for those days is already stored in
--   oura_raw_documents. This script re-derives the two columns from that
--   stored raw payload and updates only the still-NULL cells.
--
-- Investigation performed before writing this script (read-only, via
-- `npx supabase db query --linked "<sql>" < /dev/null`):
--
--   1. Confirmed the exact field names in the raw daily_activity payload:
--        select payload from oura_raw_documents
--        where endpoint = 'daily_activity'
--          and fetched_at::date between '2026-07-24' and '2026-07-30'
--        order by fetched_at desc limit 1;
--      -> payload has integer field "score" (0-100, used as-is) and integer
--         field "non_wear_time" measured in SECONDS (e.g. 24600 = 410 min).
--         This matches src/lib/health/ouraDailyMapper.ts's live mapping:
--           activityScore:   numberOrNull(input.dailyActivity?.score)
--           nonWearMinutes:  minutesOrNull(input.dailyActivity?.non_wear_time)
--             where minutesOrNull(v) = Math.round(v / 60)  ("Oura durations are seconds")
--
--   2. Confirmed target column names/types:
--        select column_name, data_type from information_schema.columns
--        where table_name = 'external_health_daily_snapshots'
--          and (column_name ilike '%activity%' or column_name ilike '%non_wear%'
--               or column_name in ('user_id','local_date','id'));
--      -> activity_score integer, non_wear_minutes integer, local_date date,
--         user_id uuid (both plan-doc names were correct; no renaming needed).
--
--   3. Confirmed the join key: oura_raw_documents already carries its own
--      user_id and local_date columns (no need to parse payload->>'day'),
--      so the two tables join directly on (user_id, local_date).
--
--   4. Confirmed oura_raw_documents has MANY rows per (user_id, local_date)
--      for daily_activity (14-23 fetches/day in the affected week). Pulled
--      every fetch for one affected day (2026-07-24) to see how the value
--      moves over time:
--        select fetched_at, payload->>'score' as score,
--               payload->>'non_wear_time' as non_wear_time
--        from oura_raw_documents
--        where endpoint = 'daily_activity' and local_date = '2026-07-24'
--          and user_id = 'f9b36ee9-823a-4ec1-9648-e5a3e793e207'
--        order by fetched_at;
--      -> Result: score fluctuates during the day itself (56,56,56,56,56,56,
--         57,57,57,57,56,56,55,55,53 across same-day fetches from 00:01 to
--         22:00), then a LAST fetch dated 2026-07-30 23:00 (six days later,
--         not "the day after") jumps to score=58, non_wear_time=24600
--         (vs 3060-5580 on the same-day fetches). So the value is NOT a
--         same-day value that quietly stabilizes and then goes untouched —
--         Oura keeps revising a day's activity score for days afterward as
--         more device data syncs in, and the raw-document table has no
--         is_final/sync_type flag to mark which fetch is authoritative.
--         "Latest fetched_at" is therefore not a verified-stable
--         "finalize sync" per se — it is the best available proxy for
--         "most complete data Oura has produced for that day so far", and
--         it matches how the live sync would behave anyway: persistence.ts
--         upserts snapshot rows on `(user_id, source, local_date)` conflict
--         (upsertExternalHealthDailySnapshots, onConflict:
--         'user_id,source,local_date'), i.e. last-write-wins — so a
--         correctly-running sync during this week would itself have kept
--         overwriting the day's values with whatever the newest fetch said,
--         landing on the same answer this backfill computes.
--
--   5. Confirmed scope: only one user (f9b36ee9-823a-4ec1-9648-e5a3e793e207)
--      has snapshot rows in this date range, all 7 dates present, all with
--      activity_score and non_wear_minutes both NULL.
--
-- ============================================================================
-- STEP 1 — PREVIEW (read-only). Run this first and eyeball the output before
-- running the UPDATE below.
-- ============================================================================

WITH latest_raw AS (
  SELECT DISTINCT ON (user_id, local_date)
    user_id,
    local_date,
    payload,
    fetched_at
  FROM oura_raw_documents
  WHERE endpoint = 'daily_activity'
    AND local_date BETWEEN '2026-07-24' AND '2026-07-30'
  ORDER BY user_id, local_date, fetched_at DESC
)
SELECT
  s.user_id,
  s.local_date,
  s.activity_score   AS current_activity_score,
  s.non_wear_minutes AS current_non_wear_minutes,
  (r.payload ->> 'score')::integer AS new_activity_score,
  ROUND((r.payload ->> 'non_wear_time')::numeric / 60)::integer AS new_non_wear_minutes,
  r.fetched_at AS raw_document_fetched_at
FROM external_health_daily_snapshots s
JOIN latest_raw r
  ON r.user_id = s.user_id
 AND r.local_date = s.local_date
WHERE s.local_date BETWEEN '2026-07-24' AND '2026-07-30'
  AND (s.activity_score IS NULL OR s.non_wear_minutes IS NULL)
ORDER BY s.user_id, s.local_date;

-- ============================================================================
-- STEP 2 — UPDATE. Only run after reviewing the preview above.
-- Only touches rows where the target column is currently NULL and a matching
-- raw document exists; never overwrites a non-NULL value. RETURNING lists
-- exactly which rows changed and their new values, so there's no need to
-- re-run the preview SELECT afterward to confirm the result.
-- ============================================================================

BEGIN;

WITH latest_raw AS (
  SELECT DISTINCT ON (user_id, local_date)
    user_id,
    local_date,
    payload,
    fetched_at
  FROM oura_raw_documents
  WHERE endpoint = 'daily_activity'
    AND local_date BETWEEN '2026-07-24' AND '2026-07-30'
  ORDER BY user_id, local_date, fetched_at DESC
)
UPDATE external_health_daily_snapshots AS s
SET
  activity_score = CASE
    WHEN s.activity_score IS NULL THEN (r.payload ->> 'score')::integer
    ELSE s.activity_score
  END,
  non_wear_minutes = CASE
    WHEN s.non_wear_minutes IS NULL THEN ROUND((r.payload ->> 'non_wear_time')::numeric / 60)::integer
    ELSE s.non_wear_minutes
  END
FROM latest_raw AS r
WHERE s.user_id = r.user_id
  AND s.local_date = r.local_date
  AND s.local_date BETWEEN '2026-07-24' AND '2026-07-30'
  AND (s.activity_score IS NULL OR s.non_wear_minutes IS NULL)
RETURNING s.user_id, s.local_date, s.activity_score, s.non_wear_minutes;

-- Review the RETURNING output above. If it looks correct, run `COMMIT;` to
-- apply the update. If anything looks wrong, run `ROLLBACK;` to abort —
-- this transaction is left open on purpose and will NOT auto-commit.
