# System Audit — Full Stack & Pipeline Review (2026-07-09)

**Scope:** every stack and pipeline (sync engine, reminders/push, food AI, correlation, Oura/health, medKnowledge, frontend, PWA, CI/tests), live production logs & DB state, and a consolidated improvement backlog for reliability, performance, and usability.
**Method:** live Supabase Management API queries (DB state + edge/postgres/auth logs), 6 parallel read-only code audits, spot-verification of every headline claim, full local test run.
**Baseline:** compared against `docs/health-check-2026-06-14.md`.
**Branch/commit at audit:** `main` @ `dfb6022`.

---

## 1. Executive summary

**Core product (dose tracking + sync) is healthy; the notification pipeline has a critical silent failure; every analytics pipeline is dormant.**

| Area | Status |
|---|---|
| Postgres / API / Auth logs (24h) | ✅ 0 errors, 0 fatal |
| Sync ledger | ✅ 479 succeeded · 0 failed · 7 inflight (all E2E-teardown artifacts, see §3.2) |
| Data integrity | ✅ 0 unlinked terminal events, 0 duplicate slots |
| Boot pull | ✅ heavy user 998 rows (June: 979) — stable |
| Cron trigger | ✅ alive, firing every minute (verified live tick 20:55:16 UTC) |
| **Push delivery** | 🔴 **0 subscriptions in the entire DB — every "delivery" since the last subscription vanished is a phantom** (§2) |
| Oura sync | 🟠 stalled since 2026-04-26 (known; overhaul plan ready — `docs/superpowers/plans/2026-07-05-oura-sync-overhaul.md`) |
| Correlation insights | 🟠 **0 cards ever generated in production**; snapshots frozen at 2026-04-26 (§4.1) |
| Food pipeline | 🟠 technically healthy, **0 entries in 30+ days** — user abandoned the flow (§4.2) |
| medKnowledge | 🟡 runtime is a 7-rule static engine; all LLM/evidence/safety scaffolding is dead code (§4.3) |
| Unit / correlation / med-knowledge tests | ✅ 0 fail (run this audit) |
| `tsc --noEmit` / `npm run build` | ✅ clean |

**The single systemic theme:** everything that isn't the daily dose loop has quietly stopped being *used* or *delivered* — and in each case the system reports success. Phantom push "deliveries", a cron that can silently disable, provider errors collapsed into one generic message, zero-card insights with no "why" shown to the user. The app needs **honest failure surfacing** more than new features.

---

## 2. 🔴 P0 — Push notifications are phantom-delivered

**Live evidence:**
- `push_subscriptions` table: **0 rows** (June 14 audit: 1 active).
- `notification_log`: 2–5 rows/day continuously, reaching `notification_count=3` (Pass A + 2 reminders), last at 2026-07-09 16:15 UTC — for `peter@alionuk.com`, `push_enabled=true`.
- Code path: `sendPushToUser` returns `{ sent: 0, stale: 0 }` when the user has no subscriptions ([sendToUser.ts:52-53](../src/lib/push/sendToUser.ts)) **without throwing**; the cron route then marks the claim delivered (`notification_count=1`, [route.ts:195-199](../src/app/api/cron/notify/route.ts)) and later escalates it to 3. Every scheduled dose "notifies" nobody, and the log says it worked.

**How subscriptions likely got to zero:** `subscribeToPush()` **deletes all existing subscriptions before inserting the new one** ([subscription.ts:117-129](../src/lib/push/subscription.ts)) — a failed re-subscribe (browser rejects, iOS PWA quirk, VAPID mismatch after the pending secret-rotation) leaves the user at 0. Additionally, after a VAPID rotation old endpoints fail with **403, which is never cleaned up nor surfaced** — only 410/404 are treated as stale ([sendToUser.ts:75-85](../src/lib/push/sendToUser.ts)).

**Fixes (ordered):**
1. **Detect zero-delivery:** when `sent === 0` for a user with `push_enabled=true`, do NOT mark the claim delivered — record a distinct state (or delete the claim) and surface "push disabled on all devices" in Settings + Sentry. *(low effort, kills the silent failure)*
2. Re-subscribe the real device (user action) and verify an actual delivery lands.
3. Treat 403 like 410/404 in stale-subscription cleanup. *(one line)*
4. Stop delete-all-then-insert in `subscribeToPush` — upsert on endpoint instead, so one device's re-subscribe can't wipe another's. *(schema already allows multi-device)*
5. Add a cron heartbeat: cron-job.org has silently flipped `enabled:false` before (project memory); a daily check (or a Vercel Cron fallback entry in `vercel.json`) that alerts when no cron tick was seen for >10 min. *(medium)*

