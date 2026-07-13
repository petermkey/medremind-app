# Oura Integration — Stack, Gaps, and Target Architecture

**Date:** 2026-07-05 · **Status:** analysis + approved target architecture (implementation not yet scheduled)
**Companion:** `docs/backlog-wellbeing-features.md` (B1–B5 consume this data).

---

## 1. Current state (audited live, 2026-07-05)

### What is built
- **OAuth2** flow (`src/lib/oura/oauth.ts`, `client.ts`): scopes `email personal daily heartrate tag workout session spo2 heart_health stress` (widened 2026-07-13 — see §2 correction below); tokens encrypted at rest (`tokenCrypto.ts`, `OURA_TOKEN_ENCRYPTION_KEY`), refresh-token exchange implemented.
- **Fetch layer** `/api/integrations/oura/daily`: pulls `daily_sleep`, `daily_readiness`, `daily_activity`, `daily_spo2`, `daily_stress` (+ `workout` via analyticsSync) with `syncWindows.ts` range logic.
- **Mapping** `src/lib/health/ouraDailyMapper.ts` → `external_health_daily_snapshots` (008): scores, stress/recovery seconds, steps, calories, SpO2, breathing disturbance, workout_count, `raw_payload` jsonb — **plus vo2_max / resting_heart_rate / hrv_balance / resilience_level columns**.
- **Consumption**: correlation featureBuilder (`daily_lifestyle_snapshots` ← Oura features), Insights.

### Gaps found (live DB evidence)
| # | Gap | Evidence | Severity |
|---|---|---|---|
| G1 | **Sync is manual-only** — a Settings button (`/api/integrations/health/sync`); no cron, no webhook | connection `status=connected`, `last_sync_at=2026-04-26`; only **15 snapshot days** (Apr 12–26) exist | 🔴 the whole downstream (correlations, B2/B3) starves |
| G2 | **vo2_max / RHR / hrv_balance / resilience columns are always NULL** — mapper accepts a `heartHealth` input the fetch layer never requests | 0/15 rows populated for all four columns | 🟠 schema & mapper ready; fetch missing |
| G3 | `tag` scope is used but the **Tag endpoint is deprecated** (replaced by Enhanced Tag) | Oura docs | 🟡 |
| G4 | No webhook subscription — polling only | code | 🟡 (fine at current scale, see §4) |

## 2. Platform news (checked 2026-07-05)

- **Personal Access Tokens deprecated Dec 2025** — OAuth2 only now. *We are already OAuth2-only → no action.*
- **Webhooks are the recommended freshness mechanism**: subscription API (create/list/renew/delete) authenticated with `x-client-id`/`x-client-secret`; events fire ~30s after mobile-app sync. Daily Activity / Stress / Heart Rate update **periodically through the day**, so single morning polls miss updates.
- **Endpoint catalog (v2, `api.ouraring.com/v2/usercollection/*`)** — beyond what we pull today:
  `daily_resilience`, `daily_cardiovascular_age`, `vO2_max`, `sleep` (detailed periods: HRV, efficiency, latency, stages, respiratory rate), `sleep_time` (recommended bedtime windows), `rest_mode_period`, `enhanced_tag` (replaces tag), `session` (meditation/breathing), `heartrate` (5-min granularity), `ring_configuration`, `personal_info`.

**⚠️ Correction (2026-07-13, verified via a live 401 probe against the real API with a real token):** this catalog did not originally note per-endpoint OAuth scope requirements, and the code built against it (2026-07-10 sync overhaul) shipped without them — `vO2_max` and `daily_cardiovascular_age` require the **`heart_health`** scope, `daily_resilience` requires the **`stress`** scope. Neither scope was requested, so those three endpoints 401 on every call; `fetchOptionalOuraCollection`'s error-tolerance silently turned that into "0 documents," indistinguishable from "user has no data" until endpoint coverage was explicitly widened to record auth errors (see `src/lib/oura/optionalFetchError.ts`). `sleep` and `enhanced_tag` need no additional scope beyond what was already granted. **Any future endpoint added from this catalog must have its scope requirement verified with a live authenticated call before shipping — the catalog/docs are not a reliable source for this.**

