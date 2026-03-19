# Architecture (Current Main)

Date: 2026-03-19
Source of truth: current `main` branch

## 1. Runtime stack and boundaries

- Framework: Next.js App Router (`next@16`), React (`react@19`), TypeScript.
- State: Zustand + `persist` middleware (`src/lib/store/store.ts`).
- Date logic: `date-fns`.
- Cloud backend: Supabase auth + Postgres tables via browser and server clients.
- Styling/UI: Tailwind CSS with local component primitives.

Runtime boundaries:

- Client app shell and feature routes are under `src/app/app/*`.
- Auth routes are under `src/app/(auth)/*`.
- Edge auth guard is implemented in `src/proxy.ts`.
- Supabase browser client is singleton-based in `src/lib/supabase/client.ts`.

## 2. Routing model

Public/auth routes:

- `/` landing page (`src/app/page.tsx`)
- `/register` (`src/app/(auth)/register/page.tsx`)
- `/login` (`src/app/(auth)/login/page.tsx`)
- `/onboarding` (`src/app/(auth)/onboarding/page.tsx`)

App routes (guarded by proxy + client bootstrap):

- `/app` schedule/today (`src/app/app/page.tsx`)
- `/app/protocols` list (`src/app/app/protocols/page.tsx`)
- `/app/protocols/new` wizard (`src/app/app/protocols/new/page.tsx`)
- `/app/protocols/[id]` detail/edit (`src/app/app/protocols/[id]/page.tsx`)
- `/app/meds` (`src/app/app/meds/page.tsx`)
- `/app/progress` (`src/app/app/progress/page.tsx`)
- `/app/settings` (`src/app/app/settings/page.tsx`)

## 3. App boot architecture

`src/app/app/layout.tsx` owns bootstrapping and app-shell gating.

Boot sequence:

1. Start outbox processing (`startSyncOutbox`).
2. Call `getCurrentUser()`.
3. On auth fetch failure:
- if local profile is onboarded, release loading state and keep shell usable.
- otherwise reset local user data and redirect to `/login`.
4. On no user: reset local user data and redirect to `/login`.
5. On user switch (`profile.id` mismatch): reset local user data to prevent cross-account state bleed.
6. Set profile in store.
7. If user is not onboarded: redirect to `/onboarding`.
8. Pull cloud state with retry (`pullStoreFromSupabase`, retry loop in layout).
9. If pull fails, continue with local state (non-fatal).

This is the current guard against indefinite spinner lock during auth bootstrap failures.

## 4. Server-side auth gate (proxy)

`src/proxy.ts`:

- Refreshes Supabase session by awaiting `supabase.auth.getUser()`.
- Redirects unauthenticated `/app*` requests to `/login`.
- Redirects authenticated users away from `/login` and `/register` to `/app`.

Current limitation:

- Proxy does not evaluate profile onboarding state; onboarding redirect remains client-side in app layout.

## 5. State architecture

Primary state container: `src/lib/store/store.ts`.

Persisted keys:

- `medremind-store`
- `medremind-sync-outbox-v1` (separate outbox module)

Persist partialization:

- Persists profile, notification settings, active protocols, scheduled doses, dose records, and custom protocols only.
- Seed templates are re-merged during hydration (`merge` function).

Key helper internals in store:

- `generateId(prefix)` with guarded fallback path (uuid -> crypto.randomUUID -> timestamp-random string).
- `normalizeDurationDays(value)` for defensive fixed-duration normalization.
- `computeInclusiveEndDate(startDate, durationDays)`.
- `expandItemToDoses(...)` for dose generation over date ranges with end-date cap.

## 6. Cloud persistence architecture

Primary modules:

- `src/lib/supabase/realtimeSync.ts` for direct cloud writes.
- `src/lib/supabase/syncOutbox.ts` for retry queue/backoff.
- `src/lib/supabase/cloudStore.ts` for backup/export/pull.
- `src/lib/supabase/importStore.ts` for snapshot import.

Write model:

- Local-first optimistic update in store.
- Fire-and-forget sync call.
- On failure, queue operation into outbox.
- Outbox replays on app start/online/visible and manual flush.

Cloud ID mapping:

- `realtimeSync.ts` maps local non-UUID IDs to deterministic stable UUIDs per entity class.
- `importStore.ts` uses deterministic stable UUID mapping for non-UUID IDs on import.

## 7. PWA/runtime platform status

Present:

- Manifest: `public/manifest.json`.
- Icons: `public/icon-192.png`, `public/icon-512.png`.
- Root metadata references manifest (`src/app/layout.tsx`).
- `display: standalone`, `start_url: /app`.

Not present on current main:

- No explicit service worker registration code.
- No app-specific offline cache logic in runtime code.

## 8. Build and deployment essentials

- Build command: `npm run build`.
- Environment dependencies: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- Auth + cloud flows degrade only partially without Supabase; app is built around signed-in sync.

## 9. Critical files (high regression risk)

- `src/lib/store/store.ts`
- `src/app/app/layout.tsx`
- `src/proxy.ts`
- `src/lib/supabase/realtimeSync.ts`
- `src/lib/supabase/importStore.ts`
- `src/lib/supabase/cloudStore.ts`
- `src/lib/supabase/syncOutbox.ts`

Changes in these files should always include focused behavior verification (auth boot, protocol activation/regeneration, and sync resilience).
