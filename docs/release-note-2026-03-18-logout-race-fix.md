# Release Note: Logout Race Persistence Fix

> **Historical document:** This is a point-in-time snapshot for audit and context only.
> It does not override the current source-of-truth documents listed in `docs/system-logic.md`.

Date: 2026-03-18
Scope: activation + snooze persistence across logout/relogin

> Historical release note (point-in-time). Current source of truth is the current-main docs pack: `docs/agent-handoff-current-main.md`, `docs/architecture-current-main.md`, `docs/auth-and-persistence-current-main.md`, `docs/domain-and-schedule-current-main.md`, and `docs/current-status-and-next-phase.md`.

## Bug
Users could activate a protocol and snooze a dose, then logout quickly and lose this state after relogin.

## Root cause
Sign out protection only flushed the outbox queue. It did not wait for in-flight realtime writes started by `syncFireAndForget`, creating a race window where signout could happen before cloud writes completed.

## Fix
1. Added in-flight realtime sync tracking in `src/lib/store/store.ts`.
2. Added `waitForRealtimeSyncIdle(timeoutMs)` and wired sign out to wait for in-flight writes first.
3. Kept outbox flush as a second guard.
4. If sync is still pending after timeout, sign out asks explicit confirmation.

## User-visible behavior change
- Fast logout no longer silently drops recent activation/snooze changes.
- Sign out now protects recent writes by waiting for in-flight sync first.
- Confirmation appears only when sync is still pending or timed out.

## Verification evidence that closed incident
- Scenario A (normal flow): pass.
- Scenario B (fast logout race): pass.
- Second clean browser session (same account): pass.
- Supabase evidence: active protocol rows and snoozed scheduled dose rows persisted with correct `user_id` and were restored after relogin.
