-- 025: latest Oura device/user status snapshots on the connection row.
-- sleep_window = latest sleep_time doc's optimal_bedtime + status enums,
-- battery_* = latest ring_battery_level sample. Display/diagnostics only.
alter table external_health_connections
  add column if not exists sleep_window jsonb,
  add column if not exists sleep_window_date date,
  add column if not exists battery_level int check (battery_level between 0 and 100),
  add column if not exists battery_charging boolean,
  add column if not exists battery_at timestamptz;
