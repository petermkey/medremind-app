# Project Backlog — medremind-app

**Date:** 2026-07-05 · **Status:** living index — update in place as items ship or new ones are found.
**Purpose:** single entry point for "what's approved/planned but not yet built" and "what known issues are deliberately deferred." Feature specs live in their own docs; this file indexes them, tracks sequencing conflicts between them, and holds the smaller fixes that never got their own doc.

---

## 1. Ready for execution

### 1.0 Production fixes 🔴 highest priority
**Sources:** [`docs/system-audit-2026-07-09.md`](system-audit-2026-07-09.md) (full audit, 3-wave plan) · [`docs/incident-food-analyze-2026-07-09.md`](incident-food-analyze-2026-07-09.md) (live-reproduced incident)

Two confirmed user-facing production breakages, both currently silent:

| # | Fix | Source | Effort | Status |
|---|---|---|---|---|
| P-1 | **Food photo analysis restore (F1):** set Vercel `OPENROUTER_FOOD_VISION_MODEL`/`_FALLBACK_MODEL` → redeploy → verify with live repro | incident F1 | 10 min | ✅ shipped (PR #70), then **re-fixed 2026-07-10**: `google/gemini-2.5-flash`/`gemini-3.5-flash` both 404 account-wide on this OpenRouter account's data-policy/guardrail settings (`openrouter.ai/settings/privacy`) — different failure than the retired-model incident. Now `google/gemma-4-31b-it:free` primary, `openai/gpt-4o-mini` fallback (both verified end-to-end against the real request shape) — PR #72 |
| P-2 | **Food model-chain hardening (F2):** append code-default model as terminal fallback; surface `food_provider_*` reason codes in client UI; fix stale README model docs | incident F2 | S | ✅ shipped (PR #70) |
| P-3 | **Phantom push fix:** zero-delivery detection (don't mark `sent:0` as delivered) + Settings warning; treat 403 as stale like 410/404; upsert-not-delete-all in `subscribeToPush`; then re-subscribe owner's device | audit §2 / Wave 0.1 | S | ✅ shipped (PR #71) |
| P-4 | **Cron heartbeat:** alert when cron-job.org silently disables (has happened before); optional Vercel Cron fallback | audit Wave 0.2 | S | ✅ shipped: `Sentry.captureCheckIn` added to `cron/notify` (monitor slug `cron-notify`), PR #73 |
| P-5 | **Model-config healthcheck (F3):** check that configured OpenRouter models actually pass a live completion call (not just `GET /models` existence — that would have missed the 2026-07-10 data-policy block) → Sentry on failure | incident F3 | S–M | ✅ route shipped: `GET /api/cron/food-model-check` (monitor slug `cron-food-model-check`), PR #73. ⚠️ **still needs a cron-job.org job wired up** (daily cadence recommended) — not yet scheduled |
| P-6 | 409 idempotent-retry log noise → `upsert(ignoreDuplicates)` (F4) | audit §6.2 / incident F4 | S | ✅ shipped (PR #70) |

All six items shipped 2026-07-09/10. Remaining follow-up: create the external cron-job.org job for P-5 (see README "CI/CD and Runtime Pipelines").

### 1.1 Oura sync overhaul ⭐ next up
**Spec:** [`docs/superpowers/plans/2026-07-10-oura-sync-overhaul.md`](superpowers/plans/2026-07-10-oura-sync-overhaul.md) (full TDD plan, 5 sequential tasks, ready for `subagent-driven-development`) — supersedes the 2026-07-05 version of this plan.
**Root doc:** [`docs/oura-integration-stack.md`](oura-integration-stack.md) (live audit + target architecture)

Oura sync has been **stalled since 2026-04-26** — only 15 snapshot days exist, starving every downstream correlation feature. It is not just "manual-only, nobody clicked the button": the currently-deployed manual "Sync now" route (`src/app/api/integrations/health/sync/route.ts`) unconditionally writes to `external_health_sync_runs` before any Oura fetch happens, and that table doesn't exist in production — so every sync attempt since ~2026-04-29 has failed outright with a silent 502. Task 1 of the new plan (pure ops, no code) fixes this first and should restore the existing button immediately; Tasks 2–5 then add cron-driven sync and widen the data pulled.

| Task | What | Migration |
|---|---|---|
| T1 | Apply `supabase/008_oura_analytics.sql` to production (written, never run) — unblocks the already-deployed manual sync | none (applies existing 008) |
| T2 | Extract sync engine → `/api/cron/oura-sync` (cron-job.org, 6h), fix `markHealthConnectionSyncSuccess` status-reset bug, reuse existing `'daily'` sync type | none |
| T3 | Phase A: real `vO2_max` / `daily_resilience` / `daily_cardiovascular_age` endpoints (replaces the non-existent `heart_health` call that always 404s) | `020_oura_heart_fields.sql` |
| T4 | Phase B: sleep-detail fetch (HRV, efficiency, latency, deep/REM minutes, respiratory rate) → featureBuilder | `021_oura_sleep_detail.sql` |
| T5 | Phase C: `enhanced_tag` → `oura_tags` table + boolean correlation features | `022_oura_tags.sql` |

Branches: `codex/oura-cron-sync` → `codex/oura-heart-endpoints` → `codex/oura-sleep-detail` → `codex/oura-tags` (T1 is ops-only, no branch; T2–T5 sequential — all touch the same engine). Orchestrator applies migrations after each merge.

**⚠️ Migration number collision:** this plan claims `020–022`. [§1.2](#12-wellbeing--nutrition-feature-backlog) claims the *same* numbers for its own migrations. **Whichever of the two starts implementation first keeps 020–022; the other must renumber its migrations to the next free slot at that time.** Neither has been applied yet (`019` is the last migration actually run against prod), so no data conflict exists yet — this is purely a paperwork collision to resolve at kickoff.

### 1.2 Wellbeing & nutrition feature backlog
**Spec:** [`docs/backlog-wellbeing-features.md`](backlog-wellbeing-features.md) (5 features, full architecture per feature)

| Wave | Feature | Migration | Effort |
|---|---|---|---|
| 1 | B4 Wellbeing check-ins («Дневник самочувствия в 1 тап») | `022_wellbeing_checkins.sql`† | S–M |
| 1 | B3 Eating window («Пищевое окно и циркадное питание») | none | S |
| 2 | B1 Nutrient balance («Дефициты и дубли: питание ↔ стек») ⭐ flagship | `020_supplement_nutrient_facts.sql`† | M–L |
| 3 | B5 Close the gap («Чем закрыть день») | none | S–M |
| 4 | B2 AI weekly review («AI-нутрициолог: недельный разбор») | `021_weekly_reviews.sql`† | M |

† Numbers as originally written in the spec — subject to the renumbering note in §1.1 depending on which backlog starts first.

Refill forecasting and the doctor-facing PDF report were considered and **explicitly dropped by the owner** — do not resurrect them.

---

## 2. Ideation stage — approved direction, not yet speced

These were approved in the same round as the wellbeing backlog but don't have a full architecture doc yet. Write a spec (same format as B1–B5) before scheduling either.

- **Stack Guard** — interaction/timing checks across the active supplement stack (e.g. flag two items competing for absorption, or a timing conflict with food). Shares the medKnowledge extraction machinery with B1 and should reuse the `supplement_nutrient_facts` groundwork once B1 ships it — sequence after B1, not before.
- **Correlation Insights v2** — richer surfacing of the existing correlation engine's output (currently `correlation_insight_cards`); no new data pipeline, presentation/ranking layer only.
- **Smart food-timed reminders** — reminder timing informed by meal/eating-window data (e.g. nudge an empty-stomach dose inside the B3 fasting window, or shift a with-food dose to align with the user's actual eating pattern instead of a fixed clock time). Natural follow-on to B3 (`src/lib/nutrition/eatingWindow.ts`) — do not start before B3's window math exists.

---

## 3. Deferred fixes and known follow-ups

Smaller items surfaced during audits that were deliberately left alone (not urgent, or blocked on a future trigger). Each has a trigger condition — don't action these speculatively.

| Item | Found in | Trigger to act |
|---|---|---|
| **Resume-overdue flood**: resuming a long-paused protocol will re-expose its past pending doses as overdue (no regeneration guard on resume) | PR #56 / migration 018 follow-up note | A user actually reports it after resuming a protocol paused >90 days |
| **E2E food suite account drift**: `food-e2e@example.org` slowly accumulates archived-with-history protocols across runs | PR #63 hardening notes | CI run times regress or hydration timeouts reappear — purge via the same pattern as migration 015's e2e cleanup |
| **Oura webhooks (phase 2)**: subscription lifecycle (create/renew/delete, verification challenge, client-secret headers) instead of 6-hourly polling | `docs/oura-integration-stack.md` §4.1 | User count makes 6-hourly polling wasteful — explicitly deferred, not urgent at current scale |
| **Retire deprecated Oura `tag` scope** on next OAuth consent refresh | `docs/oura-integration-stack.md` G3 (corrected in the sync-overhaul plan: the endpoint is unused, but the scope itself must stay until consent is re-requested, since it authorizes `enhanced_tag`) | Next time users are prompted to re-consent OAuth scopes |
| **Playwright E2E not in CI** — `quality` job runs unit/correlation/med-knowledge/build only; E2E is creds-gated and silently skips outside local runs | `docs/health-check-2026-06-14.md` | Decide: nightly scheduled E2E CI job, or accept manual-run-only as the standing policy |

---

## 4. Conventions (inherited from `docs/backlog-wellbeing-features.md`, apply project-wide)

1. Migrations are numbered sequentially, idempotent, applied manually via the Supabase Management API **by the orchestrator only** — never by an implementing subagent.
2. New LLM calls: OpenRouter structured `json_schema` output → schema validator → model fallback chain → coded `*_provider_*` errors → `Sentry.captureException`.
3. New user-writable entities follow the food-entry sync shape: Zustand store + outbox kind + boot-range pull + idempotent upsert.
4. Pure logic modules (date/window/engine math) stay clock-free with injected dates and register in the standalone `test:unit` harness (`daySchedule.ts` precedent).
5. New push notification types go through `/api/cron/notify`-style routes: `CRON_SECRET` bearer auth, `notification_log` dedupe, default-off user setting.
6. Every feature ships with at least one Playwright E2E test in the hardened harness (`workers: 1`, `afterEach` cleanup — PR #63) and follows the shared-account cleanup rules.
