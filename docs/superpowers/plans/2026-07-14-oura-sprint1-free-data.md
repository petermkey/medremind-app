# Oura Sprint 1 — "Free Data" (Temperature, Night Detail, Wear Quality, Backfill) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface three sensor data streams that already arrive with every Oura sync — skin-temperature deviation, intra-night sleep structure, and ring non-wear time — as snapshot columns and correlation features, then backfill history from stored `raw_payload`.

**Architecture:** Zero new Oura API calls. Every field this sprint needs is already inside `external_health_daily_snapshots.raw_payload` (the mapper stores its full input object there). We add: one migration (6 columns), one new pure leaf module (`nightDetail.ts`) that parses the 30-sec sleep-phase string and 5-min HRV samples, mapper/type/persistence wiring, featureBuilder + correlation-engine wiring (including a low-wear data-quality rule), and a one-off backfill script that recomputes the new columns for all historical rows from `raw_payload`.

**Tech Stack:** Next.js 15 App Router, TypeScript strict, Supabase (Postgres, service-role server clients), Node `--experimental-strip-types` test runner for leaf-module tests.

## Spec

### Requirements

1. **Temperature (P0).** Persist `temperature_deviation` and `temperature_trend_deviation` (°C, numeric, nullable) from the `daily_readiness` document into `external_health_daily_snapshots`, and expose `temperatureDeviation` as a correlation outcome.
2. **Night detail (P1).** From the main sleep document (already selected per day by `pickMainSleepByDate`), derive and persist:
   - `deep_sleep_first_third_minutes` — minutes of deep sleep within the first third of the sleep period (from `sleep_phase_30_sec`, where each char covers 30 s: `'1'` = deep, `'2'` = light, `'3'` = REM, `'4'` = awake);
   - `minutes_to_first_deep_sleep` — minutes from period start to the first deep-sleep epoch (null if no deep sleep);
   - `hrv_recovery_delta` — mean of the second half of the night's 5-min HRV samples minus mean of the first half (positive = HRV recovered overnight). Null when either half has fewer than 3 non-null samples.
   All three become correlation outcomes.
3. **Wear quality (P3-part).** Persist `non_wear_minutes` (from `daily_activity.non_wear_time`, seconds → minutes). In featureBuilder, when `non_wear_minutes > 480` (8 h), null out the day's activity-derived outcomes (`activityScore`, `steps`, `stressHighSeconds`, `recoveryHighSeconds`) so low-wear days can't produce false correlations. Sleep outcomes stay untouched (sleep data implies the ring was worn at night).
4. **Backfill.** A script recomputes all six new columns for every existing `oura` snapshot row from its `raw_payload`, in one pass, idempotently.

### Acceptance criteria

- `npm run build`, `npx tsc --noEmit`, `npm run test:correlation`, `npm run test:unit` all pass.
- After one live sync (manual button or cron), the current day's snapshot row has non-null `temperature_deviation` and (if a main sleep period exists) the night-detail columns.
- After the backfill script runs, historical rows (Apr 12–26 + Jun–Jul 2026 ranges) have the new columns populated wherever `raw_payload` contains the source fields.
- Correlation engine outcome list includes the four new outcomes; `daily_lifestyle_snapshots` persistence keeps working (new fields flow in-memory to the engine, matching how `sleepAvgHrv` etc. already work — no `daily_lifestyle_snapshots` schema change).

### Non-goals

- No new Oura endpoints, no webhook work, no `heartrate` timeseries (Sprint 2), no `sleep_time`/battery (Sprint 3).
- No `daily_lifestyle_snapshots` migration — engine consumes snapshots in-memory (existing pattern for sleep-detail fields).

## Global Constraints

