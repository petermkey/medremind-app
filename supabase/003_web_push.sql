-- Migration 003: Web Push subscriptions and notification log
-- Apply manually via Supabase SQL editor or psql.

-- ─── push_subscriptions ────────────────────────────────────────────────────────
-- One row per (user, device). A user may have multiple subscriptions (multiple
-- installed Home Screen PWA instances across different devices / browsers).

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint      TEXT NOT NULL,
  p256dh        TEXT NOT NULL,
  auth          TEXT NOT NULL,
  -- Optional device hint to aid debugging (not user-visible).
  user_agent    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Prevent storing the same endpoint twice for the same user.
  CONSTRAINT push_subscriptions_user_endpoint_unique UNIQUE (user_id, endpoint)
);

-- Index for the scheduler: fetch all subscriptions for a given user.
CREATE INDEX IF NOT EXISTS push_subscriptions_user_id_idx
  ON public.push_subscriptions (user_id);

-- RLS: users can only read/write their own subscriptions.
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own push subscriptions"
  ON public.push_subscriptions
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Service role bypasses RLS (used by the notification scheduler).

-- ─── notification_log ─────────────────────────────────────────────────────────
-- Records each push notification sent. Used for deduplication: the scheduler
-- checks this table before sending to avoid re-notifying for the same dose.

CREATE TABLE IF NOT EXISTS public.notification_log (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- The scheduled_doses.id that triggered this notification.
  scheduled_dose_id UUID NOT NULL,
  sent_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Unique: one notification per (user, dose). Prevents re-send even if the
  -- scheduler runs multiple times within the same window.
  CONSTRAINT notification_log_user_dose_unique UNIQUE (user_id, scheduled_dose_id)
);

CREATE INDEX IF NOT EXISTS notification_log_user_id_idx
  ON public.notification_log (user_id);

-- No RLS needed on notification_log — only the service-role scheduler writes to it.
-- Users never read or write this table directly.
ALTER TABLE public.notification_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role only"
  ON public.notification_log
  FOR ALL
  USING (false);

-- ─── updated_at trigger for push_subscriptions ───────────────────────────────

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER push_subscriptions_updated_at
  BEFORE UPDATE ON public.push_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
