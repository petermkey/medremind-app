# Oura Sprint 2 — Round-the-Clock Heart Rate + Dose-Response Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ingest Oura's 5-minute daytime heart-rate timeseries into a dedicated table and derive per-day medication dose-response features (post-dose HR delta, daytime average HR) for the correlation engine.

**Architecture:** The `/v2/usercollection/heartrate` endpoint is the only source of daytime HR (all current data describes the night) and — critically — uses `start_datetime`/`end_datetime` query params, not the `start_date`/`end_date` the existing fetch helper sends. We add: a datetime-range helper in `syncWindows.ts`, a sample-parsing leaf module, a new `oura_heartrate_samples` table (PK `(user_id, ts)` making upserts idempotent), a fetch+persist step appended to `syncOuraSnapshots` with its own endpoint-coverage row, a pure `doseResponse.ts` module correlating samples with `execution_events` "taken" timestamps, and featureBuilder/engine wiring for two new day-keyed outcomes.

**Tech Stack:** Next.js 15 App Router, TypeScript strict, Supabase Postgres (service-role), Node `--experimental-strip-types` runner for leaf tests, `tsc`-compiled `tests/unit` pipeline for cross-module tests.

## Spec

### Requirements

1. **Ingest.** Each sync also fetches `/v2/usercollection/heartrate` over the sync range (as datetimes) and upserts rows `{user_id, ts, bpm, source}` into `oura_heartrate_samples`. Fetch failures must not fail the whole sync (record an endpoint-coverage row with status `failed` and continue) — HR is additive, not load-bearing.
2. **Volume discipline.** ~288 samples/user/day (~105k rows/user/year) — fine for Postgres, but inserts must be chunked (500 rows/request) and the fetch must respect the existing 25-page pagination cap.
3. **Dose-response features.** For each day, for each `execution_events` row with `event_type='taken'`, compute `postDoseHrDeltaBpm` = median(bpm in [dose, dose+120 min]) − median(bpm in [dose−60 min, dose]), using only samples with `source` in `('awake','rest')` (excludes workout/session artifacts). Daily value = mean over that day's doses (null if no dose has ≥3 samples on both sides).
4. **Daytime HR outcome.** `daytimeAvgHr` = mean bpm of `awake`/`rest` samples between 08:00 and 22:00 local time.
5. **Correlation wiring.** Both become engine `OUTCOMES`; features like `adherencePct`, `lateMedicationCount` can then correlate against them.

### Acceptance criteria

- `npm run build`, `npx tsc --noEmit`, `npm run test:correlation`, `npm run test:unit` all pass.
- After one live sync, `select count(*) from oura_heartrate_samples` > 0 and a repeat sync does not error or duplicate (PK upsert).
- `daily_lifestyle_snapshots` build produces `postDoseHrDeltaBpm`/`daytimeAvgHr` for days having both doses and samples.
- `oura_sync_endpoint_coverage` gains a `heartrate` row per sync run.

### Non-goals

- No UI for HR curves; no intra-day insight cards; no backfill beyond 30 days (Oura serves history, but a big one-off pull is a separate owner decision — an optional script is included but not required for done).
- No changes to `daily_lifestyle_snapshots` table schema (in-memory pattern, as in Sprint 1).

## Global Constraints

- TypeScript strict; no `any` without comment; `npx tsc --noEmit` after every `.ts` change; `npm run build` before PR.
- Branch: `codex/oura-sprint2-heartrate`. Never push `main`. Conventional commits.
- Leaf-module rule for `.test.mjs` files (strip-types runner): zero value imports, or explicit-`.ts`-extension sibling imports only.
- Cross-module code is tested through the `tests/unit/*.test.ts` pipeline (`npm run test:unit` compiles a fixed file list with `tsc` — new test files must be added to BOTH the `tsc` list and the `node` run list inside the `test:unit` script in `package.json`).
- Migration application to production is a manual Supabase Management API step (project `hagypgvfkjkncznoctoq`).
- Oura `heartrate` response shape: `{ data: [{ timestamp, timestamp_unix, bpm, source }], next_token }`; `source` ∈ `awake|workout|rest|sleep|live|session`; params are `start_datetime`/`end_datetime` (ISO 8601), NOT `start_date`/`end_date`.

## File Structure