- TypeScript strict mode; no `any` without a comment; run `npx tsc --noEmit` after any `.ts/.tsx` change.
- `npm run build` must pass before the PR is opened.
- Branch: `codex/oura-sprint1-free-data`. Never push to `main`. Conventional commits.
- The Node `--experimental-strip-types` test runner (used by `npm run test:correlation`) cannot resolve TS path aliases or extensionless relative imports between `.ts` files. Any module under direct `.test.mjs` test must be a **leaf module** (zero value imports) or import siblings with an explicit `.ts` extension.
- Migrations are files in `supabase/`; production application is a **manual step via the Supabase Management API** (see `docs/agent-handoff-current-main.md` §0b; project ref `hagypgvfkjkncznoctoq`). The plan flags where this happens.
- `raw_payload` key shapes (set by `mapOuraDailyPayloadToHealthSnapshot`, which stores its whole input): `raw_payload.dailyReadiness` = full `daily_readiness` doc; `raw_payload.dailyActivity` = full `daily_activity` doc; `raw_payload.sleepDetail` = full main `sleep` doc (contains `sleep_phase_30_sec`, `hrv: {interval, items, timestamp}`, etc.).

## File Structure

- Create: `supabase/023_oura_temperature_wear_night_detail.sql` — 6 new snapshot columns.
- Create: `src/lib/health/nightDetail.ts` — pure leaf module: phase-string and HRV-sample math.
- Create: `src/lib/health/nightDetail.test.mjs` — its tests (strip-types runner).
- Modify: `src/lib/health/types.ts` — 6 new fields on `ExternalHealthDailySnapshot`.
- Modify: `src/lib/health/ouraDailyMapper.ts` — map the new fields (calls `nightDetail.ts` helpers).
- Modify: `src/lib/health/ouraDailyMapper.test.mjs` — new assertions.
- Modify: `src/lib/health/persistence.ts` — 6 new columns in `toSnapshotRow`.
- Modify: `src/lib/correlation/types.ts`, `src/lib/correlation/featureBuilder.ts`, `src/lib/correlation/featureBuilder.test.mjs`, `src/lib/correlation/engine.ts` — new outcomes + low-wear nulling.
- Create: `scripts/backfill-oura-night-detail.mjs` — history backfill from `raw_payload`.
- Modify: `package.json` — add `nightDetail.test.mjs` to `test:correlation`.

---

### Task 1: Migration 023 — six new snapshot columns

**Files:**
- Create: `supabase/023_oura_temperature_wear_night_detail.sql`

**Interfaces:**
- Produces: columns `temperature_deviation numeric`, `temperature_trend_deviation numeric`, `non_wear_minutes int`, `deep_sleep_first_third_minutes int`, `minutes_to_first_deep_sleep int`, `hrv_recovery_delta numeric` on `external_health_daily_snapshots` — consumed by Tasks 3–5.

- [ ] **Step 1: Write the migration**

```sql
-- 023: sensor fields already present in raw_payload — skin-temperature
-- deviation (daily_readiness), ring non-wear time (daily_activity), and
-- intra-night structure derived from the main sleep period.
alter table external_health_daily_snapshots
  add column if not exists temperature_deviation numeric,
  add column if not exists temperature_trend_deviation numeric,
  add column if not exists non_wear_minutes int,
  add column if not exists deep_sleep_first_third_minutes int,
  add column if not exists minutes_to_first_deep_sleep int,
  add column if not exists hrv_recovery_delta numeric;
```

- [ ] **Step 2: Sanity-check the SQL locally**

Run: `psql --version >/dev/null 2>&1 || true; cat supabase/023_oura_temperature_wear_night_detail.sql`
Expected: file prints; no psql needed locally (applied to prod later, Task 7).

- [ ] **Step 3: Commit**

```bash
git add supabase/023_oura_temperature_wear_night_detail.sql
git commit -m "feat: migration 023 — temperature, wear, night-detail snapshot columns"
```

---

### Task 2: `nightDetail.ts` — pure night-structure math (leaf module)

**Files:**
- Create: `src/lib/health/nightDetail.ts`
- Test: `src/lib/health/nightDetail.test.mjs`
- Modify: `package.json` (append test file to `test:correlation`)

**Interfaces:**
- Produces (consumed by Task 3 mapper and Task 6 backfill script):
  - `parseSleepPhaseFeatures(phase30: unknown): { deepSleepFirstThirdMinutes: number | null; minutesToFirstDeepSleep: number | null }`
  - `hrvRecoveryDelta(sample: unknown): number | null` — `sample` is the raw `hrv` object `{ interval, items, timestamp }` from an Oura sleep doc.
- MUST be a leaf module: zero imports (the strip-types test runner loads it directly).

- [ ] **Step 1: Write the failing tests**

