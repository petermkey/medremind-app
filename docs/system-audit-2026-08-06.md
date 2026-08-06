# System Audit — medremind-app — 2026-08-06

**Window:** last 14 days (2026-07-23 → 2026-08-06) for time-series; all-time for structural/integrity checks.
**Method:** 5 parallel read-only diagnostic passes over the production Supabase DB (Management API, SELECT-only), cron-job.org execution history, and source-code root-cause verification of every non-trivial finding. No writes, no secrets touched.
**Instance shape:** production is effectively multi-account (96 `profiles`, 128 `active_protocols`) but has **one** real push-enabled user (the owner); the extra accounts are accumulated E2E/test profiles. Low volume on user-driven pipelines is therefore expected — findings below focus on **broken data flow and errors**, not volume.

---

## Executive summary

The core operational pipelines are **healthy**: Oura hourly sync (all 14 endpoints green, ring-battery fix holding, cron-decouple confirmed 0 timeouts), push/notify (79 sends in 14d, no phantom-push, no leaked claims), weekly-review (real reviews generating on schedule), and dose/protocol data integrity (the 2026-06-11 unlink + duplicate-slot bugs have **not** recurred; referential integrity clean).

The problems are concentrated in **secondary/derived pipelines and observability**, not in the critical path:

- **1 HIGH** — the `sync_operations` audit ledger has no crash-safety and no reaper: 43 protocol-lifecycle operations are orphaned `inflight` forever. Very likely **not** data loss (local-first re-sync reconciles the real tables), but the ledger is untrustworthy and hides whether any real mutation failed.
- **6 MEDIUM** — correlation insights only regenerate on a manual button (silently stale since 07-19); the supplement-fact validation step and the entire medication-knowledge enrichment stack (RxNorm/rules/evidence) were scaffolded but **never wired** and are inert; two Oura snapshot fields never populate; food micronutrient extraction is silently degraded; Oura sync errors are captured too opaquely to root-cause.
- **Several LOW/hygiene** — unbounded overdue-occurrence backlog, empty drug catalog, unscheduled food-model healthcheck, leftover duplicate cron jobs, test-account pollution.

Nothing here is a live outage. The HIGH item and MEDIUM items M1–M3 are "value-layer features that silently do nothing," which is the theme of this audit.

---

## Findings (ranked)

### HIGH

**H1 — `sync_operations` ledger: 43 operations orphaned `inflight`, no reaper, ledger untrustworthy.**
Evidence: all-time `succeeded 607 / inflight 43`, zero `pending`/`failed`. All 43 have `attempt_count=1`, `next_attempt_at=NULL`, `last_error=NULL`, created 2026-07-03 → 2026-07-24. Kinds: `archive_command 19`, `pause_command 8`, `resume_command 8`, `complete_command 8` (all protocol-lifecycle; dose commands are unaffected).
Root cause (verified in `src/lib/supabase/realtimeSync/activation.ts`): each command writes the ledger row `inflight`, then in a `try` does the real `active_protocols`/`protocols` mutation and marks `succeeded`, with a `catch` that marks `failed`. Because all 43 have `last_error=NULL`, **neither** branch ran — the client execution was interrupted (tab closed / navigation / network loss) between the inflight write and the mutation settling. `next_attempt_at` is written `NULL` on every path and **no server-side sweeper reads it**, so orphans are never reclaimed, retried, or dead-lettered — they are silent.
Impact: The actual protocol tables are almost certainly correct (state is authoritative on the client and re-pushed via full-state sync on next boot; the observed `active_protocols` distribution 80 active / 25 abandoned / 15 paused / 8 completed looks consistent). But the ledger cannot be trusted to reflect operation outcomes, and a genuinely failed mutation would be indistinguishable from an interrupted one. **Not confirmed data loss; confirmed observability/integrity defect.**

### MEDIUM