---

## 3. Sync & dose engine

### 3.1 Correctness — holding
All prior fixes verified intact: event linking, cancel-as-tombstone, outbox drain before pull, 2-query boot pull, slot dedup. Ledger 479/0/7. Zero duplicate slot groups. Boot pull stable at 998 rows.

Remaining small gaps (P3):
- **Snoozed unlinked events are never reconciled** — the boot fallback only reapplies `taken`/`skipped` ([cloudStore.ts:531](../src/lib/supabase/realtimeSync/../cloudStore.ts)); an unlinked snooze is fetched every boot and silently dropped.
- **`endProtocolFromToday` scope mismatch** — locally deletes *all* doses ≥ cutoff (incl. taken), cloud deletes only `planned` ([store.ts:951-958](../src/lib/store/store.ts) vs [activation.ts:338-345](../src/lib/supabase/realtimeSync/activation.ts)); taken doses on the cutoff day transiently vanish from stats until next pull.
- **7 stuck `inflight` ledger rows** — all `archive_command` from `food-e2e@example.org`, 2026-07-03 (E2E teardown fires deletes and closes the page before completion). Harmless noise, but there is **no stale-inflight reaper**; add `inflight AND updated_at < now()-interval '1h' → failed` to a future migration, and have E2E teardown tolerate it.

### 3.2 Performance (verified against code)
| # | Finding | Evidence | Fix |
|---|---|---|---|
| P1 | **All 14 `useStore()` call sites subscribe to the whole store — zero selectors in the codebase.** Any store write re-renders every mounted page. | verified: 14 files, 0 selector-form calls | Field-level selectors + `React.memo` on `MedCard`/`WeekStrip` (also 0 `memo` in codebase) |
| P1 | `getStreak()` runs un-memoized in Progress render: 365 iterations × full filter+sort of `scheduledDoses` on every unrelated store change | [progress/page.tsx:387](../src/app/app/progress/page.tsx), [store.ts:1038-1050](../src/lib/store/store.ts) | `useMemo` keyed on doses |
| P2 | Outbox happy path does 2 full `JSON.stringify`+`localStorage.setItem` passes per action; `activateProtocol` fallback embeds up to ~360 dose rows with duplicated nested `protocolItem`/`activeProtocol` graphs | [syncState.ts:31-51](../src/lib/store/syncState.ts), [syncOutbox.ts:216-222](../src/lib/supabase/syncOutbox.ts) | Thin references (ids + patch) in fallback ops; single write |
| P2 | `pumpOutboxLocked` is O(n²) in queue length (full parse+stringify per item) — punishes exactly the offline-heavy user | [syncOutbox.ts:474-544](../src/lib/supabase/syncOutbox.ts) | Parse once, write once per pump |
| P2 | Boot pull history is unbounded by age — grows linearly forever | [cloudStore.ts:171-232](../src/lib/supabase/cloudStore.ts) | 12-month window + on-demand older history |
| P3 | Rolling-horizon regeneration: N sequential round-trips per boot; `resolvePlannedOccurrenceId` up to 3 sequential lookups per action | [cloudStore.ts:634-645](../src/lib/supabase/cloudStore.ts) | Batch; acceptable today |

---

## 4. Dormant pipelines — the April cliff

Every analytics feature stopped producing value in the last days of April:

| Pipeline | Last activity | Root cause |
|---|---|---|
| Oura snapshots | 2026-04-26 (15 days total) | manual-only sync — **fix already planned & speced** |
| `daily_lifestyle_snapshots` | 2026-04-26 (90 rows) | only rebuilt by manual "Refresh" on Progress |
| `correlation_insight_cards` | **never** (0 rows ever) | starved: outcomes come from Oura; `MIN_PAIRED_DAYS=14` unreachable with 15 stale days |
| `food_entries` | 2026-04-28 (18 total, 0 in 30d) | user abandoned logging — friction (§6) |
| medKnowledge jobs | 2026-04-26 (2 jobs) | manual-only trigger |

