-- 029: W3-B Morning Briefing — per-user opt-in for the daily readiness push.
-- notification_settings has fixed columns and no extensible jsonb (001), so the
-- default-off toggle (master Global Constraint: new push types default off)
-- becomes a dedicated boolean column.
alter table notification_settings
  add column if not exists morning_briefing_enabled boolean not null default false;

comment on column notification_settings.morning_briefing_enabled is
  'Opt-in for the daily morning readiness briefing push (W3-B). Default off.';
