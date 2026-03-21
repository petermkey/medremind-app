# MedRemind System Logic (Current)

Date: 2026-03-21
Status: top-level source-of-truth index for current `main`

## 1. Source-of-truth map

Use this order for current behavior and process truth:

1. `docs/project-rules-and-current-operating-model.md`
2. `docs/agent-handoff-current-main.md` — read this FIRST for working-tree state awareness
3. `docs/future-agent-guide.md` — feature map, risk boundaries, persistence model
4. `docs/architecture-current-main.md`
5. `docs/auth-and-persistence-current-main.md`
6. `docs/domain-and-schedule-current-main.md`
7. `docs/current-status.md`
8. `docs/current-status-and-next-phase.md`
9. `README.md`

If any statement conflicts with code, code on current `main` wins.

## 2. Core runtime model

- Local-first domain state: `src/lib/store/store.ts`.
- Cloud sync and command paths: `src/lib/supabase/realtimeSync.ts`.
- Retry/outbox: `src/lib/supabase/syncOutbox.ts`.
- Auth routing: `src/proxy.ts` + `src/app/app/layout.tsx`.
- Additive migration tables are active as write targets while legacy tables remain live.

## 3. Critical invariants

1. Auth bootstrap must not hang in an indefinite spinner.
2. Signup with no immediate session must not force onboarding entry.
3. Fixed-duration protocols use inclusive end-date boundaries.
4. Duration updates reconcile future planned doses immediately.
5. Snooze creates replacement-row lineage (original row remains traceable).
6. Command-path sync for take/skip/snooze and pause/resume/complete/archive remains idempotent.
7. Sign-out guard must protect pending realtime sync and outbox work.

## 4. Migration posture on current main

- Core implementation slices A1..A5, B1..B5, C1..C5, D1, D2, and D4 are landed.
- D3 tooling is landed; live environment execution is operational work.
- Current priority is operational validation and anomaly triage, not broad new feature work.

## 5. Historical docs policy

Historical incident/release/design snapshots in `docs/` are timeline artifacts.
They do not override current-main source documents listed above.