### 4.1 Correlation engine
- **P1 (product):** feature has never produced a card; the UI shows an empty state with no explanation of *what data is missing*. Fix: explicit "insufficient health data — N/14 paired days" state; then the Oura cron (already planned) starts filling it automatically. Consider a weekly cron rebuild of snapshots so the pipeline runs without manual refreshes.
- **P2 (safety-drift):** [engine.ts:45-52](../src/lib/correlation/engine.ts) carries a *private copy* of the medication-safety regex that also lives in `medicationSafety.ts`; the two can silently diverge. Import the shared one.
- **P3:** `stats.ts` is dead code — engine reimplements Pearson inline; full 90-day rebuild on every refresh instead of incremental.

### 4.2 Oura/health (beyond the planned overhaul)
- **P1:** token refresh has **no per-user lock** — two concurrent syncs both consume the same rotating refresh token; the loser gets `invalid_grant` and the connection is marked failed spuriously ([sync/route.ts:164-198](../src/app/api/integrations/health/sync/route.ts)). Add `pg_advisory_xact_lock(user_id)` around refresh+sync — fold into overhaul Task 1.
- **P2:** `persistOuraAnalyticsPayloads` does 100–250 **sequential** round-trips per sync (per-row SELECT-then-write); the biggest Vercel-timeout risk in the repo. Batch upserts — fold into overhaul Task 1/2.
- **P2:** no `OURA_TOKEN_ENCRYPTION_KEY` rotation path (hardcoded `v1`, no dual-version decrypt); disconnect never revokes the grant on Oura's side.

### 4.3 medKnowledge — scaffolding vs reality
Runtime = `normalizeMedicationFromLocalRules` (4 hardcoded aliases) + 7 curated rules. **Everything else is dead code with zero callers:** `callOpenRouterStructuredJson`, RxNorm/RxClass lookups, all of `evidence.ts` ranking, and — notably — `assertSafeMedicationKnowledgeText` (the safety guard) **is never invoked anywhere**. Currently safe only because the 7 rules were hand-vetted.
**Decision needed:** (a) wire the RxNorm fallback for unmatched meds + invoke the safety assert on rule persistence *(small)*, or (b) delete the scaffolding so the module stops misrepresenting its capability. Either way, wire the safety assert — it's one call.

### 4.4 Food pipeline (code-level, for when usage resumes)
- **P1:** photos upload **before** draft confirmation and every discarded/retaken draft orphans an object forever — the `food-photos` bucket has **no delete RLS policy at all** (017), and entry deletion removes only the DB row. Fix: delete policy + cleanup of unreferenced objects + delete photo with entry.
- **P1:** **no rate limiting** on `analyze-photo`/`analyze-text` — every authenticated hit is a paid OpenRouter vision call. A simple per-user daily cap closes the cost exposure.
- **P2:** fallback chain is 1–2 models (only if `OPENROUTER_FOOD_VISION_FALLBACK_MODEL` is set); client discards the server's diagnostic `reason` and shows one generic error; signed URLs are re-issued per thumbnail mount and silently break after 1h TTL; 9-day window refetched on every day-strip tap with no range cache.

---

## 5. Frontend, PWA & usability

### 5.1 Loading experience (biggest UX lever)
- **Zero `loading.tsx`, zero route `error.tsx`, zero Suspense, zero skeletons** anywhere (verified). Any route error falls through to the global crash screen.
- **Boot is a hard gate:** up to 8s outbox flush + 3×-retry pull behind a bare spinner ([app/layout.tsx:44-113](../src/app/app/layout.tsx)) — while persisted `activeProtocols`/`profile` are already in the store. For a medication app opened "to take a pill", render cached shell immediately + skeleton the schedule while the pull lands.

### 5.2 Safety UX
- **No undo anywhere** (verified: 0 matches). A mistaken "take" tap is irreversible in the UI — real double-dose bookkeeping risk. Extend `Toast` with an action button (`{ label: 'Undo', onClick }`) on take/skip.
- `requireInteraction: false` in sw.js lets the OS auto-dismiss the *final* reminder.

### 5.3 PWA
- **`sw.js` has no `fetch` handler at all** — zero offline capability (verified). Offline launch = browser error page. Even a minimal app-shell + icons cache-first handler changes that.
- No `apple-touch-icon` metadata; no maskable icon → degraded Home-Screen install on iOS/Android.
- `maximumScale: 1` disables pinch-zoom app-wide (low-vision accessibility).

