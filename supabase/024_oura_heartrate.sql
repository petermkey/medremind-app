-- 024: 5-minute heart-rate timeseries from /v2/usercollection/heartrate.
-- The only daytime HR source; ~288 rows/user/day. PK (user_id, ts) makes
-- repeated sync-window upserts idempotent. Server-only (no user RLS policy),
-- same stance as oura_raw_documents.
create table if not exists oura_heartrate_samples (
  user_id uuid not null references profiles(id) on delete cascade,
  ts timestamptz not null,
  bpm int not null check (bpm between 20 and 250),
  source text not null check (source in ('awake', 'workout', 'rest', 'sleep', 'live', 'session')),
  fetched_at timestamptz not null default now(),
  primary key (user_id, ts)
);

alter table oura_heartrate_samples enable row level security;

create index if not exists idx_oura_heartrate_samples_user_ts
  on oura_heartrate_samples(user_id, ts desc);
