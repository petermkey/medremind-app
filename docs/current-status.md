# MedRemind Current Status

Date: 2026-03-19
Owner: engineering runtime status on current main

## 1. Current maturity

Overall: beta, with focused hardening already landed across auth, protocol/schedule boundaries, sync/idempotency, and accessibility.

## 2. Stable areas on current main

- Confirmation-aware register and login confirmation handling (with resend + cooldown)
- Onboarding and settings profile save non-blocking behavior
- App layout auth bootstrap hardening (no indefinite spinner lock path)
- Protocol creation/finalization ID hardening and safe fallback ID generation
- Fixed-duration validation and inclusive activation end-date behavior
- Active-dose reconciliation when protocol duration changes
- Live protocol resolution during regeneration
- Deterministic import IDs for active protocols, doses, and records
- Sync outbox retry lifecycle + guarded sign-out flow
- Improved swipe targeting and action accessibility labels in key schedule/protocol rows
- Progress screen lifecycle-aware selector path (avoids raw `scheduledDoses` scans)
- Schedule calendar date projection uses lifecycle-aware selector path (`selectCalendarVisibleDoseDates`)
- Protocol Detail lifecycle-aware read path (`selectProtocolDetailReadModel`)
- Take action command path with client operation id/idempotency (`syncTakeDoseCommand`)
- Skip action command path with client operation id/idempotency (`syncSkipDoseCommand`)
- Snooze action command path with client operation id/idempotency (`syncSnoozeDoseCommand`)
- Take/skip command paths write-through into additive `execution_events`

## 3. Partially hardened / still fragile areas

- Auth policy is still split across proxy and client layout logic.
- Domain scheduling rules are centralized in `store.ts` and tightly coupled to persistence/sync concerns.
- Outbox remains device-local and can accumulate under prolonged failure conditions.
- PWA is partial (manifest + icons present; no explicit service-worker runtime path).

## 4. Deferred larger initiatives

Future work should continue only from fresh scoped branches off `main`:

1. Auth and email confirmation redesign
2. Domain and schedule engine redesign
3. UI and PWA pack audit

See `docs/current-status-and-next-phase.md` for detailed track framing.

## 5. Quality gate expectation for next slices

Minimum before merge:

1. `npm run build`
2. Focused flow checks for touched behavior
3. No mixed-concern commits
4. Documentation update in same change when behavior changes
