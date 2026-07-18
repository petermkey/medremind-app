-- 026: Nutrient Balance (B1).
-- (a) supplement_nutrient_facts: LLM-extracted per-dose nutrient content per
--     normalized supplement, cached forever (one extraction per unique
--     name+dose+unit, medKnowledge-style validation_status machinery).
--     Global cache - no user_id, service-role access only.
-- (b) nutrient_balance_reports: per-user/day report cache so the Progress
--     card is instant (B1 spec prefers cache over recompute).
create table if not exists supplement_nutrient_facts (
  id uuid primary key default gen_random_uuid(),
  normalized_name text not null,
  dose_amount numeric not null,
  dose_unit text not null,
  nutrients jsonb not null,
  model text not null,
  validation_status text not null default 'pending'
    check (validation_status in ('pending', 'verified', 'rejected')),
  created_at timestamptz not null default now(),
  unique (normalized_name, dose_amount, dose_unit)
);
alter table supplement_nutrient_facts enable row level security;
-- Intentionally no policies: not user data; only the service-role client
-- (RLS-bypassing) reads/writes this cache.

create table if not exists nutrient_balance_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  report_date date not null,
  payload jsonb not null,
  limits_version text not null,
  computed_at timestamptz not null default now(),
  unique (user_id, report_date)
);
alter table nutrient_balance_reports enable row level security;
do $$ begin
  create policy "Owner read nutrient balance reports" on nutrient_balance_reports
    for select using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
create index if not exists idx_nutrient_balance_reports_user_date
  on nutrient_balance_reports(user_id, report_date);
