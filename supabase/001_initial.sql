-- MedRemind — Initial Schema
-- Run this in your Supabase SQL editor or via supabase db push

-- ─── Extensions ──────────────────────────────────────────────────────────────
create extension if not exists "uuid-ossp";

-- ─── Profiles (extends Supabase auth.users) ──────────────────────────────────
create table if not exists profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  name        text not null,
  timezone    text not null default 'UTC',
  age_range   text check (age_range in ('18-30','31-50','51-70','70+')),
  onboarded   boolean not null default false,
  created_at  timestamptz not null default now()
);
alter table profiles enable row level security;
create policy "Users see own profile"   on profiles for select using (auth.uid() = id);
create policy "Users update own profile" on profiles for update using (auth.uid() = id);
create policy "Users insert own profile" on profiles for insert with check (auth.uid() = id);

-- ─── Notification settings ────────────────────────────────────────────────────
create table if not exists notification_settings (
  user_id         uuid primary key references profiles(id) on delete cascade,
  push_enabled    boolean not null default false,
  email_enabled   boolean not null default false,
  lead_time_min   int not null default 0,
  digest_time     time not null default '07:00',
  updated_at      timestamptz not null default now()
);
alter table notification_settings enable row level security;
create policy "Owner access" on notification_settings for all using (auth.uid() = user_id);

-- ─── Drug catalogue ───────────────────────────────────────────────────────────
create table if not exists drugs (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  generic_name  text,
  category      text,
  common_doses  jsonb,       -- [{"amount":500,"unit":"mg"},...]
  routes        text[],
  notes         text,
  is_custom     boolean not null default false,
  created_by    uuid references profiles(id),
  created_at    timestamptz not null default now()
);
alter table drugs enable row level security;
-- Global drugs readable by all authenticated users
create policy "Read global drugs" on drugs for select using (is_custom = false or auth.uid() = created_by);
create policy "Create custom drugs" on drugs for insert with check (auth.uid() = created_by and is_custom = true);

-- ─── Analysis catalogue ───────────────────────────────────────────────────────
create table if not exists analyses (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  category    text,
  description text,
  is_custom   boolean not null default false,
  created_by  uuid references profiles(id)
);
alter table analyses enable row level security;
create policy "Read analyses" on analyses for select using (is_custom = false or auth.uid() = created_by);

-- ─── Protocols ────────────────────────────────────────────────────────────────
create table if not exists protocols (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid references profiles(id),  -- null = global template
  name          text not null,
  description   text,
  category      text not null default 'custom',
  duration_days int,
  is_template   boolean not null default false,
  is_archived   boolean not null default false,
  created_at    timestamptz not null default now()
);
alter table protocols enable row level security;
create policy "Read templates and own" on protocols for select
  using (is_template = true or auth.uid() = owner_id);
create policy "Insert own" on protocols for insert with check (auth.uid() = owner_id);
create policy "Update own" on protocols for update using (auth.uid() = owner_id);
create policy "Delete own" on protocols for delete using (auth.uid() = owner_id);

-- ─── Protocol items ───────────────────────────────────────────────────────────
create table if not exists protocol_items (
  id              uuid primary key default gen_random_uuid(),
  protocol_id     uuid not null references protocols(id) on delete cascade,
  item_type       text not null check (item_type in ('medication','analysis','therapy')),
  name            text not null,
  drug_id         uuid references drugs(id),
  analysis_id     uuid references analyses(id),
  dose_amount     numeric,
  dose_unit       text,
  dose_form       text,
  route           text,
  frequency_type  text not null,
  frequency_value int,
  times           text[],
  with_food       text check (with_food in ('yes','no','any')),
  instructions    text,
  start_day       int not null default 1,
  end_day         int,
  sort_order      int not null default 0,
  icon            text,
  color           text
);
alter table protocol_items enable row level security;
create policy "Access via protocol" on protocol_items for select
  using (exists (
    select 1 from protocols p
    where p.id = protocol_id and (p.is_template = true or p.owner_id = auth.uid())
  ));
create policy "Manage own items" on protocol_items for all
  using (exists (
    select 1 from protocols p where p.id = protocol_id and p.owner_id = auth.uid()
  ));

-- ─── Active protocols ─────────────────────────────────────────────────────────
create table if not exists active_protocols (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references profiles(id) on delete cascade,
  protocol_id   uuid not null references protocols(id),
  status        text not null default 'active'
                  check (status in ('active','paused','completed','abandoned')),
  start_date    date not null,
  end_date      date,
  paused_at     timestamptz,
  completed_at  timestamptz,
  notes         text,
  created_at    timestamptz not null default now()
);
alter table active_protocols enable row level security;
create policy "Owner access" on active_protocols for all using (auth.uid() = user_id);

-- ─── Scheduled doses ──────────────────────────────────────────────────────────
create table if not exists scheduled_doses (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references profiles(id) on delete cascade,
  active_protocol_id    uuid not null references active_protocols(id) on delete cascade,
  protocol_item_id      uuid not null references protocol_items(id) on delete cascade,
  scheduled_date        date not null,
  scheduled_time        time not null,
  status                text not null default 'pending'
                          check (status in ('pending','taken','skipped','snoozed','overdue')),
  snoozed_until         timestamptz,
  created_at            timestamptz not null default now(),
  unique (active_protocol_id, protocol_item_id, scheduled_date, scheduled_time)
);
alter table scheduled_doses enable row level security;
create policy "Owner access" on scheduled_doses for all using (auth.uid() = user_id);
create index if not exists idx_scheduled_doses_user_date on scheduled_doses(user_id, scheduled_date);
create index if not exists idx_scheduled_doses_status on scheduled_doses(status, scheduled_time);

-- ─── Dose records ─────────────────────────────────────────────────────────────
create table if not exists dose_records (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references profiles(id) on delete cascade,
  scheduled_dose_id    uuid not null references scheduled_doses(id),
  action               text not null check (action in ('taken','skipped','snoozed')),
  recorded_at          timestamptz not null default now(),
  note                 text
);
alter table dose_records enable row level security;
create policy "Owner access" on dose_records for all using (auth.uid() = user_id);
create index if not exists idx_dose_records_user on dose_records(user_id, recorded_at desc);

-- ─── Push subscriptions ───────────────────────────────────────────────────────
create table if not exists push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles(id) on delete cascade,
  endpoint    text not null,
  p256dh      text not null,
  auth        text not null,
  created_at  timestamptz not null default now()
);
alter table push_subscriptions enable row level security;
create policy "Owner access" on push_subscriptions for all using (auth.uid() = user_id);

-- ─── Trigger: auto-create profile on signup ───────────────────────────────────
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, name, timezone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email,'@',1)),
    coalesce(new.raw_user_meta_data->>'timezone', 'UTC')
  );
  insert into public.notification_settings (user_id) values (new.id);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─── Trigger: mark overdue doses ─────────────────────────────────────────────
-- Run this as a cron job instead (see below). Can't use pg_cron in free tier.
-- Example Supabase Edge Function cron: runs daily at 00:05 UTC
-- update scheduled_doses
-- set status = 'overdue'
-- where status = 'pending'
--   and (scheduled_date < current_date
--     or (scheduled_date = current_date and scheduled_time < current_time));
