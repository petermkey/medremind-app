# Release Note — Swipe Targeting Fix (2026-03-18)

> **Historical document:** This is a point-in-time snapshot for audit and context only.
> It does not override the current source-of-truth documents listed in `docs/system-logic.md`.

> Historical release note (point-in-time). Current source of truth is the current-main docs pack: `docs/agent-handoff-current-main.md`, `docs/architecture-current-main.md`, `docs/auth-and-persistence-current-main.md`, `docs/domain-and-schedule-current-main.md`, and `docs/current-status-and-next-phase.md`.

## Bug
In Schedule medication rows, swiping one visible item could occasionally result in inconsistent row behavior (neighbor row appearing to move/open), especially in dense lists and after scroll interactions.

## Root Cause
Row swipe handling relied on basic touch start/end delta logic without robust cancellation/scroll discrimination, which made gesture targeting fragile in mobile interaction patterns.

## Fix
- Switched row gesture handling to pointer-based touch interactions.
- Added gesture reset on cancel.
- Added vertical-scroll guard so pan gestures do not trigger swipe open.
- Added row identity marker for verification (`data-dose-id`).
- Ensured only one row stays swipe-open at a time.

## Verification
- Verified in mobile browser emulation on `/app` with stress sequence: A -> B -> A, scroll, date switch.
- Verified Snooze and Skip requests target the same swiped medication row.
- No duplicate-key rendering warnings observed in this flow.

## Remaining Gap
- Real physical phone verification is still pending.
