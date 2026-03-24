-- Migration 004: Reminder notifications support
-- Adds notification_count to notification_log so we can track how many times
-- a reminder was sent per dose. The sent_at column already exists and will be
-- updated on each reminder send (instead of being a no-op on conflict).

ALTER TABLE notification_log
  ADD COLUMN IF NOT EXISTS notification_count int NOT NULL DEFAULT 1;

COMMENT ON COLUMN notification_log.notification_count IS 'Total number of notifications sent for this dose (1 = initial only, >1 = reminders sent)';
COMMENT ON COLUMN notification_log.sent_at IS 'Timestamp of the most recent notification sent (updated on each reminder)';
