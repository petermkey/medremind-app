-- MedRemind - Medication knowledge core.
-- Additive schema for medication map, normalization, evidence, processing, and daily exposure features.

create table if not exists medication_map_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  active_protocol_id uuid not null references active_protocols(id) on delete cascade,
  protocol_item_id uuid not null references protocol_items(id) on delete cascade,
  drug_id uuid references drugs(id) on delete set null,
  display_name text not null,
  generic_name text,
  dose_amount numeric,
  dose_unit text,
  dose_form text,
  route text,
  frequency_type text not null,
  times text[] not null default '{}',
  with_food text,
  start_date date not null,
  end_date date,
  status text not null default 'unknown'
    check (status in ('active', 'paused', 'completed', 'abandoned', 'unknown')),
  source_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint medication_map_items_user_active_protocol_item_key
    unique (user_id, active_protocol_id, protocol_item_id)
);

alter table medication_map_items enable row level security;

drop policy if exists "Owner read medication map items" on medication_map_items;
create policy "Owner read medication map items" on medication_map_items
  for select using (auth.uid() = user_id);

drop trigger if exists medication_map_items_updated_at on medication_map_items;
create trigger medication_map_items_updated_at
  before update on medication_map_items
  for each row execute function public.set_updated_at();

create table if not exists medication_normalizations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  medication_map_item_id uuid not null references medication_map_items(id) on delete cascade,
  rxnorm_rxcui text,
  normalized_name text,
  ingredients text[] not null default '{}',
  class_codes text[] not null default '{}',
  class_labels text[] not null default '{}',
  source text not null
    check (source in ('seed', 'local_alias', 'rxnorm', 'openrouter', 'manual')),
  confidence numeric check (confidence >= 0 and confidence <= 1),
  ambiguity_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint medication_normalizations_map_item_key unique (medication_map_item_id)
);

alter table medication_normalizations enable row level security;

drop policy if exists "Owner read medication normalizations" on medication_normalizations;
create policy "Owner read medication normalizations" on medication_normalizations
  for select using (auth.uid() = user_id);

drop trigger if exists medication_normalizations_updated_at on medication_normalizations;
create trigger medication_normalizations_updated_at
  before update on medication_normalizations
  for each row execute function public.set_updated_at();

create table if not exists medication_rule_evaluations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  medication_map_item_id uuid not null references medication_map_items(id) on delete cascade,
  rule_id text not null,
  domain text not null,
  recommendation_kind text not null
    check (recommendation_kind in ('lifestyle_adjustment', 'tracking_prompt', 'clinician_review')),
  risk_level text not null
    check (risk_level in ('low', 'medium', 'high')),
  title text not null,
  body text not null,
  evidence_refs jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

alter table medication_rule_evaluations enable row level security;

drop policy if exists "Owner read medication rule evaluations" on medication_rule_evaluations;
create policy "Owner read medication rule evaluations" on medication_rule_evaluations
  for select using (auth.uid() = user_id);

create table if not exists medication_evidence_documents (
  id uuid primary key default gen_random_uuid(),
  source text not null
    check (source in ('rxnorm', 'rxclass', 'dailymed', 'openfda', 'curated_rule', 'clinical_advisory')),
  source_url text,
  source_version text,
  source_retrieved_at timestamptz,
  title text not null,
  section_name text,
  content_hash text not null,
  content_excerpt text not null,
  retrieval_strategy text not null
    check (retrieval_strategy in ('lexical', 'model_rerank', 'vector')),
  embedding_model text,
  review_status text not null default 'unreviewed'
    check (review_status in ('unreviewed', 'curated', 'rejected')),
  created_at timestamptz not null default now(),
  constraint medication_evidence_documents_source_hash_key unique (source, content_hash)
);

alter table medication_evidence_documents enable row level security;

create table if not exists medication_ai_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete set null,
  pipeline_name text not null,
  model text not null,
  model_version text,
  provider text not null,
  openrouter_generation_id text,
  prompt_tokens int,
  completion_tokens int,
  total_tokens int,
  input_hash text not null,
  output_json jsonb not null,
  source_evidence_ids uuid[] not null default '{}',
  validation_status text not null
    check (validation_status in ('accepted', 'rejected', 'error')),
  validation_errors text[] not null default '{}',
  created_at timestamptz not null default now()
);

alter table medication_ai_runs enable row level security;

drop policy if exists "Owner or null read medication ai runs" on medication_ai_runs;
create policy "Owner or null read medication ai runs" on medication_ai_runs
  for select using (user_id is null or auth.uid() = user_id);

create table if not exists medication_processing_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  job_type text not null
    check (job_type in ('medication_map_refresh', 'medication_normalization', 'evidence_refresh', 'daily_feature_build', 'insight_generation')),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'completed', 'failed', 'cancelled')),
  idempotency_key text not null unique,
  input_window_start date,
  input_window_end date,
  attempt_count int not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table medication_processing_jobs enable row level security;

drop policy if exists "Owner read medication processing jobs" on medication_processing_jobs;
create policy "Owner read medication processing jobs" on medication_processing_jobs
  for select using (auth.uid() = user_id);

drop trigger if exists medication_processing_jobs_updated_at on medication_processing_jobs;
create trigger medication_processing_jobs_updated_at
  before update on medication_processing_jobs
  for each row execute function public.set_updated_at();

create table if not exists daily_medication_exposures (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  local_date date not null,
  has_glp1_active boolean not null default false,
  days_since_glp1_start int,
  glp1_dose_escalation_phase boolean not null default false,
  has_testosterone_active boolean not null default false,
  testosterone_injection_day_offset int,
  has_beta_blocker_active boolean not null default false,
  has_thyroid_med_active boolean not null default false,
  has_ssri_active boolean not null default false,
  with_food_mismatch_count int not null default 0,
  late_medication_count int not null default 0,
  missed_medication_count int not null default 0,
  medication_class_exposure_score int not null default 0,
  medication_review_signal_count int not null default 0,
  source_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint daily_medication_exposures_user_date_key unique (user_id, local_date)
);

alter table daily_medication_exposures enable row level security;

drop policy if exists "Owner read daily medication exposures" on daily_medication_exposures;
create policy "Owner read daily medication exposures" on daily_medication_exposures
  for select using (auth.uid() = user_id);

drop trigger if exists daily_medication_exposures_updated_at on daily_medication_exposures;
create trigger daily_medication_exposures_updated_at
  before update on daily_medication_exposures
  for each row execute function public.set_updated_at();

create index if not exists idx_medication_map_items_user_protocol
  on medication_map_items(user_id, active_protocol_id);

create index if not exists idx_medication_rule_evaluations_user_map_item
  on medication_rule_evaluations(user_id, medication_map_item_id);

create index if not exists idx_medication_processing_jobs_user_status
  on medication_processing_jobs(user_id, status);

create index if not exists idx_daily_medication_exposures_user_date
  on daily_medication_exposures(user_id, local_date desc);
