# Feature Wave 2026-07-18 — Master Orchestration Plan

> **For agentic workers:** this is the ORCHESTRATION index. Each feature has its own detailed
> implementation plan in `docs/superpowers/plans/2026-07-18-<slug>.md` (listed below). An
> implementing agent executes exactly ONE feature plan on ONE branch and must read this master
> first for global constraints and file-ownership rules. REQUIRED SUB-SKILL for executing a
> feature plan: superpowers:executing-plans (or subagent-driven-development when orchestrated).

**Goal:** ship 9 approved features in 4 waves with independent parallel agents, without file
conflicts and without breaking the production sync/push/Oura pipelines.

**Scope decision (owner, 2026-07-18):** the previously-designed B4 wellbeing check-ins are
**dropped from this wave** (do not build; do not resurrect). Refill forecasting and the doctor
PDF report remain permanently dropped. Everything else from the 2026-07-18 review's top-10 is
in scope.

**Architecture:** Next.js 15/16 App Router + TypeScript strict, Supabase (Postgres/Auth) via
`@supabase/ssr`, Zustand persisted store + sync outbox, web-push via cron-job.org → CRON_SECRET
routes, OpenRouter structured-output LLM calls, Playwright E2E + standalone `test:unit` harness.

**Tech stack references an implementer MUST read before starting any task:**
- `CLAUDE.md` (repo root) — build/verify commands, hard rules
- `docs/project-rules-and-current-operating-model.md` — agent workflow policy
- `docs/backlog-wellbeing-features.md` — original B1/B2/B3/B5 architecture (note: its migration
  numbers are STALE, see Migration Ledger below)
- `docs/project-backlog.md` §4 — cross-cutting conventions (LLM, sync, push, testing)

---

## Global Constraints (apply to every feature plan)

- **Branches:** `codex/w<wave><letter>-<slug>` (e.g. `codex/w1a-sleep-lab`). Never push to
  `main`; every feature ends in a PR. Merging a PR to `main` triggers a production Vercel
  deploy — **merges are owner-only actions**.
- **Before starting:** run `bash scripts/git-state-check.sh`; branch from fresh `origin/main`.
- **Verification gates (every feature, before PR):** `npx tsc --noEmit` && `npm run build` &&
  `npm run test:unit` && `npm run test:correlation` (if correlation files touched) — all pass.
- **Migrations:** numbered from **026** (020–025 are TAKEN by shipped Oura work — the numbers
  printed inside `docs/backlog-wellbeing-features.md` are stale). Idempotent SQL files in
  `supabase/`. Applied to production manually **by the orchestrator/owner only** — an
  implementing agent writes the file and STOPS; it never applies migrations.
- **LLM calls:** OpenRouter structured `json_schema` → server-side validator module → model
  fallback chain → coded `*_provider_*` errors → `Sentry.captureException`. Aggregates in,
  never raw user rows. Clone the `src/lib/food/analyze/providers.ts` discipline.
- **New user-writable entities:** Zustand store + outbox kind + boot-range pull + idempotent
  upsert (the food-entry shape). No new sync patterns.
- **Pure logic modules:** clock-free, injected dates, relative imports, registered in
  `test:unit` (the `daySchedule.ts` precedent).
- **Push:** new notification types via `CRON_SECRET`-gated routes, `notification_log` dedupe,
  user-toggleable settings, **default off**.
- **Safety:** health-interpretive output carries the medKnowledge disclaimer; LLM-derived facts
  carry `validation_status`; correlation surfaces respect `correlation_consents`.
