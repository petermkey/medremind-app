# Eating Window (B3) — Implementation Plan (W1-B)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or
> superpowers:subagent-driven-development when orchestrated) to implement this plan
> task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Read
> `docs/superpowers/plans/2026-07-18-feature-wave-master.md` FIRST — its Global
> Constraints and file-ownership matrix bind this plan.

**Goal:** Derive fasting/eating-window metrics from data that already exists
(`food_entries.consumed_at` + per-entry `timezone`): daily window length, first/last-meal
time, late-meal flag. Surface today's window + a ≤10h-window streak as a Food-page
mini-card, and feed `eating_window_hours` / `last_meal_hour` / `late_meal_flag` into the
correlation engine as features. Also resolves the orphaned `/app/insights`
nutrition-averages page (this plan OWNS that fix per the master plan's Wave-1 note).

**Architecture:** One new pure clock-free module `src/lib/nutrition/eatingWindow.ts`
(zero imports — the `daySchedule.ts` precedent) consumed from three places:
1. **Food page** (client): computes today's window from `foodStore` entries already in memory.
2. **Correlation pipeline** (server): `src/lib/correlation/persistence.ts` — which already
   fetches `food_entries` rows for `buildDailyLifestyleSnapshots` — precomputes per-day
   window rows and passes them in as a new `eatingWindowRows` input. `featureBuilder.ts`
   itself gains NO value imports (it is loaded directly by the `--experimental-strip-types`
   test runner and must stay a leaf module — this is the exact `doseResponseRows` precedent
   already visible in `persistence.ts:323-338`).
3. **Engine**: three new FEATURE entries in `src/lib/correlation/engine.ts`.

Water entries are excluded from window math **by construction**: only `food_entries` /
`foodStore` entries are ever passed to the module; `water_entries` live in a different
table/store and never enter any call site in this plan.

No migration, no LLM, no cron, no new sync pattern.

**Orphan-page decision (recorded):** LINK the existing `/app/insights` 7-day-averages page
from the new Food-page mini-card instead of folding it in. Justification: linking is ~3
lines (one `<Link>`), folding is ~80 lines moved + a route deleted + its empty-state logic
re-homed — linking is strictly less code. No other agent touches `/app/insights`.

**Tech Stack:** Next.js 16 App Router, TypeScript strict, Zustand stores (read-only here),
standalone `test:unit` harness (`tsc --ignoreConfig` + `node`), `--experimental-strip-types`
runner for `test:correlation`, Playwright E2E.

## Spec

### Requirements

1. `computeEatingWindow(entries, date, timezone)` → `{ firstMeal, lastMeal, firstMealHour,
   lastMealHour, windowHours, lateFlag, mealCount }` where:
   - an entry belongs to `date` iff its `consumedAt` converted to the entry's own timezone
     (falling back to the `timezone` argument) lands on that local date — this is the
     midnight-crossing rule: a 22:30 UTC meal is a *next-day* 01:30 meal in Asia/Novosibirsk
     and must count toward the next local date, exactly like
     `filterFoodEntriesForLocalDate` in `src/lib/food/nutrition.ts` behaves;
   - `windowHours` = last-meal decimal hour − first-meal decimal hour (0 for single-meal
     days, `null` for empty days);
   - `lateFlag` = last meal at/after 21:00 local;
   - clock-free: no `Date.now()` / `new Date()` without argument anywhere in the module.
2. `computeEatingWindowStreak(entries, endDate, timezone, maxDays)` — consecutive days
   ending at `endDate` where the day has ≥1 meal AND `windowHours ≤ 10`. A day with no
   meals breaks the streak. `endDate` is injected (clock-free).
3. Food page mini-card: today's window so far ("11:20 → 19:05 · 7h45m"), late badge,
   streak, and a "7-day averages →" link to `/app/insights`. Hidden when the selected day
   has no meals.
4. Correlation features `eatingWindowHours`, `lastMealHour`, `lateMealFlag` flow:
   `persistence.ts` → `featureBuilder.ts` → `DailyLifestyleSnapshot` → `engine.ts` FEATURES.
   No `daily_lifestyle_snapshots` schema change — in-memory pattern, same as the sleep-detail
   fields (see `docs/superpowers/plans/2026-07-14-oura-sprint1-free-data.md` Task 4).
5. Unit tests across midnight-crossing, single-meal, empty days, timezones; a
   featureBuilder test extension; one Playwright E2E.

### Acceptance criteria

- `npx tsc --noEmit`, `npm run build`, `npm run test:unit`, `npm run test:correlation` all pass.
- Logging a meal on the Food page makes the eating-window card appear with a valid
  `HH:MM → HH:MM · XhYYm` line.
- The card's link opens `/app/insights` (currently orphaned — reachable from nowhere;
  verified 2026-07-18: `rg "app/insights" src/ tests/` returns zero references).
- Correlation refresh (POST `/api/insights/correlations`) builds snapshots containing the
  three new fields for days with food entries.

### Non-goals

