# Sync Tail Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining edges of the V2 sync fix (2026-06-11 audit): dose removal that misses legacy-keyed rows, unlinked events in the import path, the offline-take boot race, data debt (legacy keys, stale ledger, e2e users), and helper duplication.

**Architecture:** Reuse `resolvePlannedOccurrenceId` for removal; link import-path events the same way migration 013 did; flush the outbox before the boot pull replaces local state; one data migration (015) normalizes legacy occurrence keys and purges noise; ID-derivation helpers consolidate into one module.

**Tech Stack:** Next.js 15, Supabase Postgres (manual migrations via Management API), Playwright E2E (supports `context.setOffline`).

---

## Multi-agent orchestration

One agent per branch/PR; agents in the same wave touch disjoint files and run in parallel (worktree isolation). **Never push to `main`.** Migration 015 is applied to prod by the orchestrator after PR review — subagents only author the SQL file.

| Wave | Agent | Branch | Tasks | Files (conflict domain) |
|---|---|---|---|---|
| 1 | B1 | `codex/v2-remove-and-import-link` | 1, 2 | `realtimeSync/doses.ts`, `realtimeSync/helpers.ts`, `importStore.ts`, e2e spec |
| 1 | B2 | `codex/v2-data-cleanup-015` | 4 | `supabase/015_*.sql` only |
| 2 | B3 | `codex/v2-offline-flush-before-pull` | 3 | `app/app/layout.tsx`, e2e spec |
| 2 | B4 | `codex/shared-id-helpers` | 5, 6 | `src/lib/ids.ts` (new), `storeHelpers.ts`, `realtimeSync/helpers.ts`*, docs |

*B4 touches `realtimeSync/helpers.ts` like B1 — that is why B4 runs in wave 2, after B1 merges.

**Gate after every wave (orchestrator):** `npx tsc --noEmit` && `npm run test:unit` && `npm run build` && `npx playwright test tests/e2e/doseStatusPersistence.spec.ts`.

---

### Task 1: removeDose resolves the occurrence instead of guessing the key

**Problem:** `syncRemoveDoseCommand` deletes by canonical `occurrence_key` only ([doses.ts:166]); 451 live future rows still carry `legacy-dose:<uuid>` keys → the cloud delete silently no-ops and the dose resurrects on the next pull. Also, deleting an occurrence that has linked events would orphan them (FK `on delete set null`).

**Files:**
- Modify: `src/lib/supabase/realtimeSync/helpers.ts` (add `options` param to `resolvePlannedOccurrenceId`)
- Modify: `src/lib/supabase/realtimeSync/doses.ts:153-166` (`syncRemoveDoseCommand`)
- Modify: `tests/e2e/doseStatusPersistence.spec.ts` (new test)

- [ ] **Step 1: Make creation optional in the resolver.** Change the signature in `helpers.ts`:

```ts
export async function resolvePlannedOccurrenceId(
  userId: string,
  dose: ScheduledDose,
  options?: { createIfMissing?: boolean },
): Promise<string | null> {
```

and wrap the tier-4 write-through block (the final `upsert` + re-select) in:

```ts
  if (options?.createIfMissing === false) return null;
```

placed immediately before the existing tier-4 `upsert` call. Existing callers keep default behavior.

- [ ] **Step 2: Rewrite `syncRemoveDoseCommand` in `doses.ts`:**

```ts
export async function syncRemoveDoseCommand(userId: string, dose: ScheduledDose): Promise<void> {
  const supabase = getSupabaseClient();
  const occurrenceId = await resolvePlannedOccurrenceId(userId, dose, { createIfMissing: false });
  if (!occurrenceId) return; // nothing in the cloud to remove

  const { data: events, error: eventsErr } = await supabase
    .from('execution_events')
    .select('id')
    .eq('user_id', userId)
    .eq('planned_occurrence_id', occurrenceId)
    .limit(1);
  if (eventsErr) throw new Error(`removeDose events check failed: ${eventsErr.message}`);

  if (events?.length) {
    // History exists — cancel the slot instead of deleting (a delete would
    // orphan the events via the on-delete-set-null FK).
    const { error } = await supabase
      .from('planned_occurrences')
      .update({ status: 'cancelled' })
      .eq('user_id', userId)
      .eq('id', occurrenceId);
    if (error) throw new Error(`removeDose occurrence cancel failed: ${error.message}`);
    return;
  }

  const { error } = await supabase
    .from('planned_occurrences')
    .delete()
    .eq('user_id', userId)
    .eq('id', occurrenceId)
    .eq('status', 'planned');
  if (error) throw new Error(`removeDose occurrence delete failed: ${error.message}`);
}
```

