# Agent Handoff (Current Main)

Date: 2026-07-10
Audience: agents continuing work from current `main`

## 0. Start here — most recent work (2026-07-09/10)

A full stack/pipeline audit ([`docs/system-audit-2026-07-09.md`](system-audit-2026-07-09.md)) and a food-analyze incident diagnosis ([`docs/incident-food-analyze-2026-07-09.md`](incident-food-analyze-2026-07-09.md)) produced six production fixes (P-1..P-6, tracked in [`docs/project-backlog.md`](project-backlog.md) §1.0), all merged and deployed: PR #70, #71, #72, #73. Production SHA verified live via `GET /api/version` matches `main` HEAD.

**Two things a new agent must know before touching food-analyze or push:**

1. **OpenRouter data-policy landmine.** This account's `openrouter.ai/settings/privacy` settings block certain providers account-wide with a 404 whose message is `"No endpoints available matching your guardrail restrictions and data policy"` — this is a *different* failure from "model retired" (also a 404, different message). `google/gemini-2.5-flash` and `gemini-3.5-flash` are currently blocked this way; `google/gemma-4-31b-it:free` and `openai/gpt-4o-mini` are verified to pass. **Before repinning `OPENROUTER_FOOD_VISION_MODEL`/`_FALLBACK_MODEL` to any new model, test it with a live completion call** (`GET /models` existence is not sufficient — see `src/lib/food/analyze/modelHealthcheck.ts`), or wait for `GET /api/cron/food-model-check` results once it has a scheduler (see next point).
2. **P-5's healthcheck route is deployed but not scheduled.** `GET /api/cron/food-model-check` (CRON_SECRET-gated) exists and works, but no external cron-job.org job calls it yet. This is a manual owner action (cron-job.org dashboard access), not something an agent can do from the repo.

## 0a. Live pipeline status as of 2026-07-10 (verified this session)

| Pipeline | Status | Evidence |
|---|---|---|
| Vercel production deploy | ✅ live, matches `main` HEAD | `GET /api/version` |
| `cron-job.org` → `GET /api/cron/notify` | ✅ firing every ~60s, 200 OK | `vercel logs medremind-app-two.vercel.app` |
| Push delivery | ⚠️ code path correct (P-3), but **zero rows in `push_subscriptions`** even though 1 user has `notification_settings.push_enabled = true` | live DB query; Settings now shows a warning banner for this exact case — the owner needs to open `/app/settings` once and re-toggle notifications to re-create a subscription row |
| Food-analyze (OpenRouter) | ✅ verified end-to-end with the real request shape + a real image | primary (`gemma-4-31b-it:free`) was transiently 429 rate-limited at verification time, which correctly triggers fallback to `gpt-4o-mini` (200) |
| `test:unit` / `test:correlation` / `test:med-knowledge` / `tsc` / `build` | ✅ all green on latest `main` | ran directly |
| Oura sync / correlation insights | 🔴 **stalled since 2026-04-26** (known, pre-existing — not part of P-1..P-6) | `external_health_daily_snapshots`: 15 rows total, latest `local_date = 2026-04-26`; `correlation_insight_cards`: 0 rows. Tracked as `docs/project-backlog.md` §1.1 "Oura sync overhaul ⭐ next up" |

## 0b. Schema drift found this session — read before starting the Oura overhaul

