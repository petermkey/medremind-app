# MedRemind Current Status

Date: 2026-03-19
Owner: engineering runtime status on current `main`

## 1. Current maturity

Overall: beta with hardened auth/session flows, lifecycle command paths, additive write-through paths, read-model selector migration, and migration tooling landed.

## 2. Landed behavior on main

## Auth and onboarding

- Confirmation-aware register flow (`hasSession`-aware).
- Register/login confirmation resend actions with cooldown.
- Non-blocking profile saves in onboarding and settings.
- App-layout bootstrap hardening (no indefinite lock on auth bootstrap failure).
- Cross-account local-state reset guard on user identity changes.

## Lifecycle and schedule

- Fixed-duration validation and inclusive activation `endDate` behavior.
- Duration-change reconciliation regenerates future rows safely.
- Regeneration uses live protocol reference and preserves handled history.
- Snooze uses replacement-row semantics (original -> `snoozed`, replacement -> `pending`).
- Archive path is lifecycle-aware (`deleteProtocol` archives when history exists).

## Command-based sync and additive write-through

- Dose commands: `syncTakeDoseCommand`, `syncSkipDoseCommand`, `syncSnoozeDoseCommand`.
- Lifecycle commands: `syncPauseProtocolCommand`, `syncResumeProtocolCommand`, `syncCompleteProtocolCommand`, `syncArchiveProtocolCommand`.
- Additive execution write-through is active for take/skip/snooze into `execution_events`.
- Activation write-through is active for future rows into `planned_occurrences` (`source_generation = activation_write_through_c4`).

## Read-model selector migration (landed)

- `/app` actionable list, next-dose, and summary metrics use selector-based paths.
- Progress uses lifecycle-aware selectors.
- Protocol Detail uses `selectProtocolDetailReadModel`.
- Calendar date projection uses `selectCalendarVisibleDoseDates`.
- Past-date history surface uses `selectHistoryDayRows`.

## 3. Landed migration/tooling status

Landed implementation slices on `main`:

- A1, A2, A3, A4, A5
- B1, B2, B3, B4, B5
- C1, C2, C3, C4, C5
- D1, D2, D4
- D3 tooling implementation is landed and available for operational runs

## 4. Remaining work categories

## Operational (live environment execution)

- D2 dry-run/apply/rerun validation on real data.
- D3 dry-run/apply/rerun validation on real data.
- C5 parity validation runs and anomaly triage.
- D4 consistency checks and severity triage.

## Deferred larger tracks (not current behavior)

1. Auth and email-confirmation architecture redesign.
2. Domain/schedule engine redesign and test deepening.
3. UI/PWA pack audit.

## 5. Risks still requiring discipline

- Auth policy remains split across proxy and client bootstrap.
- Store domain and sync concerns remain tightly coupled in `store.ts`.
- Outbox remains device-local and can accumulate under prolonged failures.

## 6. Quality gate expectation for future slices

Minimum before merge:

1. `npm run build`
2. Focused behavior checks for touched scope
3. No mixed-concern commits
4. Same-branch docs update for any behavior/process changes
