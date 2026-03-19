# Sprint 2B Read-Model Plan (Historical Design Snapshot)

Date: 2026-03-19
Status: historical design artifact (not current source-of-truth)

## Historical context

This file captured the read-model migration plan before implementation slices were completed.
It remains useful for design rationale, not for current behavior truth.

## Current truth location

For current landed read paths and selector behavior, use:

- `docs/domain-and-schedule-current-main.md`
- `docs/current-status.md`
- `src/lib/store/store.ts`

## Landed outcome summary (high level)

- Lifecycle-aware selector migration is already landed for app/progress/protocol-detail/calendar/history surfaces.
- Legacy raw scan paths described in old planning sections are no longer the primary intended model.
