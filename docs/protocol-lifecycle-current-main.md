# Protocol Lifecycle (Current Main)

## Scope
This document describes the **current implemented protocol lifecycle** and persistence model.
It covers create, activate, pause/resume, complete, archive/delete, item edits, and schedule regeneration.
It is an implementation snapshot, not an authority specification.

Authoritative lifecycle behavior is defined in `docs/lifecycle-contract-v1.md`.
If this document and the lifecycle contract diverge, the lifecycle contract is correct.

## Core Domain Entities
- `Protocol`
  - fields: `id`, `ownerId`, `name`, `description`, `category`, `durationDays`, `isTemplate`, `isArchived`, `items[]`, `createdAt`.
- `ActiveProtocol`
  - user instance of a protocol with lifecycle status.
  - status values: `active`, `paused`, `completed`, `abandoned`.
- `ProtocolItem`
  - timing definition for medication/analysis/therapy slots.

## Lifecycle States and Meaning
- `active`
  - protocol is live and contributes actionable doses.
- `paused`
  - protocol instance is retained but non-actionable in current schedule UI.
- `completed`
  - terminal finished state for an instance.
- `abandoned`
  - used when protocol is archived with retained history.

## Allowed Protocol Operations (Current)

### 1. Create custom protocol
- Store: `createCustomProtocol(...)`.
- Writes protocol into local state.
- Sync: `syncProtocolUpsert(...)`.

### 2. Update protocol metadata/timing
- Store: `updateProtocol(id, patch)`.
- Applies patch to protocol and linked active instances.
- If `durationDays` changes (and instance status is `active` or `paused`):
  - recomputes `endDate`
  - triggers `regenerateDoses(activeId)`.
- Sync: `syncProtocolUpsert(...)`.

### 3. Add/remove protocol item
- Store: `addProtocolItem(...)`, `removeProtocolItem(...)`.
- Sync:
  - upsert whole protocol after add
  - item delete path + protocol upsert after remove.

### 4. Activate protocol
- Store: `activateProtocol(protocolId, startDate)`.
- Guard: do not duplicate if already `active` or `paused`.
- Creates `ActiveProtocol(status='active')` + generated doses (~90 days).
- Sync: `syncActivation(...)`.

### 5. Pause protocol
- Store: `pauseProtocol(activeId)`.
- Guard: only `active -> paused` is allowed.
- Local: set status `paused`, set `pausedAt`.
- Sync command: `syncPauseProtocolCommand(...)`.

### 6. Resume protocol
- Store: `resumeProtocol(activeId)`.
- Guard: only `paused -> active` is allowed.
- Local: set status `active`, clear `pausedAt`.
- Sync command: `syncResumeProtocolCommand(...)`.

### 7. Complete protocol
- Store: `completeProtocol(activeId)`.
- Guard: only `active -> completed` is allowed (`paused -> completed` is forbidden).
- Local: set status `completed`, set `completedAt`, clear `pausedAt`.
- Sync command: `syncCompleteProtocolCommand(...)`.

### 8. Delete protocol (branching behavior)
- Store: `deleteProtocol(id)` returns mode:
  - `deleted`: if no handled history.
  - `archived`: if handled history exists.

#### 8a. Hard delete path (`mode='deleted'`)
- Removes protocol, related active instances, related doses, related records from local state.
- Sync: `syncProtocolDelete(...)`.

#### 8b. Archive path (`mode='archived'`)
- Marks protocol `isArchived=true`.
- Marks related active instances `status='abandoned'`, clears `pausedAt` and `completedAt`.
- Keeps historical data.
- Sync: `syncArchiveProtocolCommand(...)`.

### 9. Regenerate future plan
- Store: `regenerateDoses(activeProtocolId)`.
- Deletes only pending future rows that have no durable history/snooze link.
- Inserts newly generated future rows.
- Sync: `syncRegeneratedDoses(...)`.

## Database Persistence by Protocol Operation

## `protocols`
- Upsert on create/update/archive sync (`is_archived` included).
- Delete on hard-delete path.
- Fields written:
  - `id`, `owner_id`, `name`, `description`, `category`, `duration_days`,
  - `is_template`, `is_archived`, `created_at`.

## `protocol_items`
- Upsert all items via protocol upsert.
- Delete specific row on item removal.
- Fields written include:
  - `item_type`, `name`, `drug_id`, `dose_amount`, `dose_unit`, `dose_form`,
  - `route`, `frequency_type`, `frequency_value`, `times`, `with_food`,
  - `instructions`, `start_day`, `end_day`, `sort_order`, `icon`, `color`.

## `active_protocols`
- Upsert on activation.
- Update on pause/resume/complete/archive/end-from-date.
- Delete on hard protocol delete.
- Fields written:
  - `status`, `start_date`, `end_date`, `paused_at`, `completed_at`, `notes`, `created_at`.

## `scheduled_doses`
- Bulk upsert on activation/regeneration.
- Update/delete during dose/protocol lifecycle operations.
- Delete on hard protocol delete or end-from-date command.

## `planned_occurrences`
- Activation write-through creates additive bridge rows for future plan.
- Key fields:
  - `occurrence_key`, `revision=1`, `status='planned'`,
  - `source_generation='activation_write_through_c4'`,
  - `legacy_scheduled_dose_id` bridge.

## `sync_operations`
- Command-ledger rows are written for:
  - `pause_command`, `resume_command`, `complete_command`, `archive_command`.
- Fields:
  - `operation_kind`, `entity_type`, `entity_id`, `idempotency_key`, `payload`,
  - `status`, `attempt_count`, `source`, `last_error`, `completed_at`, `updated_at`.

## `dose_records` and `execution_events`
- Not protocol-state tables themselves, but impacted by protocol actions via related dose handling and deletion paths.

## ID Normalization and Linking
All persisted references use cloud-normalized IDs:
- protocol/item/active/dose/record/operation IDs are normalized with deterministic UUID mapping helpers.
- This maintains stable joins and idempotency across retries.

## UI-Visible Operational Rules (Current)
- Protocols screen defaults to `Active` filter.
- Schedule actionable view includes only doses from `active` protocol instances for non-past days.
- Paused protocol rows in past view are dimmed and action-blocked.
- Future-day dose actions are blocked by both store guard and outbox guard.

## Command Sequencing (High Level)
For command-style lifecycle changes:
1. write `sync_operations` as `inflight`
2. write target table changes (`active_protocols` / related)
3. mark `sync_operations` as `succeeded` or `failed`

For non-command upsert flows:
- protocol and items are upserted first,
- dependent rows (`active_protocols`, `scheduled_doses`, `planned_occurrences`) are upserted next.