- Create: `supabase/024_oura_heartrate.sql` — samples table.
- Modify: `src/lib/oura/syncWindows.ts` — `heartrateDatetimeRange()`.
- Modify: `tests/unit/ouraSyncWindows.test.ts` — its test.
- Create: `src/lib/oura/heartrateSamples.ts` — leaf module: response→rows parsing + chunking.
- Create: `src/lib/oura/heartrateSamples.test.mjs` — its tests.
- Modify: `src/lib/health/persistence.ts` — `upsertOuraHeartrateSamples()`.
- Modify: `src/lib/health/ouraSyncEngine.ts` — fetch + persist + coverage step.
- Create: `src/lib/health/doseResponse.ts` — leaf module: dose-response math.
- Create: `src/lib/health/doseResponse.test.mjs` — its tests.
- Modify: `src/lib/correlation/persistence.ts`, `featureBuilder.ts`, `types.ts`, `engine.ts` — wiring.
- Modify: `package.json` — test lists.
- Create (optional): `scripts/backfill-oura-heartrate.mjs` — 90-day history pull in 30-day chunks.

---

### Task 1: Migration 024 — `oura_heartrate_samples`

**Files:**
- Create: `supabase/024_oura_heartrate.sql`

**Interfaces:**
- Produces: table `oura_heartrate_samples(user_id uuid, ts timestamptz, bpm int, source text)`, PK `(user_id, ts)` — consumed by Tasks 4–6.

- [ ] **Step 1: Write the migration**

```sql
-- 024: 5-minute heart-rate timeseries from /v2/usercollection/heartrate.
-- The only daytime HR source; ~288 rows/user/day. PK (user_id, ts) makes
-- repeated sync-window upserts idempotent. Server-only (no user RLS policy),
-- same stance as oura_raw_documents.
create table if not exists oura_heartrate_samples (
  user_id uuid not null references profiles(id) on delete cascade,
  ts timestamptz not null,
  bpm int not null check (bpm between 20 and 250),
  source text not null check (source in ('awake', 'workout', 'rest', 'sleep', 'live', 'session')),
  fetched_at timestamptz not null default now(),
  primary key (user_id, ts)
);

alter table oura_heartrate_samples enable row level security;

create index if not exists idx_oura_heartrate_samples_user_ts
  on oura_heartrate_samples(user_id, ts desc);
```

- [ ] **Step 2: Commit**

```bash
git add supabase/024_oura_heartrate.sql
git commit -m "feat: migration 024 — oura_heartrate_samples table"
```

---

### Task 2: `heartrateDatetimeRange()` in syncWindows

**Files:**
- Modify: `src/lib/oura/syncWindows.ts`
- Test: `tests/unit/ouraSyncWindows.test.ts`

**Interfaces:**
- Consumes: the `{ start_date, end_date }` range already produced by `computeOuraCronSyncRange`.
- Produces: `heartrateDatetimeRange(range: { start_date: string; end_date: string }): { start_datetime: string; end_datetime: string }` — consumed by Task 4's fetch. UTC day bounds: `${start_date}T00:00:00Z` .. `${end_date}T23:59:59Z`.

- [ ] **Step 1: Add failing test to `tests/unit/ouraSyncWindows.test.ts`**

```ts
// append (this file uses node:test + assert like the others in tests/unit)
test('heartrateDatetimeRange expands a date range to UTC datetime bounds', () => {
  assert.deepEqual(
    heartrateDatetimeRange({ start_date: '2026-07-07', end_date: '2026-07-14' }),
    { start_datetime: '2026-07-07T00:00:00Z', end_datetime: '2026-07-14T23:59:59Z' },
  );
});
```
(Add `heartrateDatetimeRange` to the existing import from `syncWindows`.)

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:unit`
Expected: FAIL — `heartrateDatetimeRange` not exported.

- [ ] **Step 3: Implement in `src/lib/oura/syncWindows.ts`**

```ts
// heartrate + ring_battery_level use datetime params, not date params.
export function heartrateDatetimeRange(
  range: { start_date: string; end_date: string },
): { start_datetime: string; end_datetime: string } {
  return {
    start_datetime: `${range.start_date}T00:00:00Z`,
    end_datetime: `${range.end_date}T23:59:59Z`,
  };
}
```

- [ ] **Step 4: Run to verify pass** — `npm run test:unit` → PASS. Also `npx tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/oura/syncWindows.ts tests/unit/ouraSyncWindows.test.ts
git commit -m "feat: heartrate datetime range helper"
```

---

### Task 3: `heartrateSamples.ts` — parse + chunk (leaf module)

**Files:**
- Create: `src/lib/oura/heartrateSamples.ts`
- Test: `src/lib/oura/heartrateSamples.test.mjs`
- Modify: `package.json` (append to `test:correlation` list)

**Interfaces:**
- Produces (consumed by Tasks 4–5):
  - `export type OuraHeartrateSampleRow = { ts: string; bpm: number; source: string };`
  - `parseHeartrateRows(data: unknown): OuraHeartrateSampleRow[]` — validates each item (`timestamp` ISO string, integer `bpm` 20–250, known `source`), drops invalid.
  - `chunkRows<T>(rows: T[], size: number): T[][]`
- Leaf module: zero imports.

- [ ] **Step 1: Write failing tests**

```js
// src/lib/oura/heartrateSamples.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';

