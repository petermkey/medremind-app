# MedRemind CTO Persistence Verification Pass (Live Runtime)
Date: 2026-03-18
Owner: Incident Follow-up (Data Reliability)

> **Historical document:** This is a point-in-time snapshot for audit and context only.
> It does not override the current source-of-truth documents listed in `docs/system-logic.md`.

> Historical report (point-in-time pass). Current behavior source of truth is `docs/system-logic.md` and `docs/current-status.md`.

## 1. Executive verification summary
Claim status after live validation:
- Real-time CRUD sync from Zustand to Supabase: PARTIALLY TRUE.
  - Create/update flows are wired and observed in Supabase.
  - Reliability is improved by outbox retry, but still client-best-effort until full idempotency and conflict policy are added.
- Autoload from Supabase on app entry: TRUE (wired in `/app` layout and verified by reload + second session).
- Recovery flow (export/import/backup/restore): PARTIALLY TRUE.
  - Core paths exist and execute.
  - Requires additional conflict-safe merge policy and stronger guardrails for production confidence.
- Persistence reliability improved: TRUE, but not yet production-complete.

## 2. Runtime truth summary
Environments verified on 2026-03-18:
- Local app: `http://localhost:3000`
- Production app: `https://medremind-app-two.vercel.app/app`
- Local version endpoint: `{ "sha": "unknown", "environment": "development" }`
- Production version endpoint: `{ "sha": "b922441d6b4a8d74f8d586a53a33395c8e7fb1fc", "environment": "production" }`

Active Supabase project in local runtime:
- `NEXT_PUBLIC_SUPABASE_URL=https://hagypgvfkjkncznoctoq.supabase.co`

Key implication:
- Two app URLs exist because one is local dev and one is deployed production.
- They can show different state when local-only optimistic changes exist, when sync outbox has pending writes, or when users are effectively on different account/session contexts.

## 3. Persistence verification summary (CRUD + survival)
Verified via browser actions, network requests, and DB reads for authenticated test user:
- user_id: `c0ddfecc-6682-4dfa-92c2-79cf57b3d09c`
- email: `codex.audit.1773862726281@example.com`

Observed table counts after scenario:
- profiles: 1
- notification_settings: 1
- protocols: 2
- protocol_items: 6
- active_protocols: 1
- scheduled_doses: 120
- dose_records: 4
- doses for today: 2

Observed action status in `scheduled_doses`:
- taken: 1
- snoozed: 1
- pending: 118

Persistence survival checks:
- Refresh: PASS
- Logout/login same account: PASS
- Clear local store then reload (cloud rehydrate): PASS
- Second browser session same account: PASS

## 4. Recovery flow summary
Implemented and exercised paths:
- Export snapshot: UI path exists and produces snapshot payload from current store.
- Backup to Supabase: writes snapshot entities via import adapter.
- Restore/load from Supabase: `pullStoreFromSupabase()` repopulates store.
- Import snapshot: ingestion path exists via `importStoreSnapshotToSupabase()`.

Current assessment:
- Functional for normal flows.
- Needs stronger destructive/merge controls and explicit operator confirmation semantics for production-grade incident recovery.

## 5. Account linkage summary
Ownership binding in code and runtime:
- protocols.owner_id = auth user id
- protocol_items linked by protocol_id
- active_protocols.user_id = auth user id
- scheduled_doses.user_id = auth user id
- dose_records.user_id = auth user id
- profiles.id = auth user id
- notification_settings.user_id = auth user id

Read and write paths use authenticated user context. Account linkage in tested flows is correct.

## 6. Divergence analysis
### Confirmed divergence modes
1. Local optimistic state visible on one device, not visible on another device yet
- Cause: write fails or is delayed; local state updates immediately; outbox replay pending on originating device.
- Symptom: desktop shows latest actions, phone does not.

2. Different runtime environments (local dev vs production URL)
- Cause: local and deployed apps are different runtime contexts; local build may include unpushed changes.
- Symptom: behavior/data mismatch between `localhost` and Vercel.

3. Date-boundary visibility mismatch for “today”
- Cause: UI filters by local `yyyy-MM-dd`; per-device timezone/date can differ near midnight.
- Symptom: entries appear under adjacent day on phone vs desktop.

4. Partial sync windows during network instability
- Cause: background cloud writes can lag the UI action timeline.
- Symptom: temporary cross-session mismatch until replay completes.

### Existing mitigations
- Outbox queue with retry/backoff and online/visibility triggers.
- Sync status surfaced in settings page.

