# Sprint 4F C5 Lifecycle Validation and Parity Tooling

> **Historical document:** This is a point-in-time snapshot for audit and context only.
> It does not override the current source-of-truth documents listed in `docs/system-logic.md`.

Date: 2026-03-19
Status: landed read-only validation tooling on `main`

## Scope

Included:

- read-only parity validation across legacy lifecycle bridges and additive `execution_events`
- optional user scope
- anomaly sampling and summary counts
- strict non-zero exit option (`--strict`)

Excluded:

- writes or repairs
- runtime code/path changes

## Tool location

- script: `scripts/validate-lifecycle-parity.mjs`
- command: `npm run tool:validate:lifecycle-parity`

## Required environment

- `SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

## Operational use

Recommended order:

1. run scoped validation first
2. review missing bridges, duplicates, and mismatches
3. run broader validation only when scoped results are acceptable
4. use `--strict` for gate-style runs when desired

## Safety and rerun behavior

- always read-only
- safe to rerun repeatedly
- suitable for post-backfill parity confirmation
