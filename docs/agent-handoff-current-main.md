# Agent Handoff (Current Main)

Date: 2026-03-21
Audience: agents continuing work from current `main`

## 1. Source-of-truth scope

- Code source of truth: `main`.
- Process/governance source: `docs/project-rules-and-current-operating-model.md`.
- **Lifecycle behavioral specification: `docs/lifecycle-contract-v1.md`** — authoritative, platform-neutral. Read before touching any lifecycle logic.
- Behavior source: `docs/architecture-current-main.md`, `docs/auth-and-persistence-current-main.md`, `docs/domain-and-schedule-current-main.md`, `docs/current-status.md`.
- Historical snapshots in `docs/` are context only.

**Lifecycle contract note:** `src/lib/store/store.ts` is the current web implementation of the lifecycle model. It is not the contract. Do not treat Zustand store code as the authoritative specification for protocol states, dose states, persistence semantics, snooze lineage, or idempotency behavior. The lifecycle contract is the specification. Code discrepancies are bugs.

## 2. OAuth state — branch `codex/oauth-google-apple` (PR #5 open against main)

OAuth changes are committed and CI is green. This section documents the current state of that branch.

### What is committed on `codex/oauth-google-apple`

| File | Change |
|------|--------|
| `middleware.ts` (root) | Delegates to `proxy()` — SSR session refresh + route guard entry point |
| `src/app/auth/callback/route.ts` | OAuth PKCE code-exchange handler |
| `src/app/(auth)/login/page.tsx` | Google OAuth button added; email-unconfirmed resend flow with 30s cooldown |
| `src/app/(auth)/register/page.tsx` | Google OAuth button added; confirmation-pending resend flow |
| `src/lib/supabase/auth.ts` | `signInWithOAuth('google')` added; provider type narrowed to `'google'` |

**Apple sign-in: removed.** Apple button deleted from login/register pages. Not deferred — permanently removed.

### OAuth build and verification state

| Status | Detail |
|--------|--------|
| Build (`next build --webpack`) | **Passes.** All routes compile. TypeScript clean. |
| CI (GitHub Actions) | **Green.** Source-based Vercel deploy confirmed working. |
| `/login` render | Verified (HTTP 200) |
| `/register` render | Verified (HTTP 200) |
| Callback fallback | Verified — `/auth/callback` with no `?code` redirects to `/login?error=oauth` |
| **Google OAuth end-to-end** | **VERIFIED LIVE — real browser, staging environment** |
| Email auth | Verified intact and unchanged |
| **Staging readiness** | **CONFIRMED WORKING** |
| **Production readiness** | **Not ready — account-linking unverified** |

### What is NOT yet verified

- Account-linking behavior when a Google sign-in uses the same email as an existing email/password account
- Onboarding redirect for a genuinely new OAuth user (no prior profile)
- Logout and re-login via Google OAuth

### Account-linking — do not assume safe

Account linking is governed entirely by a Supabase dashboard setting ("Allow automatic linking") on project `hagypgvfkjkncznoctoq`. It is not confirmed enabled or tested live. A user who has an email/password account and signs in via Google with the same address may land in a **duplicate empty account** — medication data invisible. This is the primary production gate.

Full detail: `docs/auth-and-persistence-current-main.md` §8 and §15.

### Production prerequisites before OAuth goes live

1. Google provider confirmed enabled in Supabase production project (Client ID + Secret)
2. Production Supabase redirect URL allowlist includes `https://medremind-app-two.vercel.app/auth/callback`
3. Google Cloud Console OAuth app lists `https://<project-ref>.supabase.co/auth/v1/callback` as authorized redirect URI
4. **"Allow automatic linking" confirmed enabled** in Supabase Auth → Configuration
5. Live browser-based verification of account-linking scenario (existing email/password user signs in via Google)

### What is NOT implemented in OAuth

- Account linking / conflict detection (Supabase config governs; unverified)
- Provider-specific error messages (all failures → generic message)
- Deep-link forwarding after OAuth (always lands at `/app` or `/onboarding`)
- Password reset flow

## 3. Current product/runtime shape

- Protocol-driven medication/adherence tracking.
- Local-first store with cloud sync and outbox retry.
- Command-based lifecycle/dose sync with additive write-through coverage.
- Selector-based lifecycle-aware read paths on key screens.
- Auth: email/password + Google OAuth. Apple sign-in removed. Google OAuth committed on `codex/oauth-google-apple`, staging-verified.

## 4. Recent landed features (last 5 commits on `codex/oauth-google-apple`)

| Commit | What landed |
|--------|------------|
| `71f4975` | fix(build): force webpack bundler — generates `middleware.js.nft.json`, fixes Vercel CLI v50+ packaging |
| `f1d0cce` | fix(ci): deploy from source (removes `--prebuilt`), fixes `middleware.js.nft.json` packaging failure |
| `49bdb64` | docs(auth): remove stale middleware/proxy duplication note |
| `e053921` | feat(auth): Google and Apple OAuth with callback route and route protection fix (Apple subsequently removed) |
| `963aea1` | CI: production environment for main branch Vercel build |

## 5. Most important code surfaces

- Domain/store: `src/lib/store/store.ts`
- Sync + commands: `src/lib/supabase/realtimeSync.ts`
- Outbox: `src/lib/supabase/syncOutbox.ts`
- Auth functions: `src/lib/supabase/auth.ts`
- App layout/boot gate: `src/app/app/layout.tsx`
- Route guard: `src/proxy.ts` (server-side routing, committed on main) + `middleware.ts` (entry point, committed on `codex/oauth-google-apple`)
- OAuth callback: `src/app/auth/callback/route.ts` (committed on `codex/oauth-google-apple`)
- Cloud pull/import/backup: `src/lib/supabase/cloudStore.ts`, `src/lib/supabase/importStore.ts`

## 6. Landed migration/tooling summary

Already landed on `main`:

- A1..A5, B1..B5, C1..C5, D1, D2, D4
- D3 tooling implementation and command wiring

Operationally pending (live environment execution, not code changes):

- Live-run D2/D3 apply flow with scoped validation
- C5 parity run and D4 consistency run on real data
- Consolidated anomaly triage for rollout/decommission readiness

## 7. Mandatory execution model

1. Start from clean `main`.
2. Create one correctly named slice branch when coding.
3. Keep one concern per branch.
4. Stop/report on drift or unrelated file contamination.
5. Use `main` only for merge/cleanup/operational run tasks.

## 8. Operational run prerequisites

Required environment for D2/D3/C5/D4 scripts:

- `SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

If missing, do not run tooling; report environment not ready.
