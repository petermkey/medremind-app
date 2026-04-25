# Incident Live Verification & Closure Pass
Date: 2026-03-18
Owner: CTO / Backend Reliability / QA

> **Historical document:** This is a point-in-time snapshot for audit and context only.
> It does not override the current source-of-truth documents listed in `docs/system-logic.md`.

> Historical incident closure pass. For current runtime logic and status, use `docs/system-logic.md` and `docs/current-status.md`.

## 1. Executive summary
Verified live persistence chain against real runtime (`http://localhost:3000`), real Supabase project (`hagypgvfkjkncznoctoq`), real authenticated users, browser UI/network, and direct database reads.

Key result:
- A **P0 incident cause** was reproduced: cross-account local state bleed where a newly authenticated user could see prior account data from persisted local state.
- The P0 was fixed in this session and re-tested.
- Real-time CRUD + dose action persistence were validated with DB evidence.
- Manual flush and safe logout behaviors were validated, including pending-sync warning.

Closure decision: **Partially closed**.
Reason: core persistence-loss path was fixed and revalidated locally across refresh/relogin/second session, but production deploy verification on the same fixed commit remains unproven in this pass.

## 2. Runtime truth summary
Active environment and connections used for live validation:
- App URL: `http://localhost:3000`
- Version endpoint: `GET /api/version` => `sha: "unknown", environment: "development"`
- Supabase URL: `https://hagypgvfkjkncznoctoq.supabase.co`
- Auth mode: client anon key + Supabase Auth session

Test account used in closure pass:
- Email: `incident.qa.20260318.2002@example.com`
- User ID: `9d66965b-7a1e-452e-888d-3fa478ff2b98`

## 3. Ownership and persistence summary
Ownership model verified as consistent:
- `protocols.owner_id = auth.user.id`
- `active_protocols.user_id = auth.user.id`
- `scheduled_doses.user_id = auth.user.id`
- `dose_records.user_id = auth.user.id`
- `profiles.id = auth.user.id`
- `notification_settings.user_id = auth.user.id`

Create/read parity verified:
- Writes target the same owner semantics used in read filters.
- Reload/relogin/clean-session data was restored from cloud.

## 4. Live verification matrix

### Scenario A: Protocol create & persist
- Action: login -> create custom protocol + 2 items -> activate.
- UI: protocol visible and active.
- Network: `POST/UPSERT` to `protocols`, `protocol_items`, `active_protocols`, `scheduled_doses`.
- DB: rows created for test user.
- Refresh: PASS.
- Relogin: PASS.
- Status: **Verified**.

### Scenario B: Protocol update and item edit/remove
- Action: rename protocol, edit one item, delete one item.
- UI: updates reflected.
- Network: update + delete requests observed.
- DB: updated protocol name and item set persisted.
- Refresh/relogin: PASS.
- Status: **Verified**.

### Scenario C: Dose actions
- Action: take one dose, skip one dose, snooze one dose.
- UI: status chips updated.
- Network: `PATCH scheduled_doses`, `UPSERT dose_records`.
- DB: status and action rows persisted for same user.
- Refresh/relogin: PASS.
- Status: **Verified**.

### Scenario D: Pause/resume/complete
- Action: pause -> resume -> complete.
- UI: lifecycle reflected.
- Network: active protocol updates observed.
- DB: final status `completed` with completion timestamp.
- Status: **Verified**.

### Scenario E: Manual flush and safe logout
- Action: force pending sync (blocked write), click flush, then unblock and flush again; attempt logout with pending.
- UI: pending count visible; warning prompt on sign-out with unsynced ops.
- Network/DB: blocked run left pending; subsequent flush replayed and cleared pending.
- Status: **Verified (truthful behavior)**.

### Scenario F: Second clean session
- Action: clear local store + open independent clean browser context.
- Result: same account data loaded from Supabase.
- Status: **Verified**.

### Scenario G: Recovery checks
- Action: export snapshot, backup current to cloud, restore from cloud, import with overlap.
- Result: flows executed end-to-end; no destructive duplication observed in pass.
- Status: **Verified with residual risk** (needs stricter merge/idempotency policy for production hard guarantees).

