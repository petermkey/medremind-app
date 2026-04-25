# MedRemind Persistence Verification and Hardening Report
Date: 2026-03-18
Scope: runtime validation of local Zustand <-> Supabase persistence, auth/account binding, reload/relogin/cross-session behavior, and recovery flows.

> **Historical document:** This is a point-in-time snapshot for audit and context only.
> It does not override the current source-of-truth documents listed in `docs/system-logic.md`.

> Historical report (point-in-time pass). Current behavior source of truth is `docs/system-logic.md` and `docs/current-status.md`.

## 1) Executive verification summary
- Claim "real-time CRUD sync works": **partially true before this pass**, now **verified with hardening**.
- Claim "autoload from Supabase on app entry": **implemented and wired** (`/app` layout boot path).
- Claim "recovery export/import/backup/restore works": **implemented and exercised** via settings actions and cloud pull/import modules.
- Main gap found: transient network failures could drop `dose_records` writes while local state already changed (trust risk). Fixed with outbox+retry.

## 2) Runtime truth summary
- Active local app under test: `http://localhost:3000`.
- Supabase project used by this runtime: `https://hagypgvfkjkncznoctoq.supabase.co`.
- Public deploy tested: `https://medremind-app-two.vercel.app` is on a different/older build (evidence: `/api/version` returns 404 there, 200 locally).
- Auth/db evidence collected with a live test account `codex.sync.1773857466981@example.com` and user id `7bf63fb1-3f34-48f1-aaf8-70707201e1da`.

## 3) Persistence architecture mapping (code-verified)
- Local state owner: `src/lib/store/store.ts` (Zustand `persist`).
- Cloud write path:
  - protocol + items: `syncProtocolUpsert`, `syncProtocolItemDelete`
  - activation + generated doses: `syncActivation`
  - pause/resume/complete: `syncActiveStatus`
  - regenerate doses: `syncRegeneratedDoses`
  - dose actions: `syncDoseAction`
- Cloud read/autoload path:
  - `pullStoreFromSupabase()` in `src/lib/supabase/cloudStore.ts`
  - called from `src/app/app/layout.tsx` on authenticated app entry.
- Recovery path:
  - export/backup/restore actions in `src/app/app/settings/page.tsx`
  - import adapter in `src/lib/supabase/importStore.ts`.
- New reliability layer:
  - outbox/retry engine: `src/lib/supabase/syncOutbox.ts`
  - enqueue on sync failure in store actions.

Entity map:
- `protocols` <- local `protocols` slice -> `protocols` table (`owner_id=userId`) -> read via `pullStoreFromSupabase`.
- `protocol_items` <- protocol items in local -> `protocol_items` table (`protocol_id`) -> read joined by user protocol ids.
- `active_protocols` <- local `activeProtocols` -> `active_protocols` table (`user_id`) -> read by `user_id`.
- `scheduled_doses` <- local `scheduledDoses` -> `scheduled_doses` table (`user_id`) -> read by `user_id`.
- `dose_records` <- local `doseRecords` -> `dose_records` table (`user_id`) -> read by `user_id`.
- `notification_settings` <- local settings -> `notification_settings` table (`user_id`) -> read by `user_id`.
- `profiles` <- local profile -> `profiles` table (`id=user_id`) -> read by user id.

## 4) End-to-end test results (runtime + db)
Executed sequence:
1. Register new user -> onboarding complete.
2. Create custom protocol with one item and activate.
3. Pause/resume protocol.
4. Take + snooze + skip dose actions.
5. Refresh.
6. Sign out and sign in again.

Observed network evidence (Supabase REST):
- `POST /protocols` (201/200 upsert)
- `POST /protocol_items` (201/200 upsert)
- `POST /active_protocols` (201)
- `POST /scheduled_doses` (201)
- `PATCH /active_protocols` (204 pause/resume)
- `PATCH /scheduled_doses` (204 status updates)
- `POST /dose_records` (201)
- `GET` reads for all user-scoped tables on app re-entry.

DB evidence snapshot (same authenticated user):
- `profiles`: 1
- `notification_settings`: 1
- `protocols`: 1
- `protocol_items`: 1
- `active_protocols`: 1
- `scheduled_doses`: 90
- `dose_records`: 2 initially, then 3 after retry test below.

## 5) Failure/divergence tests
Injected failure test:
- Deliberately aborted first `POST /dose_records` request in browser route interception.
- Local action still completed; outbox enqueued failed write.
- After unblocking network and waiting retry window, DB `dose_records` count increased from `2` -> `3`.
- This verifies retry replay and closes the transient-loss gap for this class of failure.

## 6) Incident-style defect log
| ID | Priority | Severity | Area | Repro | Expected | Actual | Cause | Fix | Status |
|---|---|---|---|---|---|---|---|---|---|
| MEM-001 | P0 | Critical | Auth/profile hydration | Fresh account login/onboarding | Profile persisted and onboarding state stable | profile patch path could no-op when local profile null | `updateProfile` required existing profile | Added `setProfile`, wired login/register/layout to use it | Fixed |
| MEM-002 | P1 | High | Dose action sync reliability | Transient network fail during `dose_records` write | Eventual cloud consistency | Local state changed, cloud record could be dropped | fire-and-forget without durable retry | Added persistent outbox + retry/backoff replay | Fixed |
| MEM-003 | P2 | Medium | Read path noise | Empty profile/settings row reads | Graceful empty read without 406 noise | `.single()` produced 406 in some no-row flows | strict single row semantics | Switched reads to `.maybeSingle()` | Fixed |

## 7) Repair/hardening sprint summary
Implemented:
- Outbox queue persisted in localStorage for failed sync operations.
- Exponential retry with scheduled replay and online/visibility triggers.
- Sync status signals (`pending`, `last error`, `last success`) and UI visibility in settings.
- `maybeSingle()` hardening for profile/settings fetch paths.

Files changed in this sprint:
- `src/lib/supabase/syncOutbox.ts` (new)
- `src/lib/store/store.ts`
- `src/app/app/layout.tsx`
- `src/app/app/settings/page.tsx`
- `src/lib/supabase/auth.ts`
- `src/lib/supabase/cloudStore.ts`

## 8) Re-test summary after fixes
- Build: passes (`npm run build`).
- Runtime CRUD: protocol + items + activation + status updates + dose actions observed in Supabase network calls.
- Refresh/relogin: cloud reads run and state restored for same account.
- Failure replay: verified with injected `dose_records` failure and successful replay.

## 9) Remaining risks
- Outbox currently replays full operation payload objects (can be large for large protocols).
- No conflict resolution policy beyond last-write-wins.
- No server-side idempotency keys; client uses deterministic IDs for many entities, but action replay semantics can still create edge-case duplicates if upstream constraints change.
- No dedicated automated integration test suite yet for persistence flows.

## 10) Recommended next sprint
1. Add integration tests (Playwright + seeded Supabase test project) for persistence matrix and failure injection.
2. Add operation compaction in outbox (collapse repeated status updates on same dose/active protocol).
3. Add explicit sync badge in main app header (not only settings) with actionable retry diagnostics.
4. Add conflict policy and stale-write guard timestamps for cross-session concurrent edits.