- [ ] **Step 3: Run `npx tsc --noEmit` — expect clean.**

- [ ] **Step 4: Add an E2E test** to `tests/e2e/doseStatusPersistence.spec.ts` (the suite already creates a protocol with one daily med; the store is exposed as `window.__medremindStore`):

```ts
  test('removed dose stays removed after reload', async ({ page }) => {
    // same auth + protocol-creation flow as the taken-status test, then:
    await page.goto('/app');
    await expect(page.getByRole('button', { name: 'Mark as taken' }).first()).toBeVisible({ timeout: 20_000 });
    const before = await page.evaluate(() => {
      const store = (window as never as { __medremindStore: { getState(): { scheduledDoses: { id: string; scheduledDate: string }[]; removeDose(id: string): void } } }).__medremindStore;
      const state = store.getState();
      const today = new Date().toISOString().slice(0, 10);
      const dose = state.scheduledDoses.find(d => d.scheduledDate === today);
      if (dose) state.removeDose(dose.id);
      return state.scheduledDoses.length;
    });
    await page.waitForFunction(() => {
      const raw = localStorage.getItem('medremind-sync-outbox-v1');
      const queue = raw ? JSON.parse(raw) : [];
      return Array.isArray(queue) && queue.filter((i: { dead?: boolean }) => !i.dead).length === 0;
    }, { timeout: 20_000 });
    await page.waitForTimeout(2_000);
    await page.reload();
    await page.waitForURL(/\/app/, { timeout: 30_000 });
    const after = await page.evaluate(() =>
      (window as never as { __medremindStore: { getState(): { scheduledDoses: unknown[] } } })
        .__medremindStore.getState().scheduledDoses.length,
    );
    expect(after).toBeLessThan(before);
  });
```

- [ ] **Step 5: Run `npx playwright test tests/e2e/doseStatusPersistence.spec.ts` — expect PASS (2 tests).**

- [ ] **Step 6: Commit** — `git commit -m "fix: removeDose resolves the cloud occurrence (legacy keys, history-safe cancel)"`

### Task 2: Import path links execution events

**Problem:** `importStoreSnapshotToSupabase` writes `execution_events` with `planned_occurrence_id: null` ([importStore.ts:303]) — the bug class fixed in PR #41, alive in the backup-restore path.

**Files:**
- Modify: `src/lib/supabase/importStore.ts:295-315`

- [ ] **Step 1:** The import builds planned occurrence rows with `occurrenceKey = `${mappedActiveId}|${mappedItemId}|${d.scheduledDate}|${d.scheduledTime.slice(0, 5)}`` and `id: stableUuid(`planned-occurrence:${userId}`, occurrenceKey)` (lines 268-278). `doseScheduleMap` entries already carry `cloudActiveId`, `cloudItemId`, `scheduledDate`, `scheduledTime`. In the event-row builder (line ~300) replace `planned_occurrence_id: null` with:

```ts
        planned_occurrence_id: stableUuid(
          `planned-occurrence:${userId}`,
          `${doseInfo.cloudActiveId}|${doseInfo.cloudItemId}|${doseInfo.scheduledDate}|${doseInfo.scheduledTime.slice(0, 5)}`,
        ),
```

First check (read lines 260-280) that `mappedActiveId === doseInfo.cloudActiveId` and `mappedItemId === doseInfo.cloudItemId` for the same dose — if the map uses different variables, reuse exactly the ones the occurrence-row builder uses so the ids match bit-for-bit.

