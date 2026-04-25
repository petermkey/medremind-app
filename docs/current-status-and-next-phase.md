# Current Status and Next Phase (Current Main)

Date: 2026-04-17
Source: current `main`

## 1. Current phase summary

Implementation phase for lifecycle migration slices is largely complete on `main`.
Current phase is operational execution and validation on real data.

## 2. What is implementation-complete on main

- Additive schema readiness and runtime-safe coexistence with legacy tables.
- Command-based write paths for dose and lifecycle transitions.
- Additive execution write-through for take/skip/snooze.
- Planned future write-through at activation time.
- Lifecycle-aware selector/read-model migration for app/progress/protocol-detail/calendar/history surfaces.
- Operational tooling scripts for D2, D3, C5, and D4.

## 3. What remains operational (not new coding)

Required live-run sequence:

1. Preflight (branch clean + required environment)
2. D2 dry-run
3. D2 user-scoped apply
4. D2 user-scoped rerun convergence check
5. D3 dry-run
6. D3 user-scoped apply
7. D3 user-scoped rerun convergence check
8. C5 parity validation
9. D4 consistency checker
10. Consolidated anomaly triage + recommendation

## 4. Safety gates for operational runs

- Always run dry-run before apply.
- Start with user-scoped runs before wider rollout.
- Stop if required credentials are missing.
- Stop broader apply when severe anomalies appear.
- Keep exact command/output audit trail.

## 5. Explicit deferred work

The following are deferred architecture tracks, not current behavior:

1. Auth and email-confirmation redesign.
2. Domain/schedule engine redesign.
3. UI/PWA packaging and offline strategy audit.

## 6. What not to do in this phase

- Do not implement broad new runtime behavior while operational validation is pending.
- Do not run migration apply operations without preflight and scoped dry-run evidence.
- Do not treat historical branch docs as source-of-truth.
