# Future Agent Guide

Date: 2026-03-21
Audience: agents starting work on this repository for the first time

## 1. Read order (mandatory)

Read in this order before touching any file:

1. `docs/project-rules-and-current-operating-model.md` — governance, branch naming, preflight rules
2. `docs/agent-handoff-current-main.md` — where things stand TODAY, including branch and PR state
3. `docs/current-status.md` — what is implemented, what is deferred, what is pending merge
4. `docs/architecture-current-main.md` — full stack, routing, persistence, auth model
5. `docs/auth-and-persistence-current-main.md` — auth flows, outbox, sign-out guard
6. `docs/domain-and-schedule-current-main.md` — protocol/dose lifecycle, selectors, snooze semantics
7. `README.md` — quick-start, env vars, available scripts

Do not read historical docs first. They are timeline artifacts. If any doc conflicts with code on `main`, code wins.

## 2. What to do first on any new task

```
1. git status                         # check clean working tree
2. git log --oneline -5               # orient on recent commits
3. git diff HEAD                      # check unstaged changes
4. Read the task docs in order above
5. Create branch: codex/<sprint-id>-<slice-name>
```

Stop and report if:
- working tree has unexplained modified or untracked files
- branch context from a prior task is still present
- required environment variables are missing for operational tasks

## 3. Known branch state (as of 2026-03-21)

Branch `codex/oauth-google-apple` is open as PR #5 against `main`. It is **committed and CI-green**. The main working tree is clean.

| What | State |
|------|-------|
| Google OAuth (login + register + callback + middleware) | Committed on `codex/oauth-google-apple` |
| Apple sign-in | **Removed permanently** — not on any branch, not deferred |
| Build command | `next build --webpack` (Turbopack removed) |
| CI | Green — source-based Vercel deploy |
| Staging | Google OAuth verified end-to-end in real browser |
| Merge gate | Account-linking verification required before production |

If your task is unrelated to OAuth: the main branch is clean; create a new branch from `main` as normal.

If your task is to verify account-linking or merge PR #5: see `docs/auth-and-persistence-current-main.md` §15.

## 4. Risk boundaries — what requires extra care

### High-risk files (domain + sync core)

- `src/lib/store/store.ts` — 1234 lines; domain logic, sync wiring, all selectors. Any change here can affect every screen. Build + E2E smoke required.
- `src/lib/supabase/realtimeSync.ts` — all cloud command paths. Changes here affect cloud durability.
- `src/app/app/layout.tsx` — auth boot gate. Bugs here cause infinite spinners or boot loops.
- `src/proxy.ts` — server route guard. Changes here affect auth boundary for all routes.

### Safe files (UI presentation layer)

- `src/app/app/page.tsx` — schedule screen rendering. UI-only changes are safe but test dose actions.
- `src/app/app/progress/page.tsx` — progress screen. Pure presentational, reads from selectors.
- `src/app/app/protocols/page.tsx` — protocols screen. Safe but verify lifecycle button wiring.
- `src/components/app/MedCard.tsx` — dose card component. Safe; test swipe gestures on mobile.

## 5. Implemented features — what exists today

### Screens and navigation
- Bottom nav: Schedule (`/app`), Protocols (`/app/protocols`), Progress (`/app/progress`), Settings (`/app/settings`)
- Week strip selector with dose-presence dots
- Per-day dose list grouped by time block (Morning/Afternoon/Evening)

