# Wire Oura Analytics Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect the existing Oura analytics storage foundation to the authenticated health sync route.

**Architecture:** Keep `/api/integrations/health/sync` as the user-triggered runtime entry point. Add a focused helper that converts fetched Oura collection payloads into raw document inputs, endpoint coverage records, and daily derived health feature inputs, then have the route persist those through `analyticsStore` before preserving the current normalized health snapshot write.

**Tech Stack:** Next.js App Router, TypeScript, Supabase service-role writes, existing Oura V2 client helpers, Node unit tests.

---

### Task 1: Oura Analytics Helper

**Files:**
- Create: `src/lib/oura/analyticsSync.ts`
- Modify: `tests/unit/ouraAnalyticsStore.test.ts`
- Modify: `package.json`

- [ ] Write failing tests for raw document input construction, daily health feature construction, and sync window helpers.
- [ ] Implement a pure helper that maps Oura collections to analytics store inputs.
- [ ] Add the helper file to `npm run test:unit` compile inputs.

### Task 2: Health Sync Route Wiring

**Files:**
- Modify: `src/app/api/integrations/health/sync/route.ts`

- [ ] Start an Oura sync run for the requested range.
- [ ] Record endpoint coverage for every fetched collection.
- [ ] Upsert raw documents and daily health features before normalized snapshots.
- [ ] Finish the sync run as success, partial success, or failed.
- [ ] Prune raw documents using the 90-day retention helper after successful sync.

### Task 3: Docs And Verification

**Files:**
- Modify: `docs/current-status.md`
- Modify: `docs/agent-handoff-current-main.md`

- [ ] Document that raw Oura analytics storage is now wired into health sync.
- [ ] Run `npm run test:unit`.
- [ ] Run `npm run build`.