- **E2E:** ≥1 Playwright test per feature in the hardened harness (`workers: 1`, afterEach
  cleanup, shared-account rules — PR #63 precedent).
- No `console.log` in committed code; no new `any`; conventional commits.

## Migration Ledger (this wave)

| # | File | Feature | Written by | Applied by |
|---|---|---|---|---|
| 026 | `supabase/026_supplement_nutrient_facts.sql` (incl. `nutrient_balance_reports` cache table) | W2-C Nutrient Balance | W2-C agent | owner/orchestrator |
| 027 | `supabase/027_weekly_reviews.sql` | W4-B Weekly Review | W4-B agent | owner/orchestrator |
| 028 | — reserved, UNUSED (Stack Guard computes on demand per owner decision #2; number left unclaimed) | — | — | — |
| 029 | `supabase/029_notification_settings_morning_briefing.sql` (toggle column — `notification_settings` has fixed columns, no jsonb) | W3-B Morning Briefing | W3-B agent | owner/orchestrator |
| 030 | `supabase/030_notification_settings_smart_food_timing.sql` (toggle column; cron reads it via a guarded separate query so an unapplied 030 leaves notify byte-identical) | W4-A Smart Reminders | W4-A agent | owner/orchestrator |

If any plan discovers it needs an extra migration, it takes the next free number (031+) and
MUST update this ledger in its PR.

---

## Waves and Parallelism

One agent = one branch = one feature plan. Agents inside a wave run in parallel and their file
sets MUST NOT overlap (ownership matrix below). A wave starts only after the previous wave's
PRs are merged by the owner (rebasing mid-wave on a moving main is not allowed).

### Wave 1 (3 parallel agents — zero interdependencies)

| ID | Feature | Plan file | Branch |
|---|---|---|---|
| W1-A | Sleep Lab — Night detail v2 (surface stored-but-hidden Oura night fields) | `2026-07-18-sleep-lab.md` | `codex/w1a-sleep-lab` |
| W1-B | Eating Window (B3 window math + Food page mini-card + correlation features) | `2026-07-18-eating-window.md` | `codex/w1b-eating-window` |
| W1-C | Offline-first PWA (SW read-cache for app shell + today's schedule) | `2026-07-18-offline-pwa.md` | `codex/w1c-offline-pwa` |

### Wave 2 (3 parallel agents)

| ID | Feature | Plan file | Branch |
|---|---|---|---|
| W2-A | Pulse Day — intraday heartrate chart + caffeine/alcohol/sauna/dose overlays (first UI consumer of `oura_heartrate_samples` + `oura_tags`) | `2026-07-18-pulse-day.md` | `codex/w2a-pulse-day` |
| W2-B | Close the Gap (B5 — LLM meal suggestions from remaining daily targets) | `2026-07-18-close-the-gap.md` | `codex/w2b-close-the-gap` |
| W2-C | Nutrient Balance (B1 flagship — food diary × supplement stack; migration 026) | `2026-07-18-nutrient-balance.md` | `codex/w2c-nutrient-balance` |

### Wave 3 (2 parallel agents)

| ID | Feature | Plan file | Branch |
|---|---|---|---|
| W3-A | Stack Guard (absorption/timing conflicts across the active stack; consumes 026 facts) | `2026-07-18-stack-guard.md` | `codex/w3a-stack-guard` |
| W3-B | Morning Briefing (readiness-aware daily push + in-app card) | `2026-07-18-morning-briefing.md` | `codex/w3b-morning-briefing` |

### Wave 4 (SEQUENTIAL — both touch Settings/notification surfaces)

| ID | Feature | Plan file | Branch |
|---|---|---|---|
| W4-A | Smart Food-Timed Reminders (empty-stomach doses inside the fasting window; with-food doses aligned to the user's real meal pattern) | `2026-07-18-smart-food-reminders.md` | `codex/w4a-smart-food-reminders` |
| W4-B | AI Weekly Review (B2 — Monday synthesis push; migration 027; resolves the dead email-digest toggle) | `2026-07-18-weekly-review.md` | `codex/w4b-weekly-review` |

**Dependency edges (hard):**
- W4-A needs W1-B's `computeEatingWindow` (`src/lib/nutrition/eatingWindow.ts`).
- W3-A needs W2-C's `supplement_nutrient_facts` (026) + facts extractor.
- W4-B is the synthesis layer — richest after everything else; ship LAST.
- W2-A inserts its entry point into `OuraTab.tsx`, which W1-A also edits → W2-A goes after W1-A
  merges (that is why they are in different waves).

## File-Ownership Matrix (conflict prevention)

| Surface | W1-A | W1-B | W1-C | W2-A | W2-B | W2-C | W3-A | W3-B | W4-A | W4-B |
|---|---|---|---|---|---|---|---|---|---|---|
| `src/components/app/oura/*` | ✏️ | — | — | ✏️ (new files + one insertion in OuraTab) | — | — | — | — | — | — |
| `src/app/api/health/oura/summary` | ✏️ | — | — | — | — | — | — | — | — | — |
| `src/lib/nutrition/*` | — | ✏️ (new `eatingWindow.ts`) | — | — | — | — | — | — | read | — |
| `src/app/app/food/page.tsx` | — | ✏️ (mini-card) | — | — | ✏️ (button+sheet) | — | — | — | — | — |
| `src/lib/correlation/featureBuilder.ts` | — | ✏️ | — | — | — | — | — | — | — | — |
| `public/sw.js`, `src/lib/push/swRegister*` | — | — | ✏️ | — | — | — | — | — | — | — |
| `src/app/app/layout.tsx` | — | — | ✏️ (cache boot hook) | — | — | — | — | — | — | — |
| new `src/app/api/health/oura/heartrate-day` route | — | — | — | ✏️ | — | — | — | — | — | — |
| new `src/app/api/food/suggest` route | — | — | — | — | ✏️ | — | — | — | — | — |
| new `src/lib/nutrientBalance/*` + migration 026 + Progress card | — | — | — | — | — | ✏️ | read | — | — | — |
| new `src/lib/stackGuard/*` (+ progress/meds card) | — | — | — | — | — | — | ✏️ | — | — | — |
| new `src/app/api/cron/morning-briefing` + `src/lib/briefing/*` | — | — | — | — | — | — | — | ✏️ | — | — |
| `src/app/api/cron/notify/route.ts` + `src/lib/push/scheduleWindow.ts` | — | — | — | — | — | — | — | — | ✏️ | — |
| new `src/app/api/cron/weekly-review` + `src/lib/weeklyReview/*` + migration 027 | — | — | — | — | — | — | — | — | — | ✏️ |
| `src/app/app/settings/page.tsx` (toggles) | — | — | — | — | — | — | — | ✏️ (briefing toggle) | ✏️ (wave-sequenced) | ✏️ (wave-sequenced) |
| `src/app/app/progress/page.tsx` | — | — | — | — | — | ✏️ (balance card) | — | — | — | ✏️ (review section) |

W3-B vs W4-A/W4-B settings-page edits are separated by wave boundaries (merge between), so no
live conflict. Within Wave 4, A merges before B starts (sequential).

## Wave-1 note on the orphaned `/app/insights` page

W1-B (Eating Window) also OWNS the fix for the orphaned nutrition-averages page: its plan must
either link it from the Food page or fold the 7-day averages into the Food page and delete the
orphan. Decision recorded in that plan — no other agent touches `/app/insights`.

## Owner decision points (recorded defaults — implementer follows these unless owner overrides)

1. **Email digest dead-end:** W4-B REMOVES the non-functional email toggle and digest-time
   field, replacing that Settings block with the Weekly-Review push toggle (default off).
   No email provider is being added this wave.
2. **Stack Guard persistence:** default = compute on-demand server-side, no migration 028,
   unless rule-evaluation cost proves it needs caching (then take 028 per the ledger).
3. **Cron jobs** (morning briefing daily, weekly review Mon 06:00 UTC): created on cron-job.org
   by the owner/orchestrator (API key in local `cronjob-env-import.env`, see memory) AFTER the
   route is deployed — never by the implementing agent. Each new cron route ships with a Sentry
   `captureCheckIn` + `monitorConfig` upsert (the `cron/oura-sync` pattern, PR #93).

## Execution Protocol (per implementing agent)

1. Read this master plan + your feature plan end-to-end. Read the referenced docs.
2. `bash scripts/git-state-check.sh` → branch `codex/w<id>-<slug>` off fresh `origin/main`.
3. Execute the plan task-by-task, TDD, committing per task (checkbox steps in the plan).
4. Run all verification gates. Fix failures; never weaken configs to pass.
5. Push branch, open a PR titled per the plan, body = summary + test evidence. STOP — do not
   merge, do not apply migrations, do not create cron jobs.
6. Report back: PR URL, verification output, any deviations from the plan (with reasons).