- [ ] **Step 2:** `npx tsc --noEmit` clean; `npm run build` passes.

- [ ] **Step 3: Commit** — `git commit -m "fix: link imported execution events to their planned occurrences"`

### Task 3: Flush the outbox before the boot pull

**Problem:** an offline take is queued in the outbox; on next launch the boot pull replaces `scheduledDoses` from the cloud *before* the queue drains → the dose shows pending until a second reload.

**Files:**
- Modify: `src/app/app/layout.tsx:25-43` (boot sequence)
- Modify: `tests/e2e/doseStatusPersistence.spec.ts` (offline test)

- [ ] **Step 1:** In `layout.tsx` extend the import from `@/lib/supabase/syncOutbox` with `flushSyncOutbox, getSyncStatusSnapshot`, and in `boot()` insert before `await pullWithRetry();`:

```ts
      // Drain queued offline writes first — the pull below replaces local
      // state from the cloud and would otherwise hide them until next boot.
      if (getSyncStatusSnapshot().pending > 0) {
        await flushSyncOutbox(8_000);
      }
```

- [ ] **Step 2: E2E offline test** in `tests/e2e/doseStatusPersistence.spec.ts`:

```ts
  test('offline take survives reload once back online', async ({ page, context }) => {
    // same auth + protocol-creation flow, then:
    await page.goto('/app');
    const takeButton = page.getByRole('button', { name: 'Mark as taken' }).first();
    await expect(takeButton).toBeVisible({ timeout: 20_000 });
    await context.setOffline(true);
    await takeButton.click();
    await expect(page.getByRole('button', { name: 'Already marked as taken' }).first()).toBeVisible();
    await context.setOffline(false);
    await page.reload();
    await page.waitForURL(/\/app/, { timeout: 30_000 });
    await expect(
      page.getByRole('button', { name: 'Already marked as taken' }).first(),
    ).toBeVisible({ timeout: 30_000 });
  });
```

- [ ] **Step 3: Run the spec — expect PASS. Commit** — `git commit -m "fix: drain sync outbox before boot pull so offline actions survive reload"`

### Task 4: Migration 015 — legacy keys, stale ledger, e2e users

**Files:**
- Create: `supabase/015_normalize_keys_and_cleanup.sql`

- [ ] **Step 1: Author the migration** (idempotent; orchestrator applies via Management API and runs the verification selects):

```sql
-- MedRemind — 015: normalize legacy occurrence keys, purge ledger/user noise.

begin;

-- 1) Normalize live legacy-keyed occurrences to the canonical key format so
--    every code path (incl. key-based lookups) finds them. Guarded: skip when
--    a row with the canonical key already exists for that user.
update planned_occurrences po
   set occurrence_key = po.active_protocol_id::text || '|' || po.protocol_item_id::text
         || '|' || po.occurrence_date::text || '|' || to_char(po.occurrence_time, 'HH24:MI')
 where po.occurrence_key like 'legacy-dose:%'
   and po.superseded_by_occurrence_id is null
   and not exists (
     select 1 from planned_occurrences other
      where other.user_id = po.user_id
        and other.occurrence_key = po.active_protocol_id::text || '|' || po.protocol_item_id::text
              || '|' || po.occurrence_date::text || '|' || to_char(po.occurrence_time, 'HH24:MI')
   );

-- 2) Expire ledger rows stuck inflight for over a week (3 archive + 1
--    complete from Mar–Apr 2026; their effects already landed or were retried).
update sync_operations
   set status = 'failed',
       last_error = 'expired stale inflight (migration 015)',
       updated_at = now()
 where status = 'inflight'
   and updated_at < now() - interval '7 days';

-- 3) Remove throwaway E2E accounts (register-flow runs without E2E_EMAIL).
--    profiles.id → auth.users(id) cascade removes all dependent app data.
delete from auth.users where email like 'e2e-%@example.com';

commit;

-- Verification (run separately):
-- select count(*) from planned_occurrences
--   where occurrence_key like 'legacy-dose:%' and superseded_by_occurrence_id is null;
-- select count(*) from sync_operations where status = 'inflight';
-- select count(*) from auth.users where email like 'e2e-%@example.com';
```