import { chunkRows, parseHeartrateRows } from './heartrateSamples.ts';

test('parseHeartrateRows keeps valid rows and drops malformed ones', () => {
  const rows = parseHeartrateRows([
    { timestamp: '2026-07-13T09:05:00+00:00', bpm: 62, source: 'awake' },
    { timestamp: '2026-07-13T09:10:00+00:00', bpm: 300, source: 'awake' },   // bpm out of range
    { timestamp: 'not-a-date', bpm: 60, source: 'rest' },                    // bad ts
    { timestamp: '2026-07-13T09:15:00+00:00', bpm: 58, source: 'martian' },  // bad source
    'garbage',
    { timestamp: '2026-07-13T09:20:00+00:00', bpm: 71, source: 'workout' },
  ]);
  assert.deepEqual(rows, [
    { ts: '2026-07-13T09:05:00+00:00', bpm: 62, source: 'awake' },
    { ts: '2026-07-13T09:20:00+00:00', bpm: 71, source: 'workout' },
  ]);
});

test('parseHeartrateRows tolerates non-array input', () => {
  assert.deepEqual(parseHeartrateRows(undefined), []);
  assert.deepEqual(parseHeartrateRows({ data: [] }), []);
});

test('chunkRows splits into fixed-size chunks', () => {
  assert.deepEqual(chunkRows([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunkRows([], 2), []);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --experimental-strip-types --test src/lib/oura/heartrateSamples.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/oura/heartrateSamples.ts
// Validation and batching for /v2/usercollection/heartrate rows.
// Leaf module (zero imports) — directly loadable by the strip-types test runner.

export type OuraHeartrateSampleRow = { ts: string; bpm: number; source: string };

const SOURCES = new Set(['awake', 'workout', 'rest', 'sleep', 'live', 'session']);

export function parseHeartrateRows(data: unknown): OuraHeartrateSampleRow[] {
  if (!Array.isArray(data)) return [];
  const rows: OuraHeartrateSampleRow[] = [];
  for (const item of data) {
    if (!item || typeof item !== 'object') continue;
    const { timestamp, bpm, source } = item as { timestamp?: unknown; bpm?: unknown; source?: unknown };
    if (typeof timestamp !== 'string' || Number.isNaN(Date.parse(timestamp))) continue;
    if (typeof bpm !== 'number' || !Number.isInteger(bpm) || bpm < 20 || bpm > 250) continue;
    if (typeof source !== 'string' || !SOURCES.has(source)) continue;
    rows.push({ ts: timestamp, bpm, source });
  }
  return rows;
}

export function chunkRows<TRow>(rows: TRow[], size: number): TRow[][] {
  const chunks: TRow[][] = [];
  for (let i = 0; i < rows.length; i += size) {
    chunks.push(rows.slice(i, i + size));
  }
  return chunks;
}
```

- [ ] **Step 4: Verify + wire into suite**

Append ` src/lib/oura/heartrateSamples.test.mjs` to `test:correlation` in `package.json`.
Run: `npm run test:correlation && npx tsc --noEmit` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/oura/heartrateSamples.ts src/lib/oura/heartrateSamples.test.mjs package.json
git commit -m "feat: heartrate sample parsing and chunking"
```

---

### Task 4: Persist + fetch wiring in the sync engine

**Files:**
- Modify: `src/lib/health/persistence.ts` (append `upsertOuraHeartrateSamples`)
- Modify: `src/lib/health/ouraSyncEngine.ts` (new step inside `syncOuraSnapshots`, after `upsertOuraTags`)

**Interfaces:**
- Consumes: `heartrateDatetimeRange` (Task 2), `parseHeartrateRows`, `chunkRows`, `OuraHeartrateSampleRow` (Task 3), existing `fetchOuraJson`, `recordOuraEndpointCoverage`, `getContinuationToken`.
- Produces: `upsertOuraHeartrateSamples(userId: string, rows: OuraHeartrateSampleRow[]): Promise<number>`; sync runs now write `heartrate` coverage rows.

- [ ] **Step 1: Add `upsertOuraHeartrateSamples` to `src/lib/health/persistence.ts`**

```ts
import { chunkRows, type OuraHeartrateSampleRow } from '@/lib/oura/heartrateSamples';

const HEARTRATE_UPSERT_CHUNK = 500;

export async function upsertOuraHeartrateSamples(
  userId: string,
  rows: OuraHeartrateSampleRow[],
): Promise<number> {
  if (rows.length === 0) return 0;
  const supabase = createHealthServiceClient();
  for (const chunk of chunkRows(rows, HEARTRATE_UPSERT_CHUNK)) {
    const { error } = await supabase.from('oura_heartrate_samples').upsert(
      chunk.map((row) => ({ user_id: userId, ts: row.ts, bpm: row.bpm, source: row.source })),
      { onConflict: 'user_id,ts' },
    );
    if (error) throw error;
  }
  return rows.length;
}
```

- [ ] **Step 2: Add the fetch+persist step to `ouraSyncEngine.ts`**

Add imports:
```ts
import { upsertOuraHeartrateSamples } from '@/lib/health/persistence'; // extend existing import line
import { parseHeartrateRows } from '@/lib/oura/heartrateSamples';
import { heartrateDatetimeRange } from '@/lib/oura/syncWindows';
```

Add a private function (near `fetchOptionalOuraCollection`):
```ts
// heartrate is additive telemetry: a failure records coverage and moves on,
// never failing the run. Uses datetime params (heartrate has no date params).
async function syncHeartrateSamples(input: {
  userId: string;
  syncRunId: string;
  apiBaseUrl: string;
  accessToken: string;
  range: { start_date: string; end_date: string };
}): Promise<number> {
  const dtRange = heartrateDatetimeRange(input.range);
  const data: unknown[] = [];
  let nextToken: string | null = null;
  try {
    for (let page = 0; page < OURA_MAX_PAGES_PER_COLLECTION; page += 1) {
      const response = await fetchOuraJson<OuraCollectionResponse>(
        input.apiBaseUrl,
        input.accessToken,
        '/v2/usercollection/heartrate',
        nextToken ? { ...dtRange, next_token: nextToken } : dtRange,
      );
      if (Array.isArray(response.data)) data.push(...response.data);
      nextToken = getContinuationToken(response);
      if (!nextToken) break;
    }
    const rows = parseHeartrateRows(data);
    const count = await upsertOuraHeartrateSamples(input.userId, rows);
    await recordOuraEndpointCoverage({
      syncRunId: input.syncRunId,
      userId: input.userId,
      endpoint: 'heartrate',
      status: 'success',
      required: false,
      rangeStart: input.range.start_date,
      rangeEnd: input.range.end_date,
      documentCount: count,
    });
    return count;
  } catch (err) {
    await recordOuraEndpointCoverage({
      syncRunId: input.syncRunId,
      userId: input.userId,
      endpoint: 'heartrate',
      status: 'failed',
      required: false,
      rangeStart: input.range.start_date,
      rangeEnd: input.range.end_date,
      documentCount: 0,
      error: { message: err instanceof Error ? err.message : 'heartrate fetch failed' },
    }).catch(() => undefined);
    Sentry.captureException(err, { tags: { route: 'ouraSyncEngine', endpoint: 'heartrate' } });
    return 0;
  }
}
```
> Signature confirmed against `src/lib/oura/analyticsStore.ts:59-70` (`RecordOuraEndpointCoverageInput`): the field names above match exactly (`error` is `JsonValue` — a message object fits).

In `syncOuraSnapshots`, after the `await upsertOuraTags(tagRows);` line, add:
```ts
    const heartrateCount = await syncHeartrateSamples({
      userId,
      syncRunId: syncRun.id,
      apiBaseUrl: auth.config.apiBaseUrl,
      accessToken: auth.tokens.accessToken,
      range,
    });
```
and extend the `finishOuraSyncRun` counts object with `heartrateSamples: heartrateCount,`.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm run build`
Expected: clean. (No unit test hits the network path; coverage recording and idempotency are validated live in Task 7.)

- [ ] **Step 4: Commit**

```bash
git add src/lib/health/persistence.ts src/lib/health/ouraSyncEngine.ts
git commit -m "feat: fetch and persist Oura heartrate samples during sync"
```

---

### Task 5: `doseResponse.ts` — dose-response + daytime HR math (leaf module)

**Files:**
- Create: `src/lib/health/doseResponse.ts`
- Test: `src/lib/health/doseResponse.test.mjs`
- Modify: `package.json` (append to `test:correlation`)

**Interfaces:**
- Produces (consumed by Task 6):
  - `export type HrSample = { ts: string; bpm: number; source: string };`
  - `postDoseHrDelta(samples: HrSample[], doseTimesIso: string[], opts?: { preMin?: number; postMin?: number; minSamplesPerSide?: number }): number | null` — defaults pre 60 / post 120 / min 3; only `awake`/`rest` sources; per-dose delta = median(post) − median(pre); returns mean of dose deltas rounded to 0.1, or null.
  - `daytimeAvgHr(samples: HrSample[], localDate: string, timeZone: string): number | null` — mean bpm of `awake`/`rest` samples whose local time on `localDate` falls in [08:00, 22:00); null if < 12 samples (one hour of coverage).
  - `export type DoseResponseRow = { local_date: string; post_dose_hr_delta_bpm: number | null; daytime_avg_hr: number | null };`
  - `dailyDoseResponseRows(samples: HrSample[], takenTimesIso: string[], startDate: string, endDate: string, timeZone: string): DoseResponseRow[]` — one row per date in [startDate, endDate], bucketing samples/doses by UTC date prefix and applying the two functions above. This is the ONLY entry point Task 6's `persistence.ts` calls — featureBuilder itself never imports this module (import-topology constraint: `featureBuilder.test.mjs` loads `featureBuilder.ts` directly under the strip-types runner, and `tsconfig` `moduleResolution: "bundler"` without `allowImportingTsExtensions` forbids the `.ts`-extension workaround; verified 2026-07-14).
- Leaf module: zero imports.

- [ ] **Step 1: Write failing tests**

```js
// src/lib/health/doseResponse.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';

import { daytimeAvgHr, postDoseHrDelta } from './doseResponse.ts';

const s = (iso, bpm, source = 'awake') => ({ ts: iso, bpm, source });

test('postDoseHrDelta: median(post) - median(pre) per dose, averaged', () => {
  const dose = '2026-07-13T09:00:00Z';
  const samples = [
    // pre-window (08:00-09:00): 70, 72, 74 → median 72
    s('2026-07-13T08:10:00Z', 70), s('2026-07-13T08:30:00Z', 72), s('2026-07-13T08:50:00Z', 74),
    // post-window (09:00-11:00): 62, 64, 66 → median 64
    s('2026-07-13T09:20:00Z', 62), s('2026-07-13T10:00:00Z', 64), s('2026-07-13T10:40:00Z', 66),
  ];
  assert.equal(postDoseHrDelta(samples, [dose]), -8);
});

test('postDoseHrDelta ignores workout/sleep samples and thin windows', () => {
  const dose = '2026-07-13T09:00:00Z';
  const samples = [
    s('2026-07-13T08:10:00Z', 70), s('2026-07-13T08:30:00Z', 72), s('2026-07-13T08:50:00Z', 74),
    s('2026-07-13T09:20:00Z', 130, 'workout'), s('2026-07-13T10:00:00Z', 64), s('2026-07-13T10:40:00Z', 66),
  ];
  // post-window has only 2 awake/rest samples (< minSamplesPerSide 3) → null
  assert.equal(postDoseHrDelta(samples, [dose]), null);
  assert.equal(postDoseHrDelta([], [dose]), null);
  assert.equal(postDoseHrDelta(samples, []), null);
});

test('daytimeAvgHr averages awake/rest samples in the 08:00-22:00 local window', () => {
  const samples = [];
  for (let i = 0; i < 12; i += 1) {
    samples.push(s(`2026-07-13T${String(9 + Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}:00Z`, 60 + i));
  }
  samples.push(s('2026-07-13T02:00:00Z', 45, 'sleep'));   // night — excluded
  samples.push(s('2026-07-13T09:05:00Z', 150, 'workout')); // workout — excluded
  const result = daytimeAvgHr(samples, '2026-07-13', 'UTC');
  assert.equal(result, 65.5); // mean of 60..71
});

test('daytimeAvgHr needs at least 12 qualifying samples', () => {
  assert.equal(daytimeAvgHr([s('2026-07-13T09:00:00Z', 60)], '2026-07-13', 'UTC'), null);
});

test('dailyDoseResponseRows emits one row per date in range', () => {
  const samples = [
    s('2026-07-13T08:10:00Z', 70), s('2026-07-13T08:30:00Z', 72), s('2026-07-13T08:50:00Z', 74),
    s('2026-07-13T09:20:00Z', 62), s('2026-07-13T10:00:00Z', 64), s('2026-07-13T10:40:00Z', 66),
  ];
  const rows = dailyDoseResponseRows(samples, ['2026-07-13T09:00:00Z'], '2026-07-12', '2026-07-13', 'UTC');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { local_date: '2026-07-12', post_dose_hr_delta_bpm: null, daytime_avg_hr: null });
  assert.equal(rows[1].local_date, '2026-07-13');
  assert.equal(rows[1].post_dose_hr_delta_bpm, -8);
});
```
(Also add `dailyDoseResponseRows` to the import line.)

- [ ] **Step 2: Run to verify failure**

Run: `node --experimental-strip-types --test src/lib/health/doseResponse.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/health/doseResponse.ts
// Pure math pairing medication "taken" events with the 5-min HR timeseries.
// Leaf module (zero imports) for the strip-types test runner.

export type HrSample = { ts: string; bpm: number; source: string };

const QUIET_SOURCES = new Set(['awake', 'rest']);
const DAYTIME_START_HOUR = 8;
const DAYTIME_END_HOUR = 22;
const MIN_DAYTIME_SAMPLES = 12;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function postDoseHrDelta(
  samples: HrSample[],
  doseTimesIso: string[],
  opts: { preMin?: number; postMin?: number; minSamplesPerSide?: number } = {},
): number | null {
  const preMs = (opts.preMin ?? 60) * 60_000;
  const postMs = (opts.postMin ?? 120) * 60_000;
  const minSide = opts.minSamplesPerSide ?? 3;

  const quiet = samples
    .filter((sample) => QUIET_SOURCES.has(sample.source))
    .map((sample) => ({ t: Date.parse(sample.ts), bpm: sample.bpm }))
    .filter((sample) => Number.isFinite(sample.t));

  const deltas: number[] = [];
  for (const doseIso of doseTimesIso) {
    const doseT = Date.parse(doseIso);
    if (!Number.isFinite(doseT)) continue;
    const pre = quiet.filter((sample) => sample.t >= doseT - preMs && sample.t < doseT).map((sample) => sample.bpm);
    const post = quiet.filter((sample) => sample.t >= doseT && sample.t <= doseT + postMs).map((sample) => sample.bpm);
    if (pre.length < minSide || post.length < minSide) continue;
    deltas.push(median(post) - median(pre));
  }

  if (deltas.length === 0) return null;
  const meanDelta = deltas.reduce((total, delta) => total + delta, 0) / deltas.length;
  return Math.round(meanDelta * 10) / 10;
}

function localHour(iso: string, timeZone: string): number | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const hour = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hour12: false }).format(date);
  const parsed = Number(hour);
  return Number.isFinite(parsed) ? parsed : null;
}

