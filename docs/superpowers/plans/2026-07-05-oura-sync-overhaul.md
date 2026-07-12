# Oura Sync Overhaul Implementation Plan

> **Superseded 2026-07-10** — use [`docs/superpowers/plans/2026-07-10-oura-sync-overhaul.md`](2026-07-10-oura-sync-overhaul.md) instead. This plan's Task 1 assumes `supabase/008_oura_analytics.sql` is already applied to production; it is not, and the currently-deployed manual sync route already calls into those missing tables unconditionally — meaning "Sync now" has been actively failing (502), not just unused. The 2026-07-10 plan opens with a migration-application task that fixes this before any of the code-extraction work below, and reuses the existing `'daily'` sync-type value instead of introducing a new `'scheduled'` one. Kept here for historical reference only — do not execute from this file.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automate Oura data sync (stalled since 2026-04-26 because it is manual-only) and widen the pulled data per `docs/oura-integration-stack.md`: fix the never-populated heart-health fields, add sleep detail, add enhanced tags, and wire everything into the correlation feature builder.

**Architecture:** Extract the already-complete sync engine out of the cookie-authed `/api/integrations/health/sync` route into a shared server module (every persistence dependency already uses a service-role client, so the engine is cron-ready as-is). A new `/api/cron/oura-sync` route walks all connected users on a schedule. Data widening replaces the non-existent `heart_health` endpoint (silently 404-swallowed today — root cause of the NULL columns) with the real `vO2_max` / `daily_resilience` / `daily_cardiovascular_age` routes, then adds `sleep` detail and `enhanced_tag`.

**Tech Stack:** Next.js 15 App Router route handlers (`runtime='nodejs'`), Supabase service-role clients (already the pattern in `src/lib/health/persistence.ts`, `src/lib/oura/tokenStore.ts`, `analyticsStore.ts`), Oura API v2 OAuth2, node:test standalone harness (`npm run test:unit`), manual SQL migrations (020+) applied by the orchestrator via Management API.

## Global Constraints

