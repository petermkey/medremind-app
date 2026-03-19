# Auth and Persistence Behavior (Current Main)

Date: 2026-03-19
Scope: register/login/onboarding, session bootstrap, cloud sync, import/restore, and sign-out safety

## 1. Auth surface and key files

- Register: `src/app/(auth)/register/page.tsx`
- Login: `src/app/(auth)/login/page.tsx`
- Onboarding: `src/app/(auth)/onboarding/page.tsx`
- App bootstrap: `src/app/app/layout.tsx`
- Proxy guard: `src/proxy.ts`
- Auth wrapper: `src/lib/supabase/auth.ts`

## 2. Register/login confirmation behavior

Register:

- `supabaseSignUp` returns profile/error/session-availability signal.
- Confirmation-required signups do not force onboarding entry.
- Confirmation-required state exposes resend action.
- Resend actions apply cooldown to prevent rapid repeats.

Login:

- Unconfirmed-email response enters confirmation-required state.
- Login confirmation resend is available with cooldown.
- Successful login resets local user state, sets profile, pulls cloud state non-fatally, and routes by onboarding flag.

## 3. Onboarding and profile persistence behavior

- Onboarding completion updates local profile immediately.
- Cloud `saveProfile` is non-blocking for navigation.
- Settings profile save follows non-blocking behavior.

## 4. App bootstrap resilience

`src/app/app/layout.tsx` guarantees finite bootstrap behavior:

- handles auth fetch failures explicitly
- avoids indefinite loading lock
- allows usable shell when safe local state exists
- resets state and routes to login when required

## 5. Proxy responsibilities and limits

`src/proxy.ts` currently handles coarse auth routing only:

- unauthenticated `/app*` -> `/login`
- authenticated `/login`/`/register` -> `/app`

Onboarding enforcement remains client-side in layout/store flow.

## 6. Local persistence and outbox model

Persisted store subset includes profile/settings/active protocols/scheduled doses/dose records/custom protocols.
Seed templates are re-merged on hydration.

Outbox model:

- local key: `medremind-sync-outbox-v1`
- retries on app start, online, visibility changes, and manual flush
- protects eventual cloud durability after transient failures

## 7. Command-path sync and additive writes

Landed command paths in `realtimeSync.ts`:

- take, skip, snooze dose commands
- pause, resume, complete, archive lifecycle commands

Additive writes:

- command paths write execution facts into `execution_events`
- activation writes planned future rows into `planned_occurrences`

## 8. Import/restore idempotency behavior

`importStore.ts` maps non-UUID protocol-related IDs deterministically.
This protects re-import/idempotency for active protocols, scheduled doses, and dose records.

## 9. Sign-out guard sequence

Settings sign-out path:

1. wait for in-flight realtime sync idle
2. confirm if in-flight work remains
3. flush outbox
4. confirm if outbox work remains
5. sign out from Supabase
6. clear local user state and outbox
7. route to login

This avoids silent loss during pending writes.

## 10. Current risks to preserve awareness

- auth policy split across proxy + client layout
- heavy coupling of domain and sync concerns in store
- device-local outbox backlog risk under prolonged failures