Sources: [cloud.ouraring.com/v2/docs](https://cloud.ouraring.com/v2/docs), [Oura Member Care — The Oura API](https://support.ouraring.com/hc/en-us/articles/4415266939155-The-Oura-API), [Pinta365/oura_api endpoint coverage](https://github.com/Pinta365/oura_api).

## 3. Data catalog → which of our features consumes it

| Oura data | Endpoint | Feeds | Why |
|---|---|---|---|
| Sleep / readiness / activity scores, stress & recovery seconds, steps, calories, SpO2, BDI | *(already pulled)* | correlation engine (outcomes), Insights, B2 weekly review | baseline outcomes |
| **Resilience level** | `daily_resilience` | correlations, B2 | long-horizon stress recovery — fills existing NULL column |
| **Cardiovascular age** | `daily_cardiovascular_age` | B2 weekly/monthly trend | slow-moving longevity KPI |
| **VO2max** | `vO2_max` | B2 trend, correlations | fitness capacity — fills existing NULL column |
| **Sleep detail** (avg HRV, resting HR, efficiency, latency, deep/REM minutes, respiratory rate) | `sleep` | correlations (much richer outcomes than the 0-100 score), B3 late-meal impact | "ужин после 21:00 → deep −18%" needs stage minutes, not the composite score |
| **Recommended sleep window** | `sleep_time` | smart reminders (quiet hours), B4 check-in timing | align pushes with the user's optimal bedtime |
| **Enhanced tags** (caffeine, alcohol, sauna…) | `enhanced_tag` | correlation features alongside our meds/food | user already tags lifestyle events in the Oura app — free feature inputs |
| Sessions (meditation/breath) | `session` | correlations (optional) | recovery practices as features |
| 5-min heart rate | `heartrate` | *(defer)* | high volume, low marginal value until intra-day analysis exists |
| Ring configuration / battery | `ring_configuration` | *(defer)* | support/diagnostics only |

## 4. Target architecture

### 4.1 Freshness: scheduled server pull now, webhooks later
```
cron-job.org (every 6h) ──▶ /api/cron/oura-sync   (Bearer CRON_SECRET)
  for each external_health_connections row with status='connected':
    decrypt refresh token (tokenStore/tokenCrypto — already built)
    → refresh access token if needed (client.ts — already built)
    → fetch window = max(last_sync_at − 2d, 7d back)   // trailing re-fetch:
      daily_activity/stress update during the day; readiness finalizes next morning
    → existing analyticsSync merge → upsert external_health_daily_snapshots
      (idempotent on user_id+source+local_date — constraint already exists)
    → update last_sync_at; on 401 after refresh → status='reauth_required' + push
```
- **Reuses the entire existing fetch/map/upsert path** — the only new code is the cron route walking connections server-side (Settings button stays as manual "sync now").
- Same operational discipline as `/api/cron/notify`: CRON_SECRET, per-user try/catch, Sentry, results summary.
- **Webhooks = phase 2**, only when user count makes 6-hourly polling wasteful: subscription lifecycle (create/renew/delete) needs client-secret headers, a verification challenge endpoint, and renewal bookkeeping — real complexity that a single-digit user base doesn't justify. Architecture note: webhook handler would enqueue `(user, data_type, date)` and reuse the same fetch-window code path, so nothing built for polling is thrown away.

### 4.2 New data: fill the NULLs, then widen (migration 020-series)
Phase A (no schema change): fetch `daily_resilience`, `vO2_max`, `daily_cardiovascular_age` in the daily route; extend `ouraDailyMapper` inputs (columns already exist; add `cardiovascular_age numeric` — one new column).
Phase B (sleep detail): new columns on the snapshot (`sleep_avg_hrv numeric, sleep_efficiency int, sleep_latency_seconds int, deep_sleep_minutes int, rem_sleep_minutes int, respiratory_rate numeric`) fed from `sleep` periods (pick the longest/main period per local date — Oura returns multiple docs/day for naps).
Phase C (tags): `oura_tags` table `(user_id, local_date, tag_type, comment, ts)` from `enhanced_tag`; correlation featureBuilder exposes them as boolean day-features. The deprecated `/tag` endpoint is unused; the `tag` OAuth scope stays (it authorizes `enhanced_tag`).

### 4.3 Pipelines consuming it (wiring, not new engines)
- **correlation featureBuilder**: add sleep-detail outcomes + tag features — mechanical extension of `BuildDailyLifestyleSnapshotsInput`.
- **B2 weekly review aggregator**: weekly deltas of resilience/VO2max/CV-age + sleep-detail trends.
- **B3 eating window**: late-meal flag × deep/REM minutes (needs Phase B).
- **Reminder timing**: `sleep_time` window → default quiet hours.

### 4.4 Security & ops invariants
- Tokens stay AES-encrypted at rest (`tokenCrypto`), decrypted only server-side in routes; never in client bundles (unchanged).
- Respect Oura rate limits (5000 req/day/token) — trivially satisfied by 6-hourly windows (~30 req/user/day incl. new endpoints).
- `raw_payload` already stores the full merged response — new mapper fields can be **backfilled from stored raw payloads** for the 15 existing days where the data was present in responses.
- E2E/dev: keep provider mocked; add a fixtures-based unit test for the mapper phase B fields (mapper tests already exist as the pattern).

## 5. Sequencing & effort

| Step | What | Effort | Unblocks |
|---|---|---|---|
| 1 | **Cron sync route** (G1) — the single highest-value fix; data resumes flowing | S | everything downstream |
| 2 | Phase A endpoints (G2) — fill vo2/RHR/resilience (+CV-age column) | S | B2 trends |
| 3 | Phase B sleep detail + featureBuilder wiring | M | B3 correlations, richer "what works" |
| 4 | Phase C enhanced tags (`/tag` endpoint unused, G3) | S–M | caffeine/alcohol correlations |
| 5 | Webhooks | M | scale-time freshness (defer) |

Step 1 is effectively a bug fix (silent data starvation since Apr 26) and can ship independently today; steps 2–4 ride the wellbeing backlog waves.
