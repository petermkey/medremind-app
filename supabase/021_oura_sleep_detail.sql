-- 021: sleep-detail fields from Oura /v2/usercollection/sleep (main period per day).
alter table external_health_daily_snapshots
  add column if not exists sleep_avg_hrv numeric,
  add column if not exists sleep_efficiency int,
  add column if not exists sleep_latency_seconds int,
  add column if not exists deep_sleep_minutes int,
  add column if not exists rem_sleep_minutes int,
  add column if not exists respiratory_rate numeric;
