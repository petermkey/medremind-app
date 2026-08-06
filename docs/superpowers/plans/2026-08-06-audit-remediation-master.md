# Audit Remediation 2026-08-06 — Master Multi-Agent Plan

> **For agentic workers:** this is the ORCHESTRATION index. Each workstream (WS) below is executed by an independent agent on its own branch. REQUIRED SUB-SKILL for executing a workstream: superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. Read this master first for Global Constraints, the migration ledger, and the file-ownership matrix before touching any code.

**Goal:** Fix the defects found in `docs/system-audit-2026-08-06.md` — make the sync-operations ledger trustworthy, stop shipping silently-dead value features, close the Oura/food data-fidelity gaps, and clear the hygiene backlog — without disturbing the healthy core pipelines.

**Architecture:** Same stack the audit covered. Most fixes are code + ops, not schema. Work is split into workstreams grouped into 3 waves; agents within a wave run in parallel over non-overlapping files (see ownership matrix). New scheduled work follows the established cron pattern: `CRON_SECRET` fail-closed → `Sentry.captureCheckIn(in_progress)` + `monitorConfig` upsert → `after()` decouple → per-user loop → `captureCheckIn(ok/error)` (the `src/app/api/cron/oura-sync/route.ts` shape, PR #106/#93).

**Tech Stack:** Next.js 16 App Router (`runtime='nodejs'`, `maxDuration=300`, `next/server` `after`), TypeScript strict, `@supabase/supabase-js` service-role client for cron/server, `@sentry/nextjs`, Playwright E2E, the standalone `test:unit` (tsc-compile harness) and `test:correlation` (`node --test --experimental-strip-types`) test runners.

---

## Global Constraints (apply to every workstream)

- **Branches:** `codex/rem-<ws-id>-<slug>` (e.g. `codex/rem-ws1-ledger-reaper`). NEVER push to `main` from a workstream; every WS ends in a PR. Merging a PR to `main` triggers a **production Vercel deploy** — merges are **owner-only**.
- **Before starting a WS:** `bash scripts/git-state-check.sh`; branch from fresh `origin/main`.
- **Verification gates (every WS, before PR):** `npx tsc --noEmit` && `npm run build` && `npm run test:unit` && (`npm run test:correlation` if any correlation/health/push/weeklyReview file is touched) — all pass. No `console.log` (use `console.error`/`console.warn` as the surrounding code does). No new `any`; guard external data. Conventional commits (`feat|fix|chore|refactor|test|docs:`).
- **Migrations:** numbered from **031** (026/027/029/030 taken; 028 reserved-unused). Idempotent SQL in `supabase/`. An implementing agent WRITES the migration file and STOPS — it is applied to production **by the owner/orchestrator only**, always **before** merging the PR that needs it. Method: `npx supabase db query --linked --file supabase/0XX_*.sql`.
- **cron-job.org jobs** are created/edited **by the owner only** (API key in local `cronjob-env-import.env`), AFTER the route deploys. Every new cron route ships a Sentry `captureCheckIn` + `monitorConfig` so the monitor auto-registers on first fire.
- **Production data cleanup SQL** (one-time reconciliations) is drafted by the agent as a reviewable `.sql` file under `supabase/oneoff/` and run **by the owner** — never executed by the agent (classifier blocks prod writes anyway).
- **Pure logic modules** are clock-free (inject `now`/dates), use relative imports, and register in the `test:unit` script (edit BOTH the tsc file-list and the node run-chain in `package.json`).
- **New user-facing UI copy is English** (post-PR #105 convention). LLM-generated payload content may stay Russian.
- **Read-only DB diagnostics** for verification use `npx supabase db query --linked "SQL" < /dev/null`. If the link is missing on a fresh machine: `mkdir -p supabase/.temp && printf 'hagypgvfkjkncznoctoq' > supabase/.temp/project-ref` (do NOT run `supabase link` — it hangs on an interactive prompt).

## Migration & one-off ledger (this remediation)

| # | File | Workstream | Purpose | Written by | Applied by |
|---|---|---|---|---|---|
| 031 | `supabase/031_sync_operations_reaper_index.sql` | WS1 | partial index `on sync_operations(status, updated_at) where status='inflight'` for the reaper sweep | WS1 agent | owner |
| — | `supabase/oneoff/2026-08-06-reconcile-stuck-inflight.sql` | WS1 | one-time reconcile of the 43 orphaned `inflight` rows | WS1 agent | owner |
| — | `supabase/oneoff/2026-08-06-backfill-oura-activity.sql` | WS4 | one-time backfill of `activity_score`/`non_wear_minutes` for 2026-07-24→07-30 from `oura_raw_documents` | WS4 agent | owner |
| 032 | `supabase/032_drugs_seed.sql` (only if L2 "seed" branch is chosen) | WS9 | seed the `drugs` catalog | WS9 agent | owner |

No other schema changes. M2 (`validation_status`), M6 (`errors` jsonb), M1 (reads `correlation_consents`) all use existing columns.

## File-Ownership Matrix (conflict prevention)

| Surface | WS1 | WS2 | WS3 | WS4 | WS5 | WS6 | WS7 | WS8 | WS9 |
|---|---|---|---|---|---|---|---|---|---|
| `src/lib/supabase/realtimeSync/*` | ✏️ | — | — | — | — | — | — | — | — |
| `src/lib/supabase/syncOutbox.ts` (boot hook) | ✏️ | — | — | — | — | — | — | — | — |
| new `src/lib/supabase/reconcileLedger.ts` (+test) | ✏️ | — | — | — | — | — | — | — | — |
| new `src/app/api/cron/correlation-refresh/route.ts` | — | ✏️ | — | — | — | — | — | — | — |
| `src/lib/correlation/persistence.ts` (add enumerator) | — | ✏️ | — | — | — | — | — | — | — |
| `src/app/app/progress/page.tsx` (staleness line) | — | ✏️ | — | — | — | — | — | — | — |
| new `src/lib/nutrientBalance/validateFacts.ts` (+test) | — | — | ✏️ | — | — | — | — | — | — |
| `src/lib/nutrientBalance/service.ts` | — | — | ✏️ | — | — | — | — | — | — |
| `src/lib/health/ouraDailyMapper.ts` + `persistence.ts` + `ouraSyncEngine.ts` | — | — | — | ✏️ | — | ✏️(errors only, coordinate) | — | — | — |
| food analyze schema/route + `src/lib/supabase/foodSync.ts` | — | — | — | — | ✏️ | — | — | — | — |
| new `src/lib/schedule/occurrenceReaper.ts` (+test) + notify route | — | — | — | — | — | — | ✏️ | — | — |
| medKnowledge stack (`src/lib/medKnowledge/*`, refresh route) | — | — | — | — | — | — | — | ✏️ | — |
| `supabase/032_drugs_seed.sql`, E2E env, cron ops | — | — | — | — | — | — | — | — | ✏️ |

**WS4 & WS6 both touch `ouraSyncEngine.ts`** → they are in the **same wave but must be sequenced** (WS4 merges first, WS6 rebases). Or fold WS6's error-capture change into WS4's PR. The matrix marks the overlap; the orchestrator decides. Everything else is non-overlapping within a wave.

## Waves & sequencing

- **Wave 1 (P0 + data-fidelity, parallel):** WS1 (ledger), WS4 (Oura mapper) → then WS6 (Oura errors, after WS4), WS5 (food nutrients). No cross-dependencies except WS4→WS6 file overlap.
- **Wave 2 (dead value-features, parallel):** WS2 (correlation cron), WS3 (fact validation), WS7 (occurrence reaper). Independent files.
- **Wave 3 (decision-gated + hygiene):** WS8 (medKnowledge finish-or-retire — **BLOCKED on an owner product decision**, see WS8), WS9 (hygiene bundle — mostly owner/ops).

Each wave starts after the previous wave's PRs are merged by the owner (no rebasing on a moving main mid-wave).

---

## WS1 — Ledger crash-safety + reaper + one-time reconcile (audit H1)

**Problem:** `sync_operations` rows are written `status='inflight'` then flipped to `succeeded`/`failed` by the same client execution (`realtimeSync/activation.ts`, `doses.ts`, `snooze.ts`). If the client is interrupted between the two, the row is orphaned `inflight` forever — `next_attempt_at` is always NULL and nothing sweeps it. 43 such orphans exist (all protocol-lifecycle). Real tables are likely correct (local-first re-sync); the ledger is not.

**Files:**
- Create: `src/lib/supabase/reconcileLedger.ts`
- Test: `tests/unit/reconcileLedger.test.ts` (register in `package.json` `test:unit`)
- Modify: `src/lib/supabase/syncOutbox.ts` (call the reaper on boot, alongside the existing `pumpOutbox()` path)
- Create: `supabase/031_sync_operations_reaper_index.sql`
- Create: `supabase/oneoff/2026-08-06-reconcile-stuck-inflight.sql`

**Interfaces:**
- Produces: `reconcileStuckLedgerOps(userId: string, opts?: { staleAfterMs?: number; now?: Date }): Promise<{ reconciled: number; succeeded: number; failed: number }>` — finds `sync_operations` rows for the user with `status='inflight'` and `updated_at < now - staleAfterMs` (default 10 min), compares each row's `payload` intended state to the live target row (`active_protocols`/`protocols` by `entity_id`), and updates the ledger row to `succeeded` (target matches intent) or `failed` (mismatch, `last_error='reconciled: target state diverged'`).
- Consumes: `getSupabaseClient()` from the existing realtimeSync helpers.

**Tasks:**

### Task 1: pure classifier for a stuck-inflight row
- [ ] **Step 1 — failing test** `tests/unit/reconcileLedger.test.ts`: write `classifyLedgerReconciliation(op, targetRow, now)` cases: (a) `pause_command` payload `{status:'paused'}` + target `{status:'paused'}` → `'succeeded'`; (b) same payload + target `{status:'active'}` → `'failed'`; (c) `archive_command` payload `{status:'abandoned'}` + target `{status:'abandoned'}` → `'succeeded'`; (d) target row missing (`null`) → `'failed'`; (e) row `updated_at` newer than `now-stale` → `'skip'`.
- [ ] **Step 2** run `npm run test:unit` → FAIL (`classifyLedgerReconciliation is not defined`).
- [ ] **Step 3** implement the pure `classifyLedgerReconciliation` in `reconcileLedger.ts` (no I/O; map `operation_kind`→expected target `status`, compare).
- [ ] **Step 4** run `npm run test:unit` → PASS.
- [ ] **Step 5** commit `fix: ledger reconciliation classifier (WS1)`.

### Task 2: DB-driven reaper
- [ ] **Step 1 — failing test**: with a stubbed supabase client (in-memory fake returning canned `inflight` rows + target rows), assert `reconcileStuckLedgerOps` updates the right rows to the classifier's verdict and returns correct counts; and that rows newer than the stale threshold are skipped.
- [ ] **Step 2** run → FAIL.
- [ ] **Step 3** implement `reconcileStuckLedgerOps`: select `inflight` rows past the stale threshold for the user; for each, fetch the target row by `entity_type`/`entity_id`; call the classifier; `update` the ledger row's `status`/`last_error`/`completed_at`/`updated_at`. Non-throwing per row (`console.warn` on error) so one bad row can't abort the sweep.
- [ ] **Step 4** run → PASS.
- [ ] **Step 5** commit `fix: sync_operations stale-inflight reaper (WS1)`.

### Task 3: wire the reaper into boot
- [ ] **Step 1** In `src/lib/supabase/syncOutbox.ts`, after the boot pump path, fire `void reconcileStuckLedgerOps(userId)` (best-effort, non-blocking) once per session on startup for the signed-in user.
- [ ] **Step 2** `npx tsc --noEmit` → PASS; `npm run build` → PASS.
- [ ] **Step 3** commit `fix: run ledger reaper on app boot (WS1)`.

### Task 4: reaper index migration (write-only)
- [ ] **Step 1** Write `supabase/031_sync_operations_reaper_index.sql`: `create index if not exists idx_sync_operations_inflight on sync_operations (updated_at) where status = 'inflight';`
- [ ] **Step 2** commit `chore: migration 031 reaper index (WS1) [owner-applies]`. Do NOT apply.

### Task 5: one-time reconcile SQL (write-only, owner-run)
- [ ] **Step 1** Write `supabase/oneoff/2026-08-06-reconcile-stuck-inflight.sql`: a reviewable statement that, per orphaned `inflight` row, sets `status='succeeded', completed_at=now()` where the joined `active_protocols`/`protocols` target already matches `payload->>'status'`, else `status='failed', last_error='reconciled 2026-08-06: target diverged'`. Include a preceding `SELECT` that lists the 43 rows + their target's live status for the owner to eyeball first.
- [ ] **Step 2** commit `chore: one-off reconcile for 43 stuck inflight ops (WS1) [owner-runs]`.

**Acceptance:** after owner applies 031 + the one-off + deploys: `select status, count(*) from sync_operations group by 1;` shows `inflight` = 0 (or only rows <10 min old); a deliberately-interrupted lifecycle op is reconciled within one boot cycle. **Owner action:** run 031, review+run the one-off SELECT then the UPDATE, confirm all 24 `active_protocol` targets matched intent (report any mismatch as a real lost transition).

---

## WS2 — Automate correlation regeneration (audit M1)

**Problem:** `generateAndPersistCorrelationInsights` is only called from `POST /api/insights/correlations` (the Progress "Refresh patterns" button). No cron → insights silently stale since 2026-07-19. Consent is enabled.

**Files:**
- Create: `src/app/api/cron/correlation-refresh/route.ts`
- Modify: `src/lib/correlation/persistence.ts` (add `listConsentedCorrelationUserIds()`)
- Modify: `src/app/app/progress/page.tsx` (show "insights last refreshed N days ago" + a manual refresh affordance already exists)
- Create: `tests/e2e/correlationRefresh.spec.ts` (optional smoke)

**Interfaces:**
- Produces: `listConsentedCorrelationUserIds(supabase?): Promise<string[]>` — `select user_id from correlation_consents where enabled = true`.
- Consumes: existing `generateAndPersistCorrelationInsights(userId)`.

**Tasks:**
### Task 1: consented-user enumerator
- [ ] Failing test in `src/lib/correlation/persistence` test surface (or a new `.test.mjs` registered in `test:correlation`): `listConsentedCorrelationUserIds` returns only `enabled=true` user_ids from a stubbed client. Run → FAIL → implement (single `.from('correlation_consents').select('user_id').eq('enabled', true)`) → PASS → commit.

### Task 2: cron route (decoupled)
- [ ] Create `correlation-refresh/route.ts` cloning the `oura-sync` shape: `CRON_SECRET` guard → `captureCheckIn(in_progress)` with `monitorConfig { schedule: { type:'crontab', value:'0 5 * * *' }, checkinMargin:60, maxRuntime:10, timezone:'UTC' }` (daily 05:00 UTC, before the 06:00 weekly/briefing) → `after(() => runCorrelationRefresh(checkInId))` → return `200 {triggered:true}`. `runCorrelationRefresh` loops `listConsentedCorrelationUserIds()`, calls `generateAndPersistCorrelationInsights(userId)` per user in try/catch (per-user `captureException`), then `captureCheckIn(ok)`; top-level catch → `captureCheckIn(error)`.
- [ ] `tsc` + `build` PASS → commit `feat: daily correlation-refresh cron (WS2)`.

### Task 3: staleness surfacing (UI, English copy)
- [ ] In `progress/page.tsx`, near the correlation cards, render "Insights last updated: {relativeTime(latest generatedAt)}" and, when > 2 days old, a muted "Refresh to update" hint next to the existing refresh control. Verify in the browser preview (per the verification workflow). Commit `feat: correlation staleness indicator (WS2)`.

**Acceptance:** after owner creates the cron-job.org daily job for `/api/cron/correlation-refresh` and it fires, `daily_lifestyle_snapshots` and `correlation_insight_cards` gain fresh rows dated today for consented users. **Owner action:** create the daily 05:00 UTC cron-job.org job (auth-header clone pattern).

---

## WS3 — Wire supplement-fact validation (audit M2)

**Problem:** `supplement_nutrient_facts.validation_status` is only ever READ (`nutrientBalance/service.ts`, `stack-guard/route.ts`); nothing writes `verified`/`rejected`. All rows sit `pending`; Nutrient Balance + Stack Guard consume unvalidated LLM facts.

**Files:**
- Create: `src/lib/nutrientBalance/validateFacts.ts`
- Test: `tests/unit/validateFacts.test.ts` (register in `test:unit`)
- Modify: `src/lib/nutrientBalance/service.ts` (call the validator at fact-extraction time; promote/reject before persist)

**Interfaces:**
- Produces: `validateNutrientFact(fact: { nutrients: Record<string, number>; normalizedName: string; doseAmount: number; doseUnit: string }, limits: NutrientLimits): { status: 'verified' | 'rejected'; reasons: string[] }` — deterministic plausibility check against `src/lib/nutrientBalance/limits.ts`: reject if any nutrient exceeds a hard implausibility ceiling (e.g. > N× the curated UL) or is negative/non-finite; otherwise verified.
- Consumes: the curated limits already exported by `limits.ts`.

**Tasks:**
### Task 1: deterministic validator (pure, TDD)
- [ ] Failing test `validateFacts.test.ts`: (a) plausible omega-3 fact → `verified`; (b) a fact with a nutrient at 50× its UL → `rejected` with a reason; (c) negative/NaN nutrient → `rejected`; (d) empty nutrients object → `rejected` ("no extractable nutrients"). Run → FAIL → implement `validateNutrientFact` reading `limits.ts` → PASS → commit.

### Task 2: promote at extraction time
- [ ] In `service.ts` where facts are extracted/persisted, call `validateNutrientFact` and set `validation_status` to the result (not the hard-coded `'pending'`). Keep the "unverified" UI chip meaningful for anything still `pending` from before. `tsc`/`build`/`test:unit` PASS → commit `fix: run supplement-fact validation on extract (WS3)`.

### Task 3: backfill-validate the existing rows (write-only SQL is NOT allowed by agent; use code path)
- [ ] Add a guarded one-shot: on the next Nutrient Balance computation for a user, re-validate any `pending` facts encountered and update their status. (No separate migration; reuses Task 2's path.) Document in the PR that the 5 existing rows promote on next use.

**Acceptance:** `select validation_status, count(*) from supplement_nutrient_facts group by 1;` shows rows moving off `pending`; Stack Guard/Nutrient Balance no longer rely solely on unvalidated facts.

---

## WS4 — Oura snapshot mapper: hrv_balance + activity backfill (audit M4)

**Problem:** `hrv_balance` is 0/71 in the DB even though `ouraDailyMapper.ts:85` maps `hrvBalance: stringOrNull(input.heartHealth?.hrv_balance)`. So the break is upstream (heartHealth input not populated) OR the persistence layer drops the `hrvBalance`→`hrv_balance` column write. Separately, `activity_score`/`non_wear_minutes` are NULL for 2026-07-24→07-30 (a fix landed ~07-31; earlier week un-backfilled).

**Files:**
- Investigate then Modify: `src/lib/health/ouraSyncEngine.ts` (does it pass `heartHealth` into the mapper?), `src/lib/health/ouraDailyMapper.ts`, `src/lib/health/persistence.ts` (does the upsert write `hrv_balance` from `hrvBalance`?)
- Test: extend `src/lib/health/ouraDailyMapper.test.mjs` (in `test:correlation`)
- Create: `supabase/oneoff/2026-08-06-backfill-oura-activity.sql`

**Tasks:**
### Task 0 (investigation — REQUIRED first, no guessing):
- [ ] Trace the hrv_balance path end to end and record the actual break site:
  1. `grep -n "heartHealth\|hrv_balance\|hrvBalance" src/lib/health/ouraSyncEngine.ts src/lib/health/persistence.ts` — confirm whether `ouraSyncEngine` populates `input.heartHealth` and whether `persistence` writes the `hrv_balance` column from `snapshot.hrvBalance`.
  2. Query one recent raw doc: `... db query --linked "select payload->'heart_health' from oura_raw_documents where endpoint like '%heart%' order by fetched_at desc limit 1;"` to confirm Oura actually returns an `hrv_balance` field for this user.
  - The fix location is whichever of {engine wiring, mapper input, persistence column write} the trace identifies. Do NOT edit before this step pins it.

### Task 1: failing test at the identified break site
- [ ] Add a `ouraDailyMapper.test.mjs` case asserting `hrvBalance` maps from a representative `heart_health` payload; if the break is in persistence, add/extend a persistence-layer test that the `hrv_balance` column receives `snapshot.hrvBalance`. Run the relevant runner → FAIL.

### Task 2: fix + pass
- [ ] Apply the minimal fix at the pinned site → `npm run test:correlation` PASS → `tsc`/`build` PASS → commit `fix: persist Oura hrv_balance (WS4)`.

### Task 3: activity backfill one-off (write-only, owner-run)
- [ ] Write `supabase/oneoff/2026-08-06-backfill-oura-activity.sql`: for `external_health_daily_snapshots` rows 2026-07-24→07-30 with NULL `activity_score`/`non_wear_minutes`, re-derive from the stored `oura_raw_documents` `daily_activity` payload (`score`, `non_wear_time`) and UPDATE. Include a preceding SELECT to preview. Commit `chore: one-off Oura activity backfill 07-24→07-30 (WS4) [owner-runs]`.

**Acceptance:** new snapshots populate `hrv_balance`; `select count(*) filter (where hrv_balance is not null) from external_health_daily_snapshots where local_date > '<deploy-date>';` grows; the 7-day activity hole fills after the owner runs the backfill.

---

## WS5 — Food extended_nutrients persistence (audit M5)

**Problem:** `food_entries.extended_nutrients` is always an empty `{}`; base macros populate fine.

**Files:**
- Investigate then Modify: the food analyze schema (`src/lib/food/analyze/*` — the structured-output schema + validator), the analyze route(s) (`src/app/api/food/analyze-photo/route.ts`, `analyze-text/route.ts`), and `src/lib/supabase/foodSync.ts` (the persist path that writes `extended_nutrients`).
- Test: the food analyze schema/unit test surface.

**Tasks:**
### Task 0 (investigation — REQUIRED first):
- [ ] Determine whether (a) the OpenRouter `json_schema` even requests an extended/micronutrient block, (b) the validator strips it, or (c) `foodSync.ts` writes `{}` regardless. `grep -n "extended_nutrients\|micronutrient\|extendedNutrients" src/lib/food/analyze/*.ts src/lib/supabase/foodSync.ts` and read the schema. Record the actual cause.

### Task 1–2: fix at the pinned site (TDD)
- [ ] Add a failing unit test asserting a model response containing an extended block persists non-empty `extended_nutrients`; fix the schema/validator/persist path so it round-trips; PASS. If the product intent is that `food-analysis-v1` omits micronutrients, INSTEAD document that decision in the PR and remove the empty-`{}` write (store `null`), plus a one-line note in the food analyze module. Commit `fix: persist food extended nutrients (WS5)` (or `docs: clarify food-analysis-v1 omits micronutrients`).

**Acceptance:** a fresh photo/text analysis persists a populated `extended_nutrients` (or an explicit, documented `null`), verified by querying the newest `food_entries` row.

---

## WS6 — Oura sync error capture (audit M6) — sequence after WS4

**Problem:** failed `external_health_sync_runs` carry only the generic string "Oura health sync failed." with empty `errors`/`counts`; real cause is unrecoverable.

**Files:** Modify `src/lib/health/ouraSyncEngine.ts` (the top-level catch that writes the run row).

**Tasks:**
- [ ] **Task 1:** In the sync-run catch, write the real error into the `errors` jsonb (`{ message, stage, endpoint? }`) and `Sentry.captureException(err, { tags: { route:'cron/oura-sync', stage } })` with the underlying error, instead of collapsing to a generic string. Add/extend a unit test on the error-shaping helper if one is extractable; otherwise verify via `tsc`/`build`. Commit `fix: capture real Oura sync errors in run row (WS6)`.

**Acceptance:** a forced failure records a specific `errors` payload (verify on next real/forced failure).

---

## WS7 — Occurrence backlog reaper (audit L1)

**Problem:** 5,354 `planned_occurrences` are `status='planned'` with `occurrence_date < today` (oldest 2026-03-18); no terminal transition, so the every-minute notify cron scans an ever-growing set.

**Files:**
- Create: `src/lib/schedule/occurrenceReaper.ts` + `tests/unit/occurrenceReaper.test.ts` (register in `test:unit`)
- Modify: `src/app/api/cron/notify/route.ts` (either exclude far-past occurrences from the scan window, or run the reaper as a bounded step)

**Tasks:**
### Task 1: pure predicate (TDD)
- [ ] `isReapableOccurrence(occ: { status: string; occurrence_date: string }, today: string, graceDays: number): boolean` → true when `status='planned'` and `occurrence_date < today - graceDays` (default 2). Failing test → implement → PASS → commit.

### Task 2: bounded reaper + notify scan bound
- [ ] Add a reaper that, per run (capped, e.g. 500 rows/run), transitions reapable occurrences to a terminal status (reuse an existing status like `'cancelled'` if a new enum value would need a migration — CONFIRM the allowed `status` domain first via `information_schema`/a check constraint; if `'expired'` is not allowed, use `'cancelled'` and note it). In `notify/route.ts`, add `occurrence_date >= today - interval '2 days'` to the candidate scan so cost is bounded regardless of backlog. `tsc`/`build`/`test:unit`/`test:correlation` PASS → commit `fix: bound notify scan + reap stale planned occurrences (WS7)`.

**Acceptance:** overdue-`planned` count stops growing; notify latency stays flat as history accumulates. **Owner note:** decide whether the historical 5,354 are bulk-reaped once (owner one-off) or aged out by the reaper.

---

## WS8 — Medication-knowledge stack: finish or retire (audit M3) — DECISION-GATED

**Problem:** RxNorm normalization (0 rxcui / 30 rows), `medication_rule_evaluations` (0), `medication_evidence_documents` (0), `daily_medication_exposures` (frozen since April), `medication_ai_runs` (0 all-time). The whole enrichment layer is inert scaffolding.

**⛔ BLOCKED on an owner product decision before any code:** *Finish* (build RxNorm enrichment + rule pass + evidence ingestion + schedule a refresh cron) or *Retire* (remove the dormant tables/columns + the `medication_review_signal_count` correlation feature so the code stops implying a capability that produces nothing).

- **If RETIRE (smaller, recommended default until the feature is prioritized):** WS8 removes references to the inert tables from live code paths, drops `medication_review_signal_count` from the correlation feature set (and its `featureBuilder`/`engine` wiring + tests), and writes a migration to drop the unused tables (owner-applies). One PR. TDD on the correlation-feature-set change.
- **If FINISH:** this is a multi-task sub-plan of its own (RxNorm client + normalization enrichment + rule evaluator + evidence fetcher + a scheduled refresh cron). Split into its own dated plan file rather than inlining here.

**Task 0:** Present the two branches to the owner; do not write code until they choose. Record the decision at the top of the WS8 PR.

---

## WS9 — Hygiene bundle (audit L2, L3, L4, L5) — mostly owner/ops

**Agent-doable:**
- [ ] **L2 seed (if chosen):** write `supabase/032_drugs_seed.sql` with the seed drug catalog (idempotent `insert ... on conflict do nothing`); owner applies. If the dictionary features are not wanted, INSTEAD open a PR removing the `drugs`-dependent dead code paths and note the decision.
- [ ] **L5 E2E account:** change test config so E2E authenticates a dedicated test account, not `.env.local`'s owner `E2E_EMAIL`; document the new account requirement in the test README/`docs`. (Owner provisions the account + sets the env var.)

**Owner-only (ops, documented in the PR as a checklist):**
- [ ] **L3:** create the cron-job.org daily job for `/api/cron/food-model-check` (auth-header clone pattern).
- [ ] **L4:** delete disabled duplicate cron-job.org jobs `#8118508` ("...(Copy)") and `#7402449`.
- [ ] **L5:** optionally purge accumulated test `profiles`/`active_protocols` from prod (reviewable one-off SQL under `supabase/oneoff/`).

**Acceptance:** food-model health monitored; cron list clean; E2E no longer writes to the owner's account.

---

## Owner / orchestrator action checklist (things agents cannot do)

1. Apply migrations **before merging** the PR that needs them: `031` (WS1), `032` (WS9-L2 if chosen). Method: `npx supabase db query --linked --file supabase/0XX_*.sql`.
2. Review + run the one-off SQL files (WS1 reconcile, WS4 activity backfill, WS9-L5 purge) — SELECT-preview first, then the write.
3. Create cron-job.org jobs after deploy: correlation-refresh (daily 05:00 UTC), food-model-check (daily). Delete duplicate notify jobs #8118508, #7402449.
4. Merge each wave's PRs (production deploy) in order; do not start the next wave until the prior wave is merged.
5. Provision the dedicated E2E account (WS9-L5) and set its env var.
6. Make the WS8 finish-vs-retire product decision.

## Self-review (per writing-plans)

- **Spec coverage:** H1→WS1; M1→WS2; M2→WS3; M3→WS8; M4→WS4; M5→WS5; M6→WS6; L1→WS7; L2/L3/L4/L5→WS9. All audit items mapped. ✅
- **Placeholder scan:** the two `Task 0` investigation steps (WS4 hrv_balance, WS5 extended_nutrients) are deliberate — the audit proved the fix *site* is not yet known (the mapper already maps hrv_balance), so the plan prescribes an exact trace recipe + acceptance query rather than inventing a wrong line-edit. This is honest scoping, not a placeholder. ✅
- **Type consistency:** `reconcileStuckLedgerOps`/`classifyLedgerReconciliation` (WS1), `listConsentedCorrelationUserIds` (WS2), `validateNutrientFact` (WS3), `isReapableOccurrence` (WS7) signatures are used consistently in their own workstreams; no cross-WS shared symbols except existing `generateAndPersistCorrelationInsights` (unchanged). ✅
- **Migration numbering:** 031 (WS1), 032 (WS9) — verified 026/027/029/030 are the last taken, 028 reserved-unused. ✅