**M1 — Correlation insights regenerate only on a manual button; silently stale since 2026-07-19.**
Evidence: `daily_lifestyle_snapshots` 174 rows continuous 2026-01-27 → 2026-07-19 then a hard stop (0 in 14d); `correlation_insight_cards` 6 rows, latest `generated_at` 2026-07-19, 0 new in 14d. Consent **is** enabled.
Root cause (verified): `generateAndPersistCorrelationInsights` (which builds+upserts the snapshots) is called **only** from `POST /api/insights/correlations` — the Progress-page "Refresh patterns" button. There is **no cron**. 2026-07-19 is simply the last time the owner pressed it. Each press rebuilds a rolling window, which is why history looks "continuous then stops."
Impact: This is a **design gap, not a regression**. The flagship correlation feature goes stale the moment the user stops manually refreshing, with no UI signal that it's stale. Agent hypothesis of a "deploy regression" was incorrect and is corrected here.

**M2 — Supplement-fact validation never runs; Nutrient Balance & Stack Guard consume unvalidated LLM facts.**
Evidence: `supplement_nutrient_facts` 5 rows, **all** `validation_status='pending'` (0 verified, 0 rejected), model `openai/gpt-5.6-sol`.
Root cause (verified): grep shows `validation_status` is only ever **read** (`src/lib/nutrientBalance/service.ts`, `src/app/api/insights/stack-guard/route.ts`); **no code writes `verified`/`rejected`**. The medKnowledge-style validation machinery was scaffolded (column + default) but the validation step was never implemented/wired.
Impact: `nutrient_balance_reports` and Stack Guard findings are computed off never-validated LLM extractions, and the "unverified" UI chip is permanent. Correctness/safety risk for a health-interpretive feature.

**M3 — Medication-knowledge enrichment stack is inert (RxNorm/rules/evidence never ran; frozen since April).**
Evidence: `medication_normalizations` 30 rows, **all** `source='manual'`, **all** `rxnorm_rxcui NULL`, all confidence <0.5, all carry `ambiguity_notes`, latest 2026-04-26. `medication_rule_evaluations` **0 rows**. `medication_evidence_documents` **0 rows**. `daily_medication_exposures` **2 rows** (April seed). `medication_ai_runs` **0 rows all-time**. `medication_processing_jobs` 2 rows, both `medication_map_refresh`, `status=completed` in <2s, last 2026-04-26.
Impact: The medication-knowledge value layer (RxNorm resolution → rule evaluation → evidence surfacing → `medication_review_signal_count` feeding correlation) has never produced output; the refresh jobs complete as sub-2s no-ops without logging an AI run. Whole stack is dormant scaffolding.

**M4 — Oura snapshot mapper gaps: `hrv_balance` never written; 7-day `activity_score`/`non_wear_minutes` hole.**
Evidence: `hrv_balance` 0/71 non-null all-time despite `daily_readiness` fetching 336/336 successfully. `activity_score` + `non_wear_minutes` NULL for 2026-07-24 → 07-30 (7 consecutive days), populated cleanly from 07-31 onward, even though `daily_activity` reported success+docs every one of those days.
Root cause: snapshot upsert mapper omits `hrv_balance` extraction from the readiness payload (field-mapping gap); an activity-field mapping fix landed ~07-31 but the already-fetched earlier week was never backfilled.
Impact: `hrv_balance` column is dead storage; a 7-day gap in activity/wear data will skew any correlation over that window.

**M5 — Food `extended_nutrients` is silently degraded (always empty `{}`).**
Evidence: both 14-day food entries have `extended_nutrients` = empty object (0 keys); typed macros (cal/protein/carbs/fat) populate fine; model `openai/gpt-4o-mini`, schema `food-analysis-v1`.
Impact: micronutrient/extended block never persists — base macros work, the richer nutrient data (which Nutrient Balance would want) is missing. Either the model isn't returning the block or the route persists an empty placeholder.

**M6 — Oura sync error capture is too opaque to root-cause.**
Evidence: 2 failed `external_health_sync_runs` (2026-07-24 13:00, 2026-07-25 06:00), both `errors`/`counts` empty, generic message "Oura health sync failed." Transient (later runs recovered).
Impact: the top-level catch swallows the real error into a generic string with no stack/detail, so transient failures can't be diagnosed. Observability gap.

### LOW / HYGIENE

