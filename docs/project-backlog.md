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

### 1.1 Oura sync overhaul ✅ shipped 2026-07-12/13
**Spec:** [`docs/superpowers/plans/2026-07-10-oura-sync-overhaul.md`](superpowers/plans/2026-07-10-oura-sync-overhaul.md) (full TDD plan, 5 sequential tasks) — supersedes the 2026-07-05 version.
**Root doc:** [`docs/oura-integration-stack.md`](oura-integration-stack.md) (live audit + target architecture; still worth reading for the endpoint/data catalog, though the gap list there now reflects the pre-fix state)

Oura sync was **stalled since 2026-04-26** — the currently-deployed manual "Sync now" route wrote unconditionally to `external_health_sync_runs` before any Oura fetch happened, and that table didn't exist in production (`008_oura_analytics.sql` was written but never applied), so every sync attempt since ~2026-04-29 failed outright with a silent 502. All 5 tasks shipped, merged to `main`, and deployed to production; migrations `008` + `020`–`022` applied.

| Task | What | Migration | PR |
|---|---|---|---|
| T1 | Applied `supabase/008_oura_analytics.sql` to production (written, never run) | `008` (applied) | ops-only, no PR |
| T2 | Extracted sync engine → `/api/cron/oura-sync`, fixed `markHealthConnectionSyncSuccess` status-reset bug, reused existing `'daily'` sync type | none | [#76](https://github.com/petermkey/medremind-app/pull/76) |
| T3 | Phase A: real `vO2_max` / `daily_resilience` / `daily_cardiovascular_age` endpoints (replaces the non-existent `heart_health` call that always 404s) | `020_oura_heart_fields.sql` (applied) | [#80](https://github.com/petermkey/medremind-app/pull/80) (supersedes closed #77) |
| T4 | Phase B: sleep-detail fetch (HRV, efficiency, latency, deep/REM minutes, respiratory rate) → featureBuilder | `021_oura_sleep_detail.sql` (applied) | [#78](https://github.com/petermkey/medremind-app/pull/78) |
| T5 | Phase C: `enhanced_tag` → `oura_tags` table + correlation features (`caffeineTagged`/`alcoholTagged`/`saunaTagged`/`ouraTagCount`, registered in `engine.ts` FEATURES) | `022_oura_tags.sql` (applied) | [#79](https://github.com/petermkey/medremind-app/pull/79) |

**⚠️ Still open — one manual owner action:** `/api/cron/oura-sync` is deployed and CRON_SECRET-gated but has **no external scheduler wired up yet** (same situation P-5's healthcheck route was in). Create a cron-job.org job — `GET https://medremind-app-two.vercel.app/api/cron/oura-sync`, header `Authorization: Bearer <CRON_SECRET>` (Vercel prod value, not `.env.local`'s — they differ by design), every 6h, same account as job #7402449 (`/api/cron/notify`). Trigger once manually after creating it, then verify `external_health_daily_snapshots` keeps growing past 2026-07-12.

Two deferred Minor items from the final review (not blocking, low priority): `daily_lifestyle_snapshots`'s column whitelist (`src/lib/correlation/persistence.ts`) doesn't yet persist the new sleep/heart/tag fields — harmless today since correlation cards build from the in-memory snapshot, but note if that table is ever made authoritative; tag-type substring matching (`includes('caffeine')` etc. in `featureBuilder.ts`) is unverified against a live Oura `enhanced_tag` payload — check once real tag data exists.

**Migration numbers `020`–`022` are now taken by this work.** [§1.2](#12-wellbeing--nutrition-feature-backlog) below claims the same numbers for its own (unstarted) migrations — renumber those to `023`–`025` when that backlog starts.

### 1.2 Wellbeing & nutrition feature backlog
**Spec:** [`docs/backlog-wellbeing-features.md`](backlog-wellbeing-features.md) (5 features, full architecture per feature)

| Wave | Feature | Migration | Effort |
|---|---|---|---|
| 1 | B4 Wellbeing check-ins («Дневник самочувствия в 1 тап») | `024_wellbeing_checkins.sql`† | S–M |
| 1 | B3 Eating window («Пищевое окно и циркадное питание») | none | S |
| 2 | B1 Nutrient balance («Дефициты и дубли: питание ↔ стек») ⭐ flagship | `023_supplement_nutrient_facts.sql`† | M–L |
| 3 | B5 Close the gap («Чем закрыть день») | none | S–M |
| 4 | B2 AI weekly review («AI-нутрициолог: недельный разбор») | `025_weekly_reviews.sql`† | M |

† Renumbered from the spec's original `020`–`022` — those are now taken by the shipped Oura sync overhaul (§1.1). Confirm `019`+Oura's `020`–`022` are still the last applied migrations before starting.

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
