-- MedRemind - Oura analytics storage foundations
-- Server-only storage for raw Oura payloads, sync audit metadata, endpoint coverage,
-- and daily derived health features. No browser-facing RLS policies are created.

create table if not exists external_health_sync_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  provider text not null check (provider in ('oura')),
  sync_type text not null
    check (sync_type in ('initial_backfill', 'daily', 'manual_refresh')),
  range_start date not null,
  range_end date not null,
  status text not null default 'running'
    check (status in ('running', 'success', 'partial_success', 'failed')),
  counts jsonb not null default '{}'::jsonb,
  errors jsonb not null default '[]'::jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  check (range_start <= range_end)
);

alter table external_health_sync_runs enable row level security;

-- Intentionally no user-facing RLS policies: sync audit rows are written/read by
-- server routes using SUPABASE_SERVICE_ROLE_KEY.

create index if not exists idx_external_health_sync_runs_user_provider_started
  on external_health_sync_runs(user_id, provider, started_at desc);

create index if not exists idx_external_health_sync_runs_status
  on external_health_sync_runs(provider, status, started_at desc);

create table if not exists oura_sync_endpoint_coverage (
  id uuid primary key default gen_random_uuid(),
  sync_run_id uuid not null references external_health_sync_runs(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  provider text not null default 'oura' check (provider in ('oura')),
  endpoint text not null,
  status text not null
    check (status in ('success', 'failed', 'skipped')),
  required boolean not null default true,
  range_start date not null,
  range_end date not null,
  document_count int not null default 0 check (document_count >= 0),
  error jsonb,
  fetched_at timestamptz not null default now(),
  check (range_start <= range_end),
  constraint oura_sync_endpoint_coverage_run_endpoint_key unique (sync_run_id, endpoint)
);

alter table oura_sync_endpoint_coverage enable row level security;

-- Minimal endpoint coverage table for Oura partial-success reporting. This is
-- server-only because endpoint failures can contain provider diagnostics.

create index if not exists idx_oura_sync_endpoint_coverage_user_fetched
  on oura_sync_endpoint_coverage(user_id, fetched_at desc);

create table if not exists oura_raw_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  connection_id uuid not null references user_integrations(id) on delete cascade,
  endpoint text not null,
  oura_document_id text,
  local_date date,
  start_datetime timestamptz,
  end_datetime timestamptz,
  payload jsonb not null,
  payload_hash text not null,
  fetched_at timestamptz not null default now(),
  sync_run_id uuid references external_health_sync_runs(id) on delete set null,
  schema_version int not null default 1,
  check (oura_document_id is not null or local_date is not null or start_datetime is not null)
);

alter table oura_raw_documents enable row level security;

-- Intentionally no user-facing RLS policies: raw Oura payloads are server-only
-- and should be pruned through the 90-day retention helper in analyticsStore.

create unique index if not exists idx_oura_raw_documents_identity_hash
  on oura_raw_documents(
    user_id,
    connection_id,
    endpoint,
    coalesce(oura_document_id, ''),
    coalesce(local_date, '-infinity'::date),
    coalesce(start_datetime, '-infinity'::timestamptz),
    payload_hash
  );

create index if not exists idx_oura_raw_documents_user_fetched
  on oura_raw_documents(user_id, fetched_at desc);

create index if not exists idx_oura_raw_documents_retention
  on oura_raw_documents(fetched_at);

create index if not exists idx_oura_raw_documents_user_endpoint_date
  on oura_raw_documents(user_id, endpoint, local_date desc);

create table if not exists daily_health_features (
  user_id uuid not null references profiles(id) on delete cascade,
  date date not null,
  sleep_score int check (sleep_score between 0 and 100),
  readiness_score int check (readiness_score between 0 and 100),
  activity_score int check (activity_score between 0 and 100),
  stress_summary jsonb,
  spo2_average numeric,
  resting_heart_rate numeric,
  hrv_average numeric,
  steps int check (steps >= 0),
  active_calories numeric,
  workout_count int check (workout_count >= 0),
  bedtime_start timestamptz,
  bedtime_end timestamptz,
  data_quality jsonb not null default '{}'::jsonb,
  source_payload_hashes jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, date)
);

alter table daily_health_features enable row level security;

-- No browser-facing policy yet. Future read APIs should expose derived summaries,
-- not raw Oura payloads, after product/API review.

create index if not exists idx_daily_health_features_user_date
  on daily_health_features(user_id, date desc);

drop trigger if exists daily_health_features_updated_at on daily_health_features;
create trigger daily_health_features_updated_at
  before update on daily_health_features
  for each row execute function public.set_updated_at();
