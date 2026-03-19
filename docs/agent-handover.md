# Agent Handover and Onboarding

Date: 2026-03-19
Audience: new engineering/debugging/operations agents

## 1. Mandatory read-first order

1. `docs/project-rules-and-current-operating-model.md`
2. `docs/system-logic.md`
3. `docs/current-status.md`
4. `docs/current-status-and-next-phase.md`
5. `docs/architecture-current-main.md`
6. `docs/auth-and-persistence-current-main.md`
7. `docs/domain-and-schedule-current-main.md`
8. `docs/agent-handoff-current-main.md`
9. `README.md`

Historical incident/release/design docs in `docs/` are timeline artifacts only.

## 2. Mandatory preflight before starting work

1. Verify branch name is correct for intended slice.
2. Verify working tree is clean.
3. Verify no unrelated tracked/untracked files are present.
4. Verify no branch-context drift from unrelated prior changes.

If any check fails: stop and report before editing.

## 3. Branch and execution discipline

- Use `codex/<sprint-id>-<slice-name>` for new implementation slices.
- One slice per branch.
- Do not continue coding from `main` unless task is merge/cleanup/operational run.
- If branch is wrong for the slice, stop and re-branch from clean `main`.

## 4. Operational phase orientation

Current phase is live-run validation, not broad feature coding.
Run D2 -> D3 -> C5 -> D4 in safe order with dry-run first and user scope first.

## 5. Critical regression checklist (when runtime code changes are made)

1. `npm run build`
2. `npm run test:e2e` (public smoke always; authenticated smoke when credentials exist)
3. Auth boundary sanity
4. Protocol activate/update/regenerate sanity
5. Dose action sanity (take/skip/snooze)
6. Sign-out guard sanity (in-flight + outbox)

## 6. Worktree/stash hygiene rules

- Never delete worktrees/branches before uniqueness verification against `main`.
- Preserve possible unique work; report instead of deleting on uncertainty.
- Do not drop stashes unless explicitly instructed.

## 7. Documentation maintenance rule

Any behavior/process change must update current-main source docs in the same branch.