### 5.4 Misc
- Food photo thumbnails use raw `<img>` (full 1280px image for an 11×11 thumb); meds search re-filters the whole catalogue per keystroke unbounded (browse view is capped at 30, search isn't); a11y labels concentrated in 2 files, 0 in settings/new-protocol/progress.

---

## 6. Tests & CI

- **Playwright E2E still not in CI** (creds-gated, silently skips) — 4 specs / 40+ scenarios provide zero automated regression protection. Nightly job with secret creds remains the fix (carried from June audit → backlog).
- **3 orphaned test files** — `oura/oauth.test.mjs`, `oura/tokenCrypto.test.mjs`, `health/ouraDailyMapper.test.mjs` pass but are wired into **no npm script and no CI step**. One-line `test:oura` script fixes it. *(Fold into Oura overhaul Task 1, which already touches these modules.)*
- **No ESLint at all** (no config, no dependency — verified). `tsc` strict covers types but not hooks rules/unused vars/a11y.
- `supabase/` has two files numbered `008` (real, distinct migrations) — symptom of no migration tooling; plus the 020–022 collision already documented in `docs/project-backlog.md`.
- `@types/uuid`/`@types/web-push` sit in `dependencies`; `uuid` pkg is replaceable by `crypto.randomUUID()`.
- E2E account re-accumulation since the July 3 purge: 4 protocols/4 instances — cleanup is working (bounded), watch cadence unchanged.

---

## 7. Prioritized improvement plan

### Wave 0 — production fix (this week)
| # | Item | Effort |
|---|---|---|
| 0.1 | **Phantom push:** zero-delivery detection + Settings warning + Sentry; re-subscribe real device; 403 cleanup; upsert-not-delete-all in subscribe (§2) | S |
| 0.2 | Cron heartbeat/fallback so a silently-disabled cron-job.org is caught (§2.5) | S |
| 0.3 | **Execute the Oura sync overhaul plan** (already speced, 4 tasks) — unblocks correlations, weekly review, all wellbeing analytics. Add advisory-lock + batched persistence (§4.2) to Task 1 scope | M |

### Wave 1 — quick wins (high impact / low effort)
| # | Item |
|---|---|
| 1.1 | Undo action on take/skip toast (§5.2) |
| 1.2 | Zustand selectors at all 14 call sites + `React.memo` on `MedCard`; `useMemo` around `getStreak()` (§3.2) |
| 1.3 | Boot: render cached shell + schedule skeleton instead of blocking spinner (§5.1) |
| 1.4 | Food: per-user rate limit + storage delete policy/cleanup + surface `reason` codes (§4.4) |
| 1.5 | Correlation: import shared safety regex; show "N/14 days" empty-state; wire `assertSafeMedicationKnowledgeText` (§4.1/4.3) |
| 1.6 | CI: `test:oura` script + step; ESLint (`eslint-config-next`) + CI step; move type pkgs to devDeps (§6) |

### Wave 2 — structural (medium)
`loading.tsx`/`error.tsx` for heavy routes · SW offline app-shell + apple-touch/maskable icons · outbox thin-payload + single-write pump · boot-pull 12-month window · signed-URL cache + range cache in food store · stale-inflight ledger reaper (migration) · nightly E2E CI job · weekly snapshot-rebuild cron (or fold into Oura cron) · multi-device push (schema already supports it)

### Wave 3 — product decisions required
medKnowledge: wire RxNorm+LLM path or delete scaffolding (§4.3) · food-logging friction: the user's actual abandonment is the strongest usability signal — B3/B5 backlog items (eating window, close-the-gap) plus a lighter "quick log" entry point are the response · resume-overdue regeneration guard (deferred item from backlog, unchanged)

---

## 8. Verification run (this audit)

```
npx tsc --noEmit          # clean (0 errors)
npm run test:unit         # 0 fail
npm run test:correlation  # 10 pass / 0 fail
npm run test:med-knowledge# 27 pass / 0 fail
npm run build             # compiled successfully
Supabase Management API   # DB state + edge/postgres/auth logs (0 errors 24h)
Live cron tick observed   # 6 REST calls @ 20:55:16 UTC (every-minute cadence confirmed)
```

**Cross-references:** `docs/project-backlog.md` (index — Wave 0.3 = its §1.1), `docs/superpowers/plans/2026-07-05-oura-sync-overhaul.md`, `docs/backlog-wellbeing-features.md`, `docs/health-check-2026-06-14.md` (baseline).
