# Medication Lifecycle (Current Main)

## Scope
This document describes the **current implemented lifecycle** for medication-like schedule rows (`ScheduledDose`) in the app.
It covers creation, handling, snooze/shift behavior, deletion, and database persistence.

## Core Domain Entities
- `ScheduledDose`
  - Key client fields: `id`, `activeProtocolId`, `protocolItemId`, `scheduledDate`, `scheduledTime`, `status`, `snoozedUntil`.
  - Status values: `pending`, `taken`, `skipped`, `snoozed`, `overdue`.
- `DoseRecord`
  - Immutable action log rows: `action` in `taken | skipped | snoozed`.
- `ProtocolItem`
  - Defines medication timing/frequency; dose rows are generated from it.

## Where Medication Rows Come From
Medication rows are not created as standalone objects first. They are generated from protocol items.

### A. Protocol activation
- Store operation: `activateProtocol(protocolId, startDate)`.
- Generates ~90 days of doses via `expandItemToDoses(...)`.
- Marks past rows as `overdue` at generation time.
- Sync call: `syncActivation(...)`.

### B. Protocol edit/regeneration
- Store operation: `regenerateDoses(activeProtocolId)`.
- Regenerates future rows from today when protocol timing/duration changes.
- Preserves future rows that already have durable history (`dose_records`) or snooze links.
- Sync call: `syncRegeneratedDoses(...)`.

### C. Add Dose Sheet (manual add in UI)
- UI: `AddDoseSheet` does not insert a one-off dose directly.
- It creates/uses a protocol (`My Protocol`), adds a protocol item, then regenerates doses.

## Allowed Medication Actions (Current)

### 1. Take
- Store: `takeDose(doseId, note?)`.
- Guards:
  - dose must exist
  - future-date guard: future dates are blocked (`isFutureDoseByDate`).
- Local state effects:
  - `scheduledDoses[doseId].status = taken`
  - append `DoseRecord(action='taken')` if missing.
- Sync: `syncTakeDoseCommand(...)`.

### 2. Skip
- Store: `skipDose(doseId, note?)`.
- Guards:
  - dose must exist
  - future-date guard.
- Local state effects:
  - `scheduledDoses[doseId].status = skipped`
  - append `DoseRecord(action='skipped')` if missing.
- Sync: `syncSkipDoseCommand(...)`.

### 3. Snooze
- Store: `snoozeDose(doseId, option)`.
- Guards:
  - dose must exist
  - future-date guard.
- Behavior:
  - marks original row `status='snoozed'`, sets `snoozedUntil`.
  - creates or reuses a replacement pending row at target slot.
  - collision handling by finding next available slot in +5 minute increments.
  - writes `DoseRecord(action='snoozed')` with a note:
    - `snooze-replacement|original=...|replacement=...|target=...`.
- Sync: `syncSnoozeDoseCommand(...)`.

### 4. Remove Dose (supported in store/sync)
- Store: `removeDose(doseId)`.
- Local state: remove from `scheduledDoses`.
- Sync: `syncRemoveDoseCommand(...)` (hard delete from `scheduled_doses`).

### 5. End Protocol From Date (dose-affecting command)
- Store: `endProtocolFromToday(activeProtocolId, doseId, fromDate?)`.
- Local state:
  - set `activeProtocol.endDate = cutoffDate`
  - remove all rows with `scheduledDate >= cutoffDate` for this active protocol.
- Sync: `syncEndProtocolFromTodayCommand(...)`.

## UI Behavior Constraints (Current)

### Future dates
- Banner shown in schedule UI.
- Take/skip/snooze are blocked.
- Outbox guard also drops future dose operations before remote replay.

### Past dates
- Banner shown in schedule UI.
- Actionability depends on protocol state:
  - only active protocol rows can be acted on.
  - paused protocol rows are visually dimmed and action-blocked.

### History rendering
- `selectHistoryDayRows(date)` only for dates `< today`.
- Rows moved by snooze (`status='snoozed'` or latest action `snoozed`) are hidden from original day view.

## Database Persistence by Operation

## Table: `scheduled_doses`
- Insert on activation/regeneration/snooze replacement.
- Update on take/skip/snooze original:
  - `status`, `snoozed_until`, and sometimes `scheduled_date/scheduled_time` in generic sync path.
- Delete on remove-dose and end-protocol-from-date cleanup.

## Table: `dose_records`
- Upsert per handled action (`taken`, `skipped`, `snoozed`):
  - fields: `id`, `user_id`, `scheduled_dose_id`, `action`, `recorded_at`, `note`.

## Table: `execution_events`
- Insert one event per command-style handled action.
- Fields written:
  - `id`, `user_id`, `planned_occurrence_id=null`,
  - `legacy_scheduled_dose_id`, `legacy_dose_record_id`,
  - `active_protocol_id`, `protocol_item_id`,
  - `event_type` (`taken|skipped|snoozed`), `event_at`,
  - `effective_date`, `effective_time`, `note`, `source`, `idempotency_key`.

## Table: `sync_operations`
- Command-style actions (`take/skip/snooze`) write lifecycle ledger rows.
- Key fields:
  - `operation_kind`, `entity_type='scheduled_dose'`, `entity_id`,
  - `idempotency_key`, `payload`, `status`, `attempt_count`, `source`,
  - `last_error`, `completed_at`, `updated_at`.

## ID Mapping / Bridging Rules
Client IDs may be non-UUID. Before persistence, IDs are normalized using deterministic `stableUuid(...)` helpers:
- protocol: `cloudProtocolId`
- protocol item: `cloudProtocolItemId`
- active protocol: `cloudActiveId`
- dose: `cloudDoseId`
- record: `cloudRecordId`
- operation: `cloudOperationId`

This keeps idempotency and cross-table links stable.

## Timing and Ordering Notes
Typical command order (`take/skip/snooze`):
1. upsert `sync_operations` as `inflight`
2. update/insert `scheduled_doses`
3. upsert `dose_records`
4. insert `execution_events`
5. update `sync_operations` to `succeeded` or `failed`

## Known/Intentional Current Constraints
- Future dose actions are blocked in store and outbox.
- Paused protocol rows are non-interactive even in past-day schedule UI.
- Snoozed origin rows are intentionally hidden from past-day history list.