- Never push to `main`; branches `codex/<slice>`; conventional commits; every commit ends with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Never modify `tsconfig.json`; no `any` without a comment; run `npx tsc --noEmit` after every .ts change; `npm run build` must pass before PR.
- Migrations: numbered files in `supabase/`, idempotent; **authored by the implementer, applied to prod ONLY by the orchestrator** via Management API.
- Cron routes authenticate with `Bearer ${CRON_SECRET}` exactly like `src/app/api/cron/notify/route.ts:38-41`.
- Oura fetches go through the existing `fetchPaginatedOuraCollection` / `fetchOptionalOuraCollection` helpers (pagination + 401/403/404 tolerance); never raw `fetch`.
- New pure logic must be clock-free (dates injected) and registered in the `test:unit` script in `package.json` (both the tsc file list AND the `node .tmp/unit/...` run chain — see how `tests/unit/ids.test.ts` is wired).
- E2E suites run with `workers:1` and the shared-account cleanup rules (PR #63); no new E2E is required by this plan (no UI changes except none).

## File map (who owns what)

| File | Role |
|---|---|
| `src/lib/health/ouraSyncEngine.ts` (new, Task 1) | The whole fetch→map→persist engine, extracted verbatim from `health/sync/route.ts`; exports `syncOuraSnapshots` |
| `src/app/api/integrations/health/sync/route.ts` | Slims to cookie-auth wrapper around the engine |
| `src/app/api/cron/oura-sync/route.ts` (new, Task 1) | CRON_SECRET-authed walker over all connected users |
| `src/lib/oura/syncWindows.ts` + `tests/unit/ouraSyncWindows.test.ts` | Gains pure `computeOuraCronSyncRange` |
| `src/lib/health/sourceRegistry.ts` | Gains `listConnectedOuraUserIds`; success handler resets `status` |
| `src/lib/health/ouraDailyMapper.ts` + `src/lib/health/ouraDailyMapper.test.mjs` | Payload widening (Tasks 2–3) |
| `src/lib/health/types.ts`, `src/lib/health/persistence.ts` | Snapshot type + row mapping widening |
| `src/lib/correlation/featureBuilder.ts` + test, `src/lib/correlation/types.ts`, `engine.ts` | New features/outcomes (Tasks 3–4) |
| `supabase/020_oura_heart_fields.sql`, `021_oura_sleep_detail.sql`, `022_oura_tags.sql` | Migrations |

Tasks are **sequential** (they all touch `ouraSyncEngine.ts`); do not parallelize branches.

---

### Task 1: Cron-driven sync (fixes G1 — data stalled since Apr 26)

**Files:**
- Create: `src/lib/health/ouraSyncEngine.ts`
- Create: `src/app/api/cron/oura-sync/route.ts`
- Modify: `src/app/api/integrations/health/sync/route.ts` (slim to wrapper)
- Modify: `src/lib/oura/syncWindows.ts`, `src/lib/health/sourceRegistry.ts`
- Test: `tests/unit/ouraSyncWindows.test.ts` (extend)

**Interfaces:**
- Produces: `syncOuraSnapshots(userId: string, range: { start_date: string; end_date: string }, syncType: string): Promise<number>` in `ouraSyncEngine.ts`; `computeOuraCronSyncRange(now: Date, lastSyncAt: string | null): { start_date: string; end_date: string }` in `syncWindows.ts`; `listConnectedOuraUserIds(): Promise<Array<{ userId: string; lastSyncAt: string | null }>>` in `sourceRegistry.ts`.
- Consumes: everything already exported by `tokenStore`, `analyticsStore`, `persistence`, `sourceRegistry`, `client.ts` — all service-role internally, no session needed.

- [ ] **Step 1: Write the failing test for the pure range helper.** Append to `tests/unit/ouraSyncWindows.test.ts` (match the file's existing import style):

```ts
import { computeOuraCronSyncRange } from '../../src/lib/oura/syncWindows';

test('cron range defaults to a trailing 7-day window', () => {
  const now = new Date('2026-07-05T12:00:00.000Z');
  assert.deepEqual(computeOuraCronSyncRange(now, null), {
    start_date: '2026-06-28',
    end_date: '2026-07-05',
  });
});

test('cron range extends back to lastSync minus 2 days when the sync stalled', () => {
  const now = new Date('2026-07-05T12:00:00.000Z');
  assert.deepEqual(computeOuraCronSyncRange(now, '2026-06-20T10:00:00.000Z'), {
    start_date: '2026-06-18',
    end_date: '2026-07-05',
  });
});

test('cron range is floored at 30 days for very stale connections', () => {
  const now = new Date('2026-07-05T12:00:00.000Z');
  assert.deepEqual(computeOuraCronSyncRange(now, '2026-04-26T23:33:21.000Z'), {
    start_date: '2026-06-05',
    end_date: '2026-07-05',
  });
});
```

- [ ] **Step 2: Run `npm run test:unit`** — expect FAIL (`computeOuraCronSyncRange` not exported).

- [ ] **Step 3: Implement in `src/lib/oura/syncWindows.ts`:**

```ts
// Cron sync window: at minimum the trailing 7 days (daily_activity/stress
// keep updating through the day; readiness finalizes next morning), extended
// back to lastSync − 2d when the connection stalled, floored at 30 days.
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

- [ ] **Step 5: Extract the engine.** Create `src/lib/health/ouraSyncEngine.ts` by MOVING (not copying) from `src/app/api/integrations/health/sync/route.ts` everything except the `POST` handler and the request-param helpers (`toDateInput`, `defaultStartDate`, `defaultEndDate`): the `OuraCollectionResponse` / `OuraDailyCollections` types, `tokenExpiresSoon`, `asRecord`, `getLocalDate`, `groupDailyData`, `groupWorkoutData`, `getContinuationToken`, `getSnapshotDates`, `collectionData`, `getValidOuraTokens`, `fetchPaginatedOuraCollection`, `fetchOptionalOuraCollection`, `fetchOuraDailyCollections`, `persistOuraAnalyticsPayloads`, `syncOuraSnapshots`, `OURA_MAX_PAGES_PER_COLLECTION`, `DATE_RE`. Change the `syncOuraSnapshots` signature to accept the sync type instead of hardcoding it:

```ts
export async function syncOuraSnapshots(
  userId: string,
  range: { start_date: string; end_date: string },
  syncType: string,
): Promise<number> {
  // body unchanged except: startOuraSyncRun({ userId, syncType, ... })
```

The route file keeps its imports of the engine + `mapOuraDailyPayloadToHealthSnapshot` moves with the engine. The slimmed route `POST` calls `syncOuraSnapshots(userId, range, 'manual_refresh')`.
Before choosing the cron sync-type string, check the DB constraint: run `rg -n "sync_type" supabase/008_oura_analytics.sql`. If there is a `check (sync_type in (...))` list without `'scheduled'`, author `supabase/020_oura_heart_fields.sql`'s first statement as a constraint widening (drop+re-add with `'scheduled'` added); if no CHECK exists, just use `'scheduled'`.

- [ ] **Step 6: Fix the status-recovery bug.** In `src/lib/health/sourceRegistry.ts`, `markHealthConnectionSyncSuccess` currently updates `last_sync_at`/`last_error` but never resets `status` — one failure marks the row `'error'` forever and (after this task) would exclude the user from cron enumeration. Add `status: 'connected',` to its `.update({...})` object. In the same file add:

```ts
export async function listConnectedOuraUserIds(): Promise<Array<{ userId: string; lastSyncAt: string | null }>> {
  const supabase = createHealthServiceClient();
  const { data, error } = await supabase
    .from('external_health_connections')
    .select('user_id, last_sync_at, status')
    .eq('source', 'oura')
    .in('status', ['connected', 'error']); // include 'error' so transient failures self-heal
  if (error) throw error;
  return ((data ?? []) as Array<{ user_id: string; last_sync_at: string | null }>).map(row => ({
    userId: row.user_id,
    lastSyncAt: row.last_sync_at,
  }));
}
```

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
      const snapshots = await syncOuraSnapshots(connection.userId, range, 'scheduled');
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

  return NextResponse.json({ synced: results.filter(r => r.status === 'ok').length, results });
}
```

- [ ] **Step 8: Verify.** `npx tsc --noEmit` clean; `npm run test:unit` all pass; `npm run build` passes and the route list shows `ƒ /api/cron/oura-sync`. Local smoke: `E2E is not needed` — instead run `npm run dev -- --port 3260` and `curl -s -H "Authorization: Bearer $(rg -o 'CRON_SECRET=(.*)' -r '$1' .env.local | head -1)" localhost:3260/api/cron/oura-sync` → expect JSON `{"synced":...}` (0 users locally is fine; 401 without the header proves the guard). Kill the dev server.

- [ ] **Step 9: Commit** — `git commit -m "feat: scheduled Oura sync — cron route walking connected users"`

**Orchestrator ops after merge (NOT the implementer):** apply any constraint migration; create the cron-job.org job (every 6h, URL `https://medremind-app-two.vercel.app/api/cron/oura-sync`, header `Authorization: Bearer <CRON_SECRET>` — same API key workflow as job #7402449 in `~/.claude` memory); trigger once manually and verify via SQL that `external_health_connections.last_sync_at` moved and `external_health_daily_snapshots` grew past 2026-04-26.

---

### Task 2: Phase A — real heart-health endpoints (fixes G2 — NULL vo2/resilience)

**Root cause being fixed:** the engine fetches `/v2/usercollection/heart_health`, which **does not exist in Oura v2**; `fetchOptionalOuraCollection` swallows the 404, so `heartHealth` is always an empty map and `vo2_max`/`resilience_level` never populate.

**Files:**
- Modify: `src/lib/health/ouraSyncEngine.ts` (replace heart_health fetch), `src/lib/health/ouraDailyMapper.ts`, `src/lib/health/types.ts`, `src/lib/health/persistence.ts`
- Create: `supabase/020_oura_heart_fields.sql`
- Test: `src/lib/health/ouraDailyMapper.test.mjs` (extend; see wiring note in Step 1)

**Interfaces:**
- Produces: mapper payload key `heartHealth` gains `cardiovascular_age?: number | null`; snapshot type gains `cardiovascularAge: number | null`; snapshot row gains column `cardiovascular_age`.
- Consumes: `fetchOptionalOuraCollection`, `groupDailyData` from Task 1's engine.

- [ ] **Step 1: Wire the mapper test if orphaned.** Check `rg -n "ouraDailyMapper" package.json`. If the test file is not run by any script, append it to the `test:correlation` command (same `node --experimental-strip-types --test` list — it already runs `.test.mjs` files). Then add the failing test to `src/lib/health/ouraDailyMapper.test.mjs` (match its existing import/assert style):

```js
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

- [ ] **Step 2: Run the owning script** (`npm run test:correlation`) — expect FAIL (`cardiovascularAge` undefined).

- [ ] **Step 3: Widen types + mapper + persistence.**
`src/lib/health/types.ts`: add `cardiovascularAge: number | null;` to `ExternalHealthDailySnapshot`.
`src/lib/health/ouraDailyMapper.ts`: in the `heartHealth` input type add `cardiovascular_age?: number | null;`; in the return object add `cardiovascularAge: numberOrNull(input.heartHealth?.cardiovascular_age),`.
`src/lib/health/persistence.ts`: in `toSnapshotRow` add `cardiovascular_age: snapshot.cardiovascularAge,`.

- [ ] **Step 4: Author `supabase/020_oura_heart_fields.sql`:**

```sql
-- 020: cardiovascular age from Oura daily_cardiovascular_age.
-- (If Task 1 required widening the oura sync_runs sync_type CHECK, that
-- statement lives at the top of this same file.)
alter table external_health_daily_snapshots
  add column if not exists cardiovascular_age numeric;
```

- [ ] **Step 5: Replace the dead endpoint in the engine.** In `src/lib/health/ouraSyncEngine.ts`, inside `fetchOuraDailyCollections`, replace the single `heart_health` fetch with three real collections and merge them into the existing `heartHealth` map shape:

```ts
const [vo2MaxRes, resilienceRes, cardioAgeRes] = await Promise.all([
  fetchOptionalOuraCollection(apiBaseUrl, accessToken, '/v2/usercollection/vO2_max', range),
  fetchOptionalOuraCollection(apiBaseUrl, accessToken, '/v2/usercollection/daily_resilience', range),
  fetchOptionalOuraCollection(apiBaseUrl, accessToken, '/v2/usercollection/daily_cardiovascular_age', range),
]);

// Merge the three heart collections into one per-day record matching the
// mapper's heartHealth input: { vo2_max, resilience_level, cardiovascular_age }.
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

Use `heartHealth: mergeHeartHealth(vo2MaxRes, resilienceRes, cardioAgeRes)` in the returned collections, and update `analyticsCollections`: remove the `heart_health` entry, add `vO2_max`, `daily_resilience`, `daily_cardiovascular_age` (all `{ required: false, data: collectionData(...) }`).
Field-name notes (Oura v2 response docs): `vO2_max` documents carry `vo2_max`; `daily_resilience` carries `level`; `daily_cardiovascular_age` carries `vascular_age`. `resting_heart_rate`/`hrv_balance` stay null until Task 3 (they come from sleep detail, not these endpoints).

- [ ] **Step 6: Verify.** `npm run test:correlation` PASS; `npx tsc --noEmit` clean; `npm run test:unit` PASS; `npm run build` PASS.

- [ ] **Step 7: Commit** — `git commit -m "fix: fetch real Oura heart endpoints (heart_health does not exist) + cardiovascular age"`

**Orchestrator after merge:** apply migration 020; after the next cron fire verify `SELECT count(vo2_max), count(resilience_level), count(cardiovascular_age) FROM external_health_daily_snapshots WHERE local_date >= current_date - 7` are non-zero (ring subscription permitting — these endpoints can legitimately return empty for some accounts; log, don't fail).

---

### Task 3: Phase B — sleep detail into snapshots and correlations

**Files:**
- Modify: `src/lib/health/ouraSyncEngine.ts`, `ouraDailyMapper.ts`, `types.ts`, `persistence.ts`, `src/lib/correlation/featureBuilder.ts`, `src/lib/correlation/types.ts`, `src/lib/correlation/engine.ts`
- Create: `supabase/021_oura_sleep_detail.sql`
- Test: `ouraDailyMapper.test.mjs`, `src/lib/correlation/featureBuilder.test.mjs` (extend both)

**Interfaces:**
- Produces: mapper payload gains `sleepDetail?: { average_hrv?, efficiency?, latency?, deep_sleep_duration?, rem_sleep_duration?, average_breath?, lowest_heart_rate? }`; snapshot gains `sleepAvgHrv, sleepEfficiency, sleepLatencySeconds, deepSleepMinutes, remSleepMinutes, respiratoryRate` (all `number | null`); `restingHeartRate` now sources from `sleepDetail.lowest_heart_rate`; `DailyLifestyleSnapshot` gains the same six numeric fields.
- Consumes: Task 2's merged heartHealth (unchanged), Task 1 engine structure.

- [ ] **Step 1: Failing mapper test** (append to `ouraDailyMapper.test.mjs`):

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
`types.ts` snapshot additions: `sleepAvgHrv: number | null; sleepEfficiency: number | null; sleepLatencySeconds: number | null; deepSleepMinutes: number | null; remSleepMinutes: number | null; respiratoryRate: number | null;`.
`ouraDailyMapper.ts`: add the `sleepDetail` input type above; in the return object:

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

with the helper `function minutesOrNull(value: unknown): number | null { const n = numberOrNull(value); return n === null ? null : Math.round(n / 60); }` (Oura durations are seconds).
`persistence.ts` `toSnapshotRow` additions: `sleep_avg_hrv, sleep_efficiency, sleep_latency_seconds, deep_sleep_minutes, rem_sleep_minutes, respiratory_rate` mapped from the six fields.

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

- [ ] **Step 5: Engine — fetch `sleep` and pick the main period per day.** In `fetchOuraDailyCollections` add `fetchOptionalOuraCollection(apiBaseUrl, accessToken, '/v2/usercollection/sleep', range)` to the Promise.all; group with:

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

Thread `sleepDetail: collections.sleepPeriods.get(localDate)` into the `mapOuraDailyPayloadToHealthSnapshot` call in `syncOuraSnapshots`, add `sleepPeriods` to `OuraDailyCollections` and to `getSnapshotDates`, and add a `sleep: { required: false, data: collectionData(sleepRes) }` entry to `analyticsCollections`.

- [ ] **Step 6: featureBuilder + engine wiring.** In `src/lib/correlation/types.ts` add to `DailyLifestyleSnapshot`: `sleepAvgHrv?: number | null; sleepEfficiency?: number | null; deepSleepMinutes?: number | null; remSleepMinutes?: number | null; respiratoryRate?: number | null; restingHeartRate?: number | null;`. In `featureBuilder.ts`, find where `healthSnapshots` rows map `sleep_score` → `sleepScore` (run `rg -n "sleep_score" src/lib/correlation/featureBuilder.ts`) and add the six analogous row mappings (`sleep_avg_hrv` → `sleepAvgHrv`, etc.). In `engine.ts`, locate the outcome-metric registry (`rg -n "sleepScore" src/lib/correlation/engine.ts`) and register the new outcomes with human labels (`deepSleepMinutes` → "Deep sleep (min)", `remSleepMinutes` → "REM sleep (min)", `sleepAvgHrv` → "Sleep HRV", `sleepEfficiency` → "Sleep efficiency", `restingHeartRate` → "Resting HR", `respiratoryRate` → "Respiratory rate") following exactly the structure the existing entries use. Add a featureBuilder test (extend `featureBuilder.test.mjs`) asserting a healthSnapshots row `{ local_date:'2026-07-01', deep_sleep_minutes: 90, sleep_avg_hrv: 52 }` lands on the snapshot as `deepSleepMinutes: 90, sleepAvgHrv: 52`.

- [ ] **Step 7: Verify** — `npm run test:correlation` PASS, `npx tsc --noEmit`, `npm run test:unit`, `npm run build` all green.

- [ ] **Step 8: Commit** — `git commit -m "feat: Oura sleep-detail metrics in snapshots and correlation outcomes"`

**Orchestrator after merge:** apply 021. Note: **no raw-payload backfill is possible** for these fields — historical `raw_payload`s never contained sleep detail (the endpoint was never fetched) and `heart_health` responses were empty; the stack doc's backfill note does not apply here.

---

### Task 4: Phase C — enhanced tags as correlation features

**Files:**
- Modify: `src/lib/health/ouraSyncEngine.ts`, `src/lib/health/persistence.ts`, `src/lib/correlation/featureBuilder.ts`, `src/lib/correlation/types.ts`, the featureBuilder caller (locate via `rg -rn "buildDailyLifestyleSnapshots" src/app src/lib --glob '!*test*'`), `docs/oura-integration-stack.md`
- Create: `supabase/022_oura_tags.sql`
- Test: `featureBuilder.test.mjs` (extend)

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

- [ ] **Step 2: `upsertOuraTags` in `src/lib/health/persistence.ts`** (service client already there):

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
    rows.map(row => ({
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

- [ ] **Step 3: Engine fetch.** In `fetchOuraDailyCollections` add `fetchOptionalOuraCollection(apiBaseUrl, accessToken, '/v2/usercollection/enhanced_tag', range)`, store the raw response on the collections object as a new field `enhancedTags: OuraCollectionResponse` (no per-day grouping needed); in `syncOuraSnapshots`, after the snapshot upsert, map documents (fields per Oura docs: `id`, `day` (via `getLocalDate`), `tag_type_code`, `comment`, `start_time`) and call `upsertOuraTags`:

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

(keep the raw response in `analyticsCollections` as `enhanced_tag: { required: false, ... }`). Scope note: `enhanced_tag` is covered by the existing `tag` OAuth scope — **do not remove the scope**; also correct the sentence in `docs/oura-integration-stack.md` §4.2 Phase C from "Drop the deprecated `tag` scope" to "the deprecated `/tag` **endpoint** is unused; the `tag` scope itself stays (it authorizes `enhanced_tag`)".

- [ ] **Step 4: featureBuilder tags → features + failing test first.** Test (extend `featureBuilder.test.mjs`): input `ouraTags: [{ local_date: '2026-07-01', tag_type: 'tag_generic_caffeine' }, { local_date: '2026-07-01', tag_type: 'tag_generic_alcohol' }]` → snapshot for that date has `caffeineTagged: true, alcoholTagged: true, saunaTagged: false, ouraTagCount: 2`. Implementation in `featureBuilder.ts`: group `ouraTags` rows by `local_date`; per date set `caffeineTagged = tags.some(t => String(t.tag_type ?? '').includes('caffeine'))`, same for `'alcohol'` and `'sauna'`, and `ouraTagCount = tags.length`. Add the four fields to `DailyLifestyleSnapshot` in `types.ts`.

- [ ] **Step 5: Feed the builder.** Locate the `buildDailyLifestyleSnapshots` caller (Step's rg above), add an `oura_tags` range select for the same user/date window, and pass the rows as `ouraTags`.

- [ ] **Step 6: Verify** — `npm run test:correlation` PASS, `npx tsc --noEmit`, `npm run test:unit`, `npm run build` green.

- [ ] **Step 7: Commit** — `git commit -m "feat: Oura enhanced tags stored and exposed as correlation features"`

**Orchestrator after merge:** apply 022; after next cron fire check `select count(*) from oura_tags` (may legitimately be 0 if the user never tags).

---

## Execution & ops summary (orchestrator checklist)

1. Tasks run **sequentially** (shared `ouraSyncEngine.ts`), one branch/PR each: `codex/oura-cron-sync` → `codex/oura-heart-endpoints` → `codex/oura-sleep-detail` → `codex/oura-tags`. Two-stage review per task (spec, then quality), CI gate + `tsc`/`test:unit`/`test:correlation`/`build` before each merge.
2. Migrations 020/021/022 applied by the orchestrator via Management API right after each owning PR merges, verified with the SQL checks embedded in each task.
3. After Task 1 ships: create the 6-hourly cron-job.org job (same account/key as notify job #7402449), fire once, verify `last_sync_at` advances and snapshots resume past 2026-04-26 — **this is the moment the 2-month data gap stops growing**, so prioritize merging Task 1 even if later tasks slip.
4. Out of scope (deliberate): webhook subscriptions (phase 2 per `docs/oura-integration-stack.md` §4.1), 5-min heart-rate ingestion, `ring_configuration`, `sleep_time`→quiet-hours wiring (no reminder-timing consumer exists yet), UI changes.