**L1 — `planned_occurrences` overdue-`planned` backlog is unbounded (no reaper).** 5,354 rows `status='planned'` with `occurrence_date < today`, oldest 2026-03-18; the one push user owns 1,009 of them. Past occurrences never transition to a terminal/expired state, so the every-minute notify cron scans an ever-growing set. Hygiene/scale, not a send failure.

**L2 — `drugs` reference table empty (0 rows).** No `protocol_items` carry a `drug_id`; the app runs entirely on free-text items. Any feature depending on the drug dictionary (autocomplete, categories, interaction lookups) has no data.

**L3 — Food-model healthcheck route deployed but unscheduled.** `/api/cron/food-model-check` exists but has no cron-job.org job; the OpenRouter model chain's health is unmonitored (the exact failure mode P-5 was meant to prevent).

**L4 — cron-job.org clutter.** Two disabled duplicate notify jobs — `#8118508 "MedRemind notifications (Copy)"` and `#7402449` — both point at `/api/cron/notify` (live job is `#7402447`). Harmless (disabled) but should be deleted.

**L5 — Test/E2E accounts pollute production data.** 96 `profiles`, 128 `active_protocols`, 2 `nutrition_target_profiles` across 2 user_ids. Also: E2E specs authenticate as the owner's **personal** account (`.env.local` `E2E_EMAIL`), writing test food/protocol data to real production tables.

**L6 (INFO, not bugs) — legitimate no-data.** `vo2_max` (needs qualifying GPS workouts), `oura_tags`/`enhanced_tag` (owner logs none), `water_entries` (1 entry in 14d), `analyses` catalog (0 rows, never seeded), no-wear days (ring not worn) — all healthy pipelines with no source data.

---

## Verified healthy (coverage audit)

- **Oura sync:** 334 success / 2 failed over 336 hourly runs; 0 stuck `running`; all 14 endpoints green; `ring_battery_level` fixed (battery 88%); snapshot fresh to today; heartrate samples every day; connection `connected`, token expires 2026-08-18; all 11 scopes incl. `ring_configuration`. Cron decouple confirmed: 37/37 fast 200s, 0 timeouts.
- **Push/notify:** 79 sends in 14d, all `notification_count>0`, 0 leaked claims, 0 duplicates; no phantom-push (the 1 push-on user has a live subscription); notify cron 50/50 OK (~4s).
- **All 4 cron jobs firing** (oura hourly, notify every-min, briefing 06:30, weekly Mon 06:00).
- **Weekly review (W4-B):** real reviews for weeks 2026-07-20 and 2026-07-27 (model `nvidia/nemotron-3-super-120b-a12b:free`, per fixes #110/#111); most-recent-completed-week present; only the first week used a mock model (expected).
- **Nutrient Balance reports:** fresh (latest 2026-08-05), single `limits_version`, no drift.
- **`daily_health_features`:** actively written through today (Oura pipeline healthy).
- **Food base extraction:** macros/components/source-tagging all clean; 0 orphan components; confidence sane.
- **Dose/protocol integrity:** 2026-06-11 unlink bug NOT recurred (0 unlinked taken/skipped in 14d); 0 duplicate slot-groups; 0 orphans; superseded chains clean; referential integrity clean.

---

## Remediation plan

Prioritized. Each item lists exact files and the intended change. Migrations are applied by the owner/orchestrator only (never by an implementing agent), always **before** merging the PR that needs them.

### P0 — trust the ledger (H1)
1. **Make the ledger crash-safe + add a reaper.** In `src/lib/supabase/realtimeSync/activation.ts` / `doses.ts` / `snooze.ts`, the terminal update already exists — the gap is interruption before it runs. Add a **stale-inflight reaper**: a small function (run on app boot alongside outbox flush, and/or in the notify cron) that finds `sync_operations` rows `status='inflight'` with `updated_at < now() - interval '10 minutes'` and reconciles them — mark `succeeded` if the target entity already matches the intended state (payload vs. live row), else `failed` with a synthetic error. This requires reading the payload's intended state and comparing to `active_protocols`/`protocols`.
2. **One-time cleanup** of the existing 43 orphans: reconcile each against its target row's current state; mark terminal accordingly. Owner-run SQL (read the payload's intended `status`, compare to the live `active_protocols.status`, set `succeeded`/`failed`).
3. **Verify no real divergence:** for the 24 `active_protocol`-targeted orphans, confirm the live `active_protocols.status` matches the payload intent; if any mismatch, that's a real lost transition to fix. (Do this during cleanup; expected result: all match.)

