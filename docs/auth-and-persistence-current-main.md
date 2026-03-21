# Auth and Persistence Behavior (Current Main)

Date: 2026-03-21
Scope: register/login/onboarding, OAuth, session bootstrap, cloud sync, import/restore, sign-out safety

---

## 1. Auth surface — key files

| File | Status | Role |
|------|--------|------|
| `src/lib/supabase/auth.ts` | Committed (`codex/oauth-google-apple`) | All auth functions: sign-up, sign-in, sign-out, OAuth (Google only), resend, profile load |
| `src/app/(auth)/login/page.tsx` | Committed (`codex/oauth-google-apple`) | Login UI with email/password + Google OAuth button |
| `src/app/(auth)/register/page.tsx` | Committed (`codex/oauth-google-apple`) | Register UI with email/password + Google OAuth button |
| `src/app/auth/callback/route.ts` | Committed (`codex/oauth-google-apple`) | OAuth PKCE code-exchange route handler |
| `middleware.ts` (repo root) | Committed (`codex/oauth-google-apple`) | Delegates to `proxy()` — session refresh + route guard entry point |
| `src/proxy.ts` | Committed | Server-side route guard (protects `/app*`, redirects authenticated users away from `/login`/`/register`) |
| `src/app/app/layout.tsx` | Committed | Client-side app bootstrap gate (auth check, cloud pull, onboarding redirect) |
| `src/lib/supabase/server.ts` | Committed | Server-side Supabase client factory (used by callback route) |

---

## 2. Email auth — full flow (committed and working)

### Signup

1. User submits name, email, password (min 8 chars, 1 digit), timezone auto-detected via `Intl.DateTimeFormat`.
2. `supabaseSignUp` calls `supabase.auth.signUp` with `{ email, password, options.data: { name, timezone } }`.
3. Return value includes `hasSession: Boolean(data.session)`.
4. If `hasSession` is false (email confirmation required by Supabase project settings): UI shows confirmation-pending state with resend button. User is NOT routed to onboarding. No profile is written to store.
5. If `hasSession` is true (email confirmation disabled in Supabase): profile is set in store and user is routed to `/onboarding`.
6. `supabaseSignUp` builds a `UserProfile` object from the returned user but does NOT write to the `profiles` DB table — the profile row is created by a Supabase DB trigger (assumed; not visible in client code).

### Email confirmation resend

- Available in both register (after signup) and login (when unconfirmed-email error).
- Calls `supabase.auth.resend({ type: 'signup', email })`.
- 30-second cooldown enforced client-side to prevent rapid repeats.

### Login

1. `supabaseSignIn` calls `supabase.auth.signInWithPassword({ email, password })`.
2. On success: queries `profiles` table (`maybeSingle`) for the user row.
3. Builds `UserProfile`: falls back to `user_metadata.name` then email prefix if no `profiles` row exists. Falls back to `Intl.DateTimeFormat` timezone if none in DB.
4. Returns profile. Login page calls `store.resetUserData()`, `store.setProfile(profile)`, then `pullStoreFromSupabase()` (non-fatal on failure).
5. Routes: `profile.onboarded ? '/app' : '/onboarding'`.

### Error normalization

`normalizeAuthErrorMessage` maps:
- `email[^.]*not[^.]*confirmed` / `email_not_confirmed` → `'Please confirm your email before signing in.'`
- `invalid login credentials` → `'Invalid email or password.'`
- All other errors: raw Supabase message passed through.

`isEmailConfirmationRequiredError` triggers the confirmation-required UI branch in the login page.

### Sign-out

`supabaseSignOut` calls `supabase.auth.signOut()`. The Settings screen wraps this in a guarded sequence (see Section 9).

---

## 3. OAuth auth — Google only (committed, staging-verified)

