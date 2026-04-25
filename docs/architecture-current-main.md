# Architecture (Current Main)

Date: 2026-04-17
Source of truth: current `main`

## 1. Runtime stack and boundaries

- Framework: Next.js App Router (`next@16.2.2`), React (`react@19.2.4`), TypeScript (`v6`).
- State: Zustand + `persist` in `src/lib/store/store.ts`.
- Date/time logic: `date-fns`.
- Cloud backend: Supabase auth + Postgres via browser/server clients.
- UI: Tailwind CSS + local component primitives.

Runtime boundaries:

- App routes: `src/app/app/*`
- Auth routes: `src/app/(auth)/*`
- OAuth callback: `src/app/auth/callback/route.ts` (committed on `main`)
- Route guard: `src/proxy.ts` (redirects `/app*` → `/login` when unauthenticated; redirects `/login`/`/register` → `/app` when authenticated)
- Session refresh + route guard entry point: `middleware.ts` at repo root (committed on `main`, delegates entirely to `proxy()`)
- App bootstrap/auth gate: `src/app/app/layout.tsx`
- Sync/write model: `src/lib/supabase/realtimeSync.ts`
- Retry/outbox: `src/lib/supabase/syncOutbox.ts`

## 2. Routing model

Public/auth:

- `/`
- `/register`
- `/login`
- `/onboarding`
- `/auth/callback` (OAuth PKCE exchange — committed on `main`)

Guarded app:

- `/app`
- `/app/protocols`
- `/app/protocols/new`
- `/app/protocols/[id]`
- `/app/meds`
- `/app/progress`
- `/app/settings`

## 3. Auth model

Two auth paths are implemented:

**Email/password** (fully committed on main):
- Register: `supabaseSignUp` → email confirmation gate → resend actions → onboarding
- Login: `supabaseSignIn` → confirmation-required state or profile load → cloud pull → route by `onboarded`
- Confirmation-aware: unconfirmed signups do not force onboarding; login surfaces resend with 30s cooldown

**OAuth — Google only** (committed on `main`):
- Login and register pages have a Google button wired to `signInWithOAuth('google')`. Apple sign-in removed permanently.
- `signInWithOAuth` calls `supabase.auth.signInWithOAuth` with `redirectTo: /auth/callback`
- `middleware.ts` delegates to `proxy()`, which handles both session refresh (PKCE cookie propagation) and route protection
- `/auth/callback/route.ts` exchanges code for session, checks `profiles.onboarded`, redirects to `/app` or `/onboarding`
- On OAuth failure: redirects to `/login?error=oauth`
- Google OAuth verified end-to-end in real browser against staging and merged to `main`. Account-linking remains a production readiness gate.

## 4. Boot and auth gate architecture

`src/app/app/layout.tsx` sequence:

1. start outbox processing
2. fetch current user
3. handle fetch failure without infinite lock (fall through to local-state or redirect to login)
4. reset on no-user path
5. reset on user identity mismatch (cross-account bleed protection)
6. set profile
7. route non-onboarded users to onboarding
8. pull cloud state with bounded retries (3 attempts, 700ms backoff)
9. keep app usable with local state if pull fails

This design prevents indefinite auth bootstrap spinner lock.

## 5. Persistence architecture

Write model:

1. local optimistic store mutation
2. direct sync call (fire-and-forget, tracked in `inflightRealtimeSync` set)
3. on failure, enqueue outbox item
4. outbox retries with backoff

Modules:

- direct writes: `src/lib/supabase/realtimeSync.ts`
- outbox/retry: `src/lib/supabase/syncOutbox.ts`
- cloud pull/backup/export: `src/lib/supabase/cloudStore.ts`
- import/restore mapping: `src/lib/supabase/importStore.ts`

Outbox local key: `medremind-sync-outbox-v1`. Retried on app start, online, visibility changes, and manual flush.

## 6. Lifecycle command architecture (landed)

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

## 7. Additive migration architecture (landed in runtime)

Active additive write-through on `main`:

- `execution_events`: take/skip/snooze command writes
- `planned_occurrences`: activation future-row write-through (`activation_write_through_c4`)

Legacy tables remain active for runtime reads/writes during migration phase.

## 8. Read-model selector migration architecture (landed)

Selector-based read paths now cover:

- `/app` actionable list / next-dose / summary metrics
- `/app/progress` lifecycle-aware aggregation inputs, today summary, week trend, protocol breakdown
- protocol detail lifecycle-aware read model
- calendar-visible date projection
- past-date history rows

## 9. Schedule and dose generation

`expandItemToDoses` in `store.ts` generates `ScheduledDose` records from `ProtocolItem` definitions:

- daily/twice_daily/three_times_daily: generates per time per day
- every_n_hours: uses `times[]` array (UI sets appropriate entries)
- every_n_days: frequency-gate on day offset from protocol start
- weekly: every 7th day from item startDay
- analysis/therapy with no times: single reminder at day offset

Snooze uses replacement-row semantics: original row set to `snoozed`, new `pending` row created at target slot. Collision resolution shifts target in 5-minute increments up to 72 attempts.

## 10. Platform status

Present:

- PWA manifest + icons
- standalone display metadata
- service worker registration (`registerServiceWorker()`) for web push flow

Not present:

- full offline-first caching strategy for app data/shell

## 11. High-risk files

- `src/lib/store/store.ts` — domain logic + sync wiring + selectors, 1234 lines
- `src/lib/supabase/realtimeSync.ts` — all cloud command paths
- `src/app/app/layout.tsx` — auth boot gate
- `src/proxy.ts` — server-side route guard
- `src/lib/supabase/importStore.ts` — import idempotency via deterministic ID mapping
- `src/lib/supabase/cloudStore.ts` — cloud pull and snapshot
- `src/lib/supabase/syncOutbox.ts` — retry/outbox

Changes in these files require focused validation and docs updates in the same slice.
