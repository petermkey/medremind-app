# Sprint 4E D2 Execution History Backfill Tooling

Date: 2026-03-19
Branch: `codex/sprint-4e-backfill-execution-history-tooling`
Status: executable tooling (no runtime read/write path switch)

## Scope

This slice implements one-time backfill tooling for execution history only.

Included:
- canonical backfill from `dose_records` into `execution_events`
- fallback inferred backfill from handled `scheduled_doses.status` rows with no matching `dose_records` row
- dry-run mode (default)
- apply mode
- deterministic rerun-safe behavior
- anomaly reporting and summary output

Excluded:
- `planned_occurrences` backfill
- runtime command path changes
- runtime read-model switches

## Tool location

- Script: `scripts/backfill-execution-history.mjs`
- npm command: `npm run tool:backfill:execution-history`

## Required environment

- `SUPABASE_URL` (or `NEXT_PUBLIC_SUPABASE_URL`)
- `SUPABASE_SERVICE_ROLE_KEY`

The service role key is required because this is a cross-user migration operation.

## Usage

Dry-run (default):

```bash
npm run tool:backfill:execution-history
```

Explicit dry-run:

```bash
npm run tool:backfill:execution-history -- --dry-run
```

Apply run:

```bash
npm run tool:backfill:execution-history -- --apply
```

Single-user scoped run (recommended for first rollout pass):

```bash
npm run tool:backfill:execution-history -- --dry-run --user-id <uuid>
npm run tool:backfill:execution-history -- --apply --user-id <uuid>
```

## Mapping implemented

Canonical source (`dose_records`):
- `execution_events.user_id <- dose_records.user_id`
- `execution_events.legacy_dose_record_id <- dose_records.id`
- `execution_events.legacy_scheduled_dose_id <- dose_records.scheduled_dose_id`
- `execution_events.planned_occurrence_id <- planned_occurrences.id` where `legacy_scheduled_dose_id = dose_records.scheduled_dose_id` (nullable)
- `execution_events.active_protocol_id <- scheduled_doses.active_protocol_id`
- `execution_events.protocol_item_id <- scheduled_doses.protocol_item_id`
- `execution_events.event_type <- dose_records.action`
- `execution_events.event_at <- dose_records.recorded_at`
- `execution_events.effective_date <- scheduled_doses.scheduled_date`
- `execution_events.effective_time <- scheduled_doses.scheduled_time`
- `execution_events.note <- dose_records.note`
- `execution_events.source <- 'legacy_dose_record_backfill'`
- `execution_events.idempotency_key <- NULL`

Fallback inferred source (`scheduled_doses`):
- input rows: `scheduled_doses.status IN ('taken','skipped','snoozed')`
- only when no matching `dose_records` row exists for `(scheduled_dose_id, status)`
- `event_at <- scheduled_doses.created_at`
- `note <- 'inferred:missing_dose_record'`
- `source <- 'legacy_status_inference_backfill'`
- `legacy_dose_record_id <- NULL`

## Idempotency and safe rerun approach

1. Canonical dedupe: skip insert if any `execution_events.legacy_dose_record_id = dose_records.id` already exists.
2. Inferred dedupe: skip insert if an `execution_events` row already exists for `(legacy_scheduled_dose_id, event_type)`.
3. Deterministic IDs:
- canonical: UUID derived from record id (`execution-backfill-record` namespace)
- inferred: UUID derived from `scheduled_dose_id:event_type` (`execution-backfill-inferred` namespace)
4. Apply-mode self-check: script recomputes plan after writes and reports remaining `rowsPreparedAfterApply`.

## Anomaly reporting

The script outputs an `anomalies` object with count + sampled rows per anomaly key, including:
- `missing_scheduled_dose_for_record`
- `user_mismatch_record_vs_dose`
- `missing_protocol_links_for_record`
- `existing_event_type_mismatch_for_record`
- `duplicate_execution_event_for_legacy_record`
- `duplicate_planned_occurrence_bridge`
- `missing_protocol_links_for_inferred_status`
- `user_mismatch_*_vs_planned_occurrence`

## Verification output

The script prints JSON including:
- mode and user scope
- source totals loaded
- rows prepared by category (`canonical`, `inferred`)
- write counts (apply mode)
- rerun validation summary (apply mode)
- anomaly counts and samples

