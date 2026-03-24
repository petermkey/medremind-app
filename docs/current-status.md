# MedRemind Current Status

Date: 2026-03-22
Owner: engineering runtime status on current `main`

> **Lifecycle contract:** `docs/lifecycle-contract-v1.md` is the authoritative behavioral specification
> for protocol states, dose states, lifecycle transitions, persistence effects, snooze semantics, and
> idempotency. Read it before any lifecycle work. It supersedes inference from `store.ts`.

## 1. Current maturity

Overall: beta with hardened auth/session flows, lifecycle command paths, additive write-through paths, read-model selector migration, migration tooling landed, and recent UX improvements to dose cards and progress screen.

## 2. Landed behavior on main

### Auth and onboarding

**Committed (on main):**
- Email/password signup with confirmation-aware gate (`hasSession`-based).
- Email confirmation resend with 30s cooldown (login + register pages).
- Email login with unconfirmed-email detection and inline resend.
- Onboarding routing from login (`profile.onboarded ? '/app' : '/onboarding'`).
- Non-blocking profile saves in onboarding and settings.
- App-layout bootstrap hardening (no indefinite lock on auth bootstrap failure).
- Cross-account local-state reset guard on user identity changes.
- Sign-out guard sequence (waits for in-flight sync + outbox flush before sign-out).
- Server-side route guard (`src/proxy.ts`): unauthenticated `/app*` → `/login`; authenticated `/login`/`/register` → `/app`.

