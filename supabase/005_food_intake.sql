-- MedRemind - Food intake diary (N2)
-- Additive only: confirmed food diary entries and AI-estimated components.

create table if not exists food_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  consumed_at timestamptz not null,
  timezone text not null default 'UTC',
  meal_label text not null default 'unknown'
    check (meal_label in ('breakfast', 'lunch', 'dinner', 'snack', 'unknown')),
  title text not null,
  summary text not null,
  source text not null default 'photo_ai'
    check (source in ('photo_ai')),
  estimation_confidence numeric not null default 0
    check (estimation_confidence >= 0 and estimation_confidence <= 1),
  analysis_model text,
  analysis_schema_version text not null default 'food-analysis-v1',
  calories_kcal numeric,
  protein_g numeric,
  total_fat_g numeric,
  saturated_fat_g numeric,
  trans_fat_g numeric,
  carbs_g numeric,
  fiber_g numeric,
  sugars_g numeric,
  added_sugars_g numeric,
  sodium_mg numeric,
  cholesterol_mg numeric,
  extended_nutrients jsonb not null default '{}'::jsonb,
  uncertainties jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint food_entries_id_user_id_key unique (id, user_id)
);

alter table food_entries enable row level security;

drop policy if exists "Owner access" on food_entries;
create policy "Owner access" on food_entries
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists idx_food_entries_user_consumed_at
  on food_entries(user_id, consumed_at desc);

drop trigger if exists food_entries_updated_at on food_entries;
create trigger food_entries_updated_at
  before update on food_entries
  for each row execute function public.set_updated_at();

create table if not exists food_entry_components (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null,
  user_id uuid not null references profiles(id) on delete cascade,
  name text not null,
  category text,
  estimated_quantity numeric,
  estimated_unit text,
  grams_estimate numeric,
  confidence numeric not null default 0
    check (confidence >= 0 and confidence <= 1),
  notes text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  constraint food_entry_components_entry_owner_fk
    foreign key (entry_id, user_id) references food_entries(id, user_id) on delete cascade
);

alter table food_entry_components enable row level security;

drop policy if exists "Owner access" on food_entry_components;
create policy "Owner access" on food_entry_components
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists idx_food_entry_components_entry_order
  on food_entry_components(entry_id, sort_order, id);
