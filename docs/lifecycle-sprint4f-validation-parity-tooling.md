# Sprint 4F C5 Lifecycle Validation and Parity Tooling

Date: 2026-03-19
Branch: `codex/sprint-4f-validation-parity-tooling`
Status: read-only parity validation tooling

## Scope

This slice is validation/reporting only.

Included:
- read-only parity validator for legacy lifecycle bridges versus additive `execution_events`
- dry-run inspection mode (default)
- optional user-scoped validation
- summary counts and anomaly sampling
- strict exit option for CI/manual gates

Excluded:
- runtime behavior changes
- command-path changes
- schema changes
- read-model migration
- planned-occurrence write-through implementation

## Tool location

- Script: `scripts/validate-lifecycle-parity.mjs`
- npm command: `npm run tool:validate:lifecycle-parity`

## Required environment

- `SUPABASE_URL` (or `NEXT_PUBLIC_SUPABASE_URL`)
- `SUPABASE_SERVICE_ROLE_KEY`

## Usage

Default dry-run:

```bash
npm run tool:validate:lifecycle-parity
```

Explicit dry-run:

```bash
npm run tool:validate:lifecycle-parity -- --dry-run
```

User-scoped dry-run:

```bash
npm run tool:validate:lifecycle-parity -- --dry-run --user-id <uuid>
```

Smaller anomaly samples:

```bash
npm run tool:validate:lifecycle-parity -- --sample-size 5
```

Strict gate mode (non-zero exit when parity misses/anomalies exist):

```bash
npm run tool:validate:lifecycle-parity -- --strict
```

## Parity checks implemented

1. Legacy handled `dose_records` parity:
- count handled records (`taken`, `skipped`, `snoozed`)
- count represented rows via `execution_events.legacy_dose_record_id`
- report missing and duplicate bridge representation

2. Legacy handled `scheduled_doses.status` parity:
- count handled statuses (`taken`, `skipped`, `snoozed`)
- count represented rows via `(legacy_scheduled_dose_id, event_type)`
- report missing and duplicate representation

3. Bridge integrity checks:
- execution event points to missing `dose_records` row
- execution event points to missing `scheduled_doses` row
- user mismatches across event/record/dose bridge links
- action/type mismatches (`dose_records.action` vs `execution_events.event_type`)
- legacy scheduled-dose mismatches between event and bridged record
- active protocol / protocol item bridge mismatches vs bridged scheduled dose

4. Snooze consistency checks:
- snoozed dose rows missing/invalid `snoozed_until`
- missing replacement row at expected `snoozed_until` slot
- replacement row exists but is not `pending`

5. Source-distribution checks:
- command-path additive sources (`take_command`, `skip_command`, `snooze_command`)
- D2 backfill sources (`legacy_dose_record_backfill`, `legacy_status_inference_backfill`)
- other/unclassified source buckets

6. Idempotency duplicate signal:
- duplicate `(user_id, idempotency_key)` occurrences in `execution_events`

## Anomaly categories

- `missing_execution_event_for_dose_record`
- `duplicate_execution_events_for_dose_record`
- `missing_execution_event_for_handled_scheduled_dose`
- `duplicate_execution_events_for_scheduled_dose_type`
- `event_bridge_missing_dose_record`
- `event_bridge_missing_scheduled_dose`
- `event_record_user_mismatch`
- `event_record_action_mismatch`
- `event_record_scheduled_dose_mismatch`
- `event_dose_user_mismatch`
- `event_dose_active_protocol_mismatch`
- `event_dose_protocol_item_mismatch`
- `duplicate_idempotency_key`
- `snooze_row_missing_or_invalid_snoozed_until`
- `missing_snooze_replacement_row`
- `snooze_replacement_not_pending`

## Output shape

The script prints JSON with:
- mode, user scope, started/finished timestamps
- source totals loaded
- parity counts (handled totals, represented totals, missing totals)
- source-summary buckets (command/backfill/other)
- anomaly totals and sampled anomalies

## Safety and rerun behavior

- This tooling is read-only and performs no writes.
- It is safe to rerun repeatedly.
- In default mode it exits successfully after reporting.
- With `--strict`, it exits non-zero when parity misses or anomalies are detected.