**Pending on branch `codex/oauth-google-apple` (PR #5, staging-verified, not merged into `main`):**
- Google OAuth — `/login` and `/register` pages have a Google button calling `signInWithOAuth('google')`.
- `signInWithOAuth` in `auth.ts` — initiates `supabase.auth.signInWithOAuth` with `redirectTo: /auth/callback`. Provider type narrowed to `'google'` only.
- `/auth/callback/route.ts` — server-side PKCE code exchange; queries `profiles.onboarded`; redirects to `/app` or `/onboarding`; falls back to `/login?error=oauth`.
- `middleware.ts` (repo root) — delegates to `proxy()` for session refresh + route guard.
- Build: `next build --webpack` (Turbopack removed — incompatible with Vercel CLI v50+ middleware packaging).
- CI: source-based Vercel deploy (no `--prebuilt` flag).
- **Apple sign-in removed permanently** — button deleted from both pages; not deferred.

**OAuth readiness classification:**
- Build: passes with `--webpack` flag. All routes compile. TypeScript clean.
- Staging: **VERIFIED WORKING** — Google OAuth verified end-to-end in real browser.
- **Not production-ready:** account-linking behavior unverified; production Supabase config not confirmed.
- Full verification state and production prerequisites: `docs/auth-and-persistence-current-main.md` §15.

**NOT implemented (deferred):**
- Account linking / cross-provider same-email conflict handling.
- Password reset flow.
- Provider-specific OAuth error messages.
- Deep-link forwarding after OAuth redirect.
- Full auth/email-confirmation architecture redesign (noted as deferred larger track).

### Dose card UX (landed 2026-03-21)

- Taken dose cards show **actual intake time** ("Taken at 2:30 PM") instead of scheduled time.
- Time display uses `getHours()/getMinutes()` — locale-safe across iOS/Android browsers.
- `MedCard` accepts `takenAt?: string` (ISO timestamp from `DoseRecord.recordedAt`).
- Schedule page builds a `doseId → recordedAt` map from `doseRecords` store and passes it per card.

### Progress screen UX wave 1 (landed 2026-03-21)

- **Primary adherence status block** at top: "On track" / "Needs attention" / "Off track" derived from 7-day adherence, with colored background signal and percentage.
- **Week-over-week trend signal**: ↑/↓/→ points vs previous week; hidden when prior-week data is absent.
- **Today summary pills**: taken / left / skipped displayed near the top.
- **Calendar heatmap** (30/60/90d toggle): colored cells (green ≥80%, yellow 50-79%, red <50%) replace month-view DayRings. DayRings retained for weekly block only.
- **Per-protocol breakdown**: sorted weakest-first; filters to `status === 'active'` protocols only.
- **Time-scoped metric labels**: "last 30d" / "days in a row" on summary grid.

### Lifecycle and schedule

- Fixed-duration validation and inclusive activation `endDate` behavior.
- Duration-change reconciliation regenerates future rows safely.
- Regeneration uses live protocol reference and preserves handled history.
- Snooze uses replacement-row semantics (original → `snoozed`, replacement → `pending`).
- Archive path is lifecycle-aware (`deleteProtocol` archives when history exists).

### Push notifications cron (landed 2026-03-22)

- Vercel Hobby plan supports daily cron only — `vercel.json` crons removed entirely.
- External cron: **cron-job.org job #7402449** calls `GET /api/cron/notify` every minute.
- Auth: `Authorization: Bearer <CRON_SECRET>` (set in Vercel env, stored in `vercel-env-import.env`).
- Fire window: ±1 min. Deduplication via `notification_log` table.
- Sync error fix: `syncProtocolItemDelete` now cascade-deletes `dose_records` → `scheduled_doses` before deleting `protocol_items` (FK constraint fix).
- Settings page: sync error shown inline with **Retry now** / **Clear outbox** buttons.

### Medication icon system (landed 2026-03-22)

- New `src/lib/icons.ts` — centralized `DOSE_FORM_ICONS` (16 entries) and `ROUTE_ICONS` (9 entries) maps keyed by `DoseForm` / `RouteOfAdmin` type.
- `DoseForm` type expanded from 10 → 16 values: added `softgel`, `spray`, `eye_drops`, `nasal_spray`, `suppository`, `lozenge`.
- Icon auto-assigned in `AddDoseSheet` from `DOSE_FORM_ICONS[doseForm]` instead of hardcoded 💊.
- Form and Route `<Select>` options across all three editors (AddDoseSheet, protocols/new, protocols/[id]) show emoji prefix beside each label.

### Protocols screen UX

- Default filter is "Active"; "All" moved to end.
- Swipe-to-reveal Edit/Delete actions on protocol rows.
- Dose actions disabled for paused protocol rows.
- Guidance toasts for blocked past-day or paused-protocol dose actions.
- Future-date lock banner and history-date info banner in schedule view.

### Command-based sync and additive write-through

- Dose commands: `syncTakeDoseCommand`, `syncSkipDoseCommand`, `syncSnoozeDoseCommand`.
- Lifecycle commands: `syncPauseProtocolCommand`, `syncResumeProtocolCommand`, `syncCompleteProtocolCommand`, `syncArchiveProtocolCommand`.
- Additive execution write-through is active for take/skip/snooze into `execution_events`.
- Activation write-through is active for future rows into `planned_occurrences` (`source_generation = activation_write_through_c4`).

### Read-model selector migration (landed)

- `/app` actionable list, next-dose, and summary metrics use selector-based paths.
- Progress uses lifecycle-aware selectors (`selectProgressSummaryForDates`, `selectProgressDayProtocolStats`, `selectProgressDayStatus`, `selectProgressProtocolWeights`).
- Protocol Detail uses `selectProtocolDetailReadModel`.
- Calendar date projection uses `selectCalendarVisibleDoseDates`.
- Past-date history surface uses `selectHistoryDayRows`.

## 3. Landed migration/tooling status

Landed implementation slices on `main`:

- A1, A2, A3, A4, A5
- B1, B2, B3, B4, B5
- C1, C2, C3, C4, C5
- D1, D2, D4
- D3 tooling implementation is landed and available for operational runs

## 4. Remaining work categories

### Work on `codex/oauth-google-apple` (pending branch, staging-verified, not merged to `main`)

- Google OAuth integration: `middleware.ts`, `src/app/auth/callback/route.ts`, login/register page updates, `signInWithOAuth` in `auth.ts`.
- Merge gate: account-linking verification required before production deploy. See `docs/auth-and-persistence-current-main.md` §15.

### Operational (live environment execution)

- D2 dry-run/apply/rerun validation on real data.
- D3 dry-run/apply/rerun validation on real data.
- C5 parity validation runs and anomaly triage.
- D4 consistency checks and severity triage.

### Deferred larger tracks (not current behavior)

1. Auth and email-confirmation architecture redesign.
2. Domain/schedule engine redesign and test deepening.
3. UI/PWA pack audit.

## 5. Risks still requiring discipline

- Auth policy remains split across `src/proxy.ts` (server routing, `middleware.ts` delegates to it) and client bootstrap (`layout.tsx`).
- Store domain and sync concerns remain tightly coupled in `store.ts` (1234 lines).
- Outbox remains device-local and can accumulate under prolonged failures.
- **OAuth account-linking is unverified.** If Supabase "Allow automatic linking" is not enabled on project `hagypgvfkjkncznoctoq`, a user who created an email/password account and later signs in via Google with the same address lands in a duplicate empty account — medication data invisible. Do not merge PR #5 to production before this is confirmed enabled and tested live.

## 6. Quality gate expectation for future slices

Minimum before merge:

1. `npm run build`
2. Focused behavior checks for touched scope
3. No mixed-concern commits
4. Same-branch docs update for any behavior/process changes