### Auth
- Email/password register with email confirmation gate
- Login with email-unconfirmed detection and resend
- Google OAuth (committed on `codex/oauth-google-apple`, staging-verified, PR #5 open)
- OAuth PKCE callback route at `/auth/callback` (committed on `codex/oauth-google-apple`)
- Session refresh + route guard entry via `middleware.ts` (committed on `codex/oauth-google-apple`, delegates to `proxy()`)
- Apple sign-in: removed permanently

### Dose actions
- Take, Skip, Snooze (swipe-to-reveal on MedCard)
- Snooze options: 1 hour, this evening, tomorrow, next week
- Taken cards show actual intake time ("Taken at 2:30 PM") from `DoseRecord.recordedAt`
- Actions disabled for: future dates, paused protocol rows
- Guidance toasts for blocked actions

### Protocols
- Seed templates (cannot be deleted)
- Create custom protocol
- Edit protocol metadata and items
- Lifecycle: activate, pause, resume, complete, archive-on-delete
- Default filter: Active; filters: Active, Templates, My Protocols, All

### Progress
- Primary adherence status block (On track/Needs attention/Off track) based on 7-day adherence
- Week-over-week trend signal (±pts vs last week)
- Today summary pills (taken/left/skipped)
- Last 7 days: per-protocol rings
- Monthly pattern: heatmap cells (30/60/90d toggle)
- Per-protocol breakdown sorted weakest-first (active only)
- Adherence %, streak, active protocol count, total taken summary grid

### Settings
- Export local snapshot (JSON download)
- Backup to Supabase cloud
- Restore from cloud
- Import from local snapshot
- Flush sync now
- Sign out (guarded: waits for in-flight + outbox)

## 6. Deferred — what does NOT exist yet

- Push notifications (VAPID keys in env vars, no service worker registered)
- Email notifications
- Server-side scheduling engine
- Offline PWA (manifest present, no service worker)
- Full auth/email-confirmation redesign
- Multi-device outbox merge

## 7. Persistence model

### Local store (Zustand + persist)

Persisted keys: `profile`, `notificationSettings`, `protocols` (custom only), `activeProtocols`, `scheduledDoses`, `doseRecords`, `drugs` (custom only). Seed templates re-merged on hydration.

### Supabase tables (runtime-active)

| Table | Contents |
|-------|---------|
| `profiles` | User profile (name, timezone, ageRange, onboarded) |
| `protocols` | Custom protocol definitions |
| `protocol_items` | Protocol item definitions |
| `active_protocols` | User protocol instances |
| `scheduled_doses` | Per-day/time dose rows |
| `dose_records` | Immutable take/skip/snooze log |
| `execution_events` | Additive write-through for command paths (take/skip/snooze) |
| `planned_occurrences` | Additive future-row write-through at activation (`source_generation = activation_write_through_c4`) |
| `notification_settings` | Push/email settings per user |
| `drugs` (custom) | User-created drug entries |

Legacy tables (`scheduled_doses`, `dose_records`) remain active during migration. Additive tables (`execution_events`, `planned_occurrences`) are being backfilled via D2/D3 operational tooling.

## 8. Operational tooling scripts

Only run with `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` set. Always dry-run before apply.

| Script | npm run command | Purpose |
|--------|----------------|---------|
| `scripts/backfill-execution-history.mjs` | `npm run tool:backfill:execution-history` | D2: backfill execution_events from dose_records |
| `scripts/backfill-planned-future-occurrences.mjs` | `npm run tool:backfill:planned-future` | D3: backfill planned_occurrences from active_protocols |
| `scripts/validate-lifecycle-parity.mjs` | `npm run tool:validate:lifecycle-parity` | C5: parity validation |
| `scripts/check-lifecycle-consistency.mjs` | `node scripts/check-lifecycle-consistency.mjs` | D4: consistency checker |

Run order: D2 → D3 → C5 → D4. Stop if severe anomalies appear.

## 9. Test approach

- `npm run build` — always run before merge
- `npm run test:e2e` — Playwright E2E, run public smoke always
- `npm run test:e2e:headed` — headed mode for debugging
- No unit test suite present (gap)

## 10. Branch naming

Use: `codex/<sprint-id>-<slice-name>`

Examples:
- `codex/oauth-google-apple` (Google OAuth branch — committed, PR #5 open)
- `codex/e2-progress-week2`
- `codex/fix-snooze-edge-case`

Forbidden styles: `codex/sprint-4x-*`, `codex/lifecycle-*`, anything without sprint id after `codex/`.
