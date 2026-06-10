-- Migration 011: restore the (user_id, endpoint) unique constraint on
-- push_subscriptions. Migration 003 declared it inside CREATE TABLE IF NOT
-- EXISTS, but the live table predates that version, so the statement was
-- skipped and the constraint never reached production. This broke
-- upsert(onConflict: 'user_id,endpoint') with "there is no unique or
-- exclusion constraint matching the ON CONFLICT specification".
-- Apply manually via Supabase SQL editor or psql.

-- Dedupe first: keep the most recent row per (user_id, endpoint).
DELETE FROM public.push_subscriptions a
USING public.push_subscriptions b
WHERE a.user_id = b.user_id
  AND a.endpoint = b.endpoint
  AND (a.created_at < b.created_at
       OR (a.created_at = b.created_at AND a.id < b.id));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'push_subscriptions_user_endpoint_unique'
  ) THEN
    ALTER TABLE public.push_subscriptions
      ADD CONSTRAINT push_subscriptions_user_endpoint_unique
      UNIQUE (user_id, endpoint);
  END IF;
END $$;