```js
// src/lib/health/nightDetail.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';

import { hrvRecoveryDelta, parseSleepPhaseFeatures } from './nightDetail.ts';

test('parseSleepPhaseFeatures counts deep epochs in the first third and time to first deep', () => {
  // 12 epochs (6 min total, first third = 4 epochs). '1'=deep.
  // First third '2211' → 2 deep epochs = 1 min. First '1' at index 2 → 1 min.
  const result = parseSleepPhaseFeatures('221112341234');
  assert.equal(result.deepSleepFirstThirdMinutes, 1);
  assert.equal(result.minutesToFirstDeepSleep, 1);
});

test('parseSleepPhaseFeatures returns null minutesToFirstDeepSleep when no deep sleep', () => {
  const result = parseSleepPhaseFeatures('222333444222');
  assert.equal(result.deepSleepFirstThirdMinutes, 0);
  assert.equal(result.minutesToFirstDeepSleep, null);
});

test('parseSleepPhaseFeatures rejects non-string and malformed input', () => {
  assert.deepEqual(parseSleepPhaseFeatures(undefined), {
    deepSleepFirstThirdMinutes: null,
    minutesToFirstDeepSleep: null,
  });
  assert.deepEqual(parseSleepPhaseFeatures('12x4'), {
    deepSleepFirstThirdMinutes: null,
    minutesToFirstDeepSleep: null,
  });
  assert.deepEqual(parseSleepPhaseFeatures(''), {
    deepSleepFirstThirdMinutes: null,
    minutesToFirstDeepSleep: null,
  });
});

test('hrvRecoveryDelta is second-half mean minus first-half mean, ignoring nulls', () => {
  // first half [30, 40, 50] mean 40; second half [60, 70, 80] mean 70 → +30
  const sample = { interval: 300, items: [30, 40, 50, 60, 70, 80], timestamp: '2026-07-01T23:00:00+03:00' };
  assert.equal(hrvRecoveryDelta(sample), 30);
});

test('hrvRecoveryDelta needs at least 3 non-null samples per half', () => {
  assert.equal(hrvRecoveryDelta({ interval: 300, items: [30, null, 50, 60, 70, 80] }), null);
  assert.equal(hrvRecoveryDelta({ interval: 300, items: [1, 2, 3] }), null);
  assert.equal(hrvRecoveryDelta(null), null);
  assert.equal(hrvRecoveryDelta({ items: 'nope' }), null);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --experimental-strip-types --test src/lib/health/nightDetail.test.mjs`
Expected: FAIL with `Cannot find module ... nightDetail.ts`

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/health/nightDetail.ts
// Pure math over the main Oura sleep document's intra-night arrays.
// Leaf module (zero imports) so the --experimental-strip-types test runner
// can load it directly — same constraint as optionalFetchError.ts.

// sleep_phase_30_sec: one char per 30 seconds; '1' deep, '2' light,
// '3' REM, '4' awake (Oura API v2 docs).
const PHASE_RE = /^[1-4]+$/;
const EPOCH_MINUTES = 0.5;
const MIN_HRV_SAMPLES_PER_HALF = 3;

export function parseSleepPhaseFeatures(phase30: unknown): {
  deepSleepFirstThirdMinutes: number | null;
  minutesToFirstDeepSleep: number | null;
} {
  if (typeof phase30 !== 'string' || phase30.length === 0 || !PHASE_RE.test(phase30)) {
    return { deepSleepFirstThirdMinutes: null, minutesToFirstDeepSleep: null };
  }

  const firstThirdLength = Math.floor(phase30.length / 3);
  let deepInFirstThird = 0;
  for (let i = 0; i < firstThirdLength; i += 1) {
    if (phase30[i] === '1') deepInFirstThird += 1;
  }

  const firstDeepIndex = phase30.indexOf('1');

  return {
    deepSleepFirstThirdMinutes: Math.round(deepInFirstThird * EPOCH_MINUTES),
    minutesToFirstDeepSleep: firstDeepIndex === -1 ? null : Math.round(firstDeepIndex * EPOCH_MINUTES),
  };
}