function localDateOf(iso: string, timeZone: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

export function daytimeAvgHr(samples: HrSample[], localDate: string, timeZone: string): number | null {
  const qualifying = samples.filter((sample) => {
    if (!QUIET_SOURCES.has(sample.source)) return false;
    if (localDateOf(sample.ts, timeZone) !== localDate) return false;
    const hour = localHour(sample.ts, timeZone);
    return hour !== null && hour >= DAYTIME_START_HOUR && hour < DAYTIME_END_HOUR;
  });
  if (qualifying.length < MIN_DAYTIME_SAMPLES) return null;
  const total = qualifying.reduce((acc, sample) => acc + sample.bpm, 0);
  return Math.round((total / qualifying.length) * 10) / 10;
}

export type DoseResponseRow = {
  local_date: string;
  post_dose_hr_delta_bpm: number | null;
  daytime_avg_hr: number | null;
};

function addDays(localDate: string, days: number): string {
  const date = new Date(`${localDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// Day-keyed rollup for the correlation featureBuilder. Buckets by UTC date
// prefix — a post-dose window crossing midnight is attributed to the dose's
// date, which is the day the correlation cares about anyway.
export function dailyDoseResponseRows(
  samples: HrSample[],
  takenTimesIso: string[],
  startDate: string,
  endDate: string,
  timeZone: string,
): DoseResponseRow[] {
  const samplesByDate = new Map<string, HrSample[]>();
  for (const sample of samples) {
    const date = sample.ts.slice(0, 10);
    const bucket = samplesByDate.get(date) ?? [];
    bucket.push(sample);
    samplesByDate.set(date, bucket);
  }
  const dosesByDate = new Map<string, string[]>();
  for (const iso of takenTimesIso) {
    const date = iso.slice(0, 10);
    const bucket = dosesByDate.get(date) ?? [];
    bucket.push(iso);
    dosesByDate.set(date, bucket);
  }

  const rows: DoseResponseRow[] = [];
  for (let date = startDate; date <= endDate; date = addDays(date, 1)) {
    const daySamples = samplesByDate.get(date) ?? [];
    rows.push({
      local_date: date,
      post_dose_hr_delta_bpm: postDoseHrDelta(daySamples, dosesByDate.get(date) ?? []),
      daytime_avg_hr: daytimeAvgHr(daySamples, date, timeZone),
    });
  }
  return rows;
}
```

- [ ] **Step 4: Verify + wire into suite**

Append ` src/lib/health/doseResponse.test.mjs` to `test:correlation`.
Run: `npm run test:correlation && npx tsc --noEmit` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/health/doseResponse.ts src/lib/health/doseResponse.test.mjs package.json
git commit -m "feat: dose-response HR delta and daytime average HR math"
```

---

### Task 6: Correlation wiring — fetch samples + taken events, expose two outcomes

**Files:**
- Modify: `src/lib/correlation/types.ts` — `postDoseHrDeltaBpm`, `daytimeAvgHr` on `DailyLifestyleSnapshot`.
- Modify: `src/lib/correlation/featureBuilder.ts` — new input + per-day computation.
- Modify: `src/lib/correlation/persistence.ts:275-310` (`buildAndPersistDailyLifestyleSnapshots`) — fetch HR samples + taken events, thread through.
- Modify: `src/lib/correlation/engine.ts` — two new `OUTCOMES`.
- Test: `src/lib/correlation/featureBuilder.test.mjs`

**Interfaces:**
- **Import-topology constraint (verified against `tsconfig.json` 2026-07-14):** `featureBuilder.test.mjs` loads `featureBuilder.ts` directly under the strip-types runner, so `featureBuilder.ts` must gain NO value imports (extensionless relative imports fail that runner; `.ts`-extension imports fail `tsc` because `moduleResolution: "bundler"` lacks `allowImportingTsExtensions`). Therefore: `persistence.ts` (loaded only via Next/tsc, where `@/` aliases work) calls `dailyDoseResponseRows` and passes plain rows into featureBuilder.
- Consumes: `dailyDoseResponseRows`, `HrSample` from `@/lib/health/doseResponse` — imported by `persistence.ts` ONLY.
- Produces: `BuildDailyLifestyleSnapshotsInput` gains `doseResponseRows?: Row[]` (rows: `{ local_date, post_dose_hr_delta_bpm, daytime_avg_hr }`); snapshots gain `postDoseHrDeltaBpm` and `daytimeAvgHr`.

- [ ] **Step 1: Add failing featureBuilder test**

```js
test('exposes precomputed dose-response HR outcomes', () => {
  const [snapshot] = buildDailyLifestyleSnapshots({
    userId: 'user-1',
    startDate: '2026-07-13',
    endDate: '2026-07-13',
    doseResponseRows: [{
      user_id: 'user-1',
      local_date: '2026-07-13',
      post_dose_hr_delta_bpm: -8,
      daytime_avg_hr: 65.5,
    }],
  });
  assert.equal(snapshot.postDoseHrDeltaBpm, -8);
  assert.equal(snapshot.daytimeAvgHr, 65.5);
});
```

- [ ] **Step 2: Run to verify failure** — `node --experimental-strip-types --test src/lib/correlation/featureBuilder.test.mjs` → FAIL.

- [ ] **Step 3: Implement featureBuilder + types changes (no new imports in featureBuilder)**

`types.ts` — after `hrvRecoveryDelta?: number | null;` (Sprint 1) or after `restingHeartRate` if Sprint 1 not yet merged, add:
```ts
  postDoseHrDeltaBpm?: number | null;
  daytimeAvgHr?: number | null;
```

`featureBuilder.ts` — extend the input type:
```ts
  doseResponseRows?: Row[];
```
Inside `buildDailyLifestyleSnapshots`, next to the other `indexByDate` calls:
```ts
  const doseHrByDate = indexByDate(input.doseResponseRows, input.userId, 'local_date');
```
In the per-date returned object:
```ts
      postDoseHrDeltaBpm: firstNumber(doseHrByDate.get(localDate) ?? [], 'post_dose_hr_delta_bpm'),
      daytimeAvgHr: firstNumber(doseHrByDate.get(localDate) ?? [], 'daytime_avg_hr'),
```

- [ ] **Step 4: Wire computation in `persistence.ts`**

Add import:
```ts
import { dailyDoseResponseRows, type HrSample } from '@/lib/health/doseResponse';
```
In `buildAndPersistDailyLifestyleSnapshots`, extend the `Promise.all` with two queries:
```ts
    fetchSourceRows(supabase, 'oura_heartrate_samples', userId, 'ts', `${widenedStartDate}T00:00:00.000Z`, `${widenedEndDate}T23:59:59.999Z`, 'ts, bpm, source'),
    // execution_events has its own user_id column (supabase/002:48) — no join needed.
    (async () => {
      const { data, error } = await supabase
        .from('execution_events')
        .select('event_at, event_type')
        .eq('user_id', userId)
        .eq('event_type', 'taken')
        .gte('event_at', `${widenedStartDate}T00:00:00.000Z`)
        .lte('event_at', `${widenedEndDate}T23:59:59.999Z`);
      if (error) throw error;
      return (data as unknown as Row[] | null) ?? [];
    })(),
```
then compute and pass to the builder:
```ts
  const hrSamples: HrSample[] = heartrateRows
    .filter((row) => typeof row.ts === 'string' && typeof row.bpm === 'number' && typeof row.source === 'string')
    .map((row) => ({ ts: row.ts as string, bpm: row.bpm as number, source: row.source as string }));
  const takenTimes = takenEventRows
    .map((row) => row.event_at)
    .filter((value): value is string => typeof value === 'string');
  const doseResponseRows = dailyDoseResponseRows(hrSamples, takenTimes, startDate, endDate, 'UTC')
    .map((row) => ({ ...row, user_id: userId }));
```
and add `doseResponseRows,` to the `buildDailyLifestyleSnapshots({...})` call.

- [ ] **Step 5: Engine outcomes + verify**

Append to `OUTCOMES`:
```ts
  { key: 'postDoseHrDeltaBpm', label: 'post-dose HR change (bpm)' },
  { key: 'daytimeAvgHr', label: 'daytime avg HR' },
```

Run: `npm run test:correlation && npx tsc --noEmit && npm run build` → PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/correlation/
git commit -m "feat: post-dose HR delta and daytime HR as correlation outcomes"
```

---

### Task 7: Verification + optional history pull + PR

- [ ] **Step 1: Apply migration 024 to production** *(owner/orchestrator — Supabase Management API, same pattern as Sprint 1 Task 6 Step 2).*

- [ ] **Step 2: Live sync + idempotency check** — trigger a manual sync twice; then Management API: `select count(*), min(ts), max(ts) from oura_heartrate_samples;` → count > 0 and stable across the second run (upsert).

- [ ] **Step 3 (optional, owner ask): 90-day history pull** — create `scripts/backfill-oura-heartrate.mjs` cloning the probe-script auth pattern (decrypt token from `user_integrations`) and calling `/v2/usercollection/heartrate` in three 30-day datetime windows, reusing `parseHeartrateRows` + direct table upserts. Skip unless the owner wants deep history.

- [ ] **Step 4: Full gate + PR**

```bash
npx tsc --noEmit && npm run test:correlation && npm run test:unit && npm run build
git push -u origin codex/oura-sprint2-heartrate
gh pr create --base main --title "feat: Oura sprint 2 — 24h heart rate + dose-response outcomes" --body "Implements docs/superpowers/plans/2026-07-14-oura-sprint2-heartrate.md."
```

Do NOT merge — owner merges (production deploy on merge).
