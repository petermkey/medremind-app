-- MedRemind — Lifecycle schema readiness (Sprint 2A)
-- Additive only: introduces parallel planning/event model without switching runtime reads.

-- ─── Planned occurrences (future planning model) ─────────────────────────────
create table if not exists planned_occurrences (
  id                            uuid primary key default gen_random_uuid(),
  user_id                       uuid not null references profiles(id) on delete cascade,
  active_protocol_id            uuid not null references active_protocols(id) on delete cascade,
  protocol_id                   uuid not null references protocols(id) on delete cascade,
  protocol_item_id              uuid not null references protocol_items(id) on delete cascade,
  occurrence_date               date not null,
  occurrence_time               time not null,
  occurrence_key                text not null, -- stable slot key for revision chain
  revision                      int not null default 1 check (revision > 0),
  status                        text not null default 'planned'
                                  check (status in ('planned', 'cancelled', 'superseded')),
  supersedes_occurrence_id      uuid references planned_occurrences(id) on delete set null,
  superseded_by_occurrence_id   uuid references planned_occurrences(id) on delete set null,
  superseded_at                 timestamptz,
  source_generation             text not null default 'legacy_regenerate',
  legacy_scheduled_dose_id      uuid unique references scheduled_doses(id) on delete set null,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now()
);

alter table planned_occurrences enable row level security;
create policy "Owner access" on planned_occurrences for all using (auth.uid() = user_id);

create unique index if not exists uq_planned_occurrence_revision
  on planned_occurrences(user_id, occurrence_key, revision);

create unique index if not exists uq_planned_occurrence_current
  on planned_occurrences(user_id, occurrence_key)
  where superseded_by_occurrence_id is null;

create index if not exists idx_planned_occurrences_user_date
  on planned_occurrences(user_id, occurrence_date, occurrence_time);

create index if not exists idx_planned_occurrences_active
  on planned_occurrences(user_id, active_protocol_id, occurrence_date, occurrence_time);

create index if not exists idx_planned_occurrences_legacy_link
  on planned_occurrences(user_id, legacy_scheduled_dose_id);

-- ─── Execution events (durable action history model) ─────────────────────────
create table if not exists execution_events (
  id                          uuid primary key default gen_random_uuid(),
  user_id                     uuid not null references profiles(id) on delete cascade,
  planned_occurrence_id       uuid references planned_occurrences(id) on delete set null,
  legacy_scheduled_dose_id    uuid references scheduled_doses(id) on delete set null,
  legacy_dose_record_id       uuid references dose_records(id) on delete set null,
  active_protocol_id          uuid not null references active_protocols(id) on delete cascade,
  protocol_item_id            uuid not null references protocol_items(id) on delete cascade,
  event_type                  text not null
                                check (event_type in ('taken', 'skipped', 'snoozed', 'unsnoozed', 'overdue_marked', 'manual')),
  event_at                    timestamptz not null,
  effective_date              date,
  effective_time              time,
  note                        text,
  source                      text not null default 'legacy_dose_record',
  idempotency_key             text,
  created_at                  timestamptz not null default now()
);

alter table execution_events enable row level security;
create policy "Owner access" on execution_events for all using (auth.uid() = user_id);

create unique index if not exists uq_execution_events_idempotency
  on execution_events(user_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists idx_execution_events_user_event_at
  on execution_events(user_id, event_at desc);

create index if not exists idx_execution_events_occurrence
  on execution_events(user_id, planned_occurrence_id, event_at desc);

create index if not exists idx_execution_events_legacy_dose
  on execution_events(user_id, legacy_scheduled_dose_id, event_at desc);

-- ─── Sync operations ledger (optional server-side durability) ────────────────
create table if not exists sync_operations (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references profiles(id) on delete cascade,
  operation_kind    text not null,
  entity_type       text not null,
  entity_id         uuid,
  idempotency_key   text not null,
  payload           jsonb not null default '{}'::jsonb,
  status            text not null default 'queued'
                      check (status in ('queued', 'inflight', 'succeeded', 'failed', 'cancelled')),
  attempt_count     int not null default 0 check (attempt_count >= 0),
  next_attempt_at   timestamptz,
  last_error        text,
  source            text not null default 'client',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  completed_at      timestamptz
);

alter table sync_operations enable row level security;
create policy "Owner access" on sync_operations for all using (auth.uid() = user_id);

create unique index if not exists uq_sync_operations_idempotency
  on sync_operations(user_id, idempotency_key);

create index if not exists idx_sync_operations_status_next
  on sync_operations(user_id, status, next_attempt_at);

create index if not exists idx_sync_operations_entity
  on sync_operations(user_id, entity_type, entity_id, created_at desc);
