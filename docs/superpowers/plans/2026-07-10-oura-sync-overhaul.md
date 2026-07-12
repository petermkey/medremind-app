# Oura Sync Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Supersedes `docs/superpowers/plans/2026-07-05-oura-sync-overhaul.md`.** That plan is well-researched but has one dangerous gap, found live on 2026-07-10: it assumes `supabase/008_oura_analytics.sql` is already applied to production. **It is not.** This plan opens with a new Task 1 that fixes that first — skipping it means every later task fails on the very first live sync attempt with `relation "external_health_sync_runs" does not exist`.

**Goal:** Restore automated Oura Ring data sync, which has been broken (not just "manual-only" — see Task 1) since around 2026-04-27, and widen the data pulled per `docs/oura-integration-stack.md`: fill the never-populated heart-health fields, add sleep detail, add enhanced tags, and wire everything into the correlation feature builder that powers `/app/progress` insight cards.

**Architecture:** First unblock the *already-deployed* sync code by applying a migration that was written but never run (Task 1 — pure ops, no code change). Then extract the existing fetch→map→persist engine out of the cookie-authed `/api/integrations/health/sync` route into a shared server module (every persistence call already uses a service-role client, so the engine is cron-ready as-is) and add a `/api/cron/oura-sync` route that walks all connected users on a schedule (Task 2). Then widen the data pulled in three independent phases (Tasks 3–5): real heart-health endpoints, sleep detail, enhanced tags.

**Tech Stack:** Next.js 15 App Router route handlers (`runtime='nodejs'`), Supabase service-role clients (already the pattern in `src/lib/health/persistence.ts`, `src/lib/oura/tokenStore.ts`, `src/lib/oura/analyticsStore.ts`), Oura API v2 OAuth2, `node:test` standalone harness (`npm run test:unit` / `npm run test:correlation`), manual SQL migrations applied by the orchestrator via the Supabase Management API.

## Global Constraints