- No `withFood:'no'` dose-hint (B3 spec marks it v2).
- No ≥50 kcal meal threshold (B3 spec marks it optional-later).
- No persistence of window metrics (derived data only).

## Global Constraints (from the master plan — restated, binding)

- Branch: `codex/w1b-eating-window`, off fresh `origin/main`, after
  `bash scripts/git-state-check.sh`. Never push to `main`; end in a PR; DO NOT merge.
- TypeScript strict; no new `any`; run `npx tsc --noEmit` after every `.ts/.tsx` change.
- No `console.log` in committed code. Conventional commits.
- Pure module constraint: `eatingWindow.ts` has ZERO imports so both harnesses can load it.
  The `test:unit` harness compiles with `tsc --ignoreConfig --module Node16` — `@/` path
  aliases DO NOT resolve there; only relative imports work, and zero imports is safest.
- `featureBuilder.ts` must gain NO value imports (strip-types runner loads it directly from
  `featureBuilder.test.mjs`; `moduleResolution: "bundler"` without `allowImportingTsExtensions`
  makes `./x.ts`-style imports fail `tsc` while extensionless ones fail the runner — the
  only safe state is leaf). All window computation for the pipeline happens in
  `persistence.ts` (Next/tsc-only module where `@/` aliases work).
- File ownership: this agent owns `src/lib/nutrition/eatingWindow.ts` (new),
  `src/app/app/food/page.tsx` (mini-card only), `src/lib/correlation/featureBuilder.ts`
  (+types/engine/persistence wiring), `/app/insights` resolution. Touch nothing else.

## File Structure

- Create: `src/lib/nutrition/eatingWindow.ts` — pure window math (zero imports).
- Create: `tests/unit/eatingWindow.test.ts` — its tests (test:unit harness).
- Modify: `package.json` — register both files in the `test:unit` script.
- Modify: `src/lib/correlation/types.ts` — 3 new `DailyLifestyleSnapshot` fields.
- Modify: `src/lib/correlation/featureBuilder.ts` — new `eatingWindowRows` input + mapping.
- Modify: `src/lib/correlation/featureBuilder.test.mjs` — new test.
- Modify: `src/lib/correlation/engine.ts` — 3 new FEATURES entries.
- Modify: `src/lib/correlation/persistence.ts` — compute `eatingWindowRows` from fetched food rows.
- Modify: `src/app/app/food/page.tsx` — `EatingWindowCard` + `/app/insights` link.
- Create: `tests/e2e/eatingWindow.spec.ts` — Playwright E2E.

---

### Task 1: `eatingWindow.ts` — pure window math + unit tests

**Files:**
- Create: `src/lib/nutrition/eatingWindow.ts`
- Create: `tests/unit/eatingWindow.test.ts`
- Modify: `package.json` (`test:unit` script)

**Interfaces:**
- Produces (consumed by Tasks 2 and 3):
  - `type EatingWindowEntry = { consumedAt: string; timezone?: string }`
  - `type EatingWindowResult = { firstMeal: string | null; lastMeal: string | null; firstMealHour: number | null; lastMealHour: number | null; windowHours: number | null; lateFlag: boolean; mealCount: number }`
  - `computeEatingWindow(entries: EatingWindowEntry[], date: string, timezone: string): EatingWindowResult`
  - `computeEatingWindowStreak(entries: EatingWindowEntry[], endDate: string, timezone: string, maxDays?: number): number`
  - `formatWindowDuration(windowHours: number): string` — `"7h45m"` / `"0h"` style
  - constants `LATE_MEAL_HOUR = 21`, `STREAK_MAX_WINDOW_HOURS = 10`
- MUST have zero imports (leaf module).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/eatingWindow.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  computeEatingWindow,
  computeEatingWindowStreak,
  formatWindowDuration,
} from '../../src/lib/nutrition/eatingWindow';

test('two meals in UTC produce first/last/window and no late flag', () => {
  const result = computeEatingWindow(
    [
      { consumedAt: '2026-07-01T11:20:00.000Z' },
      { consumedAt: '2026-07-01T19:05:00.000Z' },
    ],
    '2026-07-01',
    'UTC',
  );
  assert.equal(result.firstMeal, '11:20');
  assert.equal(result.lastMeal, '19:05');
  assert.equal(result.firstMealHour, 11.33);
  assert.equal(result.lastMealHour, 19.08);
  assert.equal(result.windowHours, 7.75);
  assert.equal(result.lateFlag, false);
  assert.equal(result.mealCount, 2);
});

test('meal order in the input array does not matter', () => {
  const result = computeEatingWindow(
    [
      { consumedAt: '2026-07-01T19:05:00.000Z' },
      { consumedAt: '2026-07-01T11:20:00.000Z' },
      { consumedAt: '2026-07-01T14:00:00.000Z' },
    ],
    '2026-07-01',
    'UTC',
  );
  assert.equal(result.firstMeal, '11:20');
  assert.equal(result.lastMeal, '19:05');
  assert.equal(result.mealCount, 3);
});

