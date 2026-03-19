# Sprint 2C D1 Backfill Planning (Design Only)

Date: 2026-03-19
Branch: `codex/lifecycle-backfill-history-design`
Status: planning-ready

## Scope and boundaries

This slice defines backfill design only for additive lifecycle tables:

1. Legacy scheduled rows (`scheduled_doses`) -> `planned_occurrences`
2. Legacy history rows (`dose_records`) and equivalent handled facts -> `execution_events`

Non-goals for this slice:

- No runtime code changes
- No live write-path changes
- No behavior switch of read models
- No new schema changes

## Baseline assumptions from current main

1. Additive tables exist from `supabase/002_lifecycle_schema_readiness.sql`.
2. Runtime already writes take command events into `execution_events` (`source = take_command`) with idempotency.
3. Runtime snooze semantics:
- original dose row is set to `status = snoozed`
- replacement pending row is created
- lineage is encoded in `dose_records.note` format:
  `snooze-replacement|original=<doseId>|replacement=<doseId>|target=<yyyy-MM-ddTHH:mm>`
4. Fixed-duration inclusive end-date semantics are already the runtime rule.

## Legacy-to-target mapping

## A) `scheduled_doses` -> `planned_occurrences`

- `planned_occurrences.user_id` <- `scheduled_doses.user_id`
- `planned_occurrences.active_protocol_id` <- `scheduled_doses.active_protocol_id`
- `planned_occurrences.protocol_id` <- `active_protocols.protocol_id` (join by `scheduled_doses.active_protocol_id = active_protocols.id`)
- `planned_occurrences.protocol_item_id` <- `scheduled_doses.protocol_item_id`
- `planned_occurrences.occurrence_date` <- `scheduled_doses.scheduled_date`
- `planned_occurrences.occurrence_time` <- `scheduled_doses.scheduled_time`
- `planned_occurrences.legacy_scheduled_dose_id` <- `scheduled_doses.id`
- `planned_occurrences.source_generation` <- `'legacy_backfill_d1'`
- `planned_occurrences.created_at` <- `scheduled_doses.created_at`
- `planned_occurrences.updated_at` <- `now()` at backfill write time

Derived fields:

- `occurrence_key`
- `revision`
- `status`
- `supersedes_occurrence_id`
- `superseded_by_occurrence_id`
- `superseded_at`

Design for derived values:

1. Default (non-lineage rows)
- `occurrence_key = 'legacy-dose:' || scheduled_doses.id`
- `revision = 1`
- `status = planned`
- supersession columns = `NULL`

2. Snooze lineage rows (see lineage section)
- all rows in the same snooze chain share one root-based `occurrence_key`
- revisions increment along chain order
- predecessor rows are `status = superseded`
- latest row remains `status = planned` unless terminal-state/fixed-duration cancellation rules apply

## B) `dose_records` -> `execution_events`

- `execution_events.user_id` <- `dose_records.user_id`
- `execution_events.legacy_dose_record_id` <- `dose_records.id`
- `execution_events.legacy_scheduled_dose_id` <- `dose_records.scheduled_dose_id`
- `execution_events.planned_occurrence_id` <- lookup by `planned_occurrences.legacy_scheduled_dose_id = dose_records.scheduled_dose_id`
- `execution_events.active_protocol_id` <- `scheduled_doses.active_protocol_id`
- `execution_events.protocol_item_id` <- `scheduled_doses.protocol_item_id`
- `execution_events.event_type` <- `dose_records.action` map (`taken|skipped|snoozed`)
- `execution_events.event_at` <- `dose_records.recorded_at`
- `execution_events.effective_date` <- `scheduled_doses.scheduled_date`
- `execution_events.effective_time` <- `scheduled_doses.scheduled_time`
- `execution_events.note` <- `dose_records.note`
- `execution_events.source` <- `'legacy_dose_record_backfill'`
- `execution_events.idempotency_key` <- `NULL` (historical import)

Dedup guard:

- Insert only when no existing `execution_events` row already references `legacy_dose_record_id`.
- This avoids duplicate take events already dual-written by runtime command path.

## C) Equivalent handled facts -> `execution_events` (fallback)

For legacy anomalies where a handled status exists without a `dose_records` row:

- Source rows: `scheduled_doses.status in ('taken','skipped','snoozed')`
- Only insert if no execution event already exists for same `legacy_scheduled_dose_id` and same inferred event type.
- Mapping:
  - `event_type` from status (`taken`, `skipped`, `snoozed`)
  - `event_at` fallback: `scheduled_doses.created_at`
  - `source = 'legacy_status_inference_backfill'`
  - `note = 'inferred:missing_dose_record'`
  - `legacy_dose_record_id = NULL`

This keeps historical parity for handled facts while isolating inferred events from record-backed events.

## Backfill strategy details

## 1. Historical handled facts

Primary truth:

- `dose_records` rows become canonical event backfill inputs.
- Existing runtime-inserted events are preserved and deduped by `legacy_dose_record_id` presence check.

Fallback truth:

- status-inference is used only for handled rows missing records.

## 2. Future planned rows

- All `scheduled_doses` rows are backfilled into `planned_occurrences` for continuity.
- For today/future rows tied to `active_protocols.status in ('active','paused')`, default `planned_occurrences.status = planned`.

Terminal-instance adjustment:

- If `active_protocols.status in ('completed','abandoned')` and `occurrence_date > current_date`, set `planned_occurrences.status = cancelled`.
- Reason: these are non-actionable legacy leftovers and should not appear as active plan slots in future read models.

