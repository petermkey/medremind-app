# Sprint 4G D3 Planned Future Backfill Tooling

Date: 2026-03-19
Branch: `codex/d3-backfill-planned-future-rows`
Status: executable tooling (tooling-only, no runtime path switch)

## Scope

This slice implements one-time backfill tooling for additive planned future rows only.

Included:
- backfill from legacy future-plan rows (`scheduled_doses` with `scheduled_date >= current_date`) into `planned_occurrences`
- dry-run mode (default)
- apply mode
- deterministic rerun-safe behavior
- anomaly reporting and summary output
- optional user-scoped runs (`--user-id`)

Excluded:
- execution history backfill (`execution_events`)
- runtime read/write command-path changes
- schema redesign
- read-model migration

## Tool location

- Script: `scripts/backfill-planned-future-occurrences.mjs`
- npm command: `npm run tool:backfill:planned-future`

## Required environment

- `SUPABASE_URL` (or `NEXT_PUBLIC_SUPABASE_URL`)
- `SUPABASE_SERVICE_ROLE_KEY`

## Usage

Default dry-run:

```bash
npm run tool:backfill:planned-future
```

Explicit dry-run:

```bash
npm run tool:backfill:planned-future -- --dry-run
```

Apply:

```bash
npm run tool:backfill:planned-future -- --apply
```

Single-user scoped run:

```bash
npm run tool:backfill:planned-future -- --dry-run --user-id <uuid>
npm run tool:backfill:planned-future -- --apply --user-id <uuid>
```

## Legacy source and mapping

Legacy source of planned future rows:
- `scheduled_doses` filtered by `scheduled_date >= current_date` (UTC date from tool runtime)
- joined through `active_protocols` (`scheduled_doses.active_protocol_id = active_protocols.id`)
- resolved protocol bridge via `active_protocols.protocol_id -> protocols.id`

Additive mapping:
- `planned_occurrences.user_id <- scheduled_doses.user_id`
- `planned_occurrences.active_protocol_id <- scheduled_doses.active_protocol_id`
- `planned_occurrences.protocol_id <- active_protocols.protocol_id`
- `planned_occurrences.protocol_item_id <- scheduled_doses.protocol_item_id`
- `planned_occurrences.occurrence_date <- scheduled_doses.scheduled_date`
- `planned_occurrences.occurrence_time <- scheduled_doses.scheduled_time`
- `planned_occurrences.occurrence_key <- 'legacy-dose:' || scheduled_doses.id`
- `planned_occurrences.revision <- 1`
- `planned_occurrences.status <- planned|cancelled` (rule-driven)
- `planned_occurrences.source_generation <- 'legacy_backfill_d3_future_rows'`
- `planned_occurrences.legacy_scheduled_dose_id <- scheduled_doses.id`
- `planned_occurrences.created_at <- scheduled_doses.created_at`
- `planned_occurrences.updated_at <- backfill write time`

## Status derivation and boundaries

Default mapped status: `planned`.

Force `cancelled` when either condition applies:
1. Fixed-duration boundary overflow:
- `active_protocols.end_date is not null` and `scheduled_doses.scheduled_date > active_protocols.end_date`
2. Terminal lifecycle future contradiction:
- `active_protocols.status in ('completed','abandoned')` and `scheduled_doses.scheduled_date > current_date`

Additional contradiction handling:
- future `scheduled_doses.status in ('snoozed','taken','skipped')` are surfaced as anomalies and mapped as `cancelled`.

## Rerun safety and duplicate control

1. Bridge dedupe:
- insert only when no existing `planned_occurrences` row already links `legacy_scheduled_dose_id`.
2. Deterministic IDs:
- inserted row `id` is derived from `scheduled_doses.id` via stable namespace hashing.
3. Duplicate bridge anomaly:
- if multiple `planned_occurrences` rows already reference one legacy dose id, report as anomaly and skip write.
4. Apply-mode rerun check:
- after writes, the tool rebuilds the plan and reports `rowsPreparedAfterApply`.

## Anomaly categories

- `missing_legacy_bridge_active_protocol`
- `missing_legacy_bridge_protocol`
- `user_mismatch_dose_vs_active_protocol`
- `boundary_violation_fixed_duration`
- `terminal_lifecycle_future_row`
- `lifecycle_status_contradiction`
- `ambiguous_legacy_to_additive_mapping`
- `unexpected_future_handled_status`
- `unexpected_future_snoozed_status`
- `duplicate_planned_occurrence_bridge`
- `existing_bridge_mapping_mismatch`

## Output

The script prints JSON with:
- mode and user scope
- loaded totals
- prepared insert counts
- write counts (apply mode)
- rerun validation (apply mode)
- anomaly counts and samples