## 5. Database evidence summary
Representative post-action evidence for user `9d66965b-7a1e-452e-888d-3fa478ff2b98`:
- `protocols`: expected test protocol rows present.
- `protocol_items`: reflects edits/deletions.
- `active_protocols`: status transitions persisted.
- `scheduled_doses`: today statuses include `taken/skipped/snoozed` where expected.
- `dose_records`: action log rows created with matching `user_id`.

## 6. Divergence analysis
Confirmed divergence modes before/without safeguards:
1. Optimistic local update can temporarily diverge from cloud when network/write fails.
2. Different runtime contexts (`localhost` vs deployed URL) can show different states.
3. Local persisted state can leak across auth transitions if not reset.

This pass fixed the highest-risk confirmed divergence:
- **Cross-account local bleed (P0)** removed by resetting user-scoped state on auth boundary and enforcing cloud boot behavior in layout.

## 7. Structured defect log

### MEM-CLOSE-001
- Priority: P0
- Severity: Critical
- Area: Auth boundary / local persistence
- Title: Cross-account state bleed after logout/login
- Repro: logout user A -> register/login user B -> schedule shows A data.
- Expected: user B sees only user B state.
- Actual: stale user A local persisted data visible.
- Evidence: local storage contained mixed profile/user-scoped records.
- Cause: sign-out did not clear user-scoped Zustand slices; boot logic could skip cloud reset path.
- Fix: reset user-scoped data on sign-out/login/register and enforce auth bootstrap ownership checks.
- Status: **Fixed + re-tested**.

### MEM-CLOSE-002
- Priority: P1
- Severity: High
- Area: UX reliability signal
- Title: Global sync indicator could obstruct protocol actions
- Repro: floating sync pill overlapped controls on protocols page.
- Expected: visibility without interaction blocking.
- Actual: intermittent click obstruction risk.
- Fix: moved pill to non-blocking lower-left container with pointer-events hardening.
- Status: **Fixed**.

### MEM-CLOSE-003
- Priority: P1
- Severity: High
- Area: Recovery hard guarantees
- Title: Import/restore correctness depends on client ordering and current merge behavior
- Repro: overlapping import/restore under existing data.
- Expected: deterministic idempotent merge.
- Actual: worked in tested path, but still lacks stronger server-side idempotency policy for all mutation classes.
- Status: **Open (hardening)**.

## 8. Repair sprint summary
Files changed in this closure pass:
- `src/lib/store/store.ts`
  - added `resetUserData` and invoked from `signOut`.
  - ensured user-scoped slices are cleared on account boundary.
- `src/app/app/layout.tsx`
  - always performs auth bootstrap; resets on ownership mismatch before cloud pull.
- `src/app/(auth)/login/page.tsx`
  - resets user-scoped state before setting profile.
- `src/app/(auth)/register/page.tsx`
  - resets user-scoped state before first profile bootstrap.
- `src/lib/supabase/syncOutbox.ts`
  - added clear/reset support for auth boundary protection.
- `src/app/app/settings/page.tsx`
  - integrated outbox clearing into sign-out/delete flows.
- `src/components/app/SyncStatusPill.tsx`
  - non-blocking placement/interaction behavior.

## 9. Re-test summary after repairs
Re-tested after code changes:
- protocol create/update/delete item persistence: PASS
- dose action persistence: PASS
- refresh and relogin persistence: PASS
- second clean session load from cloud: PASS
- manual flush semantics: PASS
- safe logout warning with pending ops: PASS
- cross-account contamination regression: PASS (no bleed)

## 10. Incident closure decision
Decision: **Partially closed**.

Strict justification:
- All critical closure criteria were proven in local runtime and DB evidence for tested account.
- However, closure criteria for production incident should include proof on deployed build containing these exact fixes.
- This pass did not include verified production deployment + post-deploy rerun matrix on Vercel URL with same commit SHA.

To mark fully **Closed**, run the same matrix on deployed build SHA and confirm parity.

## 11. Remaining risks
- Server-side idempotency protections are still limited for full conflict-proof guarantees.
- No automated CI persistence matrix against Supabase test project.
- Deployed/runtime drift can still confuse operators without explicit environment/build badge.

## 12. Next recommended sprint
1. Deploy current fixes and run full matrix on production URL with captured SHA.
2. Add server-side idempotency keys/constraints for dose action and regeneration-sensitive writes.
3. Add automated Playwright persistence matrix in CI (refresh/relogin/second-session/outbox failure tests).
4. Add visible environment/build badge to reduce local-vs-prod confusion.
