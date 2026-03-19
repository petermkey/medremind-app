# MedRemind System Logic (Current)

Date: 2026-03-19
Status: source-of-truth index for current main

## 1. Source-of-truth map

This file is the top-level logic index.
Detailed behavior docs are now split into:

- `docs/architecture-current-main.md`
- `docs/auth-and-persistence-current-main.md`
- `docs/domain-and-schedule-current-main.md`
- `docs/current-status-and-next-phase.md`
- `docs/agent-handoff-current-main.md`

If any statement here conflicts with code, code on current `main` wins.

## 2. Core logic summary

- Local-first domain state is in `src/lib/store/store.ts` (Zustand + persist).
- Cloud sync is in `src/lib/supabase/realtimeSync.ts` with outbox retries in `src/lib/supabase/syncOutbox.ts`.
- Auth/session routing is split between `src/proxy.ts` and `src/app/app/layout.tsx`.
- Protocol and schedule generation are store-driven and enforce fixed-duration inclusive end boundaries.

## 3. Critical invariants to preserve

1. No indefinite auth bootstrap spinner in app layout.
2. No false onboarding entry when signup has no immediate session.
3. Fixed-duration protocols use inclusive end-date boundaries.
4. Duration changes on active protocols reconcile future doses immediately.
5. Import/restore uses deterministic ID mapping for protocol-related entities.
6. Sign-out protects pending sync (in-flight and outbox) before clearing local state.

## 4. Recently landed hardened slices on main

- Protocol finalization and protocol-flow ID hardening
- Deterministic import ID mapping for restore idempotency
- Signup profile ID safeguard
- Confirmation-aware register flow + resend action + resend cooldown
- Onboarding/settings non-blocking profile save
- Layout boot hardening against indefinite spinner on auth bootstrap failure
- AddDoseSheet active-instance resolution fix
- Fixed-duration validation, activation end-date inclusion, and duration-change reconciliation
- Accessibility and swipe-targeting fixes for schedule/protocol interactions

## 5. Historical docs policy

Files in `docs/` with incident/release timestamp naming are historical audit artifacts.
They are useful for timeline context only and must not override current-main behavior docs.
