-- MedRemind - Oura integration storage
-- Server-only integration records. Tokens are encrypted by the app before insert.

create table if not exists user_integrations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  provider text not null check (provider in ('oura')),
  provider_user_id text,
  access_token_ciphertext text not null,
  refresh_token_ciphertext text,
  expires_at timestamptz,
  scopes text[] not null default '{}',
  status text not null default 'connected'
    check (status in ('connected', 'expired', 'revoked', 'error')),
  last_sync_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_integrations_user_provider_key unique (user_id, provider)
);

alter table user_integrations enable row level security;

-- Intentionally no user-facing RLS policies: access goes through server routes
-- using SUPABASE_SERVICE_ROLE_KEY so encrypted credentials never reach the browser.

create index if not exists idx_user_integrations_user_provider
  on user_integrations(user_id, provider);

drop trigger if exists user_integrations_updated_at on user_integrations;
create trigger user_integrations_updated_at
  before update on user_integrations
  for each row execute function public.set_updated_at();
