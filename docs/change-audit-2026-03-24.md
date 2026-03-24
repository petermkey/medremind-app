# Change Audit Report (2026-03-17 to 2026-03-24)

Date: 2026-03-24
Audience: engineering, operations, and future agents
Status: factual audit of current repository state based on docs, git history, configs, and runtime code

## 1. Executive summary

This audit covers the current implementation cycle from 2026-03-17 through 2026-03-24.

Primary conclusions:

- Current `main` contains the landed lifecycle migration, command-based sync, selector-based read model migration, progress UX improvements, iOS Web Push infrastructure, reminder re-notifications, the medication icon system, and several schedule/history interaction fixes.
- Google OAuth exists on branch `codex/oauth-google-apple` and is documented as staging-verified, but it is not merged into `main`.
- The current repository state shows documentation drift in a few places, most notably cron-job.org job identifiers and wording that can blur `main` versus pending branch state.
- The highest remaining product risk is not the schedule/lifecycle runtime on `main`, but unverified OAuth account-linking behavior for same-email users.

## 2. Audit baseline and evidence sources

Baseline:

- Period reviewed: 2026-03-17 through 2026-03-24
- Implemented branch reviewed: `main`
- Pending branch reviewed: `codex/oauth-google-apple`

Evidence sources:

- all files in `docs/`
- `README.md`
- `package.json`
- `.github/workflows/vercel.yml`
- `vercel.json`
- `supabase/*.sql`
- runtime surfaces under `src/app/api/*`, `src/lib/push/*`, `src/lib/supabase/*`
- key UI surfaces under `src/app/app/*` and `src/components/app/*`
- `git log`, `git diff`, and branch comparisons

Method:

- every major claim was cross-checked against both documentation and code or git history
- landed behavior was separated from pending branch behavior
- historical docs were used as timeline artifacts, not as authoritative truth without code verification

## 3. Timeline of changes

### 2026-03-17

- onboarding profile saves were made non-blocking
- activation flow consistency fixes began landing

### 2026-03-18

- auth-boundary persistence bleed was fixed by resetting user-scoped local state on account transitions
- outbox retry hardening landed for failed sync operations
- import/restore idempotency hardening landed
- logout race protection was added so sign-out waits for in-flight sync and then flushes the outbox
- swipe targeting on schedule rows was stabilized

### 2026-03-19

- lifecycle migration groundwork landed, including additive schema readiness
- lifecycle contract v1 became the authoritative behavioral specification
- command-based sync landed for take, skip, snooze, pause, resume, complete, and archive flows
- additive write-through landed for `execution_events` and `planned_occurrences`
- selector-based lifecycle-aware read paths landed across schedule, progress, protocol detail, calendar, and history
- D2, D3, C5, and D4 operational scripts landed
- confirmation-aware auth flows, duration validation, inclusive `endDate`, and history-safe regeneration fixes landed
- Playwright smoke coverage was added

### 2026-03-20

- Progress UX wave 1 landed
- future-date and paused-protocol action guards were tightened
- guidance toasts and schedule banners were added
- snoozed origin rows were hidden from past-day history

### 2026-03-21

- dose cards switched to display actual taken time rather than only scheduled time
- CI/build preparation for OAuth work landed
- Google OAuth work progressed on the dedicated branch

### 2026-03-22

- iOS Web Push support landed
- push scheduler and delivery routes landed
- iOS storage and subscription edge cases were hardened
- the medication icon system landed
- Vercel cron was removed in favor of an external trigger
- protocol item deletion was fixed to respect foreign-key ordering

### 2026-03-23

- push architecture and incident notes were documented
- a cron timezone/date formatting bug was fixed
- push toggle rehydration behavior in settings was fixed
- app icons were updated

### 2026-03-24

- reminder re-notifications landed
- notification send count per dose was capped at three total sends
- swipe-left delete with `today` and `forward` options landed in the schedule UI
- snooze duplication for daily medications was fixed
- deleting a dose from a history date was fixed so the card is removed correctly

## 4. Functional change ledger

### Auth and onboarding

Landed on `main`:

- email/password auth with confirmation-aware register and login flows
- resend confirmation actions with client cooldown
- app bootstrap hardening to avoid indefinite spinner lock
- auth-boundary local-state reset to prevent cross-account bleed
- sign-out guard that waits for in-flight sync and flushes the outbox

Pending on `codex/oauth-google-apple`:

- Google OAuth buttons on login and register pages
- OAuth PKCE callback route at `/auth/callback`
- root `middleware.ts` entry point delegating to `proxy()`
- Google-only provider narrowing after Apple sign-in removal

Unresolved:

- account-linking for same-email Google plus email-password users is still not verified and remains a production gate

### Lifecycle and sync

Landed on `main`:

- command-based sync for dose actions and lifecycle transitions
- additive execution write-through into `execution_events`
- activation write-through into `planned_occurrences`
- inclusive fixed-duration `endDate` handling
- future-pending-only regeneration with history preservation
- history-aware archive-on-delete behavior
- idempotent history records for handled doses

