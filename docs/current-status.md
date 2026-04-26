# MedRemind Current Status

Date: 2026-04-26
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

**OAuth on `main`:**
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

### Recent reliability hardening on main (2026-04)

- Rolling-horizon dose refresh runs on app boot after cloud pull to regenerate forward pending slots when needed (`pullStoreFromSupabase` + `regenerateDoses`).
- Supabase cloud pull for `scheduled_doses` and `dose_records` is paginated in 1000-row pages. Do not replace this with a single `.limit(...)` call: production Supabase REST can still cap the result at 1000 rows, which makes boot pull incomplete and can cause local pending dose regeneration after refresh.
- Import upsert conflict handling for `scheduled_doses` hardened in `importStore.ts`.
- Push cron reliability improved with stale-claim recovery and Pass B rollback on send failure.
- Service worker notification policy updated to context-aware `renotify` behavior to prevent silent reminder replacements.
- Dose command persistence hardened for restart-survival: fallback outbox operations are queued before direct sync settles, direct sync success removes the fallback, and scheduled-dose unique-slot conflicts resolve to the canonical cloud row.
- Zustand hydration now scrubs stale volatile dose state from older localStorage payloads; `scheduledDoses`, `doseRecords`, and `executionEvents` must not be restored from local persistence.

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

### Food diary and nutrition targets (landed 2026-04-26)

- `/app/food` now starts with nutrition target setup when the signed-in user has no target profile.
- Target setup calculates daily calories, macros, fiber, and water from body profile inputs, then lets users edit values before saving.
- Saved target profiles unlock the date-aware food diary, target progress cards, and hydration tracker.
- Food entries remain Supabase-backed, are scoped by selected diary date, and are collapsed by default until expanded for component and detailed nutrient views.
- Hydration supports quick-add manual water entries and daily water progress.
- Food delete now requires confirmation, removes the entry from the selected-day diary, and updates the day totals.

### Health and medication insights (landed 2026-04-26)

- Oura OAuth backend routes are under `/api/integrations/oura`: `connect`, `callback`, `status`, `daily`, and `disconnect`.
- Oura tokens are encrypted server-side in `user_integrations` via `supabase/007_oura_integrations.sql` and are never returned to browser routes.
- External health data is normalized through `supabase/008_external_health_snapshots.sql`, `src/lib/health/*`, and `/api/integrations/health/sync`; the boundary is source-compatible for Oura now and Apple Health later. Sync responses expose counts only.
- Medication Knowledge Layer is backed by `supabase/009_medication_knowledge.sql` and `src/lib/medKnowledge` types, safety, rules, map reader, features, OpenRouter client/config/schemas/normalizer, and evidence modules.
- OpenRouter model routing is server-side only. Prompts, evidence excerpts, and user identifiers must not be logged; structured outputs require `provider.require_parameters`.
- Correlation insight generation is backed by `supabase/010_correlation_insights.sql`, `src/lib/correlation`, and `/api/insights/correlations`.
- User consent is required before correlation generation and before read-card visibility. Correlation evidence is aggregate only.
- Progress is the primary user-facing surface for health and medication pattern cards.
- Settings is the user-facing surface for Oura connection, disconnect, and health sync controls.
- Safety rule: MedRemind must not provide direct medication-change instructions. Insights should route users toward clinician review rather than telling them to start, stop, increase, decrease, or reschedule medication.

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
- Past-date history surface uses `selectHistoryOccurrences`.

## 3. Landed migration/tooling status

Landed implementation slices on `main`:

- A1, A2, A3, A4, A5
- B1, B2, B3, B4, B5
- C1, C2, C3, C4, C5
- D1, D2, D4
- D3 tooling implementation is landed and available for operational runs

Food/nutrition schema additions:

- `supabase/005_food_intake.sql`: `food_entries` and `food_entry_components`
- `supabase/006_nutrition_targets_and_hydration.sql`: `nutrition_target_profiles` and `water_entries`

Health/insights schema additions:

- `supabase/007_oura_integrations.sql`: encrypted server-side Oura integration records
- `supabase/008_external_health_snapshots.sql`: source-compatible external health snapshots
- `supabase/009_medication_knowledge.sql`: Medication Knowledge Layer persistence
- `supabase/010_correlation_insights.sql`: aggregate correlation insight persistence

## 4. Remaining work categories

### Production readiness checks

- Verify Supabase account-linking behavior for existing email/password users signing in with Google.
- Confirm production Supabase OAuth settings and redirect allowlists.
- Run live browser verification for login/logout/re-login scenarios under production config.

### Operational (live environment execution)

- D2 dry-run/apply/rerun validation on real data.
- D3 dry-run/apply/rerun validation on real data.
- C5 parity validation runs and anomaly triage.
- D4 consistency checks and severity triage.

### Deferred larger tracks (not current behavior)

1. Auth and email-confirmation architecture redesign.
2. Domain/schedule engine redesign and test deepening.
3. UI/PWA pack audit.

### Protocol lifecycle hardening plan status (`PLAN2p`)

Reference plan: `PLAN2p.md` (external working plan used for lifecycle audit and execution sequencing)

Current status on `main` as of 2026-03-25:

- Option A (store-level lifecycle guards, local invariant alignment, timezone guard unification): **pending**
- Option B (protocols UX refinement: Current filter, archive/delete clarity, end-of-course CTA, archived label wording): **pending**
- Option C (duplicate-instance policy and broader domain evolution): **not started**, awaiting explicit product decision

Practical implication:

- The plan remains relevant.
- Priority order remains Option A → Option B → Option C.

## 5. Risks still requiring discipline

- Auth policy remains split across `src/proxy.ts` (server routing, `middleware.ts` delegates to it) and client bootstrap (`layout.tsx`).
- Store domain and sync concerns remain tightly coupled in `store.ts` (1234 lines).
- Dose persistence investigation identified a production read-path truncation: one cloud pull returned exactly 1000 scheduled doses for an account with more than 3000 rows. The paginated cloud-pull fix must be deployed and verified in an authenticated browser. See `docs/dose-persistence-handoff-2026-04-25.md`.
- Outbox remains device-local and can accumulate under prolonged failures.
- **OAuth account-linking is unverified.** If Supabase "Allow automatic linking" is not enabled on project `hagypgvfkjkncznoctoq`, a user who created an email/password account and later signs in via Google with the same address can land in a duplicate empty account (data appears missing).

## 6. Quality gate expectation for future slices

Minimum before merge:

1. `npm run build`
2. Focused behavior checks for touched scope
3. No mixed-concern commits
4. Same-branch docs update for any behavior/process changes
