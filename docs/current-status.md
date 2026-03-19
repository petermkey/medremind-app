# MedRemind Current Status

Date: 2026-03-18
Owner: engineering runtime status

## 1. Current maturity

Overall: **beta with hardened client-side sync**, not yet production-closed for all reliability criteria.

What is stable in current codebase:

- Auth bootstrap with account-bound cloud pull
- Optimistic local CRUD with retry outbox
- Global sync status visibility in app shell
- Manual outbox flush and guarded sign-out
- Protocol metadata and composition editing
- Dose actions (take/skip/snooze with multiple options)
- Pause/resume behavior aligned with schedule visibility rules

## 2. Recently resolved issues

- Cross-account local state bleed at auth boundary
- Missing protocol item composition editing in protocol edit flow
- Snooze hardcoded to 15 minutes only
- Skip leaving item in active queue
- Paused protocols still visible in active today/future schedule
- Register flow mismatch when signup required email confirmation but no active session
- Fixed-duration protocol input/activation boundary issues (now validated + normalized)
- Limited accessibility labels on secondary row actions (protocol swipe actions, card skip/snooze)

## 3. Current behavior summary

- Cloud read/write target: Supabase project from environment variables.
- Schedule visibility:
  - today/future: only doses from active protocol instances
  - past dates: historical doses remain visible
- Snooze supports 4 choices: 15m, 1h, this evening, tomorrow.
- Skip marks dose skipped and removes it from active queue view.

## 4. Known unresolved risks

- Outbox is local-device only and can grow with large payloads.
- No server-side generalized idempotency keys for all write classes.
- No automated persistence matrix in CI yet.
- Conflict handling remains last-write-wins.

## 5. Technical debt hotspots

- Store module carries both domain logic and sync orchestration in one file.
- Recovery/import has limited conflict-safe merge semantics.
- E2E coverage for cross-session and failure-injection scenarios is manual.

## 6. Recommended next engineering priorities

1. Add automated Playwright persistence matrix (refresh/relogin/second-session/outbox failure).
2. Add server-side idempotency constraints for dose action and regeneration-sensitive writes.
3. Add outbox operation compaction to reduce redundant queued writes.
4. Add explicit environment/build badge enforcement for all user-facing deployments.
