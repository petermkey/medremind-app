# Sprint 4E D2 Execution History Backfill Tooling

> **Historical document:** This is a point-in-time snapshot for audit and context only.
> It does not override the current source-of-truth documents listed in `docs/system-logic.md`.

Date: 2026-03-19
Status: landed tooling on `main` (operational execution pending in live environments)

## Scope

Included:

- backfill from `dose_records` into `execution_events`
- inferred fallback for handled `scheduled_doses` rows lacking matching `dose_records`
- dry-run default mode
- apply mode
- user-scoped runs (`--user-id`)
- deterministic rerun-safe planning and post-apply convergence reporting

Excluded:

- runtime read-path switching
- schema redesign
- non-tooling runtime behavior changes

## Tool location

- script: `scripts/backfill-execution-history.mjs`
- command: `npm run tool:backfill:execution-history`

## Required environment

- `SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

## Run model

1. dry-run first
2. user-scoped dry-run
3. user-scoped apply
4. rerun same scope to confirm convergence (`rowsPreparedAfterApply` expectation)
5. only then consider wider apply

## Operational caveats

- stop wider apply if severe anomalies appear
- keep command/output audit trail
- do not treat this as runtime code migration; this is data operation only
