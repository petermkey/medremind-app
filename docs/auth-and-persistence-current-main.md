# Auth and Persistence Behavior (Current Main)

Date: 2026-03-19
Scope: register/login/onboarding, session bootstrap, cloud sync, import/restore, and logout safety

## 1. Auth surface and key files

- Register: `src/app/(auth)/register/page.tsx`
- Login: `src/app/(auth)/login/page.tsx`
- Onboarding: `src/app/(auth)/onboarding/page.tsx`
- App bootstrap/layout gate: `src/app/app/layout.tsx`
- Proxy middleware: `src/proxy.ts`
- Supabase auth wrapper: `src/lib/supabase/auth.ts`

## 2. Register flow (current)

Register submit calls `supabaseSignUp(...)`.

`supabaseSignUp` returns:

- `profile`
- `error`
- `hasSession` (derived from Supabase sign-up response)

Behavior in register page:

- If sign-up fails: show normalized error.
- If sign-up succeeds but `hasSession=false` (confirmation-required):
- do not enter onboarding
- show confirmation-required info state
- expose resend action
- keep clear next step to sign in
- If sign-up returns immediate session (`hasSession=true`):
- reset local user-scoped data
- set profile
- navigate to onboarding

Resend behavior:

- Uses `resendSignupConfirmationEmail(email)`.
- Has cooldown lockout (30 seconds) to prevent rapid repeated requests.
- Shows success/error feedback inline.

## 3. Login flow (current)

Login submit calls `supabaseSignIn(email, password)`.

Behavior:

- If auth error indicates unconfirmed email:
- show explicit confirmation-required state
- offer resend confirmation action
- apply resend cooldown (30 seconds)
- If sign-in succeeds:
- reset local user data
- set profile
- attempt cloud pull (`pullStoreFromSupabase`) non-fatally
- route by onboarding flag:
- onboarded -> `/app`
- not onboarded -> `/onboarding`

Error normalization in `auth.ts`:

- email-not-confirmed class -> user-facing confirmation message
- invalid credentials -> user-friendly invalid credentials message

## 4. Onboarding behavior

Onboarding page (`src/app/(auth)/onboarding/page.tsx`):

- Completes local onboarding with `completeOnboarding(...)`.
- Optionally activates selected starter protocol.
- Persists profile via `saveProfile(...)` in non-blocking mode (`catch` only, no navigation block).
- Always navigates to `/app` after local completion.

This preserves UX continuity if profile write is delayed/failing.

## 5. App bootstrap and failure fallback

`src/app/app/layout.tsx` controls app entry safety.

Important behaviors:

- Auth fetch failures are handled explicitly.
- No-user path always resets user-scoped local state and redirects to `/login`.
- Auth bootstrap failure no longer guarantees spinner lock; checking state resolves.
- If auth fetch fails but local onboarded profile exists, app remains usable instead of hard lock.

## 6. Proxy responsibilities and limits

`src/proxy.ts` currently handles only coarse auth routing:

- `/app*` blocked for unauthenticated requests.
- `/login` and `/register` redirected to `/app` if session exists.

It does not enforce onboarding/profile completion semantics.
That remains in client boot/layout logic.

## 7. Local store persistence model

In `store.ts` persisted subset includes:

- `profile`
- `notificationSettings`
- `activeProtocols`
- `scheduledDoses`
- `doseRecords`
- custom protocols only

Seed templates are merged back on hydration.

This split is essential to preserve template availability while keeping user data scoped.

## 8. Cloud sync model

Write flow:

1. mutate local store first
2. call realtime sync writer
3. if sync fails, enqueue operation in outbox
4. retry with backoff until success

Modules:

- Direct sync: `src/lib/supabase/realtimeSync.ts`
- Retry queue: `src/lib/supabase/syncOutbox.ts`

Outbox details:

- key: `medremind-sync-outbox-v1`
- triggers: app start, online event, tab visibility, manual flush
- status exposed via `SyncStatusPill`

## 9. Logout/sign-out protection

Settings sign-out path (`src/app/app/settings/page.tsx`) is guarded:

1. wait for in-flight realtime sync (`waitForRealtimeSyncIdle`)
2. if still pending, ask user to confirm sign-out anyway
3. flush outbox if queue has pending items
4. if still pending, ask user to confirm sign-out anyway
5. sign out from Supabase
6. clear outbox and local user state
7. route to `/login`

This protects against silent loss during pending writes.

## 10. Cloud pull/backup/import/restore

- Pull from cloud: `pullStoreFromSupabase()`
- Backup local snapshot to cloud: `backupCurrentStoreToSupabase()`
- Export local snapshot JSON: `downloadCurrentStoreSnapshot()`
- Import pasted snapshot JSON to cloud: `importStoreSnapshotToSupabase(raw)`

`importStore.ts` idempotency hardening:

- Non-UUID IDs are mapped deterministically (`stableUuid`) for protocol-related entities.
- Active protocols, scheduled doses, and dose records get deterministic IDs.
- Re-importing the same snapshot no longer creates random-ID duplicates for these entities.

## 11. Recent auth/persistence fixes already in main

Already landed behavior slices include:

- confirmation-aware register flow
- register resend action for confirmation-required state
- resend cooldown on login/register confirmation actions
- onboarding saveProfile made non-blocking
- settings saveProfile made non-blocking
- layout boot hardening against indefinite spinner on auth bootstrap failure
- profile ID generation safeguarded with store `generateId` path
- protocol/import ID hardening and deterministic import mapping

These are live behaviors on current `main`, not pending branch work.

## 12. High-risk assumptions to preserve

- Never reintroduce blocking auth/profile writes that gate navigation.
- Keep auth bootstrap finite: always resolve loading/checking state.
- Preserve deterministic ID mapping in import/sync paths.
- Preserve sign-out guard sequence (in-flight + outbox checks).
- Keep cross-account reset guard when user identity changes.