test('single-meal day → window 0, not null', () => {
  const result = computeEatingWindow(
    [{ consumedAt: '2026-07-01T13:00:00.000Z' }],
    '2026-07-01',
    'UTC',
  );
  assert.equal(result.windowHours, 0);
  assert.equal(result.firstMeal, '13:00');
  assert.equal(result.lastMeal, '13:00');
  assert.equal(result.mealCount, 1);
});

test('empty day → nulls and mealCount 0', () => {
  const result = computeEatingWindow([], '2026-07-01', 'UTC');
  assert.equal(result.firstMeal, null);
  assert.equal(result.lastMeal, null);
  assert.equal(result.windowHours, null);
  assert.equal(result.lateFlag, false);
  assert.equal(result.mealCount, 0);
});

test('late flag: last meal at 21:00 or later local time', () => {
  const late = computeEatingWindow(
    [
      { consumedAt: '2026-07-01T12:00:00.000Z' },
      { consumedAt: '2026-07-01T21:05:00.000Z' },
    ],
    '2026-07-01',
    'UTC',
  );
  assert.equal(late.lateFlag, true);

  const notLate = computeEatingWindow(
    [{ consumedAt: '2026-07-01T20:59:00.000Z' }],
    '2026-07-01',
    'UTC',
  );
  assert.equal(notLate.lateFlag, false);
});

test('midnight crossing: a UTC-late meal belongs to the NEXT local date in an eastern tz', () => {
  // 22:30 UTC on Jul 1 = 05:30 Jul 2 in Asia/Novosibirsk (UTC+7).
  const entries = [
    { consumedAt: '2026-07-01T05:00:00.000Z' }, // 12:00 local Jul 1
    { consumedAt: '2026-07-01T22:30:00.000Z' }, // 05:30 local Jul 2
  ];
  const day1 = computeEatingWindow(entries, '2026-07-01', 'Asia/Novosibirsk');
  assert.equal(day1.mealCount, 1);
  assert.equal(day1.firstMeal, '12:00');
  assert.equal(day1.windowHours, 0);

  const day2 = computeEatingWindow(entries, '2026-07-02', 'Asia/Novosibirsk');
  assert.equal(day2.mealCount, 1);
  assert.equal(day2.firstMeal, '05:30');
});

test('per-entry timezone overrides the fallback timezone argument', () => {
  // 23:30 UTC is 02:30 next day in Moscow (UTC+3): with the entry tz set it
  // must NOT count toward Jul 1 even though the fallback tz is UTC.
  const entries = [{ consumedAt: '2026-07-01T23:30:00.000Z', timezone: 'Europe/Moscow' }];
  assert.equal(computeEatingWindow(entries, '2026-07-01', 'UTC').mealCount, 0);
  assert.equal(computeEatingWindow(entries, '2026-07-02', 'UTC').mealCount, 1);
});

test('invalid timestamps are ignored', () => {
  const result = computeEatingWindow(
    [{ consumedAt: 'not-a-date' }, { consumedAt: '2026-07-01T10:00:00.000Z' }],
    '2026-07-01',
    'UTC',
  );
  assert.equal(result.mealCount, 1);
});

test('streak counts consecutive ≤10h days ending at endDate', () => {
  const entries = [
    // Jul 3 (endDate): 9h window
    { consumedAt: '2026-07-03T10:00:00.000Z' },
    { consumedAt: '2026-07-03T19:00:00.000Z' },
    // Jul 2: 8h window
    { consumedAt: '2026-07-02T11:00:00.000Z' },
    { consumedAt: '2026-07-02T19:00:00.000Z' },
    // Jul 1: 12h window → breaks
    { consumedAt: '2026-07-01T08:00:00.000Z' },
    { consumedAt: '2026-07-01T20:00:00.000Z' },
  ];
  assert.equal(computeEatingWindowStreak(entries, '2026-07-03', 'UTC'), 2);
});

test('a day with no meals breaks the streak', () => {
  const entries = [
    { consumedAt: '2026-07-03T10:00:00.000Z' },
    { consumedAt: '2026-07-03T18:00:00.000Z' },
    // Jul 2: nothing logged
    { consumedAt: '2026-07-01T10:00:00.000Z' },
    { consumedAt: '2026-07-01T18:00:00.000Z' },
  ];
  assert.equal(computeEatingWindowStreak(entries, '2026-07-03', 'UTC'), 1);
});

test('streak is 0 when endDate has no meals', () => {
  assert.equal(computeEatingWindowStreak([], '2026-07-03', 'UTC'), 0);
});

test('streak respects maxDays cap', () => {
  const entries: { consumedAt: string }[] = [];
  for (let day = 1; day <= 9; day += 1) {
    const d = `2026-07-0${day}`;
    entries.push({ consumedAt: `${d}T10:00:00.000Z` }, { consumedAt: `${d}T18:00:00.000Z` });
  }
  assert.equal(computeEatingWindowStreak(entries, '2026-07-09', 'UTC', 5), 5);
});

