# Agent Handoff (Current Main)

Date: 2026-03-19
Audience: agents continuing work from current `main`

## 1. Source-of-truth scope

- Code source of truth: `main`.
- Process/governance source: `docs/project-rules-and-current-operating-model.md`.
- Behavior source: architecture/auth/domain/current-status docs.
- Historical snapshots in `docs/` are context only.

## 2. Current product/runtime shape

- Protocol-driven medication/adherence tracking.
- Local-first store with cloud sync and outbox retry.
- Command-based lifecycle/dose sync with additive write-through coverage.
- Selector-based lifecycle-aware read paths on key screens.

## 3. Most important code surfaces

- Domain/store: `src/lib/store/store.ts`
- Sync + commands: `src/lib/supabase/realtimeSync.ts`
- Outbox: `src/lib/supabase/syncOutbox.ts`
- Auth/layout/proxy: `src/lib/supabase/auth.ts`, `src/app/app/layout.tsx`, `src/proxy.ts`
- Cloud pull/import/backup: `src/lib/supabase/cloudStore.ts`, `src/lib/supabase/importStore.ts`

## 4. Landed migration/tooling summary

Already landed on `main`:

- A1..A5, B1..B5, C1..C5, D1, D2, D4
- D3 tooling implementation and command wiring

Operationally pending:

- Live-run D2/D3 apply flow with scoped validation
- C5 parity run and D4 consistency run on real data
- Consolidated anomaly triage for rollout/decommission readiness

## 5. Mandatory execution model

1. Start from clean `main`.
2. Create one correctly named slice branch when coding.
3. Keep one concern per branch.
4. Stop/report on drift or unrelated file contamination.
5. Use `main` only for merge/cleanup/operational run tasks.

## 6. Operational run prerequisites

Required environment for D2/D3/C5/D4 scripts:

- `SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

If missing, do not run tooling; report environment not ready.