### Push and reminders

Landed on `main`:

- service worker registration and push subscription handling
- push delivery endpoint at `POST /api/push/send`
- scheduler endpoint at `GET /api/cron/notify`
- reminder re-notifications every 10 minutes while a dose remains pending or overdue
- cap of three total notifications per dose
- `notification_settings` persistence to Supabase so cron can discover push-enabled users

### Icon system

Landed on `main`:

- centralized `DOSE_FORM_ICONS`
- centralized `ROUTE_ICONS`
- `DoseForm` expansion from 10 values to 16 values
- emoji-prefixed Form and Route selects in protocol editors and add-dose flows

### Schedule, protocols, progress, and settings UX

Landed on `main`:

- progress status block, week-over-week trend, daily summary pills, and heatmap improvements
- actual taken-time display on medication cards
- swipe-right Snooze and Skip actions
- swipe-left Delete actions with `today` and `forward` scope
- fixed delete behavior on history dates
- future-date and past-date informational banners
- paused and future action guidance toasts
- inline sync error actions in settings
- app icon refresh

## 5. Public interfaces, types, and schema deltas

API surfaces confirmed in code:

- `GET /api/cron/notify`
- `POST /api/push/send`
- `GET /api/version`
- pending branch route: `GET /auth/callback`

Type and runtime surface changes:

- `DoseForm` expanded from 10 to 16 values
- `RouteOfAdmin` remains a 9-value route icon surface
- lifecycle command paths are now first-class sync operations

Database deltas:

- `supabase/003_web_push.sql` adds `push_subscriptions` and `notification_log`
- `supabase/004_reminder_notifications.sql` adds `notification_log.notification_count`
- additive lifecycle readiness lives in `supabase/002_lifecycle_schema_readiness.sql`

## 6. Stack and architecture deltas

Current stack confirmed by repository config:

- Next.js 16.1.7
- React 19.2.3
- TypeScript
- Tailwind CSS v4
- Zustand
- Supabase
- Playwright
- `web-push`

Architecture deltas over the audited period:

- build mode is now `next build --webpack`
- lifecycle behavior is explicitly governed by the lifecycle contract document
- cloud writes are organized around command-based sync and additive write-through
- read paths increasingly depend on lifecycle-aware selectors rather than legacy raw scans
- push delivery moved from deferred status to implemented runtime infrastructure

## 7. Pipeline and operations deltas

CI and deploy:

- GitHub Actions deploys to Vercel on pushes to `main` and on pull requests
- the workflow installs Vercel CLI and deploys from source
- build packaging constraints drove the switch to webpack mode

Cron and scheduler operations:

- `vercel.json` disables Vercel cron with `"crons": []`
- the scheduler is triggered externally through cron-job.org
- the scheduler uses `CRON_SECRET` bearer auth

Operational tooling chain landed on `main`:

- D2 execution-history backfill
- D3 planned-future backfill
- C5 lifecycle parity validation
- D4 lifecycle consistency checker

Intended operational run order:

1. D2
2. D3
3. C5
4. D4

## 8. Drift, contradictions, and open risks

### Documentation drift

Confirmed drift found during this audit:

- cron-job.org job identifiers were inconsistent across docs
- some wording implied `main` and a pending branch were co-equal code truth sources, which conflicts with project governance

### Governance drift in the working environment

Observed at audit time:

- unrelated untracked directories existed in the working tree: `.claude/` and `supabase/.temp/`
- these appear to be external-agent artifacts, not project-owned implementation files
- they should not be merged and should be ignored for repo-state conclusions

### Product and operational risks

- OAuth account-linking remains unverified for production use
- outbox durability remains device-local
- conflict policy is still practical last-write-wins rather than a stronger server-enforced strategy
- unit-test coverage is still absent; smoke E2E exists but is intentionally narrow

## 9. Validation checklist

Recommended manual verification commands:

1. `git log --since='2026-03-17' --oneline`
2. `git log main..codex/oauth-google-apple --oneline`
3. `git diff --name-status main...codex/oauth-google-apple`
4. `cat package.json`
5. `sed -n '1,200p' .github/workflows/vercel.yml`
6. `cat vercel.json`
7. inspect `src/app/api/cron/notify/route.ts` for `WINDOW_MINUTES`, reminder interval, and notification cap
8. inspect `supabase/003_web_push.sql` and `supabase/004_reminder_notifications.sql`
9. inspect `tests/e2e/smoke.spec.ts`
10. cross-check current-main docs against code whenever a statement distinguishes landed behavior from pending branch behavior

## 10. Bottom line

The repository shows a meaningful increase in product maturity over the audited period.
The strongest gains are in lifecycle correctness, sync durability, operational tooling, push infrastructure, and day-to-day schedule UX.

The remaining high-value work is narrower:

- clean documentation drift quickly
- keep `main` and pending-branch status distinctions explicit
- verify OAuth account-linking before any production merge of the OAuth branch
