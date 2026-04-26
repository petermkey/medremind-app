-- MedRemind - Nutrition targets and hydration (N3)
-- Additive only: active nutrition target profile and manual water entries.

create table if not exists nutrition_target_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  age_years int not null
    check (age_years between 13 and 100),
  sex text not null
    check (sex in ('male', 'female', 'other_or_prefer_not_to_say')),
  weight_kg numeric not null
    check (weight_kg >= 30 and weight_kg <= 250),
  height_cm numeric not null
    check (height_cm >= 120 and height_cm <= 230),
  activity_level text not null
    check (activity_level in ('sedentary', 'light', 'moderate', 'high', 'athlete')),
  body_fat_range text not null default 'unknown'
    check (body_fat_range in ('<10%', '10-15%', '15-20%', '20-25%', '25%+', 'unknown')),
  goal_mode text not null
    check (goal_mode in ('bulk', 'lean-dry', 'stabilization', 'recomposition')),
  calories_kcal int not null
    check (calories_kcal > 0),
  protein_g int not null
    check (protein_g > 0),
  fat_g int not null
    check (fat_g > 0),
  carbs_g int not null
    check (carbs_g > 0),
  fiber_g int not null
    check (fiber_g > 0),
  water_ml int not null
    check (water_ml >= 500 and water_ml <= 8000),
  algorithm_version text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint nutrition_target_profiles_user_id_key unique (user_id)
);

alter table nutrition_target_profiles enable row level security;

drop policy if exists "Owner access" on nutrition_target_profiles;
create policy "Owner access" on nutrition_target_profiles
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop trigger if exists nutrition_target_profiles_updated_at on nutrition_target_profiles;
create trigger nutrition_target_profiles_updated_at
  before update on nutrition_target_profiles
  for each row execute function public.set_updated_at();

create table if not exists water_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  consumed_at timestamptz not null,
  timezone text not null default 'UTC',
  amount_ml int not null
    check (amount_ml >= 50 and amount_ml <= 3000),
  source text not null default 'manual'
    check (source in ('manual')),
  created_at timestamptz not null default now()
);

alter table water_entries enable row level security;

drop policy if exists "Owner access" on water_entries;
create policy "Owner access" on water_entries
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists idx_water_entries_user_consumed_at
  on water_entries(user_id, consumed_at desc);