## 3. Replacement-row snooze lineage

Lineage extraction:

1. Parse snooze notes from `dose_records.action = 'snoozed'` where note matches:
- `snooze-replacement|original=<id>|replacement=<id>|target=<...>`
2. Build directed edges `original_dose_id -> replacement_dose_id` with `edge_at = recorded_at`.
3. Derive chain roots and ordered depth (recursive traversal).

Lineage projection into `planned_occurrences`:

- Chain `occurrence_key = 'legacy-snooze-root:' || <root_dose_id>`
- Root revision starts at `1`, each successor increments by `1`
- Set predecessor row:
  - `status = superseded`
  - `superseded_by_occurrence_id = successor_occurrence_id`
  - `superseded_at = edge_at`
- Set successor row:
  - `supersedes_occurrence_id = predecessor_occurrence_id`

Anomaly handling:

- Missing predecessor/successor dose rows, forks, or cycles are excluded from lineage updates and logged to anomaly report.
- Excluded rows remain as standalone `legacy-dose:<dose_id>` planned rows to keep backfill complete.

## 4. Fixed-duration boundaries

Boundary rule:

- For rows where `active_protocols.end_date` is not null and `occurrence_date > end_date`, force `planned_occurrences.status = cancelled`.

Rationale:

- Preserves inclusive-end boundary invariant while preventing out-of-range rows from becoming actionable in target model.

## 5. Archived or abandoned instance states

Definitions used:

- Instance lifecycle source: `active_protocols.status`
- Protocol archival source: `protocols.is_archived`

Backfill treatment:

1. `active` / `paused` instances:
- keep plan rows as `planned` (except superseded rows and fixed-duration overflow rows)

2. `completed` / `abandoned` instances:
- past rows retained as planned/superseded historical plan history
- today/future rows converted to `cancelled`

3. `protocols.is_archived = true` without terminal instance:
- no forced cancellation solely due to protocol archival flag
- archival state is carried through instance and timeline views later

## Proposed backfill order (deterministic and resumable)

1. Preflight profiling (read-only)
- count candidate users/rows
- detect snooze-note parseability
- detect existing `execution_events` footprint

2. Stage A: Seed `planned_occurrences` baseline
- insert one row per `scheduled_doses.id` with standalone keys (`legacy-dose:<id>`) and `revision = 1`
- skip rows already linked through `legacy_scheduled_dose_id`

3. Stage B: Apply snooze lineage transforms
- compute chains from snooze notes
- update occurrence keys/revisions/supersession pointers/status for valid chains
- emit anomaly report for invalid chains

4. Stage C: Apply lifecycle boundary adjustments
- terminal instance future rows -> `cancelled`
- end-date overflow rows -> `cancelled`

5. Stage D: Backfill `execution_events` from `dose_records`
- insert canonical events with planned-occurrence linkage
- skip where `legacy_dose_record_id` already present in `execution_events`

6. Stage E: Backfill inferred handled events
- only for handled statuses lacking record-backed events
- mark source as inference

7. Stage F: Post-backfill verification + reconciliation report
- run verification queries
- produce anomaly and parity summary

## Verification rules after backfill

## Structural checks

1. One-to-one bridge for planned rows
- each `scheduled_doses.id` has exactly one `planned_occurrences.legacy_scheduled_dose_id`

2. Current-row uniqueness
- no `occurrence_key` has more than one row where `superseded_by_occurrence_id is null`

3. Revision uniqueness
- no duplicate `(user_id, occurrence_key, revision)`

4. Supersession consistency
- if `A.superseded_by_occurrence_id = B.id`, then `B.supersedes_occurrence_id = A.id`

## Parity checks

1. Dose-record parity
- for each user and action (`taken`, `skipped`, `snoozed`):
  count(`dose_records`) == count(`execution_events` with matching `legacy_dose_record_id`)

2. Handled fact coverage
- any `scheduled_doses.status in ('taken','skipped','snoozed')` has at least one matching `execution_events` row by `legacy_scheduled_dose_id` and type

3. Planned coverage
- count(`planned_occurrences`) >= count(`scheduled_doses`) (equal in no-anomaly case)

## Lifecycle and boundary checks

1. Terminal future rows
- no `planned_occurrences.status = planned` where linked instance is `completed|abandoned` and `occurrence_date > current_date`

2. Fixed-duration overflow
- no `planned_occurrences.status = planned` where linked instance `end_date` is not null and `occurrence_date > end_date`

3. Snooze chain monotonicity
- for each lineage key, revisions are contiguous starting at 1 and chain has no cycles

## Recommended reconciliation artifacts

Produce and store with run metadata:

1. `backfill_summary`
- rows inserted/updated/skipped per stage

2. `lineage_anomalies`
- malformed snooze note, missing node, fork, cycle, cross-user mismatch

3. `parity_exceptions`
- status/event mismatches requiring manual review

## Rollback and rerun safety

Idempotency strategy:

- `planned_occurrences`: guarded by `legacy_scheduled_dose_id` uniqueness and update-in-place lineage transforms
- `execution_events`: guarded by `legacy_dose_record_id` existence checks and inferred-event existence checks

Rerun behavior:

- rerunning stages should be no-op for already migrated rows
- anomaly rows remain reportable until source data is repaired

## Out-of-scope for D1

- Runtime read switches to additive model
- Runtime dual-write expansion for skip/snooze command events
- Server-side backfill job implementation code
- Any removal/deprecation of legacy tables
