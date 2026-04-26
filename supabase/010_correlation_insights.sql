-- MedRemind - deterministic correlation insights.
-- Stores consent, sanitized daily lifestyle vectors, and generated insight cards.

create table if not exists correlation_consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  enabled boolean not null default false,
  includes_medication_patterns boolean not null default false,
  includes_health_data boolean not null default false,
  acknowledged_no_med_changes boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint correlation_consents_user_key unique (user_id)
);

alter table correlation_consents enable row level security;

drop policy if exists "Owner manage correlation consents" on correlation_consents;
create policy "Owner manage correlation consents" on correlation_consents
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop trigger if exists correlation_consents_updated_at on correlation_consents;
create trigger correlation_consents_updated_at
  before update on correlation_consents
  for each row execute function public.set_updated_at();

create table if not exists daily_lifestyle_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  local_date date not null,
  calories_kcal numeric,
  protein_g numeric,
  fiber_g numeric,
  water_ml numeric,
  taken_count int not null default 0,
  skipped_count int not null default 0,
  missed_count int not null default 0,
  adherence_pct numeric,
  sleep_score numeric,
  readiness_score numeric,
  activity_score numeric,
  stress_high_seconds int,
  recovery_high_seconds int,
  steps int,
  average_spo2 numeric,
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
  constraint daily_lifestyle_snapshots_user_date_key unique (user_id, local_date)
);

alter table daily_lifestyle_snapshots enable row level security;

drop policy if exists "Owner read daily lifestyle snapshots" on daily_lifestyle_snapshots;
create policy "Owner read daily lifestyle snapshots" on daily_lifestyle_snapshots
  for select using (auth.uid() = user_id);

create index if not exists idx_daily_lifestyle_snapshots_user_date
  on daily_lifestyle_snapshots(user_id, local_date desc);

drop trigger if exists daily_lifestyle_snapshots_updated_at on daily_lifestyle_snapshots;
create trigger daily_lifestyle_snapshots_updated_at
  before update on daily_lifestyle_snapshots
  for each row execute function public.set_updated_at();

create table if not exists correlation_insight_cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  window_days int not null check (window_days in (30, 60, 90)),
  feature text not null,
  outcome text not null,
  r numeric not null,
  n int not null,
  strength text not null check (strength in ('weak', 'moderate', 'strong')),
  direction text not null check (direction in ('positive', 'negative')),
  recommendation_kind text not null
    check (recommendation_kind in ('lifestyle_adjustment', 'tracking_prompt', 'clinician_review')),
  title text not null,
  body text not null,
  evidence jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table correlation_insight_cards enable row level security;

drop policy if exists "Owner read correlation insight cards" on correlation_insight_cards;
create policy "Owner read correlation insight cards" on correlation_insight_cards
  for select using (auth.uid() = user_id);

create index if not exists idx_correlation_insight_cards_user_generated
  on correlation_insight_cards(user_id, generated_at desc);
