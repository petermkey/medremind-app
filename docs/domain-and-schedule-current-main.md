# Domain and Schedule Logic (Current Main)

Date: 2026-03-19 (lifecycle contract reference added 2026-03-21)
Scope: protocol lifecycle, dose generation, schedule visibility, and read-model selectors on current `main`

> **Lifecycle contract:** This document describes current web implementation behavior.
> The authoritative platform-neutral behavioral specification is `docs/lifecycle-contract-v1.md`.
> Any agent working on protocol actions, dose actions, snooze semantics, persistence effects,
> progress aggregation inputs, or future iOS lifecycle work must read the lifecycle contract first.
> When this document and the lifecycle contract conflict, the lifecycle contract is correct.

## 1. Core entities and statuses

Managed primarily in `src/lib/store/store.ts`:

- `Protocol`, `ProtocolItem`, `ActiveProtocol`, `ScheduledDose`, `DoseRecord`

Protocol statuses:

- `active`, `paused`, `completed`, `abandoned`

Dose statuses:

- `pending`, `taken`, `skipped`, `snoozed`, `overdue`

## 2. Protocol creation and activation

- Fixed-duration inputs are validated as positive whole numbers.
- `durationDays` is normalized defensively in store.
- Activation computes inclusive `endDate` for fixed-duration protocols.
- Dose generation horizon is capped by inclusive `endDate` when present.

## 3. Duration update and regeneration behavior

When protocol duration changes on active instances:

1. active instance `endDate` is recomputed
2. `regenerateDoses(activeId)` runs for impacted active instances

Regeneration behavior:

- uses live protocol snapshot from current store
- removes only future pending rows for target active instance
- preserves handled rows and rows with durable history linkage
- rebuilds forward horizon while avoiding occupied retained slots

## 4. Lifecycle transitions and archive behavior

Store lifecycle actions:

- `pauseProtocol`, `resumeProtocol`, `completeProtocol`, `deleteProtocol`

Archive rule:

- `deleteProtocol` archives protocol/instances when handled history exists
- hard delete path is used only when no handled history exists

Command sync wiring (landed):

- pause/resume/complete/archive command sync paths are used from store actions

## 5. Dose action semantics

Actions:

- `takeDose(doseId, note?)`
- `skipDose(doseId, note?)`
- `snoozeDose(doseId, option)`

Semantics:

- take/skip update status and append immutable `DoseRecord`
- snooze marks original row as `snoozed`
- snooze creates replacement `pending` row at target slot
- snooze lineage metadata is stored in record note (`original`, `replacement`, `target`)

UI snooze options currently include:

- `1 hour`
- `this evening`
- `tomorrow`
- `next week`

If a target slot conflicts, UI shifts forward in 5-minute increments.

## 6. Command-based sync and additive write-through

Dose command paths:

- take/skip/snooze use idempotent client operation IDs
- each command writes to legacy bridge paths and `execution_events`

Lifecycle command paths:

- pause/resume/complete/archive use idempotent command semantics

Activation path:

- future rows are written through to `planned_occurrences` (`activation_write_through_c4`)

## 7. Visibility and read-model selector behavior

## `/app` today/schedule

- actionable queue uses lifecycle-aware selector path
- skipped and snoozed rows are not in primary actionable queue
- next-dose path uses selector-based actionable set

## Progress

- progress day and summary metrics use selector-based lifecycle-aware inputs

## Protocol detail

- `selectProtocolDetailReadModel` provides instance status, actionable future rows, handled history rows, and archive/command gating flags

## Calendar

- visible date projection uses `selectCalendarVisibleDoseDates`
- today/future dates honor active-instance and boundary/visibility rules

## History

- past-date history surface uses `selectHistoryDayRows`
- handled and lineage-relevant rows remain visible for history integrity

## 8. Known domain limitations (deferred)

- rule engine remains centralized in one large store module
- recurrence model is practical but not a full scheduling DSL
- server-side canonical scheduling engine is not yet introduced

The dose generation algorithm is now formally specified in `docs/lifecycle-contract-v1.md` §3.13.
Future clients (iOS and others) must implement that specification — they must not derive generation
behavior solely from `expandItemToDoses` in `store.ts`.