- [ ] **Step 2: Commit** — `git commit -m "feat: migration 015 — normalize legacy occurrence keys, purge stale ledger and e2e users"`

- [ ] **Step 3 (orchestrator, after PR review):** apply via Management API, run the three verification selects, expect `0 / 0 / 0` (first count may stay >0 only for guarded collisions — list and inspect any remainder).

### Task 5: Consolidate ID-derivation helpers

**Problem:** `hash32`/`stableUuid` exist twice ([storeHelpers.ts:134-151], [realtimeSync/helpers.ts:11-28]). If the copies drift, client dose IDs and cloud IDs diverge silently.

**Files:**
- Create: `src/lib/ids.ts`
- Create: `tests/unit/ids.test.ts`
- Modify: `src/lib/store/storeHelpers.ts`, `src/lib/supabase/realtimeSync/helpers.ts` (import + re-export, delete local copies)
- Modify: `package.json` (`test:unit` list)

- [ ] **Step 1: Create `src/lib/ids.ts`** — move `hash32`, `stableUuid`, and `isUuid` verbatim from `realtimeSync/helpers.ts` (the two copies are currently identical — verify with `diff <(sed -n '11,28p' src/lib/supabase/realtimeSync/helpers.ts) <(sed -n '134,151p' src/lib/store/storeHelpers.ts)` modulo whitespace).

- [ ] **Step 2: Pin the derivation with a snapshot test.** Generate the expected value once: `node -e "const{stableUuid}=require('./.tmp/ids-check.js'); console.log(stableUuid('planned-occurrence:u1','a|b|2026-01-01|08:00'))"` (compile first via the test:unit tsc run), paste it into:

```ts
// tests/unit/ids.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stableUuid, isUuid } from '../../src/lib/ids';

test('stableUuid is deterministic and stable across refactors', () => {
  const value = stableUuid('planned-occurrence:u1', 'a|b|2026-01-01|08:00');
  assert.equal(value, '<PASTE GENERATED VALUE HERE — this pin guards cloud ID stability>');
  assert.ok(isUuid(value));
});
```

- [ ] **Step 3:** In both `storeHelpers.ts` and `realtimeSync/helpers.ts` delete the local `hash32`/`stableUuid` (and `isUuid` in helpers.ts) bodies and replace with `import { hash32, isUuid, stableUuid } from '@/lib/ids';` plus `export { hash32, isUuid, stableUuid };` so existing imports keep working.

- [ ] **Step 4:** `npm run test:unit` PASS, `npx tsc --noEmit` clean, `npm run build` PASS. **Commit** — `git commit -m "refactor: single source of truth for stableUuid/hash32 id derivation"`

### Task 6: Docs refresh

**Files:**
- Modify: `docs/current-status-and-next-phase.md`

- [ ] **Step 1:** Rewrite the header/status sections: lifecycle migration complete; Phase 5 realtimeSync split merged (PR #40); V2 sync integrity fixes shipped (PRs #41, #42; migrations 013, 014 applied); food pipeline revival in progress per `docs/superpowers/plans/2026-06-12-food-pipeline-revival.md`; sync tails per this plan. Backlog: Zustand slice split (unchanged section), deferred architecture tracks (unchanged). Add one line under testing: set `E2E_EMAIL`/`E2E_PASSWORD` to a dedicated test account so E2E runs stop creating throwaway prod users (migration 015 removes the old ones).

- [ ] **Step 2: Commit** — `git commit -m "docs: refresh current status after V2 sync fixes and food revival kickoff"`

---

**Out of scope (deliberate):** deleting the duplicate `active_protocols` pair (completed + abandoned on protocol `cc07587a`) — both instances are terminal and carry unique history occurrences; a cascade delete would lose history, and the pull-side canonicalization plus slot dedupe (PR #42) already neutralize the duplication. Revisit only if a third duplicate instance ever appears.
