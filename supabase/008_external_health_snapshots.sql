-- MedRemind - external health daily snapshots.
-- Stores normalized daily health metrics from Oura now and Apple Health/HealthKit later.

create table if not exists external_health_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  source text not null check (source in ('oura', 'apple_health')),
  status text not null default 'connected' check (status in ('connected', 'disconnected', 'error')),
  scopes text[] not null default '{}',
  last_sync_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint external_health_connections_user_source_key unique (user_id, source)
);

alter table external_health_connections enable row level security;

drop policy if exists "Owner read external health connections" on external_health_connections;
create policy "Owner read external health connections" on external_health_connections
  for select using (auth.uid() = user_id);

create table if not exists external_health_daily_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  source text not null check (source in ('oura', 'apple_health')),
  local_date date not null,
  timezone text not null default 'UTC',
  sleep_score int,
  readiness_score int,
  activity_score int,
  stress_high_seconds int,
  recovery_high_seconds int,
  steps int,
  active_calories int,
  total_calories int,
  average_spo2 numeric,
  breathing_disturbance_index int,
  vo2_max numeric,
  resting_heart_rate numeric,
  hrv_balance text,
  resilience_level text,
  workout_count int not null default 0,
  raw_payload jsonb not null default '{}'::jsonb,
  imported_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint external_health_daily_snapshots_user_source_date_key unique (user_id, source, local_date)
);

alter table external_health_daily_snapshots enable row level security;

drop policy if exists "Owner read external health snapshots" on external_health_daily_snapshots;
create policy "Owner read external health snapshots" on external_health_daily_snapshots
  for select using (auth.uid() = user_id);

create index if not exists idx_external_health_daily_snapshots_user_date
  on external_health_daily_snapshots(user_id, local_date desc);
