create table if not exists oura_tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  oura_id text not null,
  local_date date not null,
  tag_type text,
  comment text,
  start_time timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, oura_id)
);
alter table oura_tags enable row level security;
do $$ begin
  create policy "Owner read oura tags" on oura_tags for select using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
create index if not exists idx_oura_tags_user_date on oura_tags(user_id, local_date);
