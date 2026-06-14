# MedRemind — Health Check & Log Audit Report

**Date:** 2026-06-14
**Scope:** All logs (Supabase Postgres / API / Auth), infrastructure, data integrity, every test suite, and the state of all protocols & pipelines.
**Branch/commit at audit:** `main` @ `f4bf8bb` (clean working tree, no open PRs).

---

## 1. Executive summary

**Production application and infrastructure are healthy.** Over the last 24h there were **0 server errors (5xx)** and **0 fatal database errors** across 8,787 API requests. The sync ledger is 100% successful (0 failed, 0 inflight). Every automated test suite passes.

The **only genuine problem area surfaced by testing is in the E2E test harness, not the product**: the two Playwright suites share a single test account with no cleanup, so they accumulate state and cannot run in parallel — producing order-dependent flakes that masquerade as regressions. Each suite passes in isolation; the full suite passes 14/14 once the accumulated test data is purged.

| Area | Status |
|---|---|
| Postgres / API / Auth logs | ✅ clean (3 benign idempotent retries only) |
| Sync ledger | ✅ 388/388 succeeded, 0 failed, 0 inflight |
| Data integrity (events, occurrences) | ✅ 0 unlinked-terminal, 0 legacy keys, 0 duplicate slots |
| Boot pull efficiency | ✅ heavy user 3,657 → 979 rows (PR #57 live) |
| Push pipeline | ✅ delivering daily, last 16:15 UTC today |
| CI / deploys | ✅ last 5 main deploys green |
| Unit / correlation / med-knowledge | ✅ 7×0 fail / 10 / 27 |
| E2E (dose + food) | ✅ 14/14 after test-account cleanup |
| **E2E test harness robustness** | ⚠️ **fragile — see §6.1** |

---

## 2. Logs swept

### 2.1 Supabase API (edge) logs — 24h window
- **Total requests:** 8,787
- **Errors (≥400):** 3 — all `409 Conflict` on `POST /rest/v1/execution_events`
- **Server errors (≥500):** 0

### 2.2 Postgres logs — 24h window
- **ERROR:** 3 × `23505 duplicate key value violates unique constraint "execution_events_pkey"`
- **FATAL / PANIC:** 0

These 3 errors are the **same 3 events** as the API 409s. They are the **at-least-once take-command retry path**: a retried `take`/`skip` re-inserts an execution event whose primary key and idempotency key both derive from the same `clientOperationId`. The insert hits the unique index, the client catches `23505` (`isUniqueViolation`), re-reads the existing row, and continues. **Benign and self-healing** — confirmed by the ledger showing 0 failed operations. (Minor log-noise improvement noted in §6.2.)

### 2.3 Auth logs — 24h window
- **error / fatal / warn:** 0

---

## 3. Sync & data-integrity pipeline

| Check | Result |
|---|---|
| `sync_operations` by status | 388 succeeded · 0 failed · 0 inflight |
| `execution_events` total | 405 |
| — unlinked (no `planned_occurrence_id`) | 32 — **all `snoozed`** (intentional; lineage retired) |
| — unlinked **terminal** (taken/skipped) | **0** ✅ |
| Legacy-keyed live occurrences | 0 ✅ |
| Duplicate live slot-groups | 0 ✅ |
| Heavy-user boot pull | 979 rows (vs 3,657 non-superseded) — PR #57 effective |
| Table bloat (planned_occurrences) | 8,738 live / 90 dead tuples — healthy, no vacuum needed |

All integrity fixes from PRs #41/#42/#46/#56/#57 and migrations 012–019 remain holding.

---

## 4. Other pipelines

**Push / reminders** — Healthy. cron → `/api/cron/notify` filters `status='planned'` AND `active_protocols.status='active'` (paused/terminal protocols never notify). Deliveries: 4 in last 24h, 22 in last 7d, last at 16:15 UTC today; Pass-B reminders reaching `notification_count=3` as designed. 1 active push subscription.

**Food (photo / text / nutrition)** — Healthy, currently unused by the real user (18 historical entries, none in 7d; new text/duplicate/photo features have 0 production usage yet — only just shipped). Pipeline validated end-to-end by the 11-test E2E suite (mock provider).

**Build / deploy** — Last 5 `main` deploys all succeeded (incl. #57 pull optimization, #58 DST fix, #59 Node-24 CI bump).

---

## 5. Protocol status (real user `f9b3…207`)

Active instances driving today's schedule: **good evening, Good hair, Protein** (good morning & Testo boost have no dose today). Paused since March: Longevity Stack, Metabolic Reset, Daily Essentials, Sleep & Recovery, Cardiovascular Support. Terminal (abandoned/completed): Hair ×2, Testo, good morning, QA Protocol. Past noise from inactive protocols is hidden client-side (PR #56) and stale paused past-rows are tombstoned (migration 019).

---

## 6. Problem areas & recommendations

### 6.1 ⚠️ P1 — E2E test harness is fragile (real finding)
**Symptom:** Running `doseStatusPersistence.spec.ts` + `food.spec.ts` together failed (3/3 dose failed in parallel; a food date-scoping test failed when serial). Each suite passes **in isolation**. After purging the test account, the full serial run passed **14/14**.

**Root causes:**
1. **Shared single test account** (`food-e2e@example.org`) — both suites log into the same account; parallel workers cross-interfere (one suite's boot pull races the other's mutations).
2. **No cleanup** — the dose suite creates protocols (`PersistTest`/`RemoveTest`/`OfflineTest`) every run and never deletes them; the account had accumulated **12 protocols / 10 instances / 30 occurrences** (purged during this audit), producing order-dependent flakes.
3. **Not covered by CI** — the `quality` job runs unit/correlation/med-knowledge/build only; the creds-gated Playwright suites silently skip in CI, so this fragility never shows up there (and selector/data rot can go unnoticed — as happened previously).

**Recommendation (prioritized):**
- Add `test.afterAll` cleanup to the dose suite (delete protocols it created), or use a unique per-run account (`food-e2e+<runId>@…`).
- Pin local full-suite runs to `--workers=1` (or give each suite its own account) so the two suites don't share state concurrently.
- Optionally add a nightly CI job (with E2E creds as secrets) that runs Playwright against a disposable account, so suite rot is caught automatically.

### 6.2 P2 — Idempotent-retry log noise (minor)
The 3 `409 / 23505` log lines/day are harmless but noisy. Replacing the `insert`-then-catch in `realtimeSync/doses.ts` with `upsert(..., { onConflict: 'idempotency_key', ignoreDuplicates: true })` would make retries silent. Low priority — current behavior is correct.

### 6.3 P3 — One duplicate active-protocol instance (minor, known)
Protocol `cc07587a` (“Hair”) has two terminal instances (abandoned + completed). Harmless — the pull canonicalizes them and §3 shows 0 duplicate slots. Clean up only for tidiness.

### 6.4 P4 — Future paused-instance rows still pulled (optimization)
After migration 019, past paused rows are tombstoned, but ~700 **future** paused-instance occurrences (today→horizon) are still pulled then hidden client-side. Legitimate (they restore on resume), but if the user won't resume those 5 March protocols, completing/deleting them would shrink the pull further. Also: `resumeProtocol` does not regenerate, so resuming a long-paused protocol re-exposes its remaining rows — a “resume from today” regeneration is the clean future enhancement.

### 6.5 P5 — 32 snoozed events permanently unlinked (accepted)
Intentional from earlier cleanup (snooze lineage retired). No terminal (taken/skipped) events are unlinked, so history is intact. Monitored, no action.

---

## 7. Verification commands run

```
npx tsc --noEmit                                  # clean
npm run test:unit                                 # 7 suites, 0 fail
npm run test:correlation                          # 10 tests, 0 fail
npm run test:med-knowledge                        # 27 tests, 0 fail
npm run build                                     # compiled successfully
npx playwright test (dose + food, --workers=1)    # 14/14 after cleanup
Supabase Management API: edge_logs / postgres_logs / auth_logs (24h)
Supabase SQL: sync_operations, execution_events, planned_occurrences health
```

**Conclusion:** No production defects found. The single actionable item is hardening the E2E test harness (§6.1); everything else is healthy or a minor optional optimization.
