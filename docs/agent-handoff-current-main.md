# Agent Handoff (Current Main)

Date: 2026-03-21
Audience: agents continuing work from current `main`

## 1. Source-of-truth scope

- Code source of truth: `main`.
- Process/governance source: `docs/project-rules-and-current-operating-model.md`.
- Behavior source: `docs/architecture-current-main.md`, `docs/auth-and-persistence-current-main.md`, `docs/domain-and-schedule-current-main.md`, `docs/current-status.md`.
- Historical snapshots in `docs/` are context only.

## 2. CRITICAL: Uncommitted working-tree changes on main (as of 2026-03-21)

The following files are modified or untracked but NOT yet committed:

| File | Status | What it is |
|------|--------|-----------|
| `middleware.ts` (root) | Untracked | Supabase SSR session-refresh middleware — runs on every request, refreshes session cookies for OAuth PKCE propagation. No redirect logic. |
| `src/app/auth/callback/route.ts` | Untracked (new dir `src/app/auth/`) | OAuth PKCE server-side code-exchange handler. Exchanges one-time code, queries `profiles.onboarded`, redirects to `/app` or `/onboarding`. On failure: `/login?error=oauth`. |
| `src/app/(auth)/login/page.tsx` | Modified | Added Google + Apple OAuth buttons (both call `signInWithOAuth(provider)`). Added email-unconfirmed resend flow with 30s cooldown. |
| `src/app/(auth)/register/page.tsx` | Modified | Added Google + Apple OAuth buttons. Added confirmation-pending resend flow with 30s cooldown. |
| `src/lib/supabase/auth.ts` | Modified | Added `signInWithOAuth(provider)` — calls `supabase.auth.signInWithOAuth` with `redirectTo: ${window.location.origin}/auth/callback`. Returns error string or null. |

These changes implement OAuth (Google + Apple) sign-in. They are **not on any branch** and not committed. Any agent doing work must be aware of these changes and must not overwrite them without explicit instruction.

If asked to commit/PR these changes, use branch `codex/oauth-google-apple`.

### OAuth build and verification state

| Status | Detail |
|--------|--------|
| Production build | **Passes.** `npm run build` exits 0. All 14 routes compile. TypeScript clean. |
| `/login` render | Verified (HTTP 200) |
| `/register` render | Verified (HTTP 200) |
| Callback fallback | Verified — `/auth/callback` with no `?code` redirects to `/login?error=oauth` |
| Email auth | Verified intact and unchanged |
| **Readiness** | **Staging-ready. NOT production-ready.** |

### What is NOT yet verified live

None of the following have been exercised with a real browser and configured providers:
- Google OAuth end-to-end
- Apple OAuth end-to-end
- Session exchange with a real provider code
- Middleware cookie propagation after OAuth callback
- Onboarding redirect for new OAuth user
- Returning OAuth user landing in `/app`
- Logout and re-login via OAuth
- **Account-linking behavior across any provider combination**

### Account-linking — do not assume safe

Account linking is governed entirely by a Supabase dashboard setting ("Allow automatic linking"). It is not configured or verified for this project. Until confirmed enabled and tested live, a user who has an email/password account and signs in via Google or Apple with the same address will land in a **duplicate empty account** — their medication data is invisible. This is a real production risk. Do not enable OAuth in production before this is resolved.

Full detail: `docs/auth-and-persistence-current-main.md` §8 and §15.

### Production prerequisites before OAuth goes live

1. Google provider enabled in Supabase (Client ID + Secret)
2. Apple provider enabled in Supabase (Service ID, Team ID, Key ID, private key)
3. Supabase redirect URL allowlist includes `http://localhost:3000/auth/callback` and `https://your-domain/auth/callback`
4. Provider OAuth apps list `https://<project-ref>.supabase.co/auth/v1/callback` as authorized redirect URI
5. **"Allow automatic linking" confirmed enabled** in Supabase Auth → Configuration
6. Live browser-based OAuth verification completed (all flows, all linking scenarios)

### What NOT implemented in OAuth

- Account linking / conflict detection (Supabase config governs; not verified)
- Apple private relay email handling
- Provider-specific error messages (all failures → generic message)
- Deep-link forwarding after OAuth (always lands at `/app` or `/onboarding`)
- Password reset flow

## 3. Current product/runtime shape

- Protocol-driven medication/adherence tracking.
- Local-first store with cloud sync and outbox retry.
- Command-based lifecycle/dose sync with additive write-through coverage.
- Selector-based lifecycle-aware read paths on key screens.
- Auth: email/password + Google OAuth + Apple OAuth (OAuth portion uncommitted).

## 4. Recent landed features (last 5 commits)

| Commit | What landed |
|--------|------------|
| `963aea1` | CI: production environment for main branch Vercel build |
| `808b1f8` / `f97505d` | fix: "Taken at HH:MM AM/PM" on dose cards uses `getHours/getMinutes` (locale-safe) |
| `90466ca` / `1e3cfbd` | feat: display actual intake time (from `DoseRecord.recordedAt`) on dose cards instead of scheduled time |
| `5c7745b` / `ddf24f6` | feat(progress): UX wave 1 — adherence status block, week trend, today summary pills, heatmap cells for 30/60/90d, weakest-first protocol sort |
| `4927f57` | fix: show only `status === 'active'` protocols in progress breakdown |

## 5. Most important code surfaces

- Domain/store: `src/lib/store/store.ts`
- Sync + commands: `src/lib/supabase/realtimeSync.ts`
- Outbox: `src/lib/supabase/syncOutbox.ts`
- Auth functions: `src/lib/supabase/auth.ts`
- App layout/boot gate: `src/app/app/layout.tsx`
- Route guard: `src/proxy.ts` (server-side routing) + `middleware.ts` (session refresh, untracked)
- OAuth callback: `src/app/auth/callback/route.ts` (untracked)
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
