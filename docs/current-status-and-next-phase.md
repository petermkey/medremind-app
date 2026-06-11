# Current Status and Next Phase (Current Main)

Date: 2026-06-11
Source: current `main` + branch `codex/phase5-realtime-sync-split` (PR #40, pending merge)

## 1. Current phase summary

Lifecycle migration is complete on `main`. Active branch is Phase 5 — monolith split of
`realtimeSync.ts` and `store.ts` into domain-focused modules. PR #40 is open and ready to merge.

## 2. What is complete (on main or PR #40)

**Lifecycle migration (on main):**
- Additive schema readiness and runtime-safe coexistence with legacy tables (V1 tables dropped in PR #39).
- Command-based write paths for dose and lifecycle transitions.
- Execution write-through for take/skip/snooze.
- Planned future write-through at activation time.
- Lifecycle-aware selector/read-model migration for all app surfaces.

**Phase 5 — monolith split (PR #40, not yet merged):**
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

## 3. Backlog (next agent picks up here)

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

Branch: start from `main` after PR #40 merges. Name: `codex/phase5-store-slices`.

### Deferred architecture tracks

1. Auth and email-confirmation redesign.
2. Domain/schedule engine redesign.
3. UI/PWA packaging and offline strategy audit.

## 4. What not to do

- Do not push directly to `main`.
- Do not treat historical branch docs as source-of-truth.
- Do not start the slice split before PR #40 is merged.