### Gaps to close
- Global sync indicator in main app shell.
- Explicit unsynced/dirty state marker on schedule actions.
- Server-side idempotency guarantees.

## 7. Incident-style defect log
| ID | Priority | Severity | Area | Reproduction | Expected | Actual | DB evidence | UI evidence | Likely cause | Fix direction | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|
| MEM-010 | P0 | Critical | Cross-device trust | Take dose on desktop while cloud write fails; open phone immediately | Same data on both devices | Desktop shows action, phone misses it until replay | missing new `dose_records` row during failure window | schedule diverges per device | optimistic local update before confirmed cloud commit | add stronger sync-state UX + replay visibility + forced flush control | Open |
| MEM-011 | P1 | High | Runtime drift | Use localhost and Vercel interchangeably | Consistent behavior expectation | Different behavior due to different runtime/deploy state | different version metadata (`development` vs `production`) | user sees mismatch between devices | environment ambiguity | show build/environment badge in UI and docs | Open |
| MEM-012 | P1 | High | Regenerate doses reliability | Regenerate where future rows have linked dose_records | Safe regeneration without FK failure | Prior FK delete failure occurred | FK violation (`dose_records_scheduled_dose_id_fkey`) | user-visible error toast/console | unsafe delete strategy | protect referenced rows; delete only safe rows | Fixed |
| MEM-013 | P1 | High | Active protocol hydration | Active protocol references protocol not in owner-owned set | Active protocols visible after pull | Previously hidden/missing active protocol details | active row existed without matching mapped protocol in pulled set | missing active cards | pull path omitted protocols referenced by active rows | fetch missing protocol ids from active rows | Fixed |
| MEM-014 | P2 | Medium | Protocol lifecycle sync | Delete protocol with related rows | Complete cloud cleanup, no orphans | Previously local-only cleanup risk | stale related rows possible | deleted locally but potential cloud leftovers | missing delete sync operation | add ordered cloud delete (`dose_records` -> `scheduled_doses` -> `active_protocols` -> `protocols`) | Fixed |

## 8. Repair and hardening sprint summary
What was fixed in code:
- Added protected regeneration logic to avoid deleting rows referenced by `dose_records`.
- Added cloud protocol delete sync and outbox operation support.
- Hardened pull path to include protocol rows referenced by active protocol entries.
- Improved local consistency when protocol/items are edited by updating embedded active protocol references.

Files touched in hardening pass:
- `src/lib/supabase/realtimeSync.ts`
- `src/lib/supabase/syncOutbox.ts`
- `src/lib/store/store.ts`
- `src/lib/supabase/cloudStore.ts`

User-visible reliability mechanisms:
- Outbox retry path for failed writes.
- Settings-level sync status visibility.

## 9. Re-test summary (post-fix)
Critical path rechecked:
- create protocol/item: PASS
- activate protocol: PASS
- take/skip/snooze: PASS
- refresh and relogin: PASS
- clear local storage + reload from cloud: PASS
- second session same account load: PASS
- regenerate doses with FK-sensitive history: PASS after fix

## 10. Remaining risks
- Outbox is still device-local; no shared server queue.
- No strict server idempotency key enforcement for all mutation classes.
- No conflict-resolution policy beyond practical last-write behavior.
- No global sync-health indicator in header/schedule action surface.
- No fully automated persistence matrix test suite in CI yet.

## 11. Next recommended sprint (highest value)
1. Add global sync state indicator (header + schedule cards): `synced / pending / error`.
2. Add "flush pending sync now" control and blocking warning on logout when outbox not empty.
3. Add idempotency token column/strategy for dose action writes and regeneration operations.
4. Add Playwright persistence matrix in CI against dedicated Supabase test project.
5. Add timezone-aware day binding checks and explicit day-shift UI hint when device timezone differs from profile timezone.

---

## Focused plan for "desktop has today data, phone does not"
Immediate execution plan:
1. Capture both devices' runtime identity: app URL, build SHA, user id, timezone, local date.
2. Confirm pending outbox on desktop at time of mismatch.
3. Compare `scheduled_doses` + `dose_records` rows for same user_id and same date window in Supabase.
4. Verify phone is loading from cloud pull (not stale local-only cache) by clearing local store and reopening.
5. If mismatch is replay lag: add stronger pending-sync UI and manual flush action.
6. If mismatch is date boundary: add timezone/day reconciliation rule for "today" label.

Acceptance criteria for closure:
- Same account sees identical taken/skipped/snoozed state on desktop and phone within defined sync SLA.
- No silent local-only success state without user-visible pending/error indicator.
- Incident checklist and reproducible test script committed in docs.
