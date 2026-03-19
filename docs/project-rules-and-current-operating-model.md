# Project Rules and Current Operating Model (Current Main)

Date: 2026-03-19
Status: source-of-truth governance and execution model

## 1. Source-of-truth policy

- Current `main` is the only code source of truth.
- Branch snapshots, old worktrees, and historical reports are not source-of-truth.
- If docs conflict with code on `main`, code wins.

## 2. Branch discipline (mandatory)

## Branch naming

All new implementation branches must start with the sprint identifier and use:

- `codex/<sprint-id>-<slice-name>`

Examples:

- `codex/c4-planned-occurrences-write-through`
- `codex/c5-validation-parity-tooling`
- `codex/d3-backfill-planned-future-rows`
- `codex/d4-consistency-checker`
- `codex/b5-complete-archive-commands`

Forbidden old styles (no longer allowed):

- `codex/sprint-4x-*`
- `codex/lifecycle-*`
- any branch name without a sprint identifier immediately after `codex/`

## Slice discipline

- One slice per branch.
- One concern per commit whenever feasible.
- No mixed-concern branches.
- Do not continue implementation from a branch that contains unrelated scope.

## 3. Mandatory preflight before any implementation slice

Before coding, always verify:

1. Current branch name matches intended slice.
2. Working tree is clean.
3. No unrelated modified or untracked files are present.
4. No branch-context drift exists from prior work.

If any check fails:

- Stop immediately.
- Report the issue.
- Rebase workflow on a fresh branch from clean `main`.

## 4. Main branch usage rule

Use `main` only for:

- merge landing
- repository cleanup / branch triage / worktree cleanup
- operational runs (migration tooling, parity checks, consistency checks)
- explicitly requested exceptions

Do not implement new feature/code slices directly on `main`.

## 5. Worktree and stash governance

- Do not delete a branch or worktree until uniqueness is verified against `main`.
- If a branch/worktree has unique commits or meaningful uncommitted work, keep it and report.
- Detached worktrees must be resolved by either:
  - attaching to a branch, or
  - explicit retirement after patch-equivalence verification.
- Stash entries are historical safety artifacts; do not drop stashes unless explicitly instructed.

## 6. Operational run model (post-implementation phase)

Current phase is operational execution on landed tooling, not feature coding.

Run order:

1. Environment preflight
2. D2 execution-history backfill: dry-run, then user-scoped apply, then rerun check
3. D3 planned-future backfill: dry-run, then user-scoped apply, then rerun check
4. C5 lifecycle parity validation
5. D4 lifecycle consistency checker
6. Consolidated anomaly triage and go/no-go recommendation

Safety requirements:

- Always dry-run before apply.
- Prefer user-scoped runs before wider runs.
- Stop on severe anomalies before wider apply.
- Keep a command/output audit trail.

## 7. Environment requirements for migration tooling

Required for D2/D3/C5/D4 scripts:

- `SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

If missing, environment is not ready and runs must stop.

## 8. Documentation governance

- All technical docs in this repository must be in English.
- Update current-main source docs in the same branch as behavior/process changes.
- Mark design snapshots and incident reports as historical-only when superseded.