**Status:** Google OAuth is committed on branch `codex/oauth-google-apple` (PR #5 open against main). Google sign-in has been verified end-to-end in a real browser against the staging environment. Apple sign-in has been **removed** — no Apple button exists in the UI and the provider type is narrowed to `'google'` only in `auth.ts`.

Branch: `codex/oauth-google-apple` | PR #5 | Supabase project ref: `hagypgvfkjkncznoctoq`
Staging URL: `https://medremind-6m0wqxa7w-peter-7822s-projects.vercel.app`

### What is implemented

`/login` and `/register` pages have a Google button. It calls `signInWithOAuth('google')` defined in `auth.ts`.

`signInWithOAuth`:
```
supabase.auth.signInWithOAuth({
  provider,   // 'google' only — Apple removed
  options: { redirectTo: `${window.location.origin}/auth/callback` }
})
```

- Uses PKCE flow (Supabase default for browser clients).
- On success: browser navigates to the provider. No local state change at initiation.
- On initiation error (rare): returns error string displayed in UI. OAuth loading state is NOT reset on success (browser navigates away).

### Callback route — `/auth/callback/route.ts`

Server-side Route Handler. Called by Supabase after provider authentication.

1. Extracts `code` from `searchParams`.
2. Creates a server Supabase client via `createClient()` (reads cookies from `next/headers`).
3. Calls `supabase.auth.exchangeCodeForSession(code)` — one-time code exchange, server-side.
4. On success: queries `profiles` table for `onboarded` flag.
5. Redirects to `/app` if `profile.onboarded === true`, otherwise `/onboarding`.
6. If `code` is missing or exchange fails: redirects to `/login?error=oauth`.
7. Login page reads `searchParams.get('error') === 'oauth'` and sets initial error state `'Sign-in failed. Please try again.'`.

The callback route comment states: "The DB trigger guarantees a profiles row exists at this point." This is an assertion in comments only — the DB trigger is not visible in client-side code and has not been independently verified here.

### Session refresh middleware — `middleware.ts`

Runs on every request matching the pattern:
```
/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)
```

Action: delegates entirely to `proxy()` from `src/proxy.ts`. `proxy()` creates a Supabase SSR client and calls `supabase.auth.getUser()`, which triggers cookie refresh on the response. Route protection also lives in `proxy()`.

What it does NOT do:
- Does not contain its own redirect logic.
- Does not forward query params or deep links.

Purpose: ensures OAuth PKCE session cookies propagate correctly to server-side renders after the callback redirect. Without this, the SSR session can be stale immediately after OAuth.

### Relationship to `src/proxy.ts`

`middleware.ts` delegates entirely to `proxy()`:

```ts
import { proxy } from '@/proxy';
export async function middleware(request: NextRequest) {
  return proxy(request);
}
```

`proxy.ts` handles both session refresh (`getUser()`) and route protection in a single Supabase client per request. There is no duplication — one client, one `getUser()` call, one response. Route protection is active end-to-end.

### Production config requirements for OAuth

The following must be configured in the Supabase dashboard for OAuth to work. These are not set or verified by any code in this repository:

1. **Google provider**: Client ID and Client Secret from Google Cloud Console.
2. **Redirect URL allowlist**: `https://<your-domain>/auth/callback` must be added to the allowed redirect URLs in Supabase Auth settings.
3. **OAuth redirect URL at provider**: Google OAuth app must list `https://<your-supabase-project>.supabase.co/auth/v1/callback` as an authorized redirect URI.

Failing to configure any of these will result in a silent OAuth redirect failure landing on `/login?error=oauth`.

---

## 4. Profile bootstrap — `getCurrentUser`

Called by `src/app/app/layout.tsx` on every app mount.

1. Calls `supabase.auth.getUser()` (validates session with Supabase server, not just cookie).
2. Queries `profiles` table for matching row (`maybeSingle`).
3. Constructs `UserProfile` with fallbacks identical to `supabaseSignIn`.
4. Returns `null` if no authenticated user.

This means: if a `profiles` row does not exist for an OAuth user, `getCurrentUser` will still return a valid profile with fallback name and timezone. The user will not be hard-blocked, but their name and timezone may be derived from `user_metadata` or locale defaults rather than saved values.

---

## 5. App bootstrap gate — `src/app/app/layout.tsx`

Sequence on mount:

1. `startSyncOutbox()` — begins outbox retry loop.
2. `getCurrentUser()` — fetch authenticated user + profile.
3. If fetch throws: check for valid local `profile.onboarded`. If present, allow access with local state. If not, `resetUserData()` + redirect to `/login`.
4. If `user` is null: `resetUserData()` + redirect to `/login`.
5. If `profile.id !== user.id` (identity mismatch): `resetUserData()` to prevent cross-account bleed, then set new profile.
6. `setProfile(user)`.
7. If `!user.onboarded`: redirect to `/onboarding`.
8. `pullWithRetry(3, 700ms backoff)` — cloud pull. Non-fatal on failure; local store remains usable.
9. Set `checking = false`.

Render gates:
- While `checking`: spinner.
- After check, if `!profile?.onboarded`: fallback error screen with manual redirect to `/login`.

This design prevents indefinite spinner lock and handles both auth failures and network failures gracefully.

---

## 6. Onboarding redirect logic

Three places determine whether a user goes to `/onboarding`:

1. **Email signup with session** (`register/page.tsx`): always routes to `/onboarding` on `hasSession === true`.
2. **OAuth callback** (`auth/callback/route.ts`): queries `profiles.onboarded`; routes to `/onboarding` if false.
3. **App layout boot** (`app/layout.tsx`): routes to `/onboarding` if `user.onboarded === false` after `getCurrentUser`.
4. **Login** (`login/page.tsx`): routes to `profile.onboarded ? '/app' : '/onboarding'` after sign-in.

There is no onboarding skip for OAuth users. If the `profiles` row does not exist (DB trigger not fired), the fallback `onboarded: false` in `getCurrentUser` will route the user to onboarding — which is the safe default.

---

## 7. Route guard architecture

Two layers:

**`src/proxy.ts`** (server-side, committed):
- Unauthenticated `/app*` → redirect `/login`
- Authenticated `/login` or `/register` → redirect `/app`
- Does NOT enforce onboarding (client-side only)
- Matcher excludes: `_next/static`, `_next/image`, `favicon.ico`, `manifest.json`, `icon-*.png`

**`src/app/app/layout.tsx`** (client-side, committed):
- Secondary auth gate; enforces onboarding redirect
- Handles auth boot failure without infinite lock

**`middleware.ts`** (repo root, committed on `codex/oauth-google-apple`):
- Thin entry point — delegates entirely to `proxy()` from `src/proxy.ts`
- `proxy()` handles both session refresh and route protection in one pass
- Matcher: all routes except Next.js internals and static images
- One Supabase client per request; no duplication with `proxy.ts`

---

## 8. Account linking behavior

**Not implemented in application code.** No explicit account-linking logic exists anywhere in the codebase.

Supabase's behavior when the same email is used across providers depends on Supabase project configuration:
- If "Link accounts by email" is enabled in Supabase Auth settings: Supabase may automatically link OAuth identities to an existing email/password account with the same address.
- If not enabled: a new separate `auth.users` row is created for the OAuth identity. The user ends up with two accounts sharing the same email — **the user's medication protocols, active treatments, and dose history from the original email account are invisible in the new OAuth account.** For a medical adherence app this is silent data loss from the user's perspective.

This configuration is not set or verified by any code in this repository. **The application does not handle, detect, or communicate account-linking outcomes to the user.** An agent must not document account linking as safe or handled.

Apple Sign-In has been removed from the application. Apple private relay email handling is not a concern.

---

## 9. Sign-out guard sequence

The Settings page sign-out path (committed):

1. Wait for in-flight realtime sync to go idle (`inflightRealtimeSync` set drains).
2. If in-flight work remains past timeout: surface confirmation dialog.
3. Flush outbox (`syncOutbox`).
4. If outbox has remaining items: surface confirmation dialog.
5. Call `supabaseSignOut()` → `supabase.auth.signOut()`.
6. `store.resetUserData()` + clear outbox.
7. `router.push('/login')`.

This sequence protects against silent data loss during pending writes on sign-out.

---

## 10. Local persistence and outbox model

Persisted Zustand store keys: `profile`, `notificationSettings`, `protocols` (custom only), `activeProtocols`, `scheduledDoses`, `doseRecords`, `drugs` (custom only). Seed templates re-merged on hydration.

Outbox:
- Local key: `medremind-sync-outbox-v1`
- Retried on: app start, online event, visibility change, manual flush
- Protects eventual cloud durability after transient failures

---

## 11. Command-path sync and additive writes (committed)

Landed command paths in `realtimeSync.ts`:
- Dose: `syncTakeDoseCommand`, `syncSkipDoseCommand`, `syncSnoozeDoseCommand`
- Lifecycle: `syncPauseProtocolCommand`, `syncResumeProtocolCommand`, `syncCompleteProtocolCommand`, `syncArchiveProtocolCommand`

Additive write-through:
- take/skip/snooze → `execution_events`
- activation → `planned_occurrences` (`source_generation = activation_write_through_c4`)

---

## 12. Import/restore idempotency

`importStore.ts` maps non-UUID protocol-related IDs deterministically. Protects re-import idempotency for active protocols, scheduled doses, and dose records.

---

## 13. Deferred / not implemented

The following auth behaviors are NOT implemented:

| Capability | Status |
|-----------|--------|
| Deep-link forwarding after OAuth | Not implemented. Callback always goes to `/app` or `/onboarding`. |
| Apple Sign-In | **Removed permanently.** Apple button deleted from login/register pages. Provider type narrowed to `'google'` only. No Apple re-integration planned. |
| Provider-specific OAuth error messages | Not implemented. All OAuth failures → generic `'Sign-in failed. Please try again.'` |
| Account linking / conflict detection | Not implemented. Supabase auto-link behavior depends on dashboard config (unverified). |
| Password reset flow | Not implemented. No code for `resetPasswordForEmail` or update-password page. |
| Session expiry handling in-app | Not implemented. Expired sessions fall through to app layout boot → redirect to login. |
| Server-side onboarding enforcement | Not implemented. Onboarding redirect is client-side only in `layout.tsx` and `callback/route.ts`. |
| Email confirmation redesign | Deferred (noted in current-status.md). |

---

## 14. Current risks requiring awareness

- Auth policy is split across two layers: `proxy.ts` (server-side route protection, invoked by `middleware.ts`) and `layout.tsx` (client-side boot gate with onboarding enforcement). `middleware.ts` explicitly delegates to `proxy()` — the relationship is self-documenting and the server-side route guard is active end-to-end.
- No account linking logic exists. Cross-provider same-email behavior depends entirely on undocumented Supabase project config. This is the primary unresolved risk for production readiness.
- DB trigger creating `profiles` row on OAuth signup is asserted in a code comment but not independently verifiable from client code.
- `profiles` row absence for OAuth users does not hard-block access but silently degrades name/timezone data.

---

## 15. OAuth verification state and readiness classification (2026-03-21, updated post-staging-verification)

### Verified

| Item | Method | Result |
|------|--------|--------|
| Production build (`next build --webpack`) | Build run | Passes. All routes compile. Zero TypeScript errors. |
| `/login` page | HTTP GET | 200, renders sign-in form |
| `/register` page | HTTP GET | 200, renders registration form |
| `/auth/callback` missing-code fallback | HTTP GET (no `?code`) | Redirects to `/login?error=oauth` as designed |
| Email auth code path | Static code review | Intact and unchanged |
| **Google OAuth end-to-end** | **Real browser, staging** | **VERIFIED LIVE. Button → Google → callback → session → app routing working correctly.** |
| CI (webpack build + Vercel source deploy) | GitHub Actions | Green. Source-based deploy confirmed working. |

### Not verified live

- Account-linking behavior for cross-provider same-email scenarios (Google OAuth user vs existing email/password account)
- Onboarding redirect for a first-time OAuth user (new Google account, no prior profile)
- Logout and re-login via Google OAuth
- `exchangeCodeForSession` failure modes with real provider codes

### Apple Sign-In

**Removed.** Apple button has been deleted from `/login` and `/register`. The `signInWithOAuth` provider type is narrowed to `'google'` only. Apple sign-in is not deferred — it is not present and not planned.

### Account-linking status

**Unverified. Potentially unsafe in production.**

Whether "Allow automatic linking" is enabled in the Supabase project (`hagypgvfkjkncznoctoq`) is unknown. Until this is confirmed enabled and tested live with a real browser:

- A user with an existing email/password account who signs in via Google with the same address may land in a duplicate empty account with no medication data.

Do not assume account linking is safe. Do not deploy OAuth to production before this is confirmed.

### Production prerequisites

All of the following must be completed before OAuth can go to production:

1. Google provider enabled in Supabase (Auth → Providers → Google) with Client ID + Secret from Google Cloud Console — **already configured for staging; production config must be verified separately**.
2. `https://<project-ref>.supabase.co/auth/v1/callback` added to the redirect URI allowlist in Google Cloud Console for the production OAuth app.
3. Supabase Auth → URL Configuration → Redirect URLs includes `https://medremind-app-two.vercel.app/auth/callback`.
4. Supabase Auth → URL Configuration → Site URL set to production domain.
5. **"Allow automatic linking" confirmed enabled in Supabase Auth → Configuration** — confirmed on, not just assumed.
6. Live browser-based verification of Google sign-in with an account that already has an email/password identity (account-linking scenario).

### Current recommendation

| Environment | Readiness |
|-------------|-----------|
| Staging | **VERIFIED WORKING** — Google OAuth verified end-to-end in browser |
| Production | **Not ready** — account-linking unverified; production Supabase config not confirmed |

PR #5 (`codex/oauth-google-apple` → `main`) is ready to merge pending account-linking verification. Merging without account-linking confirmation risks silent data loss for users who already have email/password accounts and attempt Google sign-in with the same address.
