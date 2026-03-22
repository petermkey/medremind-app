# MedRemind Lifecycle State Machine Contract

**Version:** 1.2
**Date:** 2026-03-21
**Status:** AUTHORITATIVE — platform-neutral behavioral specification
**Changes in v1.1:** OA-1 closed — no automatic completion at endDate (§2.1, §3.12, §7).
**Changes in v1.2:** OA-4 closed — last-write-wins concurrent write policy (§5.1, §7, §9 added).

---

## Authoritativeness and Scope

This document is the authoritative behavioral specification for the MedRemind lifecycle model.

It applies equally to:
- the current web client (Next.js + Zustand)
- any future native iOS client
- any future client on any other platform

**When this document and browser implementation code conflict, this document is correct.**
The browser store (`src/lib/store/store.ts`) is the current web implementation. It is not the contract. Future clients must follow this specification — they must not reverse-engineer behavior from Zustand code.

Any agent touching the following must read this document first:
- onboarding logic
- protocol creation, edit, or activation
- dose actions (take, skip, snooze)
- protocol lifecycle actions (pause, resume, complete, archive)
- progress aggregation inputs
- sync and outbox logic
- persistence semantics
- lifecycle validation or bug fixing
- any iOS client lifecycle implementation

---

## Table of Contents

1. [State Model](#1-state-model)
2. [Transition Model](#2-transition-model)
3. [Persistence Contract](#3-persistence-contract)
4. [Snooze Lineage Contract](#4-snooze-lineage-contract)
5. [Idempotency Contract](#5-idempotency-contract)
6. [Accepted Warning-Only Behaviors](#6-accepted-warning-only-behaviors)
7. [Open Ambiguities](#7-open-ambiguities)
8. [Implementation Reference](#8-implementation-reference)

---

## 1. State Model

### 1.1 Protocol States

A protocol definition (`Protocol`) does not carry a status. Status lives on the active protocol instance (`ActiveProtocol`) — the user's running instance of a protocol definition.

#### `active`

The protocol instance is running. Doses are generated, dose actions are permitted. This is the only status in which dose actions (take, skip, snooze) are meaningful for future-generation purposes. `pausedAt` and `completedAt` must be null.

#### `paused`

The protocol instance is suspended by explicit user action. `pausedAt` is set to the ISO timestamp of the pause event. Dose actions on rows belonging to this instance are blocked at the client level — no take, skip, or snooze may be issued for doses whose `activeProtocol.status === 'paused'`. Future dose generation does not run for a paused instance. Resume returns the instance to `active`.

#### `completed`

The protocol instance was finished intentionally before or at the natural end of the protocol. `completedAt` is set to the ISO timestamp. This is a **terminal state** — no further dose actions or lifecycle transitions are permitted once completed. The instance and its dose history remain readable for progress and history surfaces.

#### `abandoned`

The protocol definition was deleted by the user after handled history existed. All active instances of the deleted protocol are transitioned to `abandoned`. `status = 'abandoned'`, `completedAt` is cleared (set to null on the instance). This is a **terminal state**. The protocol definition has `isArchived = true`. Instances and history remain readable.

#### Protocol State Field Invariants

| Field | `active` | `paused` | `completed` | `abandoned` |
|---|---|---|---|---|
| `status` | `'active'` | `'paused'` | `'completed'` | `'abandoned'` |
| `pausedAt` | null | set (ISO) | null | null |
| `completedAt` | null | null | set (ISO) | null |
| `endDate` | set if fixed-duration | unchanged | unchanged | unchanged |
| `protocol.isArchived` | false | false | false | **true** |

---

### 1.2 Dose States

A dose row (`ScheduledDose`) is in exactly one of these states at any time.

#### `pending`

The dose is scheduled and has not been acted on. This is the initial state for all generated doses. The dose is actionable — take, skip, and snooze are all permitted. Not terminal.

#### `taken`

The user has marked the dose as taken. A `DoseRecord` with `action = 'taken'` is associated with this dose via `scheduledDoseId`. **Terminal** — no further dose action is permitted on this row. Progress surfaces count this as an adherent event.

#### `skipped`

The user has chosen to skip this dose. A `DoseRecord` with `action = 'skipped'` is associated with this dose via `scheduledDoseId`. **Terminal** — no further dose action is permitted on this row.

#### `snoozed`

The dose has been deferred. A `DoseRecord` with `action = 'snoozed'` is created for the original dose. A replacement dose row is created in `pending` state at the target time. The original row has `snoozedUntil` set to the target slot ISO timestamp.

The `snoozed` original row is logically inert:
- It must **not** appear in the actionable queue.
- It must **not** appear in history surfaces for its original date.
- It must **not** be acted on (take, skip, snooze again) — the replacement dose is the live entity.

#### `overdue`

A dose whose `scheduledDate + scheduledTime` was in the past at activation time. Set at activation only — not updated dynamically at runtime by server or client. An `overdue` dose is still actionable: a user can take or skip an overdue dose. The backend does not block take or skip on `overdue` status. Whether a client surfaces overdue doses as actionable is a UI concern.

#### Dose State Terminalness

| Status | Terminal? | Notes |
|---|---|---|
| `pending` | No | Can transition to taken, skipped, or snoozed |
| `taken` | **Yes** | No further write |
| `skipped` | **Yes** | No further write |
| `snoozed` | **Yes** (original row) | Original row is inert; replacement row is the live entity |
| `overdue` | No | Can transition to taken or skipped |

---

## 2. Transition Model

### 2.1 Protocol-Level Transitions

**Valid transitions:**

```
(no instance) → active        via: activateProtocol
active        → paused        via: pauseProtocol
active        → completed     via: completeProtocol
active        → abandoned     via: deleteProtocol (when history exists)
paused        → active        via: resumeProtocol
paused        → abandoned     via: deleteProtocol (when history exists)
```

**Forbidden transitions:**

```
completed → any     FORBIDDEN. Terminal. No further lifecycle transitions.
abandoned → any     FORBIDDEN. Terminal.
paused → completed  FORBIDDEN. A paused protocol must be resumed before completion.
```

**Additional rules:**
- Double-activation of the same protocol definition is not blocked by the domain model. A protocol can have multiple active instances. This is a UX concern, not a domain constraint.
- Completed instances are excluded from `endDate` recomputation during protocol duration edits.
- Template protocols (seed data, `isTemplate = true`) cannot be deleted or modified by the user.
- The `active → completed` transition is always user-initiated. There is no system-generated, timer-based, or background-task-triggered completion. A fixed-duration protocol reaching its `endDate` does not automatically transition — the instance remains `active` until the user explicitly completes or archives it. Clients must never issue automatic completion commands on a timer or on app launch. See §3.12.

### 2.2 Dose-Level Transitions

**Valid transitions:**

```
pending → taken       via: takeDose
pending → skipped     via: skipDose
pending → snoozed     via: snoozeDose
overdue → taken       via: takeDose
overdue → skipped     via: skipDose
```

**Forbidden transitions:**

```
taken   → any         FORBIDDEN. Terminal.
skipped → any         FORBIDDEN. Terminal.
snoozed → any         FORBIDDEN for the original row.
```

### 2.3 Client-Side Guards

These guards are **client obligations**. The backend does not enforce them. Both web and iOS must honor them identically.

**Future-date guard:** Dose actions (take, skip, snooze) must be refused for any dose whose `scheduledDate` is strictly after today's local calendar date in the user's timezone. The client must compute "today" using the user's stored timezone, not the device default timezone if they differ.

**Paused-protocol guard:** Dose actions must be refused for any dose whose `activeProtocol.status === 'paused'`.

**endDate boundary guard (calendar and schedule views):** For future dates, any dose where `scheduledDate > activeProtocol.endDate` must be excluded from the actionable set.

---

## 3. Persistence Contract

For every action, the client applies a local optimistic mutation first, then syncs to the backend. The cloud sync write order specified here is required for correctness.

### 3.1 Protocol Creation

**Trigger:** user creates a custom protocol definition.

**Persistence:**
- `protocols`: upsert row. Fields: `id`, `owner_id` (user ID), `name`, `description`, `category`, `duration_days` (null for ongoing), `is_template = false`, `is_archived = false`, `created_at`.
- `protocol_items`: upsert all item rows. Fields: `id`, `protocol_id`, `item_type`, `name`, `drug_id`, `dose_amount`, `dose_unit`, `dose_form`, `route`, `frequency_type`, `frequency_value`, `times` (array), `with_food`, `instructions`, `start_day`, `end_day`, `sort_order`, `icon`, `color`.

No `active_protocols`, `scheduled_doses`, `dose_records`, `execution_events`, or `planned_occurrences` rows are written at creation time.

### 3.2 Protocol Activation

**Trigger:** user activates a protocol definition with a start date.

**Pre-conditions:** protocol must exist; user must be authenticated.

**Computed values:**
- `endDate`: if `protocol.durationDays` is a positive integer, `endDate = startDate + (durationDays - 1) days`. The end date is **inclusive** — doses are generated up to and including this date. If `durationDays` is null (ongoing), `endDate` is null and generation runs to the generation horizon.
- **Generation horizon:** 90 days from `startDate` (i.e., `startDate + 89 days`), bounded by `endDate` when present.
- Doses whose `scheduledDate + scheduledTime` is strictly before the current local date-time at activation are assigned `status = 'overdue'`. All other generated doses are `status = 'pending'`.

**Cloud sync write order:**
1. **`protocols`** + **`protocol_items`**: upsert protocol definition first, to guarantee the protocol row exists before the active instance is created.
2. **`active_protocols`**: upsert one row. Fields: `id`, `user_id`, `protocol_id`, `status = 'active'`, `start_date`, `end_date`, `paused_at = null`, `completed_at = null`, `notes`, `created_at`. Conflict key: `ON CONFLICT (id)`.
3. **`scheduled_doses`**: upsert all generated dose rows in batches (max 250 per batch). Fields: `id`, `user_id`, `active_protocol_id`, `protocol_item_id`, `scheduled_date`, `scheduled_time`, `status` (`pending` or `overdue`), `snoozed_until = null`. Conflict key: `ON CONFLICT (id)`.
4. **`planned_occurrences`**: upsert all future-dated dose rows (`scheduled_date >= today`) as planned occurrence rows. Conflict key: `ON CONFLICT (user_id, occurrence_key, revision)` — do update.

**Planned occurrence field derivation:**
- `occurrence_key = "{active_protocol_id}|{protocol_item_id}|{scheduled_date}|{scheduled_time}"` where all IDs are cloud-resolved UUIDs.
- `id = stableUuid("planned-occurrence:{userId}", occurrence_key)` — deterministic, re-upsert safe.
- `revision = 1`, `status = 'planned'`, `source_generation = 'activation_write_through_c4'`.
- `legacy_scheduled_dose_id`: references the corresponding `scheduled_doses.id`.

### 3.3 Protocol Edit with Duration Change (Active Instance Regeneration)

**Trigger:** user edits a protocol's `durationDays` while an active or paused instance exists.

**Rules:**
- Only `active` and `paused` instances are regenerated. `completed` instances are excluded.
- The `endDate` of each affected instance is recomputed: `endDate = instance.startDate + (newDurationDays - 1) days`. Null if `durationDays` becomes null.
- Regeneration runs from today forward. Past dates are never touched.

**Preservation invariants (must not be violated):**
- Any dose with a `DoseRecord` linked to it via `dose_records.scheduled_dose_id` must be preserved. This is durable history linkage.
- Any dose with `snoozedUntil` set must be preserved.
- Any dose with a non-`pending` status must be preserved.
- All other `pending` future rows for the target active instance are deleted and replaced.
- New rows are not inserted for slots held by retained (preserved) rows.

**Cloud sync write order:**
1. **`protocols`** / **`protocol_items`**: upsert updated definition.
2. **`active_protocols`**: update `end_date` for affected instances.
3. **`scheduled_doses`**: for each affected instance, starting from `fromDate = today`:
   - Query existing rows from `fromDate` onward for this `active_protocol_id`.
   - Query `dose_records` for those dose IDs to identify protected rows.
   - Delete rows that are `pending`, have no `dose_records` reference, and have no `snoozed_until` link.
   - Upsert new rows for slots not occupied by retained rows.

`execution_events` and `planned_occurrences` are not modified during regeneration in the current model. See OA-3 in §7.

### 3.4 Take

**Trigger:** user marks a dose as taken.

**Pre-conditions:** dose must be in `pending` or `overdue` status; `scheduledDate` must not be in the future (client enforces); protocol must be `active` (client enforces).

**Cloud sync write order:**
1. **`scheduled_doses`**: update `status = 'taken'` where `id = dose.id AND user_id = userId`.
2. **`dose_records`**: upsert. Fields: `id`, `user_id`, `scheduled_dose_id`, `action = 'taken'`, `recorded_at` (ISO timestamp of take), `note`. Conflict key: `ON CONFLICT (id)` — do update.
3. **`execution_events`**: insert. Fields: `id` (deterministic from `clientOperationId` — see §5), `user_id`, `planned_occurrence_id = null`, `legacy_scheduled_dose_id`, `legacy_dose_record_id`, `active_protocol_id`, `protocol_item_id`, `event_type = 'taken'`, `event_at`, `effective_date`, `effective_time`, `note`, `source = 'take_command'`, `idempotency_key`. On unique constraint violation by `idempotency_key`: confirm the existing row exists, treat as success — do not re-insert.
4. **`sync_operations`**: upsert ledger row. `operation_kind = 'take_command'`, `entity_type = 'scheduled_dose'`, `status` progresses `'inflight'` → `'succeeded'` or `'failed'`. Conflict key: `ON CONFLICT (user_id, idempotency_key)` — do update.

### 3.5 Skip

Identical structure to Take (§3.4) except:
- `scheduled_doses.status` → `'skipped'`
- `dose_records.action` → `'skipped'`
- `execution_events.event_type` → `'skipped'`
- `execution_events.source` → `'skip_command'`
- `sync_operations.operation_kind` → `'skip_command'`

### 3.6 Snooze

For the full snooze semantics and replacement-row contract, see §4.

**Cloud sync write order:**
1. **`scheduled_doses` (original row)**: update `status = 'snoozed'`, `snoozed_until = targetSlot.toISOString()`.
2. **`scheduled_doses` (replacement row)**: upsert with `id = replacementDoseId`, `status = 'pending'`, `scheduled_date = targetDate`, `scheduled_time = targetTime`, `snoozed_until = targetSlot.toISOString()`, same `user_id`, `active_protocol_id`, `protocol_item_id` as original. Conflict key: `ON CONFLICT (id)`. On slot conflict (unique constraint violation on `active_protocol_id + protocol_item_id + scheduled_date + scheduled_time`): shift forward in 5-minute increments up to 72 attempts. Update `original.snoozed_until` to reflect the resolved slot if it changed.
3. **`dose_records`**: upsert for the original dose. `action = 'snoozed'`. `note` field encodes lineage (see §4.2). Conflict key: `ON CONFLICT (id)` — do update (note may be updated on repeat snooze).
4. **`execution_events`**: insert with `event_type = 'snoozed'`, `source = 'snooze_command'`. Same idempotency handling as §3.4.
5. **`sync_operations`**: upsert with `operation_kind = 'snooze_command'`.

### 3.7 Pause

**Trigger:** user pauses an active protocol instance.

**Pre-conditions:** `activeProtocol.status === 'active'`.

**Cloud sync write order:**
1. **`active_protocols`**: update `status = 'paused'`, `paused_at = pausedAt` (ISO timestamp).
2. **`sync_operations`**: upsert. `operation_kind = 'pause_command'`, `entity_type = 'active_protocol'`, `entity_id = activeId`.

No dose rows are modified on pause. Existing pending doses are left in place and become non-actionable while the protocol is paused.

### 3.8 Resume

**Trigger:** user resumes a paused protocol instance.

**Pre-conditions:** `activeProtocol.status === 'paused'`.

**Cloud sync write order:**
1. **`active_protocols`**: update `status = 'active'`, `paused_at = null`. `completedAt` is not touched.
2. **`sync_operations`**: upsert. `operation_kind = 'resume_command'`.

No dose rows are modified on resume.

### 3.9 Complete

**Trigger:** user explicitly completes an active protocol instance.

**Pre-conditions:** `activeProtocol.status === 'active'`. A paused protocol cannot be completed directly — it must be resumed first.

**Cloud sync write order:**
1. **`active_protocols`**: update `status = 'completed'`, `completed_at = completedAt` (ISO timestamp).
2. **`sync_operations`**: upsert. `operation_kind = 'complete_command'`.

No dose rows are modified on completion. Remaining pending doses stay in `scheduled_doses` and remain readable but are no longer actionable.

### 3.10 Archive (Delete with History)

**Trigger:** user deletes a protocol definition that has handled history — at least one `DoseRecord` linked to a dose in any of its instances, or at least one dose with a non-`pending` status.

**Effect on protocol:** `protocols.is_archived = true`. Definition is not hard-deleted.

**Effect on instances:** all `active_protocols` rows linked to this `protocol_id` have `status` set to `'abandoned'`, `completed_at` set to null.

**Cloud sync write order:**
1. **`protocols`**: update `is_archived = true`.
2. **`active_protocols`**: update `status = 'abandoned'`, `completed_at = null` for all rows where `protocol_id = protocolId AND user_id = userId`.
3. **`sync_operations`**: upsert. `operation_kind = 'archive_command'`, `entity_type = 'protocol'`, `entity_id = protocolId`.

No dose rows or dose records are deleted. Full history is preserved.

### 3.11 Hard Delete (Delete without History)

**Trigger:** user deletes a protocol definition with no handled history — no `DoseRecord` rows linked to any of its doses, and no doses with non-`pending` status.

**Cloud sync cascade order:**
1. **`dose_records`**: delete all rows where `scheduled_dose_id` is in the dose set for this protocol's active instances.
2. **`scheduled_doses`**: delete all rows where `active_protocol_id` is in the active instance ID set for this protocol.
3. **`active_protocols`**: delete all rows where `protocol_id = protocolId AND user_id = userId`.
4. **`protocols`**: delete row where `id = protocolId AND owner_id = userId`.

`execution_events` and `planned_occurrences` are not deleted on hard delete in the current model. See OA-2 in §7.

### 3.12 Fixed-Duration End Boundary Behavior

- `endDate = startDate + (durationDays - 1) days` — **inclusive**. A 7-day protocol starting 2026-03-01 ends on 2026-03-07. Doses are generated on 2026-03-07.
- `expandItemToDoses` caps the generation cursor at `min(endDate, generationHorizon)`.
- Clients must exclude any dose where `scheduledDate > activeProtocol.endDate` from the actionable set for future dates.
- **Reaching `endDate` does not trigger a status transition.** The `endDate` is a generation and display boundary only. The instance remains in its current status (typically `active`) after `endDate` is passed. No dose rows are generated beyond `endDate`. The schedule, calendar, and protocol detail views apply `endDate` as a filter on actionable dose display.
- **Clients must not issue automatic completion commands.** No client — web or iOS — may issue a `completeProtocol` command automatically on a timer, on app launch, or in a background task based solely on `endDate` having passed. Completion always requires explicit user intent.
- **Progress aggregation is unaffected by this rule.** Past-date adherence is computed from dose rows in `scheduled_doses`, not from `active_protocols.status`. A protocol that is `active` past its `endDate` produces identical past-date progress numbers to one that has been formally `completed`.
- The user-facing "Complete" action remains available on any `active` instance regardless of whether `endDate` has passed. This is the intended mechanism for formally closing out a fixed-duration course.

### 3.13 Dose Generation Algorithm

All clients must generate doses using the following algorithm. This is the authoritative specification. Do not derive this from `expandItemToDoses` in `store.ts` alone — that function is the current web implementation of this spec.

**Input:** `ProtocolItem`, `ActiveProtocol`, `fromDate: YYYY-MM-DD`, `toDate: YYYY-MM-DD`
**Output:** list of `ScheduledDose` rows (without `protocolItem` / `activeProtocol` references)

**Algorithm:**

```
effectiveToDate = min(toDate, activeProtocol.endDate ?? toDate)
cursor = max(fromDate, activeProtocol.startDate)

For item.itemType === 'analysis' OR item.times is empty:
  If item.frequencyValue is set:
    targetDate = activeProtocol.startDate + (item.startDay - 1 + item.frequencyValue - 1) days
    If targetDate in [fromDate, effectiveToDate]:
      emit one dose at targetDate, scheduledTime = '08:00', status = 'pending'
  Return

While cursor <= effectiveToDate:
  dayNum = (cursor - activeProtocol.startDate) in days + 1

  If dayNum < item.startDay: advance cursor; continue
  If item.endDay is set AND dayNum > item.endDay: stop

  include = false
  switch item.frequencyType:
    'daily' | 'twice_daily' | 'three_times_daily': include = true
    'every_n_days': include = (dayNum - item.startDay) % (item.frequencyValue ?? 1) === 0
    'weekly':       include = (dayNum - item.startDay) % 7 === 0
    default:        include = true

  If include:
    For each time in item.times:
      emit one dose at cursor, scheduledTime = time, status = 'pending'

  advance cursor by 1 day
```

After generation, any dose whose `scheduledDate + scheduledTime < now (activation time)` has its status set to `'overdue'`.

---

## 4. Snooze Lineage Contract

### 4.1 What Happens at Snooze Time

When a user snoozes dose `D` to target time `T`:

1. Dose `D` (original): `status` → `'snoozed'`, `snoozedUntil` → `T` as ISO timestamp. The original dose is now logically inert. It must not appear in the actionable queue. It must not appear in the day history surface for its original scheduled date.

2. Replacement dose `R` is created:
   - `id` = deterministic UUID (see §4.3)
   - `status = 'pending'`
   - `scheduledDate`, `scheduledTime` = resolved target slot (may differ from `T` if slot was occupied — see §4.4)
   - `snoozedUntil` = resolved target slot as ISO timestamp
   - All other fields (`userId`, `activeProtocolId`, `protocolItemId`) copied from the original dose

3. A `DoseRecord` is appended for the original dose:
   - `action = 'snoozed'`
   - `note` encodes lineage in this exact format:
     ```
     snooze-replacement|original={originalDoseId}|replacement={replacementDoseId}|target={scheduledDate}T{scheduledTime}
     ```

### 4.2 Lineage Note Format

The `note` field in the `DoseRecord` for a snoozed original dose is the authoritative lineage record. It must always encode the current replacement dose ID and target slot. If the same original dose is snoozed again (e.g., via a re-snooze before the replacement is acted on), the note is updated to reflect the new target.

### 4.3 Replacement Dose ID Derivation

The replacement dose ID is **deterministic** and must be computed identically on all clients:

```
replacementDoseId = stableUuid(
  namespace: "dose-snooze-replacement:{originalDoseId}",
  source:    "{resolvedScheduledDate}|{resolvedScheduledTime}"
)
```

Where `stableUuid(namespace, source)` is:

```
input = "{namespace}:{source}"
p1 = fnv32(input, seed=0x811c9dc5)
p2 = fnv32(input, seed=0x9e3779b9)
p3 = fnv32(input, seed=0x85ebca6b)
p4 = fnv32(input, seed=0xc2b2ae35)
hex = p1_hex_8 + p2_hex_8 + p3_hex_8 + p4_hex_8   // 32 hex chars
return "{hex[0:8]}-{hex[8:12]}-4{hex[13:16]}-a{hex[17:20]}-{hex[20:32]}"
```

Where `fnv32(input, seed)` is FNV-1a 32-bit: XOR-fold with given seed, iterate each character with `h ^= charCode; h = h * 16777619` (unsigned 32-bit).

**This algorithm must be implemented identically on iOS.** A divergent implementation will produce different replacement dose IDs between clients, causing duplicate replacement rows on re-snooze rather than re-using the existing one.

### 4.4 Slot Conflict Resolution

The target slot `T` is checked against existing doses for the same `activeProtocolId + protocolItemId + scheduledDate + scheduledTime` combination. If the slot is occupied by a different row:
- Advance cursor by 5 minutes.
- Re-check. Repeat up to 72 attempts (360 minutes / 6 hours).
- If no free slot is found within 72 attempts, use the original target slot regardless. Log `[slot-resolution-exhausted]` (see §6, W-1). Do not fail the operation.

When a slot conflict is detected at the backend (unique constraint violation), the same resolution logic runs against the database. If the resolved slot differs from what the client sent, the original dose's `snoozed_until` is updated to reflect the resolved slot.

The current slot occupancy check excludes:
- The source dose itself (`d.id !== sourceDose.id`)
- The intended replacement dose (`d.id !== replacementDoseId`)

### 4.5 Repeated Snooze

If the replacement dose `R` is itself later snoozed:
- `R` is treated as the source dose for the new snooze operation.
- `R` is marked `snoozed`. A new replacement `R2` is created in `pending`.
- A new `DoseRecord` is appended for `R` with `action = 'snoozed'`.
- The lineage note references `R` as `original` and `R2` as `replacement`.
- The original `D` is unaffected — it remains `snoozed` with its own lineage.
- There is no depth limit on snooze chains.

### 4.6 Snooze Lineage in Read Surfaces

| Surface | Rule |
|---|---|
| Actionable queue (today's schedule) | Exclude `status === 'snoozed'`. Exclude `status === 'skipped'`. Include replacement doses (they have `status = 'pending'`). |
| History surface (past dates) | Exclude any dose with `status === 'snoozed'` or whose latest `DoseRecord.action === 'snoozed'` from its original date. Only `taken` and `skipped` statuses appear. |
| Protocol detail — handled history rows | Include `taken` and `skipped` statuses, and doses with any linked `DoseRecord`. Exclude `snoozed` origin rows. |
| Progress aggregation | Exclude `snoozed` origin rows. `selectProgressDayDoses` filter: exclude `status === 'snoozed'`. Replacement doses with `status = 'pending'` count toward `remaining`. |

---

## 5. Idempotency Contract

### 5.1 What clientOperationId Means

Every write command that mutates state must carry a `clientOperationId` — a stable string identifying a specific intent. If the same intent is submitted twice (retry, network failure, app restart), the backend treats the second submission as a no-op for idempotency-keyed rows.

**Idempotency is scoped to a single client's retry loop.** A `clientOperationId` prevents a specific client from duplicating its own command on retry. It does not prevent a different client from producing an independent write for the same logical dose or protocol action. Two clients acting on the same entity each generate their own distinct `clientOperationId` and each produce their own history rows. See §9 for the full multi-client concurrent write policy.

### 5.2 clientOperationId Format

This format is canonical and must be honored identically on all clients:

| Command | Format |
|---|---|
| Take | `take:{doseRecordId}` |
| Skip | `skip:{doseRecordId}` |
| Snooze | `snooze:{doseRecordId}` |
| Pause | `pause:{activeProtocolId}:{pausedAtISOTimestamp}` |
| Resume | `resume:{activeProtocolId}:{resumedAtISOTimestamp}` |
| Complete | `complete:{activeProtocolId}:{completedAtISOTimestamp}` |
| Archive | `archive:{protocolId}:{archivedAtISOTimestamp}` |

Where ID fields are local client IDs (before stable-UUID cloud resolution), and timestamp fields are ISO strings at the moment the action was initiated.

For take, skip, and snooze: the `doseRecordId` is generated once and is stable for that action. On retry, the client must reuse the original `doseRecordId` — not generate a new one.

For lifecycle commands (pause, resume, complete, archive): two separate pause actions on the same instance at different times produce different `clientOperationId` values, which is correct — they represent distinct intents.

### 5.3 Which Tables Must Be Idempotent

| Table | Idempotency Mechanism |
|---|---|
| `sync_operations` | `ON CONFLICT (user_id, idempotency_key)` — do update. Primary ledger. |
| `execution_events` | `idempotency_key` unique constraint. On insert conflict: verify existing row, treat as success. Do not re-insert. |
| `dose_records` | `ON CONFLICT (id)` — do update. Record ID is stable for a given action. |
| `scheduled_doses` | `ON CONFLICT (id)` — do update. Dose ID is stable. |
| `active_protocols` | `ON CONFLICT (id)` at activation. Status updates use targeted UPDATE — idempotency provided by `sync_operations` ledger. |
| `protocols` | `ON CONFLICT (id)` — do update. |
| `protocol_items` | `ON CONFLICT (id)` — do update. |
| `planned_occurrences` | `ON CONFLICT (user_id, occurrence_key, revision)` — do update. |

### 5.4 What Clients May Assume on Retry

A client retrying a failed command with the same `clientOperationId` may assume:
- The `sync_operations` ledger absorbs the duplicate upsert.
- The `execution_events` table does not create a duplicate row for the same `idempotency_key`.
- The `dose_records` row is written identically on retry.
- The `scheduled_doses` status update re-applies the same status.

A client must **not** assume the backend returns a special "already done" indicator. The retry will succeed and return the same outcome as the first call.

### 5.5 Duplicate Dose Record Rule

If a dose already has a `DoseRecord` for its current action at re-submission time:
- The existing record is reused (its `id` is stable and known).
- No new `DoseRecord` is appended.
- The `dose_records.upsert(onConflict: 'id')` write is still safe.
- The `execution_events` insert hits the idempotency constraint and is skipped (treated as success).

---

## 6. Accepted Warning-Only Behaviors

These are conditions the system may encounter that are not bugs. They must be logged and monitored but must not cause operational failures.

**W-1: Snooze slot not found within 72 attempts**
After 72 5-minute increments (6 hours) without finding a free slot, the system falls back to the original target. Log `[slot-resolution-exhausted]`. Do not fail the snooze operation.

**W-2: execution_events idempotency key exists on retry**
If an `execution_events` insert fails with a unique constraint violation on `idempotency_key`, and the existing row is confirmed to exist, this is a successful retry. Log `[execution-event-idempotent-skip]`. Do not re-insert or surface an error.

**W-3: sync_operations ledger write fails (non-fatal)**
If the `sync_operations` upsert fails after the main write succeeds, the ledger is stale but data is safe. Mark as an audit gap. Do not retry in a way that reverses the main write. Log `[sync-operations-ledger-write-failed]`.

**W-4: profiles row absent for authenticated user**
If no `profiles` row exists for an authenticated user (expected via DB trigger), the client falls back to `user_metadata.name` and locale-detected timezone. This is degraded but functional. Log `[profile-row-missing]`. Do not hard-block the user.

**W-5: Future dose operation dropped from outbox**
If an outbox item for a take, skip, or snooze command references a `scheduledDate` strictly in the future at retry time, the operation is dropped without re-attempt. Log `[sync-outbox-future-dose-dropped]`. This prevents stale future writes.

**W-6: Active instance remains `active` past its endDate**
A fixed-duration protocol that reaches its `endDate` does not automatically transition to `completed`. The instance remains `active` until explicit user action. Progress and schedule views must apply the `endDate` boundary filter client-side. Log nothing — this is expected and correct behavior per §3.12.

---

## 7. Open Ambiguities

The following items are not resolved in the current model. They require explicit product or architecture signoff before iOS implementation begins or before the relevant behavior is implemented on any platform.

**~~OA-1: Automatic protocol completion at endDate~~ — CLOSED 2026-03-21**
Decision: **no automatic completion**. A fixed-duration protocol does not automatically transition to `completed` when `endDate` is passed. `endDate` is a generation and display boundary only. The `active → completed` transition always requires explicit user intent. No client may issue completion commands on a timer or in a background task based solely on `endDate` having passed. Rationale: the `endDate` display boundary already delivers the correct UX (no actionable doses after `endDate`); auto-completion would require infrastructure that does not exist and creates multi-client race conditions; progress aggregation is unaffected by protocol status for past dates. Full specification: §2.1 and §3.12.

**OA-2: planned_occurrences and execution_events on hard delete**
Hard delete of a protocol does not delete `planned_occurrences` or `execution_events` rows referencing its doses. They become orphans. Architecture must decide: cascade-delete or leave as historical artifacts.

**OA-3: Regeneration and planned_occurrences**
When future doses are regenerated (duration change), `planned_occurrences` rows for deleted dose slots are not cleaned up. New write-through rows are not inserted for newly generated doses. The `planned_occurrences` table diverges from `scheduled_doses` during regeneration. This must be resolved before `planned_occurrences` is used as a primary read source.

**~~OA-4: Multi-client concurrent writes~~ — CLOSED 2026-03-21**
Decision: **last-write-wins for mutable status fields, strictly additive history, idempotency scoped to single client intent stream.** `scheduled_doses.status` and `active_protocols.status` reflect whichever client's write reached Postgres last — no conditional precondition checks exist and none may be added without an explicit architecture decision. `dose_records`, `execution_events`, and `sync_operations` are additive: each client produces its own rows regardless of other clients' concurrent writes. Clients must not assume exclusive ownership of any entity. Full specification: §9.

**OA-5: Snooze replacement dose and protocol pause**
If a replacement snooze dose exists in `pending` state and the protocol is then paused, the replacement dose is in a paused-protocol context. What happens if the protocol is resumed after the replacement's scheduled time has already passed? Must it be regenerated, cleaned up, or left as overdue? Undefined — product must decide.

**OA-6: Progress aggregation consistency across clients**
Progress (adherence %, streak, per-protocol breakdown) is computed client-side from local store data. An iOS client with a different local state (pending outbox, stale pull) will compute different progress than the web client. Whether cross-client progress consistency is required before iOS MVP must be decided.

**OA-7: clientOperationId collision across clients**
Two clients issuing the same lifecycle command within the same second with matching clocks would produce the same `clientOperationId`. The `sync_operations` upsert would merge them into one record. Whether a device-specific prefix should be incorporated must be decided before multi-device support is enabled.

**OA-8: DB trigger for profiles row — unverified**
Code comments assert a Supabase DB trigger creates the `profiles` row on auth signup. This trigger has not been independently verified. It must be confirmed against the Supabase project's actual trigger definitions and tested with an iOS SDK sign-up before iOS goes live.

---

## 8. Implementation Reference

The following web implementation files are the current reference for this contract. They are not the contract — this document is. Discrepancies between this document and those files are bugs in the implementation, not in this document.

| Area | Current Web Implementation |
|---|---|
| Domain logic, dose generation, lifecycle actions | `src/lib/store/store.ts` |
| Cloud sync command paths | `src/lib/supabase/realtimeSync.ts` |
| Outbox/retry | `src/lib/supabase/syncOutbox.ts` |
| Domain types | `src/types/index.ts` |

Changes to any of the above files must be checked for conformance with this contract. If a code change introduces behavior not described here, this document must be updated in the same commit.

---

## 9. Multi-Client Concurrent Write Policy

**Policy name:** last-write-wins for mutable status fields, strictly additive history, idempotency scoped to single client intent stream.

**Scope:** Applies to any scenario where two or more clients (e.g., web + iOS) have the same authenticated user session and concurrently issue commands that target the same rows.

### 9.1 Per-Table Behavior

| Table | Write type | Concurrent write outcome |
|---|---|---|
| `scheduled_doses` | Mutable `status` field | Last writer's value wins. No version check. No rejection. Both writes succeed at DB level; last one persists in `status`. |
| `dose_records` | Additive | Each client inserts its own record with its own ID. Two clients performing the same dose action produce two distinct `dose_records` rows. Neither row is suppressed. |
| `execution_events` | Additive | Each client inserts its own event with its own `idempotency_key`. Two clients produce two distinct rows. `idempotency_key` uniqueness scopes to the single client's intent — not across clients. |
| `sync_operations` | Upsert ledger | Each client upserts its own `(user_id, idempotency_key)` pair. Two clients with distinct `clientOperationId` values produce two distinct ledger rows. No cross-client merge. |
| `active_protocols` | Mutable `status` field | Last writer's value wins. Same as `scheduled_doses`. No conditional writes. |
| `dose_records` (snooze) | Additive (replacement row) | Each client that snoozed the same dose produces its own replacement row. The original dose's status reflects the last writer. Multiple snooze replacement rows may coexist for the same origin dose. |
| `planned_occurrences` | Additive write-through | Concurrent activation writes from two clients produce duplicate or conflicting rows resolved by `ON CONFLICT (user_id, occurrence_key, revision)` — do update. Last writer persists. |

### 9.2 Client Obligations

All clients (web and iOS) operating under this policy must comply with the following rules:

1. **No exclusive ownership assumption.** A client must not assume it is the only writer for any entity. Any entity's DB state may differ from local state at any time.

2. **Optimistic local state is stale on any concurrent write.** After a successful command, local state reflects the client's intent. The DB state may reflect a different client's subsequent write. Clients must not treat local state as a ground truth for DB values.

3. **History is strictly additive — never correct or overwrite.** A client must not delete, modify, or suppress `dose_records`, `execution_events`, or `sync_operations` rows created by another client. Audit history is append-only.

4. **`clientOperationId` is client-scoped, not entity-scoped.** Two clients issuing the "same" action on the same entity will produce different `clientOperationId` values (unless clocks and IDs align by coincidence — see OA-7). This is correct: each client's intent is distinct, even if the action is logically the same.

5. **No contradictory commands after observing another client's write.** If a client pulls the current DB state and observes that another client has already completed a dose, the client must not issue a conflicting action (e.g., re-taking or re-snoozing) without explicit user intent on that client. Clients must surface current DB state before allowing re-action on already-handled doses.

6. **Reconcile on pull, not on push.** When a client pulls updated state from Supabase (realtime subscription or explicit fetch), it must reconcile its local store with the received state. It must not re-push its local version over the received DB state without new user intent.

7. **Do not use `dose_records` row count for per-client adherence in multi-client scenarios.** In a multi-client environment, a single dose action may produce two `dose_records` rows (one per client). Adherence computation must deduplicate by `scheduled_dose_id` or use `scheduled_doses.status` as the canonical truth, not the count of `dose_records` rows.

### 9.3 Concurrent Warning Conditions

The following concurrent write scenarios are not bugs but require monitoring. Each must be logged.

**CW-1: Same dose taken on two clients before sync**
Both clients issue `take` on the same `scheduled_dose_id`. Result: two `dose_records` rows, `scheduled_doses.status = 'taken'` (last writer wins). Both history rows persist. Log `[concurrent-take-multi-record]` on pull reconciliation if two records for the same dose ID are detected.

**CW-2: Take on one client, skip on another**
One client takes, another skips, same dose, before either pulls the other's write. Result: `scheduled_doses.status` reflects the last write. Both a `dose_records` (taken) and a `dose_records` (skipped) row exist. This is a genuine data conflict. Log `[concurrent-take-skip-conflict]`. Product must define display behavior for this case (unresolved at contract level).

**CW-3: Snooze on one client, take/skip on another**
One client snoozed (creating a replacement dose), another took or skipped the original before sync. Result: original dose `status` reflects last writer. A replacement dose exists orphaned or active depending on timing. Log `[concurrent-snooze-action-conflict]`.

**CW-4: Pause on one client, dose action on another**
One client pauses a protocol while another takes/skips a dose on that protocol before sync. Both writes succeed. The dose action history is preserved even if the protocol is now paused. Log `[concurrent-pause-dose-action]`.

**CW-5: Protocol completion on one client while another is mid-action**
One client completes a protocol (`active → completed`) while another client takes a dose or snoozes on that protocol. Both writes succeed. The protocol status becomes `completed`; the dose history row persists regardless. Log `[concurrent-complete-dose-action]`.