`docs/superpowers/plans/2026-07-05-oura-sync-overhaul.md` references tables from `supabase/008_oura_analytics.sql` (`external_health_sync_runs`, `oura_sync_endpoint_coverage`, `oura_raw_documents`, `daily_health_features`) as if they already exist. **They do not — that migration has never been applied to production.** Confirmed live via `information_schema.tables`; only `008_external_health_snapshots.sql`'s tables (`external_health_connections`, `external_health_daily_snapshots`) and `010_correlation_insights.sql`'s tables (`correlation_consents`, `daily_lifestyle_snapshots`, `correlation_insight_cards`) exist. `019` is confirmed the last migration actually run against prod (matches the plan's own migration-collision note in `docs/project-backlog.md` §1.1).

**Before starting Task 1 of the Oura overhaul plan**, decide explicitly whether to apply `008_oura_analytics.sql` as-is or redesign it — do not assume it is already live.

## 1. Source-of-truth scope

- Code source of truth: `main`.
- Process/governance source: `docs/project-rules-and-current-operating-model.md`.
- **Lifecycle behavioral specification: `docs/lifecycle-contract-v1.md`** — authoritative, platform-neutral. Read before touching any lifecycle logic.
- Behavior source: `docs/architecture-current-main.md`, `docs/auth-and-persistence-current-main.md`, `docs/domain-and-schedule-current-main.md`.
- Production fixes and current pipeline health: this doc (§0) supersedes `docs/current-status.md` (2026-04-26) and `docs/current-status-and-next-phase.md` (2026-06-12) — those are historical snapshots only.
- Historical incident/design docs in `docs/` are timeline artifacts.

**Lifecycle contract note:** `src/lib/store/store.ts` is the current web implementation of the lifecycle model. It is not the contract. Do not treat Zustand store code as the authoritative specification for protocol states, dose states, persistence semantics, snooze lineage, or idempotency behavior. The lifecycle contract is the specification. Code discrepancies are bugs.

## 2. OAuth state on main

OAuth changes are merged to `main` and CI is green. **Production readiness: not confirmed** — account-linking behavior (existing email/password user signs in via Google with the same address) has not been live-verified since this was written 2026-04-25. Re-verify before relying on this.

Full detail: `docs/auth-and-persistence-current-main.md` §8 and §15.

## 3. Current product/runtime shape

- Protocol-driven medication/adherence tracking, local-first store with cloud sync and outbox retry.
- Command-based lifecycle/dose sync with additive write-through coverage.
- Auth: email/password + Google OAuth (staging-verified, production account-linking unverified). Apple sign-in removed.
- Food diary: photo + text AI-assisted analysis via OpenRouter (see §0 landmine above), Supabase-backed saved entries.
- Push notifications: cron-driven (`/api/cron/notify`, cron-job.org job #7402449, every minute), zero-delivery detection and stale-subscription pruning landed 2026-07-09 (P-3).
- Health/insights: Oura integration + correlation insights are landed in code but the data pipeline is stalled (§0a) — do not assume live data exists when testing these surfaces.

## 4. Most important code surfaces

- Domain/store: `src/lib/store/store.ts`
- Sync + commands: `src/lib/supabase/realtimeSync/` (split by concern: `protocols.ts`, `activation.ts`, `doses.ts`, `snooze.ts`, `helpers.ts`, barrel `index.ts`)
- Outbox: `src/lib/supabase/syncOutbox.ts`
- Auth functions: `src/lib/supabase/auth.ts`
- App layout/boot gate: `src/app/app/layout.tsx`
- Route guard: `src/proxy.ts` + `middleware.ts`
- Cloud pull/import/backup: `src/lib/supabase/cloudStore.ts`, `src/lib/supabase/importStore.ts`
- Food analyze provider chain: `src/lib/food/analyze/providers.ts`, `openRouterModels.ts`, `modelHealthcheck.ts`
- Cron routes: `src/app/api/cron/notify/route.ts` (dose reminders, Sentry heartbeat `cron-notify`), `src/app/api/cron/food-model-check/route.ts` (model healthcheck, Sentry heartbeat `cron-food-model-check`, not yet scheduled — see §0)
- Icon registry: `src/lib/icons.ts` — `DOSE_FORM_ICONS`, `ROUTE_ICONS`

## 5. Landed migration/tooling summary

Already landed and applied to production: `001`–`007`, `008_external_health_snapshots.sql`, `009_medication_knowledge.sql`, `010_correlation_insights.sql`, `011`–`019`.

**Not applied to production:** `008_oura_analytics.sql` (see §0b).

## 6. Mandatory execution model

1. Start from clean `main`.
2. Create one correctly named slice branch when coding (`codex/<sprint-id>-<slice-name>`).
3. Keep one concern per branch.
4. Stop/report on drift or unrelated file contamination.
5. Use `main` only for merge/cleanup/operational run tasks.
6. Never push directly to `main` — PR + squash-merge only. Merging to `main` triggers a production deploy.

## 7. Operational run prerequisites

Required environment for D2/D3/C5/D4 tooling scripts (`scripts/*.mjs`):

- `SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

If missing, do not run tooling; report environment not ready.
