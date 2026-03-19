# Sprint 4G D3 Planned Future Backfill Tooling

Date: 2026-03-19
Status: landed tooling on `main` (operational execution pending in live environments)

## Scope

Included:

- backfill of future legacy schedule rows into `planned_occurrences`
- dry-run default mode
- apply mode
- user-scoped runs (`--user-id`)
- deterministic IDs and rerun-safe duplicate controls
- anomaly reporting and post-apply convergence check

Excluded:

- execution-events backfill
- runtime read/write path switches
- schema redesign

## Tool location

- script: `scripts/backfill-planned-future-occurrences.mjs`
- command: `npm run tool:backfill:planned-future`

## Required environment

- `SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

## Status mapping behavior

Default status mapping: `planned`.

Forced `cancelled` when:

1. occurrence is beyond fixed-duration boundary (`scheduled_date > end_date`)
2. occurrence is future-dated for terminal instance states (`completed|abandoned`)
3. future row has contradictory handled status (`taken|skipped|snoozed`)

## Run model

1. dry-run first
2. user-scoped dry-run
3. user-scoped apply
4. rerun same scope and confirm convergence
5. only then consider wider apply

## Operational caveats

- stop on severe anomaly patterns before wider apply
- keep command/output audit trail
