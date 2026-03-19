# Sprint 4H: Lifecycle Consistency Checker (D4)

Date: 2026-03-19
Status: tooling-only, inspection/reporting

## Goal

Provide a standalone, rerunnable consistency checker that inspects lifecycle integrity across legacy tables and additive tables without mutating production data.

This tool does not switch reads, does not switch writes, and does not apply repairs.

## Scope and Safety

- Script: `scripts/check-lifecycle-consistency.mjs`
- Mode: dry-run inspection only
- Writes: none
- Runtime coupling: none (tooling path only)
- User scope: optional `--user-id <uuid>`

## Usage

```bash
node scripts/check-lifecycle-consistency.mjs --help
node scripts/check-lifecycle-consistency.mjs
node scripts/check-lifecycle-consistency.mjs --user-id <uuid>
node scripts/check-lifecycle-consistency.mjs --sample-size 25
node scripts/check-lifecycle-consistency.mjs --fail-on-anomalies
```

## Required Environment

- `SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

## Output

The tool emits JSON with:

- table availability/error metadata
- scanned row totals
- per-check summary counters
- anomaly category list and total count
- sampled records per anomaly category

Default exit behavior is report-only (`0`) unless runtime failure occurs (`1`).
If `--fail-on-anomalies` is provided, exit code is `2` when anomalies are detected.

## Implemented Check Families

1. Handled-history consistency
- handled legacy rows missing durable `dose_records`
- handled rows missing additive `execution_events` bridge
- `dose_records` missing additive execution event
- `dose_records` action/event type mismatch

2. Duplicate additive execution history
- duplicate `execution_events` for one `legacy_dose_record_id`
- duplicate `execution_events` for one `(legacy_scheduled_dose_id, event_type)`
- duplicate `execution_events` for one `(user_id, idempotency_key)`

3. Snooze lineage anomalies
- unparseable snooze lineage note
- lineage original mismatch
- missing replacement row
- replacement target/date-time mismatch
- replacement user mismatch
- one original linked to multiple replacements
- one replacement linked to multiple originals
- snoozed row missing lineage record
- snoozed row missing/invalid `snoozed_until`
- inferable replacement missing or ambiguous

4. Fixed-duration boundary anomalies
- `scheduled_doses` beyond `active_protocols.end_date`
- `planned_occurrences` beyond `active_protocols.end_date` (when table is available)

5. Lifecycle state contradictions
- completed protocol missing `completed_at`
- active/paused protocol with unexpected `completed_at`
- paused protocol missing `paused_at`
- active protocol still carrying `paused_at`
- archived protocol with non-terminal active instance
- terminal protocol with future live doses
- completed protocol with live doses after completion timestamp

6. Bridge integrity issues
- `scheduled_doses` with missing/foreign active protocol ownership
- `dose_records` with missing/foreign scheduled dose ownership
- `planned_occurrences` legacy bridge missing/mismatched rows (when available)
- `execution_events` missing bridged rows (`active_protocols`, `scheduled_doses`, `dose_records`, `planned_occurrences`)
- `execution_events` user mismatch across linked rows
- `execution_events` protocol/item linkage mismatches across linked rows

## Notes

- `planned_occurrences` checks are conditional on table availability.
- This slice intentionally does not include backfill or repair behavior.
