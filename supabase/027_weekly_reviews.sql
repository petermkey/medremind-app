-- 027: W4-B AI Weekly Review (B2) — stored weekly synthesis + push opt-in.
-- payload is the schema-validated review JSON (weekly-review-v1); one row per
-- user per ISO week (week_start = Monday, user timezone). Written only by the
-- service-role cron; users read their own rows (Progress page).
create table if not exists weekly_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  week_start date not null,
  payload jsonb not null,
  model text not null,
  created_at timestamptz not null default now(),
  unique (user_id, week_start)
);
alter table weekly_reviews enable row level security;
do $$ begin
  create policy "Owner read weekly reviews" on weekly_reviews
    for select using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
create index if not exists idx_weekly_reviews_user_week
  on weekly_reviews(user_id, week_start desc);

-- Weekly-review push opt-in (default off — master Global Constraint for new
-- push types). notification_settings has fixed columns, no jsonb (001).
alter table notification_settings
  add column if not exists weekly_review_enabled boolean not null default false;

comment on column notification_settings.weekly_review_enabled is
  'Opt-in for the Monday AI weekly-review generation + push (W4-B). Default off.';
