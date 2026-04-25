# Agent Handoff (Current Main)

Date: 2026-04-25
Audience: agents continuing work from current `main`

## 1. Source-of-truth scope

- Code source of truth: `main`.
- Process/governance source: `docs/project-rules-and-current-operating-model.md`.
- **Lifecycle behavioral specification: `docs/lifecycle-contract-v1.md`** — authoritative, platform-neutral. Read before touching any lifecycle logic.
- Behavior source: `docs/architecture-current-main.md`, `docs/auth-and-persistence-current-main.md`, `docs/domain-and-schedule-current-main.md`, `docs/current-status.md`.
- **Dose persistence continuation handoff: `docs/dose-persistence-handoff-2026-04-25.md`** — latest production evidence, fixes, and next debug steps for the restart-survival issue.
- Historical snapshots in `docs/` are context only.

**Lifecycle contract note:** `src/lib/store/store.ts` is the current web implementation of the lifecycle model. It is not the contract. Do not treat Zustand store code as the authoritative specification for protocol states, dose states, persistence semantics, snooze lineage, or idempotency behavior. The lifecycle contract is the specification. Code discrepancies are bugs.

## 2. OAuth state on main

OAuth changes are merged to `main` and CI is green.

### What is committed on `main`

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
- Auth: email/password + Google OAuth. Apple sign-in removed. Google OAuth is on `main` and staging-verified.

## 4. Recent landed features (latest on main)

| Commit | What landed |
|--------|------------|
| paginated cloud-pull fix | fix(doses): paginate Supabase boot pull for `scheduled_doses` and `dose_records` so accounts above 1000 rows do not regenerate pending local doses after refresh |
| `6e47068` | production merge: stale persisted dose-state hydration scrub, deployed to `medremind-app-two.vercel.app` |
| `e0123ff` | fix(store): ignore stale `scheduledDoses`, `doseRecords`, and `executionEvents` from old localStorage payloads |
| `016d7e0` | fix(doses): make dose action fallback outbox durable before direct sync settles and resolve cloud dose slot conflicts |
| `6fd90dd` | fix(doses): recover missing scheduled dose rows before dose commands |
| `51a8d13` | fix(import): resolve scheduled_doses upsert conflict on duplicate slot |
| `8ef1a9e` | fix(doses): rolling horizon refresh on app boot |
| `965ade9` | fix(doses): lift Supabase REST 1000-row default limit to 10000 |

## 5a. Push notification infrastructure

- **Cron:** cron-job.org job `#7402449`, every minute, `GET https://medremind-app-two.vercel.app/api/cron/notify`
- **Auth:** `Authorization: Bearer <CRON_SECRET>` — value in `vercel-env-import.env`
- **Fire window:** ±1 min around scheduled_time (adjusted for lead_time_min)
- **Deduplication:** `notification_log` table (user_id + scheduled_dose_id unique)
- **Delivery:** `web-push` via `/api/push/send` → `push_subscriptions` table


## 5b. Dose persistence restart-survival status (2026-04-25)

Production SHA observed during the 2026-04-25 live browser reproduction at `https://medremind-app-two.vercel.app/api/version`: `10a05b635dd1f3c99c63e932dcaf516e1b35f3d6`. After the paginated pull fix lands, re-check `/api/version` before retesting.

Latest fixes landed:

- `016d7e0`: dose take/skip/snooze command fallback is queued before direct sync completes; unique scheduled-dose slot conflicts resolve to the canonical cloud row.
- `e0123ff`: Zustand hydration whitelists persisted slices so stale localStorage cannot restore old `scheduledDoses`, `doseRecords`, or `executionEvents`.
- Paginated cloud-pull fix: `pullStoreFromSupabase()` paginates `scheduled_doses` and `dose_records`. Live production showed one `.limit(10000)` request still returned exactly 1000 scheduled rows for a user with more than 3000 rows, causing rolling-horizon regeneration and visible pending rows after refresh.

Production DB evidence for `peter@alionuk.com` after the first fix: write path is persisting dose intake rows. On `2026-04-25`, Supabase contained 38 scheduled doses, 4 `taken` scheduled rows, 12 `taken` dose records, and successful post-deploy `take_command` sync operations with no post-deploy failures.

If the symptom persists after the paginated pull fix is deployed, continue with authenticated browser read-path verification, not a generic write-path assumption. Use `docs/dose-persistence-handoff-2026-04-25.md` as the focused continuation guide.

## 6. Most important code surfaces

- Domain/store: `src/lib/store/store.ts`
- Sync + commands: `src/lib/supabase/realtimeSync.ts`
- Outbox: `src/lib/supabase/syncOutbox.ts`
- Auth functions: `src/lib/supabase/auth.ts`
- App layout/boot gate: `src/app/app/layout.tsx`
- Route guard: `src/proxy.ts` (server-side routing, committed on main) + `middleware.ts` (entry point, committed on main)
- OAuth callback: `src/app/auth/callback/route.ts` (committed on main)
- Cloud pull/import/backup: `src/lib/supabase/cloudStore.ts`, `src/lib/supabase/importStore.ts`
- Icon registry: `src/lib/icons.ts` — `DOSE_FORM_ICONS`, `ROUTE_ICONS`

## 7. Landed migration/tooling summary

Already landed on `main`:

- A1..A5, B1..B5, C1..C5, D1, D2, D4
- D3 tooling implementation and command wiring

Operationally pending (live environment execution, not code changes):

- Live-run D2/D3 apply flow with scoped validation
- C5 parity run and D4 consistency run on real data
- Consolidated anomaly triage for rollout/decommission readiness

## 8. Mandatory execution model

1. Start from clean `main`.
2. Create one correctly named slice branch when coding.
3. Keep one concern per branch.
4. Stop/report on drift or unrelated file contamination.
5. Use `main` only for merge/cleanup/operational run tasks.

## 9. Operational run prerequisites

Required environment for D2/D3/C5/D4 scripts:

- `SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

If missing, do not run tooling; report environment not ready.
