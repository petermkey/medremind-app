# AGENTS

## Documentation Language Policy

- All technical documentation in this repository must be written in English.
- This includes `README`, `docs/*`, architecture notes, migration notes, runbooks, incident reports, and PR-facing technical writeups stored in the repo.
- If content is added in another language, it must be translated to English before merge.

## Agent Read-First Policy

When picking up this project, read in this order:

1. `docs/project-rules-and-current-operating-model.md`
2. `docs/system-logic.md`
3. `docs/current-status.md`
4. `docs/agent-handover.md`
5. `README.md`

Historical incident/persistence/design reports in `docs/` are point-in-time artifacts and must not override the current source-of-truth documents above.

## Branch and Workflow Policy (Mandatory)

- Current `main` is the only code source of truth.
- New implementation branches must use: `codex/<sprint-id>-<slice-name>`.
- One slice per branch; no mixed-concern branches.
- Mandatory preflight before coding:
  - verify branch correctness
  - verify clean working tree
  - verify no unrelated changed/untracked files
- If branch context drifts or unrelated files appear, stop and report.
- Use `main` directly only for merge, cleanup, and operational runs unless explicitly instructed.
