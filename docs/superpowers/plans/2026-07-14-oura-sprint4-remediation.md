# Oura Sprint 4 — Remediation: Land Sprints 1 & 3, Close Integration Gaps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the three Oura data sprints to a fully-landed, live-verified state: resolve PR #84/#86 merge conflicts, apply the outstanding migrations in the correct order, run the Sprint-1 backfill, complete the skipped live-verification steps, and get the 6-hourly sync cron actually running.

**Architecture:** No new features. Sprints 1–3 were implemented to spec (verified 2026-07-14: all three branches pass build/tsc/tests standalone and match `docs/superpowers/plans/2026-07-14-oura-sprint{1,2,3}-*.md`), but Sprint 2 (PR #85) merged first, leaving #84 (Sprint 1) conflicting in 6 files, #86 (Sprint 3) conflicting-after-#84, migrations 023/025 unapplied, the backfill unrun, and Sprint 2's live acceptance unmet. All conflict resolutions are **unions** — the sprints are additive and orthogonal; nothing from either side is dropped.

**Tech Stack:** git conflict resolution, Supabase Management API (migrations + SQL verification), cron-job.org, existing npm gates.

## Verification findings this plan remediates (audited live, 2026-07-14)

| # | Finding | Severity | Status |
|---|---|---|---|
| V-1 | Migration 024 was NOT applied to prod while #85 was already merged+deployed — first insights refresh would have thrown (`fetchSourceRows` on missing `oura_heartrate_samples`), heartrate ingestion dead | 🔴 | **Fixed during verification** — 024 applied via Management API 2026-07-14; table confirmed present. Root lesson → constraint G-1 below |
| V-2 | PR #84 (Sprint 1) conflicts with main in 6 files: `package.json`, `src/lib/correlation/{engine,featureBuilder,types}.ts`, `src/lib/correlation/featureBuilder.test.mjs`, `src/lib/health/ouraSyncEngine.ts` | 🔴 | Task 1 |
| V-3 | PR #86 (Sprint 3) merges cleanly onto current main BUT will conflict after #84 lands (`package.json`, `src/lib/health/ouraSyncEngine.ts`) | 🟠 | Task 3 |
| V-4 | Migrations 023 (Sprint 1) and 025 (Sprint 3) not applied to prod | 🟠 | Tasks 2, 4 |
| V-5 | Sprint-1 history backfill (`scripts/backfill-oura-night-detail.mjs`) never run | 🟠 | Task 2 |
| V-6 | Sprint-2 live acceptance unmet: zero rows in `oura_heartrate_samples`, no `heartrate` endpoint-coverage rows, idempotency (double-sync) unverified — no sync has run since the #85 deploy | 🟠 | Task 5 |
| V-7 | **F-3 still open**: no cron-job.org job drives `/api/cron/oura-sync` — last `daily` sync runs 2026-07-12 (manual tests), nothing since 2026-07-13 13:08 UTC | 🔴 (data starves again without it) | Task 6 |
| V-8 | `correlation_insight_cards` is empty (never generated) — pre-existing, but the insights path must be smoke-tested now that it queries `oura_heartrate_samples` | 🟡 | Task 5 |

## Global Constraints

- **G-1 (lesson from V-1): apply a PR's migration to production BEFORE (or at the moment of) merging that PR** — merged code referencing a missing table is a production incident. Migration application = Supabase Management API, project ref `hagypgvfkjkncznoctoq`, token via `security find-generic-password -s "Supabase CLI" -w | sed 's/^go-keyring-base64://' | base64 -d`, `POST https://api.supabase.com/v1/projects/$REF/database/query` with `{"query": "<file contents>"}` (build the JSON with `python3 -c "import json; print(json.dumps({'query': open('<file>').read()}))"` to avoid shell escaping).
- Never push to `main`; **merging a PR to `main` triggers a Vercel production deploy — merges are owner-only actions**; this plan marks them explicitly.
- All conflict resolutions are UNIONS of both sides. If any resolution appears to require deleting the other sprint's lines, stop — that's a mistake.
- After every resolution: `npx tsc --noEmit && npm run test:correlation && npm run test:unit && npm run build` must pass before pushing.
- TypeScript strict; no `any` without comment; conventional commits; the worktrees at `~/.config/superpowers/worktrees/medremind-app/*` hold the sprint branches — work there or `git fetch` first in the main checkout.
- `CRON_SECRET` in the repo's `.env.local` does NOT match production (verified: prod cron returns 401 with it). Production `CRON_SECRET` is a Sensitive Vercel env var — only the owner can retrieve/rotate it (Vercel → Settings → Environment Variables). Tasks needing it say so.

## File Structure

No new source files. Touched during conflict resolution only:
- `package.json` — `test:correlation` file list (union)
- `src/lib/correlation/types.ts`, `featureBuilder.ts`, `featureBuilder.test.mjs`, `engine.ts` — union of Sprint-1 and Sprint-2 additions
- `src/lib/health/ouraSyncEngine.ts` — union of Sprint-1 (nightDetail), Sprint-2 (heartrate, already on main), Sprint-3 (device status) additions

---

### Task 1: Resolve PR #84 (Sprint 1) conflicts against main

**Files:**
- Modify (on branch `codex/oura-sprint1-free-data`): the 6 conflicting files listed in V-2.

**Interfaces:**
- Consumes: main @ `155e461` (Sprint 2 merged); branch head `3eb6018`.
- Produces: PR #84 mergeable, gates green, containing BOTH sprints' changes.

- [ ] **Step 1: Merge main into the branch**

```bash
cd ~/.config/superpowers/worktrees/medremind-app/oura-sprint1-free-data \
  || { cd "/Volumes/DATA/GRAVITY REPO/medremind-app"; git checkout codex/oura-sprint1-free-data; }
git fetch origin && git merge origin/main
# expect: CONFLICT in the 6 files from V-2
```

- [ ] **Step 2: Resolve each file as a union — exact semantics:**

1. `package.json` → `test:correlation` must list ALL of (order after `engine.test.mjs` doesn't matter):
   `src/lib/correlation/stats.test.mjs src/lib/correlation/medicationSafety.test.mjs src/lib/correlation/featureBuilder.test.mjs src/lib/correlation/engine.test.mjs src/lib/health/ouraDailyMapper.test.mjs src/lib/oura/optionalFetchError.test.mjs src/lib/health/nightDetail.test.mjs src/lib/oura/heartrateSamples.test.mjs src/lib/health/doseResponse.test.mjs`
2. `src/lib/correlation/types.ts` → `DailyLifestyleSnapshot` keeps BOTH field groups: Sprint 1's `temperatureDeviation / nonWearMinutes / deepSleepFirstThirdMinutes / minutesToFirstDeepSleep / hrvRecoveryDelta` AND main's `postDoseHrDeltaBpm / daytimeAvgHr`.
3. `src/lib/correlation/featureBuilder.ts` → keep main's `doseResponseRows` input + `doseHrByDate` index + the two `postDoseHrDeltaBpm`/`daytimeAvgHr` lines, AND Sprint 1's `LOW_WEAR_MINUTES` const, `nonWearMinutes`/`lowWearDay` consts, low-wear nulling of `activityScore`/`steps`/`stressHighSeconds`/`recoveryHighSeconds`, and the five new snapshot fields.
4. `src/lib/correlation/featureBuilder.test.mjs` → keep ALL tests from both sides (Sprint 1's two + main's dose-response one).
5. `src/lib/correlation/engine.ts` → `OUTCOMES` = base ten + Sprint 1's four (`temperatureDeviation`, `deepSleepFirstThirdMinutes`, `minutesToFirstDeepSleep`, `hrvRecoveryDelta`) + main's two (`postDoseHrDeltaBpm`, `daytimeAvgHr`) = 16 entries.
6. `src/lib/health/ouraSyncEngine.ts` → keep main's heartrate machinery (`parseHeartrateRows`/`heartrateDatetimeRange` imports, `syncHeartrateSamples` fn, its call + `heartrateSamples` count) AND Sprint 1's `import { hrvRecoveryDelta, parseSleepPhaseFeatures } from '@/lib/health/nightDetail';`, `computeNightDetail()` helper, and the `nightDetail: computeNightDetail(collections.sleepPeriods.get(localDate)),` payload line.

- [ ] **Step 3: Run the full gate**

```bash
npx tsc --noEmit && npm run test:correlation && npm run test:unit && npm run build
```
Expected: tsc clean; test:correlation = 36 tests pass (27 from main + 9 from Sprint 1); build ✓.

- [ ] **Step 4: Commit and push**

```bash
git add -A && git commit -m "chore: merge main (sprint 2) into sprint 1 branch, union conflict resolution"
git push origin codex/oura-sprint1-free-data
gh pr view 84 --json mergeable --jq .mergeable   # expect MERGEABLE
```

---

### Task 2: Migration 023 → prod, owner merges #84, run the backfill

- [ ] **Step 1: Apply `supabase/023_oura_temperature_wear_night_detail.sql` to production** (G-1 pattern). Verify:

```sql
select count(*) from information_schema.columns
 where table_name='external_health_daily_snapshots' and column_name in
 ('temperature_deviation','temperature_trend_deviation','non_wear_minutes',
  'deep_sleep_first_third_minutes','minutes_to_first_deep_sleep','hrv_recovery_delta');
-- expect 6
```

- [ ] **Step 2: OWNER ACTION — merge PR #84** (production deploy follows; safe because 023 is already applied).

- [ ] **Step 3: Run the Sprint-1 backfill against prod** (from the repo root on `main` after the merge):

```bash
git checkout main && git pull
set -a && source .env.local && set +a && node --experimental-strip-types scripts/backfill-oura-night-detail.mjs
# expect: "backfilled N/N oura snapshot rows", N > 0
```

- [ ] **Step 4: Verify backfilled data** (Management API):

```sql
select count(*) filter (where temperature_deviation is not null) as temp_rows,
       count(*) filter (where deep_sleep_first_third_minutes is not null) as night_rows,
       count(*) filter (where non_wear_minutes is not null) as wear_rows,
       count(*) as total
from external_health_daily_snapshots where source='oura';
-- expect temp_rows/night_rows/wear_rows > 0 (night_rows ≤ total: only days with a main sleep period)
```

---

### Task 3: Resolve PR #86 (Sprint 3) conflicts against the new main

- [ ] **Step 1: Merge the post-#84 main into the branch**

```bash
cd ~/.config/superpowers/worktrees/medremind-app/oura-sprint3-product-touches \
  || { cd "/Volumes/DATA/GRAVITY REPO/medremind-app"; git checkout codex/oura-sprint3-product-touches; }
git fetch origin && git merge origin/main
```
Expected conflicts: `package.json` (test list) and `src/lib/health/ouraSyncEngine.ts` (adjacent additions). Possibly none if git auto-merges — still do Step 2's checks.

- [ ] **Step 2: Union resolution**

1. `package.json` → `test:correlation` = Task 1 Step 2's nine files PLUS `src/lib/push/quietHours.test.mjs` (ten total).
2. `src/lib/health/ouraSyncEngine.ts` → keep ALL THREE additive blocks: Sprint 1's `computeNightDetail` + `nightDetail` payload line, Sprint 2's `syncHeartrateSamples` + call, Sprint 3's `syncOuraDeviceStatus` + call (device-status call goes after the heartrate call inside `syncOuraSnapshots`). Imports merge accordingly (`nightDetail`, `heartrateSamples`/`syncWindows`, `updateOuraDeviceStatus`).

- [ ] **Step 3: Full gate** — same commands as Task 1 Step 3. Expected: test:correlation = 41 tests (36 + 5 quietHours); build ✓.

- [ ] **Step 4: Commit, push, confirm mergeable**

```bash
git add -A && git commit -m "chore: merge main (sprints 1+2) into sprint 3 branch, union conflict resolution"
git push origin codex/oura-sprint3-product-touches
gh pr view 86 --json mergeable --jq .mergeable   # expect MERGEABLE
```

---

### Task 4: Migration 025 → prod, owner merges #86, verify device status live

- [ ] **Step 1: Apply `supabase/025_oura_device_status.sql` to production** (G-1 pattern). Verify:

```sql
select count(*) from information_schema.columns
 where table_name='external_health_connections' and column_name in
 ('sleep_window','sleep_window_date','battery_level','battery_charging','battery_at');
-- expect 5
```

- [ ] **Step 2: OWNER ACTION — merge PR #86** (production deploy follows).

- [ ] **Step 3: After the next sync (Task 5), verify:**

```sql
select battery_level, battery_charging, battery_at, sleep_window_date,
       sleep_window is not null as has_window
from external_health_connections where source='oura';
-- expect battery_level 0-100 populated; sleep_window may be null only if
-- Oura returned status 'not_enough_nights' (check oura_sync_endpoint_coverage
-- for endpoint='sleep_time' → status must be 'success' either way)
```
And in the browser: `/app/settings` shows `Battery: N%` on the Oura card.

---

### Task 5: Complete Sprint 2 (+1/+3) live acceptance — sync twice, verify data + insights

**Requires production `CRON_SECRET` (owner retrieves from Vercel) OR the owner pressing Settings → "sync now" twice.**

- [ ] **Step 1: Trigger sync #1**

```bash
curl -s -m 300 -H "Authorization: Bearer $PROD_CRON_SECRET" \
  https://medremind-app-two.vercel.app/api/cron/oura-sync
# expect {"synced":1,...}
```

- [ ] **Step 2: Verify heartrate ingestion + coverage** (Management API):

```sql
select (select count(*) from oura_heartrate_samples) as hr_rows,
       (select count(*) from oura_sync_endpoint_coverage where endpoint='heartrate' and status='success') as hr_cov,
       (select count(*) from oura_sync_endpoint_coverage where endpoint in ('sleep_time','ring_battery_level') and status='success') as dev_cov;
-- expect hr_rows > 0 (≈288/day over the sync window), hr_cov >= 1; dev_cov >= 2 after #86
```

- [ ] **Step 3: Trigger sync #2 (idempotency)** — same curl; then re-run Step 2's SQL: `hr_rows` must NOT double (PK upsert) and the run status must be `success`.

- [ ] **Step 4: Current-day snapshot columns** (Sprint 1 acceptance):

```sql
select local_date, temperature_deviation, non_wear_minutes,
       deep_sleep_first_third_minutes, hrv_recovery_delta
from external_health_daily_snapshots where source='oura'
order by local_date desc limit 3;
-- expect non-null temperature/non_wear on fresh rows; night detail non-null where a main sleep period exists
```

- [ ] **Step 5: Insights smoke (V-8)** — OWNER ACTION: open the app's Insights screen and trigger a correlations refresh (`POST /api/insights/correlations` fires with the user session). Expected: HTTP 200, no Sentry error, and:

```sql
select count(*) from daily_lifestyle_snapshots;  -- expect > 0 after refresh
```
(`correlation_insight_cards` may legitimately stay empty if no correlation clears the `MIN_PAIRED_DAYS`/strength thresholds yet — the acceptance here is "no crash", not "cards exist".)

---

### Task 6: F-3 — create and verify the 6-hourly sync cron (finally)

- [ ] **Step 1: OWNER ACTION — create the cron-job.org job** (same account as the existing every-minute `cron-notify` job #7402449):
  - URL: `https://medremind-app-two.vercel.app/api/cron/oura-sync`
  - Schedule: every 6 hours (e.g. 00:00/06:00/12:00/18:00 UTC)
  - Request header: `Authorization: Bearer <production CRON_SECRET from Vercel>`
  - Timeout: maximum allowed (the route sets `maxDuration = 300`)

- [ ] **Step 2: Verify after 12–24 h** (agent, Management API):

```sql
select sync_type, status, started_at from external_health_sync_runs
order by started_at desc limit 6;
-- expect 'daily' runs ~6h apart, status='success'
```
Also confirm the Sentry monitor `cron-oura-sync` shows OK check-ins on that cadence.

- [ ] **Step 3: Close the loop in docs** — in `docs/oura-verification-2026-07-13.md`, mark F-3 as done (one line, date + job id); commit as `docs:` on a fresh branch, open a PR.

---

## Done means

- PRs #84 and #86 merged (by owner) with union resolutions; `main` gates green.
- Migrations 023/024/025 all present in prod (024 already applied 2026-07-14 during verification).
- Backfill executed; historical snapshots carry temperature/wear/night-detail.
- `oura_heartrate_samples` populated and idempotent across repeated syncs; `heartrate`/`sleep_time`/`ring_battery_level` coverage rows green.
- Battery visible in Settings; quiet-hours code live (its behavioral check: a pending reminder inside the stored bedtime window yields `status:'quiet-hours'` in `/api/cron/notify` results).
- cron-job.org drives `/api/cron/oura-sync` every 6 h with Sentry check-ins.
