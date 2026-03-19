# Architecture (Current Main)

Date: 2026-03-19
Source of truth: current `main`

## 1. Runtime stack and boundaries

- Framework: Next.js App Router (`next@16`), React (`react@19`), TypeScript.
- State: Zustand + `persist` in `src/lib/store/store.ts`.
- Date/time logic: `date-fns`.
- Cloud backend: Supabase auth + Postgres via browser/server clients.
- UI: Tailwind CSS + local component primitives.

Runtime boundaries:

- App routes: `src/app/app/*`
- Auth routes: `src/app/(auth)/*`
- Route guard: `src/proxy.ts`
- App bootstrap/auth gate: `src/app/app/layout.tsx`
- Sync/write model: `src/lib/supabase/realtimeSync.ts`
- Retry/outbox: `src/lib/supabase/syncOutbox.ts`

## 2. Routing model

Public/auth:

- `/`
- `/register`
- `/login`
- `/onboarding`

Guarded app:

- `/app`
- `/app/protocols`
- `/app/protocols/new`
- `/app/protocols/[id]`
- `/app/meds`
- `/app/progress`
- `/app/settings`

## 3. Boot and auth gate architecture

`src/app/app/layout.tsx` sequence:

1. start outbox processing
2. fetch current user
3. handle fetch failure without infinite lock
4. reset on no-user path
5. reset on user identity mismatch
6. set profile
7. route non-onboarded users to onboarding
8. pull cloud state with bounded retries
9. keep app usable with local state if pull fails

This design prevents indefinite auth bootstrap spinner lock.

## 4. Persistence architecture

Write model:

1. local optimistic store mutation
2. direct sync call
3. on failure, enqueue outbox item
4. outbox retries with backoff

Modules:

- direct writes: `src/lib/supabase/realtimeSync.ts`
- outbox/retry: `src/lib/supabase/syncOutbox.ts`
- cloud pull/backup/export: `src/lib/supabase/cloudStore.ts`
- import/restore mapping: `src/lib/supabase/importStore.ts`

## 5. Lifecycle command architecture (landed)

Dose commands:

- `syncTakeDoseCommand`
- `syncSkipDoseCommand`
- `syncSnoozeDoseCommand`

Lifecycle commands:

- `syncPauseProtocolCommand`
- `syncResumeProtocolCommand`
- `syncCompleteProtocolCommand`
- `syncArchiveProtocolCommand`

Command paths use client operation IDs and sync-operation ledger semantics where available.

## 6. Additive migration architecture (landed in runtime)

Active additive write-through on `main`:

- `execution_events`: take/skip/snooze command writes
- `planned_occurrences`: activation future-row write-through (`activation_write_through_c4`)

Legacy tables remain active for runtime reads/writes during migration phase.

## 7. Read-model selector migration architecture (landed)

Selector-based read paths now cover:

- `/app` actionable list / next-dose / summary metrics
- `/app/progress` lifecycle-aware aggregation inputs
- protocol detail lifecycle-aware read model
- calendar-visible date projection
- past-date history rows

This reduced direct page-level raw scans in key screens.

## 8. Platform status

Present:

- PWA manifest + icons
- standalone display metadata

Not present:

- explicit service-worker registration/runtime offline cache layer

## 9. High-risk files

- `src/lib/store/store.ts`
- `src/lib/supabase/realtimeSync.ts`
- `src/app/app/layout.tsx`
- `src/proxy.ts`
- `src/lib/supabase/importStore.ts`
- `src/lib/supabase/cloudStore.ts`
- `src/lib/supabase/syncOutbox.ts`

Changes in these files require focused validation and docs updates in the same slice.