### P1 — stop shipping silently-dead value features (M1, M2, M3)
4. **M1 — automate correlation regeneration.** Add a scheduled regeneration so insights don't decay: either (a) a new `POST`-style cron route `/api/cron/correlation-refresh` (CRON_SECRET, `after()` decouple like the other crons, Sentry check-in) that calls `generateAndPersistCorrelationInsights` for every consented user, wired to a daily cron-job.org job; or (b) piggyback it onto the existing weekly-review cron. Gate strictly on `correlation_consents.enabled`. Also add a "last refreshed N days ago" staleness line on the Progress card.
5. **M2 — wire supplement-fact validation.** Implement the `pending → verified/rejected` step in `src/lib/nutrientBalance/` (the medKnowledge validation pattern): a deterministic validator (range/plausibility checks against `limits.ts`) that promotes facts, plus surfacing genuinely-uncertain ones as `rejected`. Until then, keep the "unverified" chip honest. Backfill-validate the 5 existing rows.
6. **M3 — decide medication-knowledge stack: finish or retire.** The RxNorm→rules→evidence chain has never run. Either (a) implement the RxNorm normalization enrichment + rule-evaluation pass + evidence ingestion and schedule the refresh, or (b) explicitly retire the dormant tables/columns and the `medication_review_signal_count` correlation feature so the code stops implying a capability that produces nothing. This is a product decision — flag to owner before building.

### P2 — data-fidelity fixes (M4, M5, M6)
7. **M4 — Oura mapper:** add `hrv_balance` extraction to the snapshot upsert mapper (`src/lib/health/*` snapshot builder); one-time backfill of `activity_score`/`non_wear_minutes` for 2026-07-24 → 07-30 from the already-stored `daily_activity` raw documents (`oura_raw_documents`).
8. **M5 — food extended nutrients:** trace `analyze-photo`/`analyze-text` → schema → persist path; confirm whether the model returns the extended block and whether the route drops it; fix so micronutrients persist (or document that `food-analysis-v1` intentionally omits them).
9. **M6 — Oura error capture:** in the oura-sync engine catch path, persist the real error (message + stage) into `external_health_sync_runs.errors` jsonb instead of the generic string, and `Sentry.captureException` with the underlying error.

### P3 — hygiene (L1–L5)
10. **L1 — occurrence reaper:** a periodic sweep transitioning long-past `planned` occurrences to a terminal/expired status (or excluding `occurrence_date < today - N` from the notify scan), to bound table growth and cron scan cost.
11. **L2 — seed `drugs`** (if the dictionary features are wanted) or remove the dependency.
12. **L3 — schedule `/api/cron/food-model-check`** as a daily cron-job.org job (owner action; same auth-header clone pattern as the others).
13. **L4 — delete cron-job.org `#8118508` and `#7402449`** (disabled duplicate notify jobs).
14. **L5 — provision a dedicated E2E account** and move `E2E_EMAIL` off the owner's personal account; optionally purge accumulated test profiles from prod.

---

## Notes on method / limits
- cron-job.org `/history` retains only ~25–50 recent runs, so cron windows were shorter than 14d (notify ≈ last hour, oura ≈ 36h); weekly-review confirmed via job `lastStatus`/`lastExecution` instead.
- Sentry issue/event history was **not** consulted (credentials not accessible from this environment); Vercel runtime logs retain only ~20–30 min and were not usable for a 14-day window. The DB's own status/error columns + cron history + code review were the evidence base.
- Two agent hypotheses were corrected against source code: the correlation "regression" (actually manual-refresh-only, M1) and the stuck-inflight "data loss" (actually ledger crash-safety gap; real data likely intact, H1).