function mean(values: number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

export function hrvRecoveryDelta(sample: unknown): number | null {
  if (!sample || typeof sample !== 'object') return null;
  const items = (sample as { items?: unknown }).items;
  if (!Array.isArray(items)) return null;

  const half = Math.floor(items.length / 2);
  const numeric = (values: unknown[]) =>
    values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  const firstHalf = numeric(items.slice(0, half));
  const secondHalf = numeric(items.slice(half));

  if (firstHalf.length < MIN_HRV_SAMPLES_PER_HALF || secondHalf.length < MIN_HRV_SAMPLES_PER_HALF) {
    return null;
  }

  return Math.round((mean(secondHalf) - mean(firstHalf)) * 10) / 10;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --experimental-strip-types --test src/lib/health/nightDetail.test.mjs`
Expected: 5 tests PASS

- [ ] **Step 5: Wire into `test:correlation` and type-check**

In `package.json`, append ` src/lib/health/nightDetail.test.mjs` to the `test:correlation` file list (after `src/lib/oura/optionalFetchError.test.mjs`).

Run: `npm run test:correlation && npx tsc --noEmit`
Expected: full suite passes (18 existing + 5 new = 23 tests), tsc clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/health/nightDetail.ts src/lib/health/nightDetail.test.mjs package.json
git commit -m "feat: night-detail parser (sleep phases 30s, overnight HRV recovery delta)"
```

---

### Task 3: Mapper + snapshot type + persistence + engine wiring

**Files:**
- Modify: `src/lib/health/types.ts`
- Modify: `src/lib/health/ouraDailyMapper.ts`
- Modify: `src/lib/health/persistence.ts:16-47` (`toSnapshotRow`)
- Modify: `src/lib/health/ouraSyncEngine.ts:409-422` (payload assembly in `syncOuraSnapshots`)
- Test: `src/lib/health/ouraDailyMapper.test.mjs`

**Interfaces:**
- **Import-topology constraint (verified against `tsconfig.json`):** this repo uses `moduleResolution: "bundler"` WITHOUT `allowImportingTsExtensions`, so `import ... from './nightDetail.ts'` fails `npx tsc --noEmit`, while the extensionless form fails the strip-types runner that loads `ouraDailyMapper.ts` directly from its `.test.mjs`. Therefore the mapper MUST stay value-import-free (leaf). Resolution: `ouraSyncEngine.ts` (only ever loaded through Next/tsc, where the `@/` alias works) computes the night-detail numbers by calling Task 2's functions, and passes them into the mapper as a precomputed `nightDetail` payload field.
- Consumes: `parseSleepPhaseFeatures`, `hrvRecoveryDelta` from `@/lib/health/nightDetail` — imported by `ouraSyncEngine.ts` only.
- Produces: `ExternalHealthDailySnapshot` gains `temperatureDeviation`, `temperatureTrendDeviation`, `nonWearMinutes`, `deepSleepFirstThirdMinutes`, `minutesToFirstDeepSleep`, `hrvRecoveryDelta` (all `number | null`) — consumed by Task 4 and Task 6. `OuraDailyPayload` gains `nightDetail?: { deep_sleep_first_third_minutes?: number | null; minutes_to_first_deep_sleep?: number | null; hrv_recovery_delta?: number | null } | null`.

- [ ] **Step 1: Add failing mapper tests**

Append to `src/lib/health/ouraDailyMapper.test.mjs`:

```js
test('maps temperature deviation, non-wear minutes, and night detail', () => {
  const snapshot = mapOuraDailyPayloadToHealthSnapshot({
    userId: 'user-1',
    localDate: '2026-07-13',
    dailyReadiness: { score: 80, temperature_deviation: 0.35, temperature_trend_deviation: -0.1 },
    dailyActivity: { score: 70, non_wear_time: 5400 },
    nightDetail: {
      deep_sleep_first_third_minutes: 1,
      minutes_to_first_deep_sleep: 1,
      hrv_recovery_delta: 30,
    },
  });
  assert.equal(snapshot.temperatureDeviation, 0.35);
  assert.equal(snapshot.temperatureTrendDeviation, -0.1);
  assert.equal(snapshot.nonWearMinutes, 90);
  assert.equal(snapshot.deepSleepFirstThirdMinutes, 1);
  assert.equal(snapshot.minutesToFirstDeepSleep, 1);
  assert.equal(snapshot.hrvRecoveryDelta, 30);
});

test('night detail fields are null when sleep detail is absent', () => {
  const snapshot = mapOuraDailyPayloadToHealthSnapshot({ userId: 'user-1', localDate: '2026-07-13' });
  assert.equal(snapshot.temperatureDeviation, null);
  assert.equal(snapshot.nonWearMinutes, null);
  assert.equal(snapshot.deepSleepFirstThirdMinutes, null);
  assert.equal(snapshot.minutesToFirstDeepSleep, null);
  assert.equal(snapshot.hrvRecoveryDelta, null);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --experimental-strip-types --test src/lib/health/ouraDailyMapper.test.mjs`
Expected: FAIL — `snapshot.temperatureDeviation` is `undefined`.

- [ ] **Step 3: Extend the type**

In `src/lib/health/types.ts`, after `respiratoryRate: number | null;` add:

```ts
  temperatureDeviation: number | null;
  temperatureTrendDeviation: number | null;
  nonWearMinutes: number | null;
  deepSleepFirstThirdMinutes: number | null;
  minutesToFirstDeepSleep: number | null;
  hrvRecoveryDelta: number | null;
```

- [ ] **Step 4: Extend the mapper (stays a leaf module — no new imports)**

In `src/lib/health/ouraDailyMapper.ts`:

Extend `OuraDailyPayload`:
```ts
  dailyReadiness?: {
    score?: number | null;
    temperature_deviation?: number | null;
    temperature_trend_deviation?: number | null;
  } | null;
  dailyActivity?: {
    score?: number | null;
    steps?: number | null;
    active_calories?: number | null;
    total_calories?: number | null;
    non_wear_time?: number | null;
  } | null;
  // Precomputed by ouraSyncEngine from the main sleep doc (nightDetail.ts) —
  // the mapper must stay import-free so its .test.mjs loads under strip-types.
  nightDetail?: {
    deep_sleep_first_third_minutes?: number | null;
    minutes_to_first_deep_sleep?: number | null;
    hrv_recovery_delta?: number | null;
  } | null;
```

In the returned object, after `respiratoryRate: ...` add:
```ts
    temperatureDeviation: numberOrNull(input.dailyReadiness?.temperature_deviation),
    temperatureTrendDeviation: numberOrNull(input.dailyReadiness?.temperature_trend_deviation),
    nonWearMinutes: minutesOrNull(input.dailyActivity?.non_wear_time),
    deepSleepFirstThirdMinutes: numberOrNull(input.nightDetail?.deep_sleep_first_third_minutes),
    minutesToFirstDeepSleep: numberOrNull(input.nightDetail?.minutes_to_first_deep_sleep),
    hrvRecoveryDelta: numberOrNull(input.nightDetail?.hrv_recovery_delta),
```

- [ ] **Step 4b: Compute `nightDetail` in `ouraSyncEngine.ts`**

Add import:
```ts
import { hrvRecoveryDelta, parseSleepPhaseFeatures } from '@/lib/health/nightDetail';
```

Add a helper near `pickMainSleepByDate`:
```ts
// Intra-night structure from the main sleep doc, precomputed here because the
// mapper is a leaf module (see nightDetail.ts header for the runner constraint).
function computeNightDetail(sleepDoc: Record<string, unknown> | undefined) {
  const phases = parseSleepPhaseFeatures(sleepDoc?.sleep_phase_30_sec);
  return {
    deep_sleep_first_third_minutes: phases.deepSleepFirstThirdMinutes,
    minutes_to_first_deep_sleep: phases.minutesToFirstDeepSleep,
    hrv_recovery_delta: hrvRecoveryDelta(sleepDoc?.hrv),
  };
}
```

In `syncOuraSnapshots`'s payload assembly (the `mapOuraDailyPayloadToHealthSnapshot({...})` call), after `sleepDetail: collections.sleepPeriods.get(localDate),` add:
```ts
        nightDetail: computeNightDetail(collections.sleepPeriods.get(localDate)),
```

- [ ] **Step 5: Extend `toSnapshotRow` in `src/lib/health/persistence.ts`**

After `respiratory_rate: snapshot.respiratoryRate,` add:
```ts
    temperature_deviation: snapshot.temperatureDeviation,
    temperature_trend_deviation: snapshot.temperatureTrendDeviation,
    non_wear_minutes: snapshot.nonWearMinutes,
    deep_sleep_first_third_minutes: snapshot.deepSleepFirstThirdMinutes,
    minutes_to_first_deep_sleep: snapshot.minutesToFirstDeepSleep,
    hrv_recovery_delta: snapshot.hrvRecoveryDelta,
```

- [ ] **Step 6: Verify**

Run: `node --experimental-strip-types --test src/lib/health/ouraDailyMapper.test.mjs && npx tsc --noEmit && npm run test:correlation`
Expected: all PASS, tsc clean (the mapper gained no imports, so the strip-types runner still loads it; the engine's `@/lib/health/nightDetail` alias import is only resolved by Next/tsc, which is fine).

- [ ] **Step 7: Commit**

```bash
git add src/lib/health/types.ts src/lib/health/ouraDailyMapper.ts src/lib/health/ouraDailyMapper.test.mjs src/lib/health/persistence.ts src/lib/health/ouraSyncEngine.ts
git commit -m "feat: map temperature deviation, non-wear, night detail into health snapshots"
```

---

### Task 4: Correlation wiring — new outcomes + low-wear data-quality rule

**Files:**
- Modify: `src/lib/correlation/types.ts` (`DailyLifestyleSnapshot`)
- Modify: `src/lib/correlation/featureBuilder.ts:184-196`
- Modify: `src/lib/correlation/engine.ts:29-40` (`OUTCOMES`)
- Test: `src/lib/correlation/featureBuilder.test.mjs`

**Interfaces:**
- Consumes: snapshot rows now carrying snake_case columns from Task 1/3 (`temperature_deviation`, `non_wear_minutes`, `deep_sleep_first_third_minutes`, `minutes_to_first_deep_sleep`, `hrv_recovery_delta`).
- Produces: `DailyLifestyleSnapshot` fields `temperatureDeviation`, `nonWearMinutes`, `deepSleepFirstThirdMinutes`, `minutesToFirstDeepSleep`, `hrvRecoveryDelta` (all `number | null` optional); engine outcomes with keys matching those field names.

- [ ] **Step 1: Add failing featureBuilder tests**

Append to `src/lib/correlation/featureBuilder.test.mjs` (match the file's existing test style — it builds snapshots via `buildDailyLifestyleSnapshots` with `healthSnapshots` rows):

```js
test('exposes temperature and night-detail outcomes from health snapshots', () => {
  const [snapshot] = buildDailyLifestyleSnapshots({
    userId: 'user-1',
    startDate: '2026-07-13',
    endDate: '2026-07-13',
    healthSnapshots: [{
      user_id: 'user-1',
      local_date: '2026-07-13',
      temperature_deviation: 0.4,
      non_wear_minutes: 30,
      deep_sleep_first_third_minutes: 22,
      minutes_to_first_deep_sleep: 14,
      hrv_recovery_delta: 8,
      activity_score: 75,
      steps: 9000,
    }],
  });
  assert.equal(snapshot.temperatureDeviation, 0.4);
  assert.equal(snapshot.nonWearMinutes, 30);
  assert.equal(snapshot.deepSleepFirstThirdMinutes, 22);
  assert.equal(snapshot.minutesToFirstDeepSleep, 14);
  assert.equal(snapshot.hrvRecoveryDelta, 8);
  assert.equal(snapshot.activityScore, 75);
});

test('low-wear days null out activity-derived outcomes but keep sleep outcomes', () => {
  const [snapshot] = buildDailyLifestyleSnapshots({
    userId: 'user-1',
    startDate: '2026-07-13',
    endDate: '2026-07-13',
    healthSnapshots: [{
      user_id: 'user-1',
      local_date: '2026-07-13',
      non_wear_minutes: 500,
      activity_score: 75,
      steps: 9000,
      stress_high_seconds: 1200,
      recovery_high_seconds: 600,
      sleep_score: 82,
      deep_sleep_minutes: 90,
    }],
  });
  assert.equal(snapshot.activityScore, null);
  assert.equal(snapshot.steps, null);
  assert.equal(snapshot.stressHighSeconds, null);
  assert.equal(snapshot.recoveryHighSeconds, null);
  assert.equal(snapshot.sleepScore, 82);
  assert.equal(snapshot.deepSleepMinutes, 90);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --experimental-strip-types --test src/lib/correlation/featureBuilder.test.mjs`
Expected: FAIL — new fields undefined.

- [ ] **Step 3: Extend `DailyLifestyleSnapshot` in `src/lib/correlation/types.ts`**

After `restingHeartRate?: number | null;` add:
```ts
  temperatureDeviation?: number | null;
  nonWearMinutes?: number | null;
  deepSleepFirstThirdMinutes?: number | null;
  minutesToFirstDeepSleep?: number | null;
  hrvRecoveryDelta?: number | null;
```

- [ ] **Step 4: Extend `featureBuilder.ts`**

Add a module-level constant near the top (after the `toBoolean` helper):
```ts
// A day where the ring was off for more than 8 waking hours cannot support
// activity/stress conclusions — but sleep metrics still can (having a sleep
// document implies the ring was worn at night).
const LOW_WEAR_MINUTES = 480;
```

In the returned snapshot object inside `buildDailyLifestyleSnapshots`, replace the four activity-derived lines and add the new fields:

```ts
      // before: activityScore / stressHighSeconds / recoveryHighSeconds / steps read directly
      activityScore: lowWearDay ? null : firstNumber(healthRows, 'activity_score'),
      stressHighSeconds: lowWearDay ? null : firstNumber(healthRows, 'stress_high_seconds'),
      recoveryHighSeconds: lowWearDay ? null : firstNumber(healthRows, 'recovery_high_seconds'),
      steps: lowWearDay ? null : firstNumber(healthRows, 'steps'),
      temperatureDeviation: firstNumber(healthRows, 'temperature_deviation'),
      nonWearMinutes,
      deepSleepFirstThirdMinutes: firstNumber(healthRows, 'deep_sleep_first_third_minutes'),
      minutesToFirstDeepSleep: firstNumber(healthRows, 'minutes_to_first_deep_sleep'),
      hrvRecoveryDelta: firstNumber(healthRows, 'hrv_recovery_delta'),
```

with these two consts computed just above the `return`:
```ts
    const nonWearMinutes = firstNumber(healthRows, 'non_wear_minutes');
    const lowWearDay = nonWearMinutes !== null && nonWearMinutes > LOW_WEAR_MINUTES;
```

- [ ] **Step 5: Extend engine `OUTCOMES` in `src/lib/correlation/engine.ts`**

Append to the `OUTCOMES` array:
```ts
  { key: 'temperatureDeviation', label: 'skin temperature deviation' },
  { key: 'deepSleepFirstThirdMinutes', label: 'deep sleep in first third (min)' },
  { key: 'minutesToFirstDeepSleep', label: 'time to first deep sleep (min)' },
  { key: 'hrvRecoveryDelta', label: 'overnight HRV recovery' },
```

- [ ] **Step 6: Verify**

Run: `npm run test:correlation && npx tsc --noEmit`
Expected: all PASS (engine tests must still pass — they assert on card generation, not the outcome count; if an engine test pins the outcome list, update it to include the four new outcomes).

- [ ] **Step 7: Commit**

```bash
git add src/lib/correlation/types.ts src/lib/correlation/featureBuilder.ts src/lib/correlation/featureBuilder.test.mjs src/lib/correlation/engine.ts
git commit -m "feat: temperature + night-detail correlation outcomes, low-wear day guard"
```

---

### Task 5: Backfill script from `raw_payload`

**Files:**
- Create: `scripts/backfill-oura-night-detail.mjs`

**Interfaces:**
- Consumes: `parseSleepPhaseFeatures`, `hrvRecoveryDelta` from `src/lib/health/nightDetail.ts` (leaf module — importable by absolute `.ts` path under `--experimental-strip-types`, same pattern as `.superpowers/sdd/probe-oura-endpoints.mjs` importing `tokenCrypto.ts`).
- Env: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (source `.env.local`).

- [ ] **Step 1: Write the script**

```js
// scripts/backfill-oura-night-detail.mjs
// One-off, idempotent: recompute Sprint-1 columns for every existing Oura
// snapshot row from its stored raw_payload. No Oura API calls.
// Run: set -a && source .env.local && set +a && \
//   node --experimental-strip-types scripts/backfill-oura-night-detail.mjs
import { createClient } from '@supabase/supabase-js';

import {
  hrvRecoveryDelta,
  parseSleepPhaseFeatures,
} from '../src/lib/health/nightDetail.ts';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const numberOrNull = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const minutesOrNull = (v) => (numberOrNull(v) === null ? null : Math.round(v / 60));

const { data: rows, error } = await supabase
  .from('external_health_daily_snapshots')
  .select('id, local_date, raw_payload')
  .eq('source', 'oura')
  .order('local_date', { ascending: true });
if (error) throw error;

let updated = 0;
for (const row of rows) {
  const raw = row.raw_payload ?? {};
  const phases = parseSleepPhaseFeatures(raw.sleepDetail?.sleep_phase_30_sec);
  const patch = {
    temperature_deviation: numberOrNull(raw.dailyReadiness?.temperature_deviation),
    temperature_trend_deviation: numberOrNull(raw.dailyReadiness?.temperature_trend_deviation),
    non_wear_minutes: minutesOrNull(raw.dailyActivity?.non_wear_time),
    deep_sleep_first_third_minutes: phases.deepSleepFirstThirdMinutes,
    minutes_to_first_deep_sleep: phases.minutesToFirstDeepSleep,
    hrv_recovery_delta: hrvRecoveryDelta(raw.sleepDetail?.hrv),
    updated_at: new Date().toISOString(),
  };
  const { error: updateError } = await supabase
    .from('external_health_daily_snapshots')
    .update(patch)
    .eq('id', row.id);
  if (updateError) throw updateError;
  updated += 1;
}

console.log(`backfilled ${updated}/${rows.length} oura snapshot rows`);
```

- [ ] **Step 2: Dry-run the import graph only (no DB writes yet — prod migration not applied)**

Run: `node --experimental-strip-types --check scripts/backfill-oura-night-detail.mjs 2>&1 || node --experimental-strip-types -e "import('./scripts/backfill-oura-night-detail.mjs').catch(e => { if (!process.env.SUPABASE_SERVICE_ROLE_KEY) console.log('import graph OK (env missing as expected)'); else throw e; })"`
Expected: parses/imports cleanly (a missing-env error is acceptable here; a module-resolution error is not).

- [ ] **Step 3: Commit**

```bash
git add scripts/backfill-oura-night-detail.mjs
git commit -m "feat: backfill script for temperature/wear/night-detail from raw_payload"
```

---

### Task 6: Full verification + PR

- [ ] **Step 1: Full local gate**

Run: `npx tsc --noEmit && npm run test:correlation && npm run test:unit && npm run build`
Expected: all pass.

- [ ] **Step 2: Apply migration 023 to production** *(orchestrator/owner step — Supabase Management API pattern from `docs/agent-handoff-current-main.md` §0b, project `hagypgvfkjkncznoctoq`; POST the file's SQL to `/v1/projects/$REF/database/query`)*

- [ ] **Step 3: Run the backfill against production**

Run: `set -a && source .env.local && set +a && node --experimental-strip-types scripts/backfill-oura-night-detail.mjs`
Expected: `backfilled N/N oura snapshot rows` with N > 0; then spot-check via Management API: `select local_date, temperature_deviation, deep_sleep_first_third_minutes, hrv_recovery_delta from external_health_daily_snapshots where source='oura' and temperature_deviation is not null order by local_date desc limit 5;` returns rows.

- [ ] **Step 4: Live sync check** — trigger the Settings "sync now" button (or `.claude/launch.json` `dev-webpack` server + authenticated `/api/integrations/health/sync`), then confirm today's row repopulates the new columns.

- [ ] **Step 5: Open PR**

```bash
git push -u origin codex/oura-sprint1-free-data
gh pr create --base main --title "feat: Oura sprint 1 — temperature, night detail, wear quality (free data)" --body "Implements docs/superpowers/plans/2026-07-14-oura-sprint1-free-data.md. Zero new Oura API calls; history backfilled from raw_payload."
```

Do NOT merge — owner merges (production deploy on merge).