- Never push to `main`; branches `codex/<slice-name>`; conventional commits; every commit ends with a `Co-Authored-By: <implementing agent name> <noreply@anthropic.com>` trailer.
- Never modify `tsconfig.json`; no `any` without a comment; run `npx tsc --noEmit` after every `.ts` change; `npm run build` must pass before any PR.
- Migrations: numbered files in `supabase/`, idempotent (`create table if not exists`, `add column if not exists`); **authored by the implementer, applied to production ONLY by the orchestrator** via the Supabase Management API (procedure given in Task 1) — never via a raw psql connection string, never committed with values filled into `.env` files.
- Cron routes authenticate with `Bearer ${CRON_SECRET}` exactly like `src/app/api/cron/notify/route.ts:38-41`.
- Oura fetches go through the existing `fetchPaginatedOuraCollection` / `fetchOptionalOuraCollection` helpers (pagination + 401/403/404 tolerance); never raw `fetch`.
- New pure logic must be clock-free (dates injected as parameters, never `new Date()` inside the function body) and registered in the `test:unit` script in `package.json` — **both** the `tsc` file list **and** the `node .tmp/unit/...` run chain (see how `tests/unit/ouraSyncWindows.test.ts` is already wired as the pattern to copy).
- `.test.mjs` files run under `npm run test:correlation` via `node --experimental-strip-types --test <files>` (see `package.json` line 13) — they import the `.ts` source file directly with an explicit `.ts` extension (see `src/lib/correlation/featureBuilder.test.mjs` line 4 for the exact style), no separate compile step.
- E2E suites run with `workers:1` and the shared-account cleanup rules (PR #63); this plan requires no new E2E test (no UI changes).

## Background — what's actually broken (read this before Task 1)

`docs/oura-integration-stack.md` (2026-07-05 audit) found sync stalled since 2026-04-26: the Oura connection for the one connected user shows `status=connected`, `last_sync_at=2026-04-26`, and only 15 snapshot days exist in `external_health_daily_snapshots`. That audit's diagnosis was "sync is manual-only, nobody has clicked the button since." **That diagnosis is incomplete.**

Reading `src/app/api/integrations/health/sync/route.ts` (the current manual "Sync now" route, last modified 2026-04-29 per file mtime — i.e. *after* the last successful sync) shows `syncOuraSnapshots()` calls `startOuraSyncRun()` **unconditionally, as its very first action, before any Oura API call is made**:

```ts
// src/app/api/integrations/health/sync/route.ts:320-332 (current)
async function syncOuraSnapshots(
  userId: string,
  range: { start_date: string; end_date: string },
): Promise<number> {
  const auth = await getValidOuraTokens(userId);
  if (!auth) return 0;

  const syncRun = await startOuraSyncRun({   // <-- throws here, see below
    userId,
    syncType: 'manual_refresh',
    rangeStart: range.start_date,
    rangeEnd: range.end_date,
  });
  // ... Oura fetch + snapshot write never runs if the line above throws
```

`startOuraSyncRun` (`src/lib/oura/analyticsStore.ts:204-223`) does `supabase.from('external_health_sync_runs').insert(...)` and `throw error` if the insert fails. **`external_health_sync_runs` does not exist in production.** Verified 2026-07-10 via a live query:

```sql
select table_name from information_schema.tables
where table_schema = 'public'
  and table_name in ('external_health_sync_runs', 'oura_sync_endpoint_coverage',
                      'oura_raw_documents', 'daily_health_features');
-- returns zero rows
```

These four tables are defined in `supabase/008_oura_analytics.sql` (created — never applied). `019` is confirmed the last migration actually run against production (this matches the migration-numbering-collision note already in `docs/project-backlog.md` §1.1). The route's outer `try/catch` (`POST` handler, same file) catches the thrown error, logs `[health/sync] sync failed`, and returns a generic `502 { error: 'Health sync failed.' }` — so every click of "Sync now" in Settings since this code shipped (~2026-04-29) has failed silently with no indication of the real cause. **This is why the data stopped growing — not because nobody clicked the button, but because clicking it has been broken the whole time.**

This means: applying the missing migration (Task 1) should, by itself, with **zero code changes**, immediately restore the existing "Sync now" button. Task 1 includes a step to verify exactly that before any new code is written.

---

## File map (who owns what)

| File | Role |
|---|---|
| `supabase/008_oura_analytics.sql` | **Already exists in the repo — apply it, don't recreate it** (Task 1) |
| `src/lib/health/ouraSyncEngine.ts` (new, Task 2) | The whole fetch→map→persist engine, extracted verbatim from `health/sync/route.ts`; exports `syncOuraSnapshots` |
| `src/app/api/integrations/health/sync/route.ts` | Slims to a cookie-auth wrapper around the engine (Task 2) |
| `src/app/api/cron/oura-sync/route.ts` (new, Task 2) | CRON_SECRET-authed walker over all connected users |
| `src/lib/oura/syncWindows.ts` + `tests/unit/ouraSyncWindows.test.ts` | Gains pure `computeOuraCronSyncRange` (Task 2) |
| `src/lib/health/sourceRegistry.ts` | Gains `listConnectedOuraUserIds`; success handler resets `status` (Task 2) |
| `src/lib/health/ouraDailyMapper.ts` + new `ouraDailyMapper.test.mjs` | Payload widening (Tasks 3–4) |
| `src/lib/health/types.ts`, `src/lib/health/persistence.ts` | Snapshot type + row mapping widening (Tasks 3–4) |
| `src/lib/correlation/featureBuilder.ts` + `featureBuilder.test.mjs`, `src/lib/correlation/types.ts`, `src/lib/correlation/engine.ts` | New features/outcomes (Tasks 4–5) |
| `supabase/020_oura_heart_fields.sql`, `021_oura_sleep_detail.sql`, `022_oura_tags.sql` | New migrations (Tasks 3–5) |

Tasks 2–5 are **sequential** (they all touch `ouraSyncEngine.ts` once it exists) — one branch/PR each, do not parallelize.

---

### Task 1: Apply the prerequisite migration (fixes the actual outage — no code change)

**Files:** none changed in this repo. This is a production database operation.

**Interfaces:** none — this task creates the tables `startOuraSyncRun`, `finishOuraSyncRun`, `recordOuraEndpointCoverage`, `upsertOuraRawDocument`, `pruneOuraRawDocuments`, and `upsertDailyHealthFeature` (all already implemented and already called by already-deployed code in `src/lib/oura/analyticsStore.ts`) expect to exist.

- [ ] **Step 1: Confirm the migration's dependencies are present.** Run against the production database (Supabase Management API `POST /v1/projects/{ref}/database/query`, or the Supabase dashboard SQL editor):

```sql
select table_name from information_schema.tables
where table_schema = 'public' and table_name in ('profiles', 'user_integrations');
```

Expected: both rows returned. `supabase/008_oura_analytics.sql` foreign-keys into both — if either is missing, stop and escalate; something else is badly wrong and this plan does not apply.

- [ ] **Step 2: Confirm the trigger function dependency.**

```sql
select proname from pg_proc where proname = 'set_updated_at';
```

Expected: one row (`daily_health_features`'s `updated_at` trigger in the migration uses `public.set_updated_at()`).

- [ ] **Step 3: Apply `supabase/008_oura_analytics.sql` verbatim.** Read the file from the repo (it already exists, do not rewrite it) and execute its full contents as one SQL statement batch against production. The migration is idempotent (`create table if not exists` throughout), so this is safe to re-run if Step 3 is interrupted partway.

- [ ] **Step 4: Verify the tables now exist.**

```sql
select table_name from information_schema.tables
where table_schema = 'public'
  and table_name in ('external_health_sync_runs', 'oura_sync_endpoint_coverage',
                      'oura_raw_documents', 'daily_health_features')
order by 1;
```

Expected: all four rows returned.

- [ ] **Step 5: Verify the outage is actually fixed — without writing any code.** If you have access to a signed-in session for the connected Oura user (or can reach the owner to click the button), trigger the existing manual sync: open `/app/settings`, find the Oura "Sync now" control, click it. Expected: success (previously a silent 502). Confirm via SQL:

```sql
select id, status, started_at, finished_at from external_health_sync_runs
order by started_at desc limit 1;
```

Expected: one row, `status = 'success'`, `finished_at` populated. If you do not have a live session available, skip the click and instead re-check after Task 2 ships (the cron route exercises the same code path).

- [ ] **Step 6: Record the fix.** No commit needed (no files changed) — note in the Task 2 PR description that Task 1 (migration application) preceded it, with the timestamp Step 3 was run, so the two-month data gap's end date is documented.

**This step alone, once done, unblocks the existing "Sync now" button in production even before any of Tasks 2–5 ship.** Prioritize it above everything else in this plan.

---

### Task 2: Cron-driven sync (replaces manual-only sync with a scheduled walker)

**Files:**
- Create: `src/lib/health/ouraSyncEngine.ts`
- Create: `src/app/api/cron/oura-sync/route.ts`
- Modify: `src/app/api/integrations/health/sync/route.ts` (slim to wrapper)
- Modify: `src/lib/oura/syncWindows.ts`, `src/lib/health/sourceRegistry.ts`
- Test: `tests/unit/ouraSyncWindows.test.ts` (extend — already wired into `test:unit`, no `package.json` change needed)

**Interfaces:**
- Produces: `syncOuraSnapshots(userId: string, range: { start_date: string; end_date: string }, syncType: 'initial_backfill' | 'daily' | 'manual_refresh'): Promise<number>` in `ouraSyncEngine.ts`; `computeOuraCronSyncRange(now: Date, lastSyncAt: string | null): { start_date: string; end_date: string }` in `syncWindows.ts`; `listConnectedOuraUserIds(): Promise<Array<{ userId: string; lastSyncAt: string | null }>>` in `sourceRegistry.ts`.
- Consumes: everything already exported by `tokenStore.ts`, `analyticsStore.ts` (`startOuraSyncRun`, `finishOuraSyncRun`, `recordOuraEndpointCoverage`, `upsertOuraRawDocument`, `pruneOuraRawDocuments`, `upsertDailyHealthFeature` — all now live thanks to Task 1), `persistence.ts`, `sourceRegistry.ts`, `client.ts` — all service-role internally, no user session needed.

**Design choice — reuse the existing `'daily'` sync type for cron runs, do not introduce `'scheduled'`.** `OuraSyncType` (`src/lib/oura/analyticsStore.ts:15`) is `'initial_backfill' | 'daily' | 'manual_refresh'`, and the SQL `check (sync_type in ('initial_backfill', 'daily', 'manual_refresh'))` in `supabase/008_oura_analytics.sql` already allows `'daily'`. `'daily'` already means exactly "an automatic periodic sync" as opposed to `'manual_refresh'` (button click) — using it needs zero type changes and zero constraint-widening migration.

- [ ] **Step 1: Write the failing test for the pure range helper.** Append to `tests/unit/ouraSyncWindows.test.ts` (match the file's existing bare-block style — no `test()` wrapper is used in this file, see the three existing blocks):

```ts
import { computeOuraCronSyncRange } from '../../src/lib/oura/syncWindows';

{
  const now = new Date('2026-07-10T12:00:00.000Z');
  assert.deepEqual(computeOuraCronSyncRange(now, null), {
    start_date: '2026-07-03',
    end_date: '2026-07-10',
  });
}

{
  const now = new Date('2026-07-10T12:00:00.000Z');
  assert.deepEqual(computeOuraCronSyncRange(now, '2026-06-25T10:00:00.000Z'), {
    start_date: '2026-06-23',
    end_date: '2026-07-10',
  });
}

{
  const now = new Date('2026-07-10T12:00:00.000Z');
  assert.deepEqual(computeOuraCronSyncRange(now, '2026-04-26T23:33:21.000Z'), {
    start_date: '2026-06-10',
    end_date: '2026-07-10',
  });
}
```

- [ ] **Step 2: Run `npm run test:unit`** — expect FAIL (`computeOuraCronSyncRange` is not exported).

- [ ] **Step 3: Implement in `src/lib/oura/syncWindows.ts`.** Add below the existing three window functions:

```ts
// Cron sync window: at minimum the trailing 7 days (daily_activity/stress
// keep updating through the day; readiness finalizes next morning), extended
// back to lastSync - 2d when the connection stalled, floored at 30 days back
// so a very stale connection doesn't trigger a huge re-fetch on first cron run.
export function computeOuraCronSyncRange(
  now: Date,
  lastSyncAt: string | null,
): { start_date: string; end_date: string } {
  const dayString = (d: Date) => d.toISOString().slice(0, 10);
  const shift = (d: Date, days: number) => {
    const next = new Date(d);
    next.setUTCDate(next.getUTCDate() + days);
    return next;
  };
  let start = shift(now, -7);
  if (lastSyncAt) {
    const parsed = new Date(lastSyncAt);
    if (!Number.isNaN(parsed.getTime())) {
      const overlap = shift(parsed, -2);
      if (overlap < start) start = overlap;
    }
  }
  const floor = shift(now, -30);
  if (start < floor) start = floor;
  return { start_date: dayString(start), end_date: dayString(now) };
}
```

- [ ] **Step 4: Run `npm run test:unit`** — expect PASS.

- [ ] **Step 5: Extract the engine.** Create `src/lib/health/ouraSyncEngine.ts` by MOVING (not copying) from `src/app/api/integrations/health/sync/route.ts` everything except the `POST` handler and the request-param helpers (`toDateInput`, `defaultStartDate`, `defaultEndDate`, which stay in the route): the `OuraCollectionResponse` / `OuraDailyCollections` types, `DATE_RE`, `OURA_MAX_PAGES_PER_COLLECTION`, `tokenExpiresSoon`, `asRecord`, `getLocalDate`, `groupDailyData`, `groupWorkoutData`, `getContinuationToken`, `getSnapshotDates`, `collectionData`, `getValidOuraTokens`, `fetchPaginatedOuraCollection`, `fetchOptionalOuraCollection`, `fetchOuraDailyCollections`, `persistOuraAnalyticsPayloads`, `syncOuraSnapshots`. Change `syncOuraSnapshots`'s signature to accept the sync type instead of hardcoding it:

```ts
export async function syncOuraSnapshots(
  userId: string,
  range: { start_date: string; end_date: string },
  syncType: 'initial_backfill' | 'daily' | 'manual_refresh',
): Promise<number> {
  const auth = await getValidOuraTokens(userId);
  if (!auth) return 0;

  const syncRun = await startOuraSyncRun({
    userId,
    syncType,
    rangeStart: range.start_date,
    rangeEnd: range.end_date,
  });
  // ...rest of the function body is unchanged from the current route.ts
```

The engine file keeps the imports it needs (`mapOuraDailyPayloadToHealthSnapshot`, `upsertExternalHealthDailySnapshots`, `ensureOuraHealthConnection`/`markHealthConnectionSyncSuccess`/`markHealthConnectionSyncError` are NOT needed here — those stay call-site-side; only `markHealthConnectionSyncSuccess` is called from inside `syncOuraSnapshots` itself per the current code, so it moves with the engine), plus everything from `@/lib/oura/analyticsStore`, `@/lib/oura/analyticsSync`, `@/lib/oura/client`, `@/lib/oura/config`, `@/lib/oura/tokenStore`.

The slimmed route's `POST` handler calls `syncOuraSnapshots(userId, range, 'manual_refresh')`.

- [ ] **Step 6: Fix the status-recovery bug.** In `src/lib/health/sourceRegistry.ts`, `markHealthConnectionSyncSuccess` currently updates `last_sync_at`/`last_error` but never resets `status` — one failure marks the row `'error'` forever, and after this task's cron enumeration filters by status, that would permanently exclude the user from scheduled sync. Add `status: 'connected',` to its `.update({...})` object (currently at lines 69-73). In the same file add:

```ts
export async function listConnectedOuraUserIds(): Promise<Array<{ userId: string; lastSyncAt: string | null }>> {
  const supabase = createHealthServiceClient();
  const { data, error } = await supabase
    .from('external_health_connections')
    .select('user_id, last_sync_at, status')
    .eq('source', 'oura')
    .in('status', ['connected', 'error']); // include 'error' so transient failures self-heal

  if (error) throw error;

  return ((data ?? []) as Array<{ user_id: string; last_sync_at: string | null }>).map((row) => ({
    userId: row.user_id,
    lastSyncAt: row.last_sync_at,
  }));
}
```

`createHealthServiceClient` is already imported at the top of `sourceRegistry.ts` from `./persistence` — no new import needed.

- [ ] **Step 7: Create `src/app/api/cron/oura-sync/route.ts`:**

```ts
import { NextRequest, NextResponse } from 'next/server';

import { syncOuraSnapshots } from '@/lib/health/ouraSyncEngine';
import {
  listConnectedOuraUserIds,
  markHealthConnectionSyncError,
} from '@/lib/health/sourceRegistry';
import { computeOuraCronSyncRange } from '@/lib/oura/syncWindows';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const connections = await listConnectedOuraUserIds();
  const results: Array<{ userId: string; status: string; snapshots?: number }> = [];

  for (const connection of connections) {
    const range = computeOuraCronSyncRange(new Date(), connection.lastSyncAt);
    try {
      const snapshots = await syncOuraSnapshots(connection.userId, range, 'daily');
      results.push({ userId: connection.userId, status: 'ok', snapshots });
    } catch (err) {
      console.error('[cron/oura-sync] user sync failed', connection.userId, err);
      await markHealthConnectionSyncError(
        connection.userId,
        'oura',
        err instanceof Error ? err.message : 'Scheduled Oura sync failed.',
      ).catch(() => undefined);
      results.push({ userId: connection.userId, status: 'error' });
    }
  }

  return NextResponse.json({ synced: results.filter((r) => r.status === 'ok').length, results });
}
```

- [ ] **Step 8: Verify.** `npx tsc --noEmit` clean; `npm run test:unit` all pass; `npm run build` passes and the route list shows `ƒ /api/cron/oura-sync`. Local smoke test: run `npm run dev -- --port 3260` in one terminal, then in another:

```bash
curl -s -H "Authorization: Bearer wrong-secret" localhost:3260/api/cron/oura-sync
# expect: {"error":"Unauthorized"} with 401

curl -s -H "Authorization: Bearer $(grep '^CRON_SECRET=' .env.local | cut -d= -f2-)" localhost:3260/api/cron/oura-sync
# expect: {"synced":0,"results":[]} if no connections exist locally, or real results if a local Oura connection is configured
```

Kill the dev server afterward.

- [ ] **Step 9: Commit** — `git commit -m "feat: scheduled Oura sync — cron route walking connected users"`

**Orchestrator ops after merge (NOT the implementer):**
1. Create the cron-job.org job: URL `https://medremind-app-two.vercel.app/api/cron/oura-sync`, method GET, header `Authorization: Bearer <CRON_SECRET>`, schedule every 6 hours (same account/workflow already used for job #7402449, the `/api/cron/notify` job).
2. Trigger it once manually from the cron-job.org dashboard.
3. Verify via SQL: `select last_sync_at from external_health_connections where source = 'oura';` moved to today, and `select count(*), max(local_date) from external_health_daily_snapshots;` grew past `2026-04-26`.
4. If Task 1's Step 5 was skipped (no live session available at the time), this is the moment to confirm the whole outage is fixed end-to-end.

---

### Task 3: Phase A — real heart-health endpoints (fills the always-NULL vo2/resilience columns)

**Root cause being fixed:** the engine fetches `/v2/usercollection/heart_health`, which **does not exist in Oura API v2**; `fetchOptionalOuraCollection` swallows the resulting 404, so `heartHealth` is always an empty map and `vo2_max` / `resilience_level` never populate (0/15 rows had these fields populated as of the 2026-07-05 audit).

**Files:**
- Modify: `src/lib/health/ouraSyncEngine.ts` (replace the `heart_health` fetch), `src/lib/health/ouraDailyMapper.ts`, `src/lib/health/types.ts`, `src/lib/health/persistence.ts`
- Create: `supabase/020_oura_heart_fields.sql`
- Create: `src/lib/health/ouraDailyMapper.test.mjs` (this file does not exist yet — confirmed via `ls src/lib/health/*.test.mjs` returning no matches)
- Modify: `package.json` (register the new test file in `test:correlation`)

**Interfaces:**
- Produces: mapper payload key `heartHealth` gains `cardiovascular_age?: number | null`; snapshot type gains `cardiovascularAge: number | null`; snapshot row gains column `cardiovascular_age`.
- Consumes: `fetchOptionalOuraCollection`, `groupDailyData` from Task 2's engine.

- [ ] **Step 1: Wire the new test file into `test:correlation`.** In `package.json`, the `test:correlation` script currently is:

```
"test:correlation": "node --experimental-strip-types --test src/lib/correlation/stats.test.mjs src/lib/correlation/medicationSafety.test.mjs src/lib/correlation/featureBuilder.test.mjs src/lib/correlation/engine.test.mjs",
```

Add `src/lib/health/ouraDailyMapper.test.mjs` to the end of that file list (space-separated, same pattern as the others).

- [ ] **Step 2: Create the failing test.** Create `src/lib/health/ouraDailyMapper.test.mjs` (new file — match the header style of `src/lib/correlation/featureBuilder.test.mjs`):

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { mapOuraDailyPayloadToHealthSnapshot } from './ouraDailyMapper.ts';

test('maps merged heart endpoints including cardiovascular age', () => {
  const snapshot = mapOuraDailyPayloadToHealthSnapshot({
    userId: 'u1',
    localDate: '2026-07-01',
    heartHealth: { vo2_max: 41.2, resilience_level: 'solid', cardiovascular_age: 33 },
  });
  assert.equal(snapshot.vo2Max, 41.2);
  assert.equal(snapshot.resilienceLevel, 'solid');
  assert.equal(snapshot.cardiovascularAge, 33);
});
```

- [ ] **Step 3: Run `npm run test:correlation`** — expect FAIL (`snapshot.cardiovascularAge` is `undefined`, not `33`).

- [ ] **Step 4: Widen types + mapper + persistence.**

`src/lib/health/types.ts` — add one field to `ExternalHealthDailySnapshot` (after `resilienceLevel: string | null;`):

```ts
  cardiovascularAge: number | null;
```

`src/lib/health/ouraDailyMapper.ts` — in the `heartHealth` input type (inside the `OuraDailyPayload` type), add one field:

```ts
    cardiovascular_age?: number | null;
```

and in the returned object (after `resilienceLevel: stringOrNull(input.heartHealth?.resilience_level),`), add:

```ts
    cardiovascularAge: numberOrNull(input.heartHealth?.cardiovascular_age),
```

`src/lib/health/persistence.ts` — in `toSnapshotRow`, after `resilience_level: snapshot.resilienceLevel,`, add:

```ts
    cardiovascular_age: snapshot.cardiovascularAge,
```

- [ ] **Step 5: Run `npm run test:correlation`** — expect PASS.

- [ ] **Step 6: Author `supabase/020_oura_heart_fields.sql`:**

```sql
-- 020: cardiovascular age from Oura daily_cardiovascular_age.
alter table external_health_daily_snapshots
  add column if not exists cardiovascular_age numeric;
```

- [ ] **Step 7: Replace the dead endpoint in the engine.** In `src/lib/health/ouraSyncEngine.ts`, inside `fetchOuraDailyCollections`, replace the single `heart_health` fetch with three real collections and a merge helper matching the mapper's `heartHealth` input shape:

```ts
const [dailySleep, readiness, activity, spo2, stress, vo2MaxRes, resilienceRes, cardioAgeRes, workouts] = await Promise.all([
  fetchPaginatedOuraCollection(apiBaseUrl, accessToken, '/v2/usercollection/daily_sleep', range),
  fetchPaginatedOuraCollection(apiBaseUrl, accessToken, '/v2/usercollection/daily_readiness', range),
  fetchPaginatedOuraCollection(apiBaseUrl, accessToken, '/v2/usercollection/daily_activity', range),
  fetchPaginatedOuraCollection(apiBaseUrl, accessToken, '/v2/usercollection/daily_spo2', range),
  fetchPaginatedOuraCollection(apiBaseUrl, accessToken, '/v2/usercollection/daily_stress', range),
  fetchOptionalOuraCollection(apiBaseUrl, accessToken, '/v2/usercollection/vO2_max', range),
  fetchOptionalOuraCollection(apiBaseUrl, accessToken, '/v2/usercollection/daily_resilience', range),
  fetchOptionalOuraCollection(apiBaseUrl, accessToken, '/v2/usercollection/daily_cardiovascular_age', range),
  fetchPaginatedOuraCollection(apiBaseUrl, accessToken, '/v2/usercollection/workout', range),
]);

const heartHealth = mergeHeartHealth(vo2MaxRes, resilienceRes, cardioAgeRes);
```

Add the merge helper function (module scope, near `groupDailyData`):

```ts
// A day's heart-health picture is now assembled from three separate
// collections instead of the non-existent /heart_health endpoint.
function mergeHeartHealth(
  vo2: OuraCollectionResponse,
  resilience: OuraCollectionResponse,
  cardioAge: OuraCollectionResponse,
): Map<string, Record<string, unknown>> {
  const merged = new Map<string, Record<string, unknown>>();
  const upsert = (date: string, patch: Record<string, unknown>) => {
    merged.set(date, { ...(merged.get(date) ?? {}), ...patch });
  };
  for (const [date, doc] of groupDailyData(vo2)) upsert(date, { vo2_max: doc.vo2_max });
  for (const [date, doc] of groupDailyData(resilience)) upsert(date, { resilience_level: doc.level });
  for (const [date, doc] of groupDailyData(cardioAge)) upsert(date, { cardiovascular_age: doc.vascular_age });
  return merged;
}
```

Update the returned `analyticsCollections` object: remove the `heart_health` entry, add `vO2_max`, `daily_resilience`, `daily_cardiovascular_age` (each `{ required: false, data: collectionData(...) }` using the three new response variables).

Field-name notes (Oura v2 response docs, verified against `docs/oura-integration-stack.md` §2): `vO2_max` documents carry `vo2_max`; `daily_resilience` carries `level`; `daily_cardiovascular_age` carries `vascular_age`. `resting_heart_rate` / `hrv_balance` stay null until Task 4 (they come from sleep detail, not these endpoints).

- [ ] **Step 8: Verify.** `npm run test:correlation` PASS; `npx tsc --noEmit` clean; `npm run test:unit` PASS; `npm run build` PASS.

- [ ] **Step 9: Commit** — `git commit -m "fix: fetch real Oura heart endpoints (heart_health does not exist) + cardiovascular age"`

**Orchestrator after merge:** apply migration `020_oura_heart_fields.sql` via the Task 1 procedure. After the next cron fire, verify `select count(vo2_max), count(resilience_level), count(cardiovascular_age) from external_health_daily_snapshots where local_date >= current_date - 7;` are non-zero (ring subscription permitting — these endpoints can legitimately return empty for some accounts; log, don't fail, if so).

---

### Task 4: Phase B — sleep detail into snapshots and correlations

**Files:**
- Modify: `src/lib/health/ouraSyncEngine.ts`, `ouraDailyMapper.ts`, `types.ts`, `persistence.ts`, `src/lib/correlation/featureBuilder.ts`, `src/lib/correlation/types.ts`, `src/lib/correlation/engine.ts`
- Create: `supabase/021_oura_sleep_detail.sql`
- Test: `src/lib/health/ouraDailyMapper.test.mjs` (extend — created in Task 3), `src/lib/correlation/featureBuilder.test.mjs` (extend)

**Interfaces:**
- Produces: mapper payload gains `sleepDetail?: { average_hrv?, efficiency?, latency?, deep_sleep_duration?, rem_sleep_duration?, average_breath?, lowest_heart_rate? }`; snapshot gains `sleepAvgHrv, sleepEfficiency, sleepLatencySeconds, deepSleepMinutes, remSleepMinutes, respiratoryRate` (all `number | null`); `restingHeartRate` now sources from `sleepDetail.lowest_heart_rate` first, falling back to `heartHealth.resting_heart_rate`; `DailyLifestyleSnapshot` gains the same six numeric fields.
- Consumes: Task 3's merged `heartHealth` (unchanged), Task 2's engine structure.

- [ ] **Step 1: Failing mapper test** (append to `src/lib/health/ouraDailyMapper.test.mjs`, created in Task 3):

```js
test('maps main sleep period detail and sources RHR from it', () => {
  const snapshot = mapOuraDailyPayloadToHealthSnapshot({
    userId: 'u1',
    localDate: '2026-07-01',
    sleepDetail: {
      average_hrv: 52,
      efficiency: 91,
      latency: 540,
      deep_sleep_duration: 5400,
      rem_sleep_duration: 6600,
      average_breath: 13.5,
      lowest_heart_rate: 47,
    },
  });
  assert.equal(snapshot.sleepAvgHrv, 52);
  assert.equal(snapshot.sleepEfficiency, 91);
  assert.equal(snapshot.sleepLatencySeconds, 540);
  assert.equal(snapshot.deepSleepMinutes, 90);
  assert.equal(snapshot.remSleepMinutes, 110);
  assert.equal(snapshot.respiratoryRate, 13.5);
  assert.equal(snapshot.restingHeartRate, 47);
});
```

- [ ] **Step 2: Run `npm run test:correlation`** — FAIL.

- [ ] **Step 3: Implement mapper + types + persistence.**

`types.ts` snapshot additions (after `cardiovascularAge: number | null;`):

```ts
  sleepAvgHrv: number | null;
  sleepEfficiency: number | null;
  sleepLatencySeconds: number | null;
  deepSleepMinutes: number | null;
  remSleepMinutes: number | null;
  respiratoryRate: number | null;
```

`ouraDailyMapper.ts` — add the `sleepDetail` input type inside `OuraDailyPayload` (after `heartHealth`):

```ts
  sleepDetail?: {
    average_hrv?: number | null;
    efficiency?: number | null;
    latency?: number | null;
    deep_sleep_duration?: number | null;
    rem_sleep_duration?: number | null;
    average_breath?: number | null;
    lowest_heart_rate?: number | null;
  } | null;
```

Add a helper below `stringOrNull`:

```ts
function minutesOrNull(value: unknown): number | null {
  const n = numberOrNull(value);
  return n === null ? null : Math.round(n / 60); // Oura durations are seconds
}
```

In the returned object, change the existing `restingHeartRate` line and add the six new fields:

```ts
    sleepAvgHrv: numberOrNull(input.sleepDetail?.average_hrv),
    sleepEfficiency: numberOrNull(input.sleepDetail?.efficiency),
    sleepLatencySeconds: numberOrNull(input.sleepDetail?.latency),
    deepSleepMinutes: minutesOrNull(input.sleepDetail?.deep_sleep_duration),
    remSleepMinutes: minutesOrNull(input.sleepDetail?.rem_sleep_duration),
    respiratoryRate: numberOrNull(input.sleepDetail?.average_breath),
    restingHeartRate: numberOrNull(input.sleepDetail?.lowest_heart_rate)
      ?? numberOrNull(input.heartHealth?.resting_heart_rate),
```

`persistence.ts` `toSnapshotRow` — after `cardiovascular_age: snapshot.cardiovascularAge,`, add:

```ts
    sleep_avg_hrv: snapshot.sleepAvgHrv,
    sleep_efficiency: snapshot.sleepEfficiency,
    sleep_latency_seconds: snapshot.sleepLatencySeconds,
    deep_sleep_minutes: snapshot.deepSleepMinutes,
    rem_sleep_minutes: snapshot.remSleepMinutes,
    respiratory_rate: snapshot.respiratoryRate,
```

- [ ] **Step 4: Migration `supabase/021_oura_sleep_detail.sql`:**

```sql
alter table external_health_daily_snapshots
  add column if not exists sleep_avg_hrv numeric,
  add column if not exists sleep_efficiency int,
  add column if not exists sleep_latency_seconds int,
  add column if not exists deep_sleep_minutes int,
  add column if not exists rem_sleep_minutes int,
  add column if not exists respiratory_rate numeric;
```

- [ ] **Step 5: Engine — fetch `sleep` and pick the main period per day.** In `fetchOuraDailyCollections`, add `fetchOptionalOuraCollection(apiBaseUrl, accessToken, '/v2/usercollection/sleep', range)` to the `Promise.all`, then group with a dedicated picker (a day can carry several sleep documents — naps — so the main overnight period must be selected):

```ts
// A day can carry several sleep documents (naps). Prefer the long_sleep
// period; fall back to the longest total_sleep_duration.
function pickMainSleepByDate(response: OuraCollectionResponse): Map<string, Record<string, unknown>> {
  const byDate = new Map<string, Record<string, unknown>>();
  for (const item of response.data ?? []) {
    const record = asRecord(item);
    const date = getLocalDate(item);
    if (!record || !date) continue;
    const current = byDate.get(date);
    const duration = (r: Record<string, unknown>) =>
      typeof r.total_sleep_duration === 'number' ? r.total_sleep_duration : 0;
    const isLong = (r: Record<string, unknown>) => r.type === 'long_sleep';
    if (!current || (isLong(record) && !isLong(current)) ||
        (isLong(record) === isLong(current) && duration(record) > duration(current))) {
      byDate.set(date, record);
    }
  }
  return byDate;
}
```

Add a `sleepPeriods: Map<string, Record<string, unknown>>` field to `OuraDailyCollections`, populate it with `pickMainSleepByDate(sleepRes)`, add `sleepPeriods` to the date-union loop inside `getSnapshotDates`, and add a `sleep: { required: false, data: collectionData(sleepRes) }` entry to `analyticsCollections`. In `syncOuraSnapshots`, thread `sleepDetail: collections.sleepPeriods.get(localDate)` into the `mapOuraDailyPayloadToHealthSnapshot(...)` call.

- [ ] **Step 6: featureBuilder + engine wiring.** In `src/lib/correlation/types.ts`, add to `DailyLifestyleSnapshot`:

```ts
  sleepAvgHrv?: number | null;
  sleepEfficiency?: number | null;
  deepSleepMinutes?: number | null;
  remSleepMinutes?: number | null;
  respiratoryRate?: number | null;
  restingHeartRate?: number | null;
```

In `src/lib/correlation/featureBuilder.ts`, find where `healthRows` maps `'sleep_score'` → `sleepScore` (`rg -n "sleep_score" src/lib/correlation/featureBuilder.ts` — currently line 179: `sleepScore: firstNumber(healthRows, 'sleep_score'),`) and add six analogous lines using the same `firstNumber(healthRows, '<column>')` helper: `sleep_avg_hrv` → `sleepAvgHrv`, `sleep_efficiency` → `sleepEfficiency`, `deep_sleep_minutes` → `deepSleepMinutes`, `rem_sleep_minutes` → `remSleepMinutes`, `respiratory_rate` → `respiratoryRate`, `resting_heart_rate` → `restingHeartRate`.

In `src/lib/correlation/engine.ts`, locate the outcome-metric registry (`rg -n "sleepScore" src/lib/correlation/engine.ts` — currently line 26: `{ key: 'sleepScore', label: 'sleep score' },`) and register the six new outcomes following the exact same `{ key: '...', label: '...' }` shape used there: `{ key: 'deepSleepMinutes', label: 'deep sleep (min)' }`, `{ key: 'remSleepMinutes', label: 'REM sleep (min)' }`, `{ key: 'sleepAvgHrv', label: 'sleep HRV' }`, `{ key: 'sleepEfficiency', label: 'sleep efficiency' }`, `{ key: 'restingHeartRate', label: 'resting HR' }`, `{ key: 'respiratoryRate', label: 'respiratory rate' }`.

Add a test to `src/lib/correlation/featureBuilder.test.mjs` asserting a `healthSnapshots` input row `{ local_date: '2026-07-01', deep_sleep_minutes: 90, sleep_avg_hrv: 52 }` lands on the built snapshot as `deepSleepMinutes: 90, sleepAvgHrv: 52` (match the existing test's `healthSnapshots` input shape in that file).

- [ ] **Step 7: Verify** — `npm run test:correlation` PASS, `npx tsc --noEmit`, `npm run test:unit`, `npm run build` all green.

- [ ] **Step 8: Commit** — `git commit -m "feat: Oura sleep-detail metrics in snapshots and correlation outcomes"`

**Orchestrator after merge:** apply migration `021_oura_sleep_detail.sql`. Note: **no raw-payload backfill is possible** for these fields — the `sleep` endpoint was never fetched historically (it's new in this task) and `heart_health` responses were always empty, so `raw_payload` for the 15 pre-existing days never contained this data. Sleep-detail history starts from whenever this task's first cron run happens, not retroactively.

---

### Task 5: Phase C — enhanced tags as correlation features

**Files:**
- Modify: `src/lib/health/ouraSyncEngine.ts`, `src/lib/health/persistence.ts`, `src/lib/correlation/featureBuilder.ts`, `src/lib/correlation/types.ts`, `src/lib/correlation/persistence.ts` (the `buildDailyLifestyleSnapshots` caller — confirmed at line 294), `docs/oura-integration-stack.md`
- Create: `supabase/022_oura_tags.sql`
- Test: `src/lib/correlation/featureBuilder.test.mjs` (extend)

**Interfaces:**
- Produces: `upsertOuraTags(rows: OuraTagRow[]): Promise<number>` in `persistence.ts` with `type OuraTagRow = { userId: string; ouraId: string; localDate: string; tagType: string | null; comment: string | null; startTime: string | null }`; `BuildDailyLifestyleSnapshotsInput` gains `ouraTags?: Row[]`; `DailyLifestyleSnapshot` gains `caffeineTagged?: boolean; alcoholTagged?: boolean; saunaTagged?: boolean; ouraTagCount?: number | null`.

- [ ] **Step 1: Migration `supabase/022_oura_tags.sql`:**

```sql
create table if not exists oura_tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  oura_id text not null,
  local_date date not null,
  tag_type text,
  comment text,
  start_time timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, oura_id)
);
alter table oura_tags enable row level security;
do $$ begin
  create policy "Owner read oura tags" on oura_tags for select using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
create index if not exists idx_oura_tags_user_date on oura_tags(user_id, local_date);
```

- [ ] **Step 2: `upsertOuraTags` in `src/lib/health/persistence.ts`** (append below `upsertExternalHealthDailySnapshots`, reusing the existing `createHealthServiceClient` in this file):

```ts
export type OuraTagRow = {
  userId: string;
  ouraId: string;
  localDate: string;
  tagType: string | null;
  comment: string | null;
  startTime: string | null;
};

export async function upsertOuraTags(rows: OuraTagRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  const supabase = createHealthServiceClient();
  const { error } = await supabase.from('oura_tags').upsert(
    rows.map((row) => ({
      user_id: row.userId,
      oura_id: row.ouraId,
      local_date: row.localDate,
      tag_type: row.tagType,
      comment: row.comment,
      start_time: row.startTime,
    })),
    { onConflict: 'user_id,oura_id' },
  );
  if (error) throw error;
  return rows.length;
}
```

- [ ] **Step 3: Engine fetch.** In `fetchOuraDailyCollections`, add `fetchOptionalOuraCollection(apiBaseUrl, accessToken, '/v2/usercollection/enhanced_tag', range)` to the `Promise.all`; store the raw response as a new field `enhancedTags: OuraCollectionResponse` on the returned collections object (no per-day grouping needed — it's mapped directly in `syncOuraSnapshots`). In `syncOuraSnapshots`, after the snapshot upsert succeeds, map documents (fields per Oura v2 docs: `id`, day via `getLocalDate`, `tag_type_code`, `comment`, `start_time`) and persist:

```ts
const tagRows = (collections.enhancedTags.data ?? [])
  .map(asRecord)
  .filter((doc): doc is Record<string, unknown> => doc !== null)
  .map((doc) => ({
    userId,
    ouraId: String(doc.id ?? ''),
    localDate: getLocalDate(doc) ?? range.end_date,
    tagType: typeof doc.tag_type_code === 'string' ? doc.tag_type_code : null,
    comment: typeof doc.comment === 'string' ? doc.comment : null,
    startTime: typeof doc.start_time === 'string' ? doc.start_time : null,
  }))
  .filter((row) => row.ouraId.length > 0);
await upsertOuraTags(tagRows);
```

Also add an `enhanced_tag: { required: false, data: collectionData(enhancedTagsRes) }` entry to `analyticsCollections`. Import `upsertOuraTags` from `@/lib/health/persistence` at the top of `ouraSyncEngine.ts`.

**Scope note:** `enhanced_tag` is covered by the existing `tag` OAuth scope (see `src/lib/oura/config.ts:7`, `DEFAULT_SCOPES` includes `tag`) — do not remove that scope; only the deprecated `/tag` **endpoint** goes unused. Correct the sentence in `docs/oura-integration-stack.md` §4.2 Phase C from "Drop the deprecated `tag` scope" to "the deprecated `/tag` endpoint is unused; the `tag` OAuth scope stays (it authorizes `enhanced_tag`)."

- [ ] **Step 4: featureBuilder tags → features + failing test first.** Add to `src/lib/correlation/featureBuilder.test.mjs`: input `ouraTags: [{ local_date: '2026-07-01', tag_type: 'tag_generic_caffeine' }, { local_date: '2026-07-01', tag_type: 'tag_generic_alcohol' }]` → the snapshot for that date has `caffeineTagged: true, alcoholTagged: true, saunaTagged: false, ouraTagCount: 2`. Implementation in `featureBuilder.ts`: group `ouraTags` rows by `local_date`; per date, `caffeineTagged = tags.some(t => String(t.tag_type ?? '').includes('caffeine'))` (same pattern for `'alcohol'` and `'sauna'`), `ouraTagCount = tags.length`. Add the four fields to `DailyLifestyleSnapshot` in `types.ts`.

- [ ] **Step 5: Feed the builder.** In `src/lib/correlation/persistence.ts` around line 294 (the `buildDailyLifestyleSnapshots({...})` call), add an `oura_tags` range select for the same user/date window and pass the rows as `ouraTags` in the input object.

- [ ] **Step 6: Verify** — `npm run test:correlation` PASS, `npx tsc --noEmit`, `npm run test:unit`, `npm run build` green.

- [ ] **Step 7: Commit** — `git commit -m "feat: Oura enhanced tags stored and exposed as correlation features"`

**Orchestrator after merge:** apply migration `022_oura_tags.sql`; after the next cron fire, check `select count(*) from oura_tags;` (may legitimately be 0 if the user never tags in the Oura app).

---

## Execution & ops summary (orchestrator checklist)

1. **Task 1 first, always** — it is pure ops (no PR), takes minutes, and unblocks the already-broken production feature immediately. Do not start Task 2's code until Task 1's Step 4 verification passes.
2. Tasks 2–5 run **sequentially** (shared `ouraSyncEngine.ts`), one branch/PR each: `codex/oura-cron-sync` → `codex/oura-heart-endpoints` → `codex/oura-sleep-detail` → `codex/oura-tags`. Two-stage review per task (spec, then quality), CI gate + `tsc`/`test:unit`/`test:correlation`/`build` before each merge.
3. Migrations `020`/`021`/`022` applied by the orchestrator via the Supabase Management API right after each owning PR merges, verified with the SQL checks embedded in each task.
4. After Task 2 ships: create the 6-hourly cron-job.org job (same account/workflow as the existing `/api/cron/notify` job #7402449), fire once, verify `last_sync_at` advances and snapshots resume past `2026-04-26`.
5. Out of scope (deliberate, per `docs/oura-integration-stack.md` §4.1/§5): webhook subscriptions (phase 2, only worth it once polling volume matters at scale), 5-minute heart-rate ingestion, `ring_configuration`, `sleep_time` → quiet-hours reminder wiring (no consumer exists yet), any UI changes.
