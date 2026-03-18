# Production Persistence Verification (SHA 5e182e7)
Date: 2026-03-18
Environment: production
URL: https://medremind-app-two.vercel.app/app
Version endpoint: /api/version => sha 5e182e75dc9d31c0c8815a97228f40a951b30af9
Supabase: https://hagypgvfkjkncznoctoq.supabase.co

> Historical production verification snapshot for this specific SHA. Current behavior source of truth is `docs/system-logic.md` and `docs/current-status.md`.

## Scope
Live verification on deployed build after incident fixes:
- protocol CRUD persistence
- dose action persistence
- ownership linkage
- refresh/relogin persistence
- manual flush and safe logout behavior
- recovery flows
- clean local state reload from cloud

## Test identity
- account email: prod.matrix.20260318.2019@example.com
- user id: dac11009-31f5-4c61-94cb-8a2152e805e8

## Runtime truth
- Deploy alias points to new build and serves SHA `5e182e7`.
- Read and write traffic use same Supabase project.
- Auth-bound reads filter by expected owner semantics:
  - protocols via `owner_id`
  - active_protocols/scheduled_doses/dose_records/settings via `user_id`

## Verification matrix

### Scenario A: protocol create + activate
Status: VERIFIED
- Created `PROD-MATRIX-A-2019` with 2 items and activated.
- Network: successful upserts to `protocols`, `protocol_items`, `active_protocols`, `scheduled_doses`.
- DB: rows present under user `dac11009-...`.

### Scenario B: protocol update + item edit/remove
Status: PARTIAL (UI capability gap)
- Updated protocol name/description to `PROD-MATRIX-A-2019-EDIT`.
- Edited item `PROD-MED-1 -> PROD-MED-1-EDIT`, amount `15`.
- Deleted second item.
- Persisted correctly in DB.
- Gap: no direct "add new item" control in protocol detail edit flow.

### Scenario C: dose actions (take/skip/snooze)
Status: VERIFIED
- Performed `take`, `skip`, `snooze` on separate doses.
- UI reflected expected statuses.
- Network observed `PATCH scheduled_doses` and `POST dose_records`.
- DB shows status mix for today and corresponding `dose_records`.

### Scenario D: pause/resume/complete
Status: VERIFIED
- Custom protocol transitioned `active -> paused -> active -> completed`.
- Persisted in `active_protocols` with `completed_at` set.

### Scenario E: manual flush + safe logout
Status: VERIFIED
- Simulated dose-record write failures by blocking `dose_records` API.
- UI switched to sync error with pending count.
- `Flush sync now` truthfully reported still pending while blocked.
- After unblocking, flush cleared queue and returned to synced.
- Safe logout showed confirm gate:
  - `There are still 1 unsynced change(s). Sign out anyway?`

### Scenario F: clean-state cloud reload
Status: VERIFIED
- Cleared local keys `medremind-store` and `medremind-sync-outbox-v1`.
- Reloaded app while authenticated.
- State restored from Supabase (same schedule/progress/profile data).

### Scenario G: recovery
Status: VERIFIED
- Export snapshot: file downloaded.
- Backup current to cloud: completed with entity counts.
- Restore from cloud: completed with expected counts.
- Load from local storage + import to cloud: completed.

## Database evidence summary
Queried directly as test account:
- protocols: 2
- active_protocols: 2
- scheduled_doses: 540
- dose_records: 4
- notification_settings: 1

Today dose status counts:
- skipped: 3
- snoozed: 1
- taken: 1
- pending: 1

Ownership consistency verified:
- `protocols.owner_id == user_id`
- `active_protocols.user_id == user_id`
- `scheduled_doses.user_id == user_id`
- `dose_records.user_id == user_id`

## Defects observed in this production pass
1. PRODMAT-001 (P1): Protocol detail lacks direct "add item" action.
- Impact: editing existing protocols requires workaround; UX/operability gap.

2. PRODMAT-002 (P2): Login form prefilled with prior credentials on sign-out page.
- Likely browser autofill/shared device risk; should be mitigated at app UX level (autocomplete policies, explicit field reset cues).

## Closure assessment for this production pass
Decision: PARTIALLY CLOSED
- Proven on production SHA:
  - CRUD + dose action persistence to Supabase
  - refresh/relogin and cloud reload behavior
  - ownership linkage consistency
  - manual flush and safe logout guard behavior
- Remaining to fully close with stricter bar:
  - resolve protocol-detail item-add UX gap
  - add automated production-like persistence matrix in CI
  - harden login autofill handling for shared-device safety
