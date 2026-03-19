# Sprint 2A Schema Readiness (Additive Only)

Date: 2026-03-19  
Branch: `codex/lifecycle-sprint2a-schema-readiness`  
Status: additive-migration-ready

## Scope and non-goals

- Add target planning model in parallel only.
- Do not switch app runtime reads.
- Do not remove legacy tables or behavior paths.
- Do not change auth, onboarding, or user-visible UI behavior.

## Current table map (main)

1. Protocol instances
- `active_protocols`: current protocol instance lifecycle (`status`, `start_date`, `end_date`, `paused_at`, `completed_at`)

2. Items
- `protocol_items`: per-protocol medication/analysis/therapy items and recurrence metadata

3. Scheduled rows
- `scheduled_doses`: materialized occurrence rows used directly by current UI (`status`, `scheduled_date`, `scheduled_time`)

4. History rows
- `dose_records`: durable action log (`taken`, `skipped`, `snoozed`) linked to `scheduled_doses`

5. Sync operations
- No server-side sync operations ledger table currently exists.
- Current sync durability is client-local outbox (`src/lib/supabase/syncOutbox.ts`).

## Proposed additive schema (parallel model)

Added in [`supabase/002_lifecycle_schema_readiness.sql`](/Volumes/DATA/GRAVITY%20REPO/worktrees/medremind-sprint2a/supabase/002_lifecycle_schema_readiness.sql):

1. `planned_occurrences`
- Purpose: canonical planned schedule rows with revision/supersession lineage.
- Key fields:
  - linkage: `user_id`, `active_protocol_id`, `protocol_id`, `protocol_item_id`
  - plan slot: `occurrence_date`, `occurrence_time`, `occurrence_key`
  - revisioning: `revision`, `supersedes_occurrence_id`, `superseded_by_occurrence_id`, `superseded_at`
  - lifecycle: `status` (`planned|cancelled|superseded`)
  - bridge: `legacy_scheduled_dose_id` (nullable unique link into current model)

2. `execution_events`
- Purpose: durable execution history independent of mutable scheduled rows.
- Key fields:
  - linkage: `user_id`, `planned_occurrence_id`, `active_protocol_id`, `protocol_item_id`
  - legacy bridge: `legacy_scheduled_dose_id`, `legacy_dose_record_id`
  - event data: `event_type`, `event_at`, `effective_date`, `effective_time`, `note`, `source`
  - idempotency: `idempotency_key` (nullable unique per user)

3. `sync_operations` (server-side ledger)
- Purpose: optional durable operation tracking for future server-aware replay/audit.
- Key fields:
  - operation identity: `operation_kind`, `entity_type`, `entity_id`, `idempotency_key`
  - payload/state: `payload`, `status`, `attempt_count`, `next_attempt_at`, `last_error`
  - metadata: `source`, timestamps

## Exact indexes added

`planned_occurrences`
- `uq_planned_occurrence_revision` on `(user_id, occurrence_key, revision)`
- `uq_planned_occurrence_current` on `(user_id, occurrence_key)` with `superseded_by_occurrence_id is null`
- `idx_planned_occurrences_user_date` on `(user_id, occurrence_date, occurrence_time)`
- `idx_planned_occurrences_active` on `(user_id, active_protocol_id, occurrence_date, occurrence_time)`
- `idx_planned_occurrences_legacy_link` on `(user_id, legacy_scheduled_dose_id)`

`execution_events`
- `uq_execution_events_idempotency` on `(user_id, idempotency_key)` where not null
- `idx_execution_events_user_event_at` on `(user_id, event_at desc)`
- `idx_execution_events_occurrence` on `(user_id, planned_occurrence_id, event_at desc)`
- `idx_execution_events_legacy_dose` on `(user_id, legacy_scheduled_dose_id, event_at desc)`

`sync_operations`
- `uq_sync_operations_idempotency` on `(user_id, idempotency_key)`
- `idx_sync_operations_status_next` on `(user_id, status, next_attempt_at)`
- `idx_sync_operations_entity` on `(user_id, entity_type, entity_id, created_at desc)`

## Invariants to enforce

1. One active row per slot key in planning model
- Enforced by partial unique index `uq_planned_occurrence_current`.

2. Revision chain uniqueness
- `(user_id, occurrence_key, revision)` must be unique.

3. Execution event idempotency
- `(user_id, idempotency_key)` unique when provided.

4. User isolation
- RLS owner-access policies on all new tables.

5. Additive-only bridge safety
- `legacy_scheduled_dose_id` and `legacy_dose_record_id` remain nullable to avoid breaking existing writes.

## Legacy tables that remain untouched in Sprint 2A

- `profiles`
- `notification_settings`
- `drugs`
- `analyses`
- `protocols`
- `protocol_items`
- `active_protocols`
- `scheduled_doses`
- `dose_records`
- `push_subscriptions`

No legacy table is removed, renamed, or behavior-switched in this pass.

## First safe runtime write-through step after Sprint 2A

Smallest safe next runtime slice:

1. Dual-write `dose_records` actions (`take`, `skip`, `snooze`) into `execution_events` only.
2. Keep all existing reads on `scheduled_doses` + `dose_records`.
3. Populate `execution_events.legacy_*` bridge fields to validate parity and idempotency before any read switch.

This gives immediate durability validation without touching current UI read paths.
