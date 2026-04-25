# Sprint 4H D4 Lifecycle Consistency Checker

> **Historical document:** This is a point-in-time snapshot for audit and context only.
> It does not override the current source-of-truth documents listed in `docs/system-logic.md`.

Date: 2026-03-19
Status: landed tooling on `main` (read-only)

## Goal

Provide a rerunnable integrity checker across legacy and additive lifecycle data without mutating data.

## Tool location

- script: `scripts/check-lifecycle-consistency.mjs`
- command: `node scripts/check-lifecycle-consistency.mjs`

Note: there is currently no npm alias in `package.json` for this script.

## Required environment

- `SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

## Usage

- `node scripts/check-lifecycle-consistency.mjs`
- `node scripts/check-lifecycle-consistency.mjs --user-id <uuid>`
- `node scripts/check-lifecycle-consistency.mjs --sample-size <n>`
- `node scripts/check-lifecycle-consistency.mjs --fail-on-anomalies`

## Check families

- handled-history consistency
- duplicate additive execution history
- snooze lineage anomalies
- fixed-duration boundary anomalies
- lifecycle state contradictions
- bridge integrity issues

## Exit behavior

- default: report-only success exit on completed run
- with `--fail-on-anomalies`: exit code `2` when anomalies are found
