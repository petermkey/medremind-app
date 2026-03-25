# Protocol Lifecycle (Current Main)

Date: 2026-03-25  
Status: implementation snapshot on current `main`

## Scope

This document describes the lifecycle behavior currently implemented on `main` for:

- protocol activation and status transitions
- dose actions (take/skip/snooze)
- archive vs hard-delete behavior
- duration-change regeneration behavior

This document is not the authority specification.
Authoritative lifecycle behavior is defined in `docs/lifecycle-contract-v1.md`.
If this document and the lifecycle contract diverge, the lifecycle contract is correct.

## Current implementation summary

- Lifecycle actions exist in `src/lib/store/store.ts`: `pauseProtocol`, `resumeProtocol`, `completeProtocol`, `deleteProtocol`.
- Sync command paths exist in `src/lib/supabase/realtimeSync.ts` for pause/resume/complete/archive.
- Archive-on-delete is implemented when handled history exists; hard delete is used when no handled history exists.
- Snooze uses replacement-row semantics and lineage metadata in `DoseRecord.note`.
- Automatic completion on `endDate` is not implemented (user-initiated completion only).

## Known implementation gaps on main (vs lifecycle plan and contract intent)

As of 2026-03-25, the following gaps are still present on `main`:

1. Store-level lifecycle transition guards are incomplete.
`pauseProtocol`/`resumeProtocol`/`completeProtocol` do not consistently reject illegal transitions before local mutation.

2. Local invariants can be temporarily inconsistent.
`pausedAt` is not always cleared locally on completion/archive until server round-trip.

3. Timezone guarding is partially inconsistent.
`isFutureDoseByDate` uses profile timezone, while some other date boundaries still use generic `today()` behavior.

4. Duration-regeneration targeting is broader than intended.
`updateProtocol` excludes `completed` but does not explicitly limit regeneration to `active|paused`.

5. Protocols list default UX still hides paused instances in the default active filter.

6. Delete confirmation text does not pre-disclose whether outcome is archive or hard delete.

7. End-of-course UX lacks an explicit “course finished” explanation/CTA when active instance has no future rows.

## PLAN2p status (2026-03-25)

- Option A (minimal correctness hardening): **pending on main**
- Option B (UX-first lifecycle refinement): **pending on main**
- Option C (domain evolution): **not started; decision pending product use-case**

## Recommended execution order

1. Implement Option A on a dedicated slice branch.
2. Implement Option B on a dedicated slice branch.
3. Re-evaluate Option C only after product confirmation on duplicate-instance policy.
