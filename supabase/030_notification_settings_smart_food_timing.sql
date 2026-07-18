-- 030: W4-A Smart Food-Timed Reminders — per-user opt-in for food-aware
-- reminder-time adjustment. notification_settings has fixed columns and no
-- extensible jsonb (001), and the cron route needs server-visible state, so
-- the default-off toggle (master constraint: new push behaviors default off)
-- takes a dedicated column. Reminder times only — planned_occurrences untouched.
alter table notification_settings
  add column if not exists smart_food_timing boolean not null default false;

comment on column notification_settings.smart_food_timing is
  'W4-A: opt-in for food-aware push-time adjustment (±90 min, quiet-hours safe).';
