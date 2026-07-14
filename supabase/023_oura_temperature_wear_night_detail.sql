-- 023: sensor fields already present in raw_payload: skin-temperature
-- deviation (daily_readiness), ring non-wear time (daily_activity), and
-- intra-night structure derived from the main sleep period.
alter table external_health_daily_snapshots
  add column if not exists temperature_deviation numeric,
  add column if not exists temperature_trend_deviation numeric,
  add column if not exists non_wear_minutes int,
  add column if not exists deep_sleep_first_third_minutes int,
  add column if not exists minutes_to_first_deep_sleep int,
  add column if not exists hrv_recovery_delta numeric;