test('formatWindowDuration renders hours and minutes', () => {
  assert.equal(formatWindowDuration(7.75), '7h45m');
  assert.equal(formatWindowDuration(0), '0h');
  assert.equal(formatWindowDuration(10), '10h');
  assert.equal(formatWindowDuration(0.5), '0h30m');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from repo root — note the quoted path convention everywhere in this repo):
```bash
cd "/Volumes/DATA/GRAVITY REPO/medremind-app" && npm run test:unit
```
Expected: FAIL — `tsc` errors with `Cannot find module '../../src/lib/nutrition/eatingWindow'`
only AFTER Step 4's package.json edit; at this point the test file is not yet registered, so
first do Step 3 (implementation is written test-first here purely by file order — the
registration in Step 4 is what makes the harness see it; the fail/pass cycle is observed in
Steps 4–5).

Actually, to observe a true failing state: temporarily run the single test via tsc directly:
```bash
cd "/Volumes/DATA/GRAVITY REPO/medremind-app" && npx tsc --ignoreConfig --target ES2020 --module Node16 --moduleResolution node16 --types node --strict --esModuleInterop --skipLibCheck --outDir .tmp/unit-probe --rootDir . --noEmit false tests/unit/eatingWindow.test.ts; rm -rf .tmp/unit-probe
```
Expected: `error TS2307: Cannot find module '../../src/lib/nutrition/eatingWindow'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/nutrition/eatingWindow.ts
// Pure eating-window math (B3). Clock-free: the date/endDate is always
// injected, never read from a clock. ZERO imports so the standalone
// test:unit harness (tsc --ignoreConfig, no path aliases) compiles it in
// isolation — the daySchedule.ts precedent.
//
// Water is excluded by construction: every call site passes FOOD entries
// only (food_entries rows / foodStore entries). water_entries never reach
// this module.

export type EatingWindowEntry = {
  consumedAt: string;
  /** Per-entry IANA timezone; falls back to the timezone argument. */
  timezone?: string;
};

export type EatingWindowResult = {
  firstMeal: string | null; // 'HH:MM' local
  lastMeal: string | null; // 'HH:MM' local
  firstMealHour: number | null; // decimal local hour (2dp), e.g. 19.08
  lastMealHour: number | null;
  windowHours: number | null; // 0 for single-meal days, null when empty
  lateFlag: boolean; // last meal at/after 21:00 local
  mealCount: number;
};

export const LATE_MEAL_HOUR = 21;
export const STREAK_MAX_WINDOW_HOURS = 10;
const DEFAULT_STREAK_MAX_DAYS = 14;

type LocalParts = { localDate: string; hour: number; minute: number };

function safeTimezone(candidate: string | undefined, fallback: string): string {
  const value = candidate?.trim();
  if (!value) return fallback;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: value });
    return value;
  } catch {
    return fallback;
  }
}

function localParts(iso: string, timezone: string): LocalParts | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;

  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date);
    const map = new Map(parts.map(part => [part.type, part.value]));
    const year = map.get('year');
    const month = map.get('month');
    const day = map.get('day');
    const hour = Number(map.get('hour'));
    const minute = Number(map.get('minute'));

    if (!year || !month || !day || !Number.isFinite(hour) || !Number.isFinite(minute)) {
      return null;
    }
    return { localDate: `${year}-${month}-${day}`, hour, minute };
  } catch {
    return null;
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

export function computeEatingWindow(
  entries: EatingWindowEntry[],
  date: string,
  timezone: string,
): EatingWindowResult {
  const fallbackTz = safeTimezone(timezone, 'UTC');
  const dayParts: LocalParts[] = [];

  for (const entry of entries) {
    const parts = localParts(entry.consumedAt, safeTimezone(entry.timezone, fallbackTz));
    if (parts && parts.localDate === date) dayParts.push(parts);
  }

  if (dayParts.length === 0) {
    return {
      firstMeal: null,
      lastMeal: null,
      firstMealHour: null,
      lastMealHour: null,
      windowHours: null,
      lateFlag: false,
      mealCount: 0,
    };
  }

  let first = dayParts[0];
  let last = dayParts[0];
  for (const parts of dayParts) {
    if (parts.hour * 60 + parts.minute < first.hour * 60 + first.minute) first = parts;
    if (parts.hour * 60 + parts.minute > last.hour * 60 + last.minute) last = parts;
  }

  const firstMealHour = round2(first.hour + first.minute / 60);
  const lastMealHour = round2(last.hour + last.minute / 60);

  return {
    firstMeal: `${pad2(first.hour)}:${pad2(first.minute)}`,
    lastMeal: `${pad2(last.hour)}:${pad2(last.minute)}`,
    firstMealHour,
    lastMealHour,
    windowHours: round2(
      (last.hour * 60 + last.minute - (first.hour * 60 + first.minute)) / 60,
    ),
    lateFlag: last.hour * 60 + last.minute >= LATE_MEAL_HOUR * 60,
    mealCount: dayParts.length,
  };
}

function addDaysToDateString(localDate: string, days: number): string {
  const date = new Date(`${localDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function computeEatingWindowStreak(
  entries: EatingWindowEntry[],
  endDate: string,
  timezone: string,
  maxDays: number = DEFAULT_STREAK_MAX_DAYS,
): number {
  let streak = 0;
  for (let offset = 0; offset < maxDays; offset += 1) {
    const date = addDaysToDateString(endDate, -offset);
    const window = computeEatingWindow(entries, date, timezone);
    if (window.mealCount === 0 || window.windowHours === null) break;
    if (window.windowHours > STREAK_MAX_WINDOW_HOURS) break;
    streak += 1;
  }
  return streak;
}

export function formatWindowDuration(windowHours: number): string {
  const totalMinutes = Math.round(windowHours * 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours}h` : `${hours}h${pad2(minutes)}m`;
}
```

- [ ] **Step 4: Register in `test:unit` and verify the suite passes**

In `package.json`, edit the `test:unit` script in TWO places:
1. In the tsc file list, append (after `src/lib/store/streak.ts`):
   ` tests/unit/eatingWindow.test.ts src/lib/nutrition/eatingWindow.ts`
2. In the run chain, append (after `node .tmp/unit/tests/unit/streak.test.js`):
   ` && node .tmp/unit/tests/unit/eatingWindow.test.js`

Run:
```bash
cd "/Volumes/DATA/GRAVITY REPO/medremind-app" && npm run test:unit
```
Expected: all existing tests + 13 new eatingWindow tests PASS.

- [ ] **Step 5: Type-check**

Run: `cd "/Volumes/DATA/GRAVITY REPO/medremind-app" && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/nutrition/eatingWindow.ts tests/unit/eatingWindow.test.ts package.json
git commit -m "feat: eating-window pure module (window math, late flag, streak)"
```

---

### Task 2: Correlation wiring — `eatingWindowRows` input, snapshot fields, engine features

**Files:**
- Modify: `src/lib/correlation/types.ts`
- Modify: `src/lib/correlation/featureBuilder.ts`
- Modify: `src/lib/correlation/featureBuilder.test.mjs`
- Modify: `src/lib/correlation/engine.ts`
- Modify: `src/lib/correlation/persistence.ts`

**Interfaces:**
- Consumes: `computeEatingWindow` from `@/lib/nutrition/eatingWindow` — imported by
  `persistence.ts` ONLY (Next/tsc module; `featureBuilder.ts` must stay import-free, see
  Global Constraints).
- Produces:
  - `BuildDailyLifestyleSnapshotsInput` gains `eatingWindowRows?: Row[]` where each row is
    `{ user_id, local_date, eating_window_hours: number | null, last_meal_hour: number | null, late_meal_flag: boolean }`.
  - `DailyLifestyleSnapshot` gains `eatingWindowHours?: number | null`,
    `lastMealHour?: number | null`, `lateMealFlag?: boolean`.
  - Engine FEATURES gains keys `eatingWindowHours`, `lastMealHour`, `lateMealFlag`
    (booleans are already coerced to 0/1 by `value()` in `engine.ts:113-117`).

- [ ] **Step 1: Add failing featureBuilder tests**

Append to `src/lib/correlation/featureBuilder.test.mjs` (match the file's existing style —
it calls `buildDailyLifestyleSnapshots` with plain row objects):

```js
test('maps eating-window rows into snapshot features', () => {
  const [snapshot] = buildDailyLifestyleSnapshots({
    userId: 'user-1',
    startDate: '2026-07-13',
    endDate: '2026-07-13',
    eatingWindowRows: [{
      user_id: 'user-1',
      local_date: '2026-07-13',
      eating_window_hours: 8.5,
      last_meal_hour: 21.25,
      late_meal_flag: true,
    }],
  });
  assert.equal(snapshot.eatingWindowHours, 8.5);
  assert.equal(snapshot.lastMealHour, 21.25);
  assert.equal(snapshot.lateMealFlag, true);
});

test('eating-window features default to null/false when no rows exist', () => {
  const [snapshot] = buildDailyLifestyleSnapshots({
    userId: 'user-1',
    startDate: '2026-07-13',
    endDate: '2026-07-13',
  });
  assert.equal(snapshot.eatingWindowHours, null);
  assert.equal(snapshot.lastMealHour, null);
  assert.equal(snapshot.lateMealFlag, false);
});
```

- [ ] **Step 2: Run to verify failure**

Run:
```bash
cd "/Volumes/DATA/GRAVITY REPO/medremind-app" && node --experimental-strip-types --test src/lib/correlation/featureBuilder.test.mjs
```
Expected: FAIL — `snapshot.eatingWindowHours` is `undefined`.

- [ ] **Step 3: Extend `DailyLifestyleSnapshot` in `src/lib/correlation/types.ts`**

After `hrvRecoveryDelta?: number | null;` (line ~40) add:

```ts
  eatingWindowHours?: number | null;
  lastMealHour?: number | null;
  lateMealFlag?: boolean;
```

- [ ] **Step 4: Extend `featureBuilder.ts` (NO new imports)**

In `BuildDailyLifestyleSnapshotsInput` (after `doseResponseRows?: Row[];`):

```ts
  eatingWindowRows?: Row[];
```

In `buildDailyLifestyleSnapshots`, after
`const doseHrByDate = indexByDate(input.doseResponseRows, input.userId, 'local_date');` add:

```ts
  const windowByDate = indexByDate(input.eatingWindowRows, input.userId, 'local_date');
```

Inside the per-date map callback, after `const tagRows = tagsByDate.get(localDate) ?? [];` add:

```ts
    const windowRows = windowByDate.get(localDate) ?? [];
```

In the returned snapshot object, after `hrvRecoveryDelta: firstNumber(healthRows, 'hrv_recovery_delta'),` add:

```ts
      eatingWindowHours: firstNumber(windowRows, 'eating_window_hours'),
      lastMealHour: firstNumber(windowRows, 'last_meal_hour'),
      lateMealFlag: toBoolean(windowRows[0]?.late_meal_flag),
```

- [ ] **Step 5: Extend engine FEATURES in `src/lib/correlation/engine.ts`**

Append to the `FEATURES` array (after `{ key: 'ouraTagCount', label: 'Oura tag count' },`):

```ts
  { key: 'eatingWindowHours', label: 'eating window (h)' },
  { key: 'lastMealHour', label: 'last meal time' },
  { key: 'lateMealFlag', label: 'late meal (after 21:00)' },
```

- [ ] **Step 6: Compute window rows in `src/lib/correlation/persistence.ts`**

Add the import (after `import { dailyDoseResponseRows, type HrSample } from '@/lib/health/doseResponse';`):

```ts
import { computeEatingWindow } from '@/lib/nutrition/eatingWindow';
```

In `buildAndPersistDailyLifestyleSnapshots`, after the `doseResponseRows` computation
(after the line ending `.map((row) => ({ ...row, user_id: userId }));`) add:

```ts
  // Eating-window features (B3). Computed here — not in featureBuilder —
  // because featureBuilder must stay a leaf module for the strip-types test
  // runner (same reason doseResponseRows are precomputed above).
  const windowEntries = foodEntries
    .filter((row) => typeof row.consumed_at === 'string')
    .map((row) => ({
      consumedAt: row.consumed_at as string,
      timezone: typeof row.timezone === 'string' ? row.timezone : undefined,
    }));
  const eatingWindowRows: Row[] = [];
  for (let date = startDate; date <= endDate; date = addDays(date, 1)) {
    const window = computeEatingWindow(windowEntries, date, 'UTC');
    if (window.mealCount === 0) continue;
    eatingWindowRows.push({
      user_id: userId,
      local_date: date,
      eating_window_hours: window.windowHours,
      last_meal_hour: window.lastMealHour,
      late_meal_flag: window.lateFlag,
    });
  }
```

(The `'UTC'` fallback is only used for entries missing their own `timezone` column —
`food_entries.timezone` is `not null default 'UTC'` per `supabase/005`, so in practice the
per-entry timezone always wins.)

Then add `eatingWindowRows,` to the `buildDailyLifestyleSnapshots({ ... })` call, after
`doseResponseRows,`.

- [ ] **Step 7: Verify**

Run:
```bash
cd "/Volumes/DATA/GRAVITY REPO/medremind-app" && npm run test:correlation && npx tsc --noEmit
```
Expected: full correlation suite PASSES including the 2 new tests; tsc clean. (If an engine
test pins the FEATURES list length, update it to include the three new features — the
current `engine.test.mjs` asserts card generation, not feature count.)

- [ ] **Step 8: Commit**

```bash
git add src/lib/correlation/types.ts src/lib/correlation/featureBuilder.ts src/lib/correlation/featureBuilder.test.mjs src/lib/correlation/engine.ts src/lib/correlation/persistence.ts
git commit -m "feat: eating-window correlation features (window hours, last-meal hour, late flag)"
```

---

### Task 3: Food page mini-card + `/app/insights` link

**Files:**
- Modify: `src/app/app/food/page.tsx`

**Interfaces:**
- Consumes: `computeEatingWindow`, `computeEatingWindowStreak`, `formatWindowDuration`,
  `STREAK_MAX_WINDOW_HOURS` from `@/lib/nutrition/eatingWindow`; `entries` /
  `foodStore.entries` already available in the component; `Link` from `next/link`.
- Produces: an `EatingWindowCard` rendered right after the `{targetProfile && (...)}` block
  in the fixed header section — visible whenever the selected day has ≥1 meal, independent
  of whether targets are configured.

Card copy (English, matching the page's existing UI language): title "Eating window", body
`"11:20 → 19:05 · 7h45m"`, a `late` badge when `lateFlag`, a streak line
`"≤10h streak: N day(s)"`, and the link `7-day averages →` to `/app/insights`.

Streak note: the page loads entries for `activeDate − 7 … activeDate + 2`
(`rangeAroundLocalDate`), so the streak is computed with `maxDays = 7` — an honest
"last 7 days" streak over the data guaranteed to be in memory. Do NOT widen the fetch range
for this card.

- [ ] **Step 1: Add imports and derived values**

In `src/app/app/food/page.tsx`:

Add to the imports block (after the `date-fns` import):

```tsx
import Link from 'next/link';
```

Add after the `consumedAtForSelectedDateInTimezone` import line:

```tsx
import {
  computeEatingWindow,
  computeEatingWindowStreak,
  formatWindowDuration,
  STREAK_MAX_WINDOW_HOURS,
} from '@/lib/nutrition/eatingWindow';
```

Inside `FoodPage()`, after `const shouldShowSetup = ...` (line ~375) add:

```tsx
  const eatingWindow = useMemo(
    () =>
      computeEatingWindow(
        entries.map(entry => ({ consumedAt: entry.consumedAt, timezone: entry.timezone })),
        activeDate,
        timezone,
      ),
    [entries, activeDate, timezone],
  );
  const storeEntries = foodStore.entries;
  const eatingStreak = useMemo(
    () =>
      computeEatingWindowStreak(
        storeEntries.map(entry => ({ consumedAt: entry.consumedAt, timezone: entry.timezone })),
        activeDate,
        timezone,
        7,
      ),
    [storeEntries, activeDate, timezone],
  );
```

(`entries` is already the day-filtered, user-scoped, pending-delete-filtered list from
`entriesForDate`; `foodStore.entries` is the full loaded range, user-scoped by
`loadEntriesForRange` — good enough for a UI streak.)

- [ ] **Step 2: Render the card**

In the main return JSX, directly AFTER the closing of the `{targetProfile && ( <> ... </> )}`
block (i.e. after the `</>` that follows `<WaterTracker ... />`, still inside the
`flex-shrink-0` header `<div>`), add:

```tsx
        {eatingWindow.mealCount > 0 && (
          <EatingWindowCard window={eatingWindow} streak={eatingStreak} />
        )}
```

- [ ] **Step 3: Add the card component**

At the bottom of the file, after the `WaterTracker` component definition, add:

```tsx
function EatingWindowCard({
  window,
  streak,
}: {
  window: ReturnType<typeof computeEatingWindow>;
  streak: number;
}) {
  return (
    <div className="mt-2 rounded-xl border border-[rgba(168,85,247,0.24)] bg-[rgba(168,85,247,0.08)] p-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className="text-[13px] font-bold text-[#F0F6FC]">Eating window</div>
            {window.lateFlag && (
              <span className="rounded-full bg-[rgba(251,191,36,0.16)] px-2 py-0.5 text-[10px] font-bold text-[#FBBF24]">
                late
              </span>
            )}
          </div>
          <div className="mt-0.5 text-[11px] font-semibold text-[#C9D1D9]">
            {window.firstMeal} → {window.lastMeal}
            {window.windowHours !== null && window.windowHours > 0 && (
              <> · {formatWindowDuration(window.windowHours)}</>
            )}
          </div>
          <div className="mt-0.5 text-[10px] font-semibold text-[#8B949E]">
            ≤{STREAK_MAX_WINDOW_HOURS}h streak: {streak} day{streak === 1 ? '' : 's'}
          </div>
        </div>
        <Link
          href="/app/insights"
          className="flex-shrink-0 text-[11px] font-bold text-[#A855F7] hover:underline"
        >
          7-day averages →
        </Link>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Verify locally**

Run:
```bash
cd "/Volumes/DATA/GRAVITY REPO/medremind-app" && npx tsc --noEmit && npm run build
```
Expected: both clean. (Manual check optional: `dev` server → log a meal → card shows.)

- [ ] **Step 5: Commit**

```bash
git add src/app/app/food/page.tsx
git commit -m "feat: eating-window mini-card on Food page + link to 7-day averages"
```

---

### Task 4: Playwright E2E

**Files:**
- Create: `tests/e2e/eatingWindow.spec.ts`

**Interfaces:**
- Consumes: the same env-gated login pattern as `tests/e2e/food.spec.ts`
  (`E2E_EMAIL`/`E2E_PASSWORD`/`NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY`;
  suite self-skips when absent), the `page.route` analyze-text stub pattern
  (`mockFoodTextAnalysis` precedent, `food.spec.ts:366-374`), and afterEach cleanup via an
  authenticated anon-key Supabase client (hardened-harness rules, PR #63: `workers: 1`,
  every created row deleted).

- [ ] **Step 1: Write the spec**

```ts
// tests/e2e/eatingWindow.spec.ts
import { expect, test, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const e2eEmail = process.env.E2E_EMAIL;
const e2ePassword = process.env.E2E_PASSWORD;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const hasE2eEnv = Boolean(e2eEmail && e2ePassword && supabaseUrl && supabaseAnonKey);

const ENTRY_TITLE = 'E2E EW Meal';

const windowDraft = {
  title: ENTRY_TITLE,
  summary: 'Buckwheat with chicken for the eating-window test.',
  mealLabel: 'lunch',
  components: [
    {
      name: 'Buckwheat with chicken',
      category: 'grain',
      estimatedQuantity: 1,
      estimatedUnit: 'bowl',
      gramsEstimate: 300,
      confidence: 0.9,
    },
  ],
  nutrients: { caloriesKcal: 450, proteinG: 35, totalFatG: 10, carbsG: 55, fiberG: 5 },
  uncertainties: [],
  estimationConfidence: 0.9,
  model: 'e2e-food-analysis',
  schemaVersion: 'food-analysis-v1',
};

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(e2eEmail!);
  await page.getByLabel('Password').fill(e2ePassword!);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/(app|onboarding)(\/|$)/, { timeout: 30_000 });
}

async function mockFoodTextAnalysis(page: Page) {
  await page.route('**/api/food/analyze-text', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ draft: windowDraft }),
    });
  });
}

