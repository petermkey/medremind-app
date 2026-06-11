# Current Status and Next Phase (Current Main)

Date: 2026-06-12
Source: current `main` with Phase 5 complete, V2 sync integrity fixes in progress

## 1. Current phase summary

Lifecycle migration complete. Phase 5 realtimeSync/store monolith split merged (PR #40). V2 sync
integrity fixes shipping: legacy occurrence keys normalized, unlinked events linked, offline-take
boot race fixed, ID-derivation helpers consolidated. Food pipeline revival wave 1 merged (PRs #45, #47);
continuation per `docs/superpowers/plans/2026-06-12-food-pipeline-revival.md`. Sync tails per
`docs/superpowers/plans/2026-06-12-sync-tail-fixes.md`.

## 2. What is complete (on main)

**Lifecycle migration:**
- Additive schema readiness and runtime-safe coexistence with legacy tables (V1 tables dropped in PR #39).
- Command-based write paths for dose and lifecycle transitions.
- Execution write-through for take/skip/snooze.
- Planned future write-through at activation time.
- Lifecycle-aware selector/read-model migration for all app surfaces.

**Phase 5 — monolith split (PR #40, merged):**
- `realtimeSync.ts` (1010 lines) → `src/lib/supabase/realtimeSync/` directory:
  - `helpers.ts` — ID derivation, ledger upserts, shared types
  - `protocols.ts` — `syncProtocolUpsert`, `syncProtocolItemDelete`, `syncProtocolDelete`
  - `activation.ts` — `syncActivation`, `syncActiveStatus`, `syncRegeneratedDoses`, lifecycle commands
  - `doses.ts` — `syncTakeDoseCommand`, `syncSkipDoseCommand`, `syncRemoveDoseCommand`
  - `snooze.ts` — `syncSnoozeDoseCommand`
  - `index.ts` — barrel re-export (all import paths unchanged)
- `store.ts` pure helpers extracted to `src/lib/store/storeHelpers.ts` (282 lines)
- `store.ts` sync state extracted to `src/lib/store/syncState.ts` (51 lines)
- `store.ts` reduced from 1408 → 1095 lines

**V2 sync integrity fixes (PRs #41, #42, #46; migrations 013, 014, 015):**
- Removed doses now cancel their occurrences (if linked to events) instead of deleting to avoid orphaning history.
- Execution events linked to planned occurrences on import so dose statuses survive reload.
- Outbox drained before boot pull so offline actions persist across sessions.
- Legacy occurrence keys normalized to canonical format; stale ledger rows expired; E2E throwaway users purged (migration 015).
- ID-derivation helpers (`hash32`, `stableUuid`, `isUuid`) consolidated to `src/lib/ids.ts` with pinned snapshot test.

**Food pipeline revival (PRs #45, #47, in progress per separate plan):**
- Wave 1 completed; continuation in progress.

## 3. Testing & Verification

**E2E test suite (Playwright):**
- Food E2E suite requires `E2E_EMAIL` and `E2E_PASSWORD` (dedicated reusable test account; use env var names only, never commit values).
- Requires `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in Playwright process env.
- Dev server must run with `FOOD_AI_PROVIDER=mock` to avoid external API calls.
- Without credentials, food tests silently skip — selector rot has gone unnoticed this way; ensure test runner is configured.

**Unit tests:**
- `npm run test:unit` compiles and runs snapshot tests for ID derivation, nutrition targets, and schedule logic.
- Snapshot pinning guards cloud ID stability across refactors.

## 4. Backlog (next agent picks up here)

### Phase 5 remainder — store.ts Zustand slice split

`store.ts` is still 1095 lines. The actions can be split into domain `StateCreator` slices:

- `src/lib/store/protocols.slice.ts` — `createCustomProtocol`, `updateProtocol`, `deleteProtocol`, `addProtocolItem`, `removeProtocolItem`
- `src/lib/store/activation.slice.ts` — `activateProtocol`, `pauseProtocol`, `resumeProtocol`, `completeProtocol`
- `src/lib/store/doses.slice.ts` — `takeDose`, `skipDose`, `snoozeDose`, `removeDose`, `endProtocolFromToday`, `regenerateDoses`

**Key constraint:** `updateProtocol` calls `get().regenerateDoses()` — a cross-slice call. Pattern to use:
```ts
type ProtocolsSlice = { createCustomProtocol: ...; ... }
type AppState = AuthSlice & ProtocolsSlice & ActivationSlice & DosesSlice & ...
// Each slice:
const createProtocolsSlice: StateCreator<AppState, [['zustand/persist', unknown]], [], ProtocolsSlice> = (set, get) => ({ ... })
```
Cross-slice calls work because `get()` returns full `AppState`.

Branch: start from `main`. Name: `codex/phase5-store-slices`.

### Deferred architecture tracks

1. Auth and email-confirmation redesign.
2. Domain/schedule engine redesign.
3. UI/PWA packaging and offline strategy audit.

## 5. What not to do

- Do not push directly to `main`.
- Do not treat historical branch docs as source-of-truth.
