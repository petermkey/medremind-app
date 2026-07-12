-- 020: cardiovascular age from Oura daily_cardiovascular_age.
alter table external_health_daily_snapshots
  add column if not exists cardiovascular_age numeric;