async function deleteTestEntries() {
  const supabase = createClient(supabaseUrl!, supabaseAnonKey!);
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: e2eEmail!,
    password: e2ePassword!,
  });
  if (signInError) throw signInError;
  const { error } = await supabase.from('food_entries').delete().eq('title', ENTRY_TITLE);
  if (error) throw error;
  await supabase.auth.signOut();
}

test.describe('eating window card', () => {
  test.skip(!hasE2eEnv, 'E2E credentials are not configured');

  test.afterEach(async () => {
    await deleteTestEntries();
  });

  test('logging a meal shows the eating-window card and links to 7-day averages', async ({
    page,
  }) => {
    await login(page);
    await mockFoodTextAnalysis(page);
    await page.goto('/app/food');
    await expect(page.getByRole('heading', { name: 'Food' })).toBeVisible();

    await page.getByLabel('Describe your meal').fill('buckwheat with chicken');
    await page.getByRole('button', { name: 'Analyze' }).click();
    await expect(page.getByRole('heading', { name: ENTRY_TITLE })).toBeVisible();
    await page.getByRole('button', { name: 'Save', exact: true }).click();

    // Card appears with a first→last time line and the streak counter.
    await expect(page.getByText('Eating window', { exact: true })).toBeVisible();
    await expect(page.getByText('→').first()).toBeVisible();
    await expect(page.getByText(/≤10h streak: \d+ days?/)).toBeVisible();

    // Orphan-page resolution: the link navigates to the 7-day averages page.
    await page.getByRole('link', { name: '7-day averages →' }).click();
    await page.waitForURL('**/app/insights');
    await expect(page.getByRole('heading', { name: 'Insights' })).toBeVisible();
  });
});
```

- [ ] **Step 2: Run it (creds-gated — runs only where `.env.local` E2E creds exist)**

Run:
```bash
cd "/Volumes/DATA/GRAVITY REPO/medremind-app" && set -a && source .env.local && set +a && npx playwright test tests/e2e/eatingWindow.spec.ts
```
Expected: 1 passed (or "1 skipped" in an environment without creds — the suite must never
fail for missing env).

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/eatingWindow.spec.ts
git commit -m "test: eating-window E2E (card render + insights link)"
```

---

### Task 5: Full verification + PR

- [ ] **Step 1: Full local gate**

Run:
```bash
cd "/Volumes/DATA/GRAVITY REPO/medremind-app" && npx tsc --noEmit && npm run test:unit && npm run test:correlation && npm run build
```
Expected: all pass. Also run `rg -n "console\.log" src/lib/nutrition/eatingWindow.ts src/app/app/food/page.tsx src/lib/correlation/` — expected: no new hits (the pre-existing `console.warn('[food-page-date-fallback]')` in food/page.tsx stays).

- [ ] **Step 2: Push and open PR (do NOT merge)**

```bash
git push -u origin codex/w1b-eating-window
gh pr create --base main --title "feat: eating window (B3) — window math, food-page card, correlation features" --body "Implements docs/superpowers/plans/2026-07-18-eating-window.md (W1-B). Pure clock-free module + Food page mini-card + 3 correlation features. Resolves the orphaned /app/insights page by linking it from the card (recorded decision: linking is less code than folding). No migration, no LLM. Test evidence: test:unit (13 new), test:correlation (2 new), 1 Playwright E2E."
```

STOP after opening the PR. The owner merges (merge = production deploy).

## Self-review checklist (author-verified)

- Every B3 spec requirement maps to a task: window math (T1), food-page card + streak (T3),
  correlation features (T2), orphan-page resolution (T3 link + T4 E2E assertion), tests
  (T1/T2/T4). Dose-hint and kcal-threshold are recorded non-goals per spec ("v2"/"later").
- W4-A dependency honored: `computeEatingWindow` lives at exactly
  `src/lib/nutrition/eatingWindow.ts` as the master plan's dependency edge requires.
- Type consistency verified against real code: `FoodEntry.consumedAt`/`timezone` (types/food.ts:37-38),
  `Row = Record<string, unknown>` featureBuilder convention, `firstNumber`/`toBoolean`
  helpers exist at featureBuilder.ts:19-28, `addDays` exists at persistence.ts:151-155.
- No placeholders; all commands runnable from repo root with the quoted path.
