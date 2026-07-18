# Close the Gap (B5) — Implementation Plan (W2-B)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or
> superpowers:subagent-driven-development when orchestrated) to implement this plan
> task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Read
> `docs/superpowers/plans/2026-07-18-feature-wave-master.md` FIRST — its Global
> Constraints and file-ownership matrix bind this plan.

**Goal:** When today's nutrition targets still have meaningful gaps after 15:00 local
(e.g. protein −40g, fiber −15g, water −800ml), a «Чем закрыть день?» button on the Food
page asks the LLM for 2–3 concrete meal/snack suggestions that close them. Tapping a
suggestion pre-fills the existing text-analyze input, feeding the already-shipped
analyze → draft → save loop. Turns passive progress bars into an action loop.

**Architecture:**

```
client: gaps = targets − totalsForDate/waterTotalForDate  (already on Food page)
  button (visible only when hasMeaningfulGaps && local time ≥ 15:00 && selected day is today)
  ─▶ POST /api/food/suggest { date }          ← server RE-COMPUTES gaps from DB rows
        (auth-gated, RLS user client; NEVER trusts client numbers)
  ─▶ src/lib/food/suggest/providers.ts: OpenRouter structured json_schema call —
        clone of the analyzeFoodText discipline (model fallback chain via
        getOpenRouterFoodVisionModels, food_provider_* coded errors, 30s timeout,
        Sentry capture in the route)
  ─▶ validateFoodSuggestions (suggestSchema.ts — the validateFoodAnalysisDraft pattern)
  ─▶ client bottom-sheet; tap → setMealText(title + description) → existing
        analyze-text → draft → saveDraftAsEntry
```

Client-side: fetch guarded by an in-flight flag (debounce) and a per-`(date, gaps-bucket)`
component-state cache (`useRef<Map>`), so re-opening the sheet with unchanged gaps never
re-fires the LLM. No server cache, nothing persisted (suggestions are ephemeral per B5).

**⚠️ Written against the post-W1-B Food page.** Wave 1's `codex/w1b-eating-window`
(`docs/superpowers/plans/2026-07-18-eating-window.md`) also edits
`src/app/app/food/page.tsx`: it adds an `EatingWindowCard` rendered immediately AFTER the
`{targetProfile && (<>…<WaterTracker …/></>)}` block and imports from
`@/lib/nutrition/eatingWindow` and `next/link`. This plan starts only after Wave 1 is
merged (master-plan wave sequencing), so branch from a `main` that already contains that
card. All insertion anchors below are chosen to be stable under W1-B's diff: the suggest
button goes INSIDE the `{targetProfile && …}` fragment right after `<WaterTracker />`
(before the fragment closes; the W1-B card sits after the fragment, so both changes
coexist without conflict). If W1-B shipped differently, anchor on `<WaterTracker` — it is
unchanged by W1-B.

**Tech Stack:** Next.js 16 App Router, TypeScript strict, `@supabase/ssr` server client
(RLS, user-scoped), OpenRouter structured outputs, standalone `test:unit` harness
(`tsc --ignoreConfig` — relative imports only, no `@/` aliases), Playwright E2E with
`page.route` stubbing (the `mockFoodAnalysis` precedent in `tests/e2e/food.spec.ts`).

## Spec

### Requirements

1. Pure module `src/lib/food/suggest/gaps.ts` (leaf, zero imports): gap computation from
   totals+water vs targets, meaningfulness thresholds, quantized cache-bucket key, and the
   local-date/local-hour helpers both client and server reuse. Registered in `test:unit`.
2. `src/lib/food/suggest/suggestSchema.ts`: `FoodSuggestion` type
   `{ title, description, approxNutrients (FoodNutrients shape), rationale }`, the strict
   OpenRouter JSON schema, and `validateFoodSuggestions(value: unknown)` cloning the
   `validateFoodAnalysisDraft` cleaning/throwing discipline. Registered in `test:unit`.
3. `src/lib/food/suggest/providers.ts`: mock provider for `FOOD_AI_PROVIDER=mock`,
   OpenRouter loop over `getOpenRouterFoodVisionModels()` with
   `shouldFallbackOpenRouterFoodModel`, 30 s `fetchWithTimeout`, coded errors reusing the
   existing `food_provider_timeout` / `food_provider_openrouter_<status>` /
   `food_provider_openrouter_exhausted` family (so the client's existing
   `foodAnalysisErrorMessage` mapping works unchanged).
4. Route `src/app/api/food/suggest/route.ts`: auth-gated POST `{ date }`; server
   recomputes gaps from `food_entries` + `water_entries` + `nutrition_target_profiles`
   via the user-scoped RLS client; returns `{ suggestions: [] , reason: 'food_suggest_no_gap' }`
   without any LLM call when gaps are below thresholds; `Sentry.captureException` + coded
   `reason` on failure (the `analyze-text` route pattern).
5. Food page: button under the target cards, bottom-sheet with suggestion cards, tap →
   prefill `mealText` (prefill ONLY — the user still presses Analyze; keeps the human in
   the loop and reuses the whole existing draft flow untouched).
6. Unit tests: gap computation + schema validator. One Playwright E2E with the route
   stubbed.

### Thresholds (concrete values — B5 gives examples, these are the recorded decision)

A gap is "meaningful" when ANY of: calories ≥ 300 kcal, protein ≥ 20 g, fiber ≥ 8 g,
water ≥ 500 ml remaining. Fat/carbs gaps are reported to the LLM for context but never
trigger the button by themselves. Button additionally requires local hour ≥ 15 and the
selected date to be today (you can't "close" a past day). The server enforces the gap
thresholds (the security-relevant part); the 15:00/today conditions are client UX only —
recorded decision, so a direct API call at 14:00 still works, which also keeps the E2E and
manual testing sane.

### Acceptance criteria

- `npx tsc --noEmit`, `npm run build`, `npm run test:unit` all pass
  (`test:correlation` untouched — no correlation files change).
- With targets configured and an empty diary at 16:00 local, the Food page shows
  «Чем закрыть день?»; tapping it opens a sheet with 2–3 suggestions; tapping a suggestion
  fills the meal-text input; Analyze produces a draft (existing flow).
- POST `/api/food/suggest` with a fully-logged day returns
  `{ suggestions: [], reason: 'food_suggest_no_gap' }` and makes no LLM call.
- Unauthenticated POST returns 401.

### Non-goals

- No `suggestion_feedback` 👍/👎 persistence (B5 marks it optional-later).
- No server-side response cache (B5: "no server cache needed at current scale").
- No auto-run of Analyze after prefill.
- No migration.

## Global Constraints (from the master plan — restated, binding)

- Branch: `codex/w2b-close-the-gap`, off fresh `origin/main` (post-Wave-1), after
  `bash scripts/git-state-check.sh`. Never push to `main`; end in a PR; DO NOT merge.
- TypeScript strict; no new `any`; `npx tsc --noEmit` after every `.ts/.tsx` change;
  no `console.log` in committed code; conventional commits.
- LLM discipline: OpenRouter structured `json_schema` → server-side validator → model
  fallback chain → coded `*_provider_*` errors → `Sentry.captureException`. Aggregates in
  (six gap numbers), never raw user rows.
- `test:unit` harness modules (`gaps.ts`, `suggestSchema.ts`) must use relative imports
  only (`tsc --ignoreConfig` resolves no `@/` aliases). `providers.ts` and the route are
  Next/tsc-only modules — aliases fine there.
- File ownership (matrix): this agent owns the new `src/app/api/food/suggest` route, the
  new `src/lib/food/suggest/*` modules, and the button+sheet edit in
  `src/app/app/food/page.tsx`. Touch nothing else.

## File Structure

- Create: `src/lib/food/suggest/gaps.ts` — pure gap math + tz helpers (zero imports).
- Create: `tests/unit/foodSuggestGaps.test.ts`
- Create: `src/lib/food/suggest/suggestSchema.ts` — types, JSON schema, validator.
- Create: `tests/unit/foodSuggestSchema.test.ts`
- Modify: `package.json` — register the four files in `test:unit`.
- Create: `src/lib/food/suggest/providers.ts` — mock + OpenRouter provider.
- Create: `src/app/api/food/suggest/route.ts`
- Modify: `src/app/app/food/page.tsx` — button, bottom-sheet, cache.
- Create: `tests/e2e/closeTheGap.spec.ts`

---

### Task 1: `gaps.ts` — pure gap math (leaf module) + unit tests

**Files:**
- Create: `src/lib/food/suggest/gaps.ts`
- Create: `tests/unit/foodSuggestGaps.test.ts`
- Modify: `package.json` (`test:unit` script)

**Interfaces:**
- Produces (consumed by Tasks 3–5):
  - `type NutrientGaps = { caloriesKcal: number; proteinG: number; fatG: number; carbsG: number; fiberG: number; waterMl: number }` (all ≥ 0, whole numbers)
  - `computeNutrientGaps(totals: { caloriesKcal?: number; proteinG?: number; totalFatG?: number; carbsG?: number; fiberG?: number }, waterTotalMl: number, targets: { caloriesKcal: number; proteinG: number; fatG: number; carbsG: number; fiberG: number; waterMl: number }): NutrientGaps`
    — the `totals` parameter shape is structurally satisfied by `FoodDailyTotals`
    (src/types/food.ts:77-79) and the `targets` shape by `NutritionTargetProfile`
    (fields `caloriesKcal/proteinG/fatG/carbsG/fiberG/waterMl`, all `number`).
  - `hasMeaningfulGaps(gaps: NutrientGaps): boolean`
  - `gapsBucket(gaps: NutrientGaps): string` — quantized cache key
  - `localDateForTimestamp(iso: string, timezone: string): string | null`
  - `localHourForTimestamp(iso: string, timezone: string): number | null`
  - constants `GAP_THRESHOLDS`, `SUGGEST_FROM_HOUR = 15`
- MUST have zero imports (leaf module for the `test:unit` tsc harness).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/foodSuggestGaps.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  computeNutrientGaps,
  gapsBucket,
  GAP_THRESHOLDS,
  hasMeaningfulGaps,
  localDateForTimestamp,
  localHourForTimestamp,
  SUGGEST_FROM_HOUR,
} from '../../src/lib/food/suggest/gaps';

const targets = {
  caloriesKcal: 2400,
  proteinG: 150,
  fatG: 80,
  carbsG: 250,
  fiberG: 35,
  waterMl: 2500,
};

test('gaps are target minus consumed, rounded, clamped at zero', () => {
  const gaps = computeNutrientGaps(
    { caloriesKcal: 1800.4, proteinG: 160, totalFatG: 50, carbsG: 200, fiberG: 20.6 },
    3000,
    targets,
  );
  assert.deepEqual(gaps, {
    caloriesKcal: 600, // 2400 - 1800.4 → 599.6 → rounds to 600
    proteinG: 0, // over target clamps to 0
    fatG: 30,
    carbsG: 50,
    fiberG: 14, // 35 - 20.6 = 14.4 → 14
    waterMl: 0, // over target clamps to 0
  });
});

test('missing totals count as zero consumed', () => {
  const gaps = computeNutrientGaps({}, 0, targets);
  assert.equal(gaps.caloriesKcal, 2400);
  assert.equal(gaps.proteinG, 150);
  assert.equal(gaps.waterMl, 2500);
});

test('hasMeaningfulGaps triggers on any single threshold', () => {
  const none = { caloriesKcal: 0, proteinG: 0, fatG: 0, carbsG: 0, fiberG: 0, waterMl: 0 };
  assert.equal(hasMeaningfulGaps(none), false);
  assert.equal(hasMeaningfulGaps({ ...none, caloriesKcal: GAP_THRESHOLDS.caloriesKcal }), true);
  assert.equal(hasMeaningfulGaps({ ...none, caloriesKcal: GAP_THRESHOLDS.caloriesKcal - 1 }), false);
  assert.equal(hasMeaningfulGaps({ ...none, proteinG: GAP_THRESHOLDS.proteinG }), true);
  assert.equal(hasMeaningfulGaps({ ...none, fiberG: GAP_THRESHOLDS.fiberG }), true);
  assert.equal(hasMeaningfulGaps({ ...none, waterMl: GAP_THRESHOLDS.waterMl }), true);
  // fat/carbs alone never trigger
  assert.equal(hasMeaningfulGaps({ ...none, fatG: 80, carbsG: 250 }), false);
});

test('gapsBucket is stable under small fluctuations and changes under big ones', () => {
  const a = gapsBucket({ caloriesKcal: 610, proteinG: 42, fatG: 12, carbsG: 55, fiberG: 11, waterMl: 740 });
  const b = gapsBucket({ caloriesKcal: 640, proteinG: 44, fatG: 14, carbsG: 61, fiberG: 12, waterMl: 790 });
  const c = gapsBucket({ caloriesKcal: 900, proteinG: 44, fatG: 14, carbsG: 61, fiberG: 12, waterMl: 790 });
  assert.equal(a, b);
  assert.notEqual(b, c);
});

test('localDateForTimestamp converts across timezones (midnight crossing)', () => {
  assert.equal(localDateForTimestamp('2026-07-01T22:30:00.000Z', 'UTC'), '2026-07-01');
  assert.equal(localDateForTimestamp('2026-07-01T22:30:00.000Z', 'Asia/Novosibirsk'), '2026-07-02');
  assert.equal(localDateForTimestamp('garbage', 'UTC'), null);
});

test('localHourForTimestamp returns the local hour', () => {
  assert.equal(localHourForTimestamp('2026-07-01T14:59:00.000Z', 'UTC'), 14);
  assert.equal(localHourForTimestamp('2026-07-01T12:30:00.000Z', 'Europe/Moscow'), 15);
  assert.equal(localHourForTimestamp('garbage', 'UTC'), null);
  assert.equal(SUGGEST_FROM_HOUR, 15);
});
```

- [ ] **Step 2: Verify the failing state**

Run:
```bash
cd "/Volumes/DATA/GRAVITY REPO/medremind-app" && npx tsc --ignoreConfig --target ES2020 --module Node16 --moduleResolution node16 --types node --strict --esModuleInterop --skipLibCheck --outDir .tmp/unit-probe --rootDir . --noEmit false tests/unit/foodSuggestGaps.test.ts; rm -rf .tmp/unit-probe
```
Expected: `error TS2307: Cannot find module '../../src/lib/food/suggest/gaps'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/food/suggest/gaps.ts
// Pure gap math for "Close the Gap" (B5). ZERO imports so the standalone
// test:unit harness (tsc --ignoreConfig, no path aliases) compiles it in
// isolation — the daySchedule.ts precedent. Used by BOTH the Food page
// (button visibility) and the /api/food/suggest route (authoritative
// server-side recomputation — the server never trusts client numbers).

export type NutrientGaps = {
  caloriesKcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
  fiberG: number;
  waterMl: number;
};

export const GAP_THRESHOLDS = {
  caloriesKcal: 300,
  proteinG: 20,
  fiberG: 8,
  waterMl: 500,
} as const;

/** Button becomes visible from this local hour ("after ~15:00", B5 spec). */
export const SUGGEST_FROM_HOUR = 15;

type GapTotals = {
  caloriesKcal?: number;
  proteinG?: number;
  totalFatG?: number;
  carbsG?: number;
  fiberG?: number;
};

type GapTargets = {
  caloriesKcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
  fiberG: number;
  waterMl: number;
};

function gap(target: number, consumed: number | undefined): number {
  const value = target - (typeof consumed === 'number' && Number.isFinite(consumed) ? consumed : 0);
  return Math.max(0, Math.round(value));
}

export function computeNutrientGaps(
  totals: GapTotals,
  waterTotalMl: number,
  targets: GapTargets,
): NutrientGaps {
  return {
    caloriesKcal: gap(targets.caloriesKcal, totals.caloriesKcal),
    proteinG: gap(targets.proteinG, totals.proteinG),
    fatG: gap(targets.fatG, totals.totalFatG),
    carbsG: gap(targets.carbsG, totals.carbsG),
    fiberG: gap(targets.fiberG, totals.fiberG),
    waterMl: gap(targets.waterMl, waterTotalMl),
  };
}

export function hasMeaningfulGaps(gaps: NutrientGaps): boolean {
  return (
    gaps.caloriesKcal >= GAP_THRESHOLDS.caloriesKcal ||
    gaps.proteinG >= GAP_THRESHOLDS.proteinG ||
    gaps.fiberG >= GAP_THRESHOLDS.fiberG ||
    gaps.waterMl >= GAP_THRESHOLDS.waterMl
  );
}

/**
 * Quantized cache key: small fluctuations (a sip of water) map to the same
 * bucket so the client component cache keeps serving one LLM response per
 * (date, bucket) pair.
 */
export function gapsBucket(gaps: NutrientGaps): string {
  const quantize = (value: number, step: number) => Math.round(value / step) * step;
  return [
    quantize(gaps.caloriesKcal, 200),
    quantize(gaps.proteinG, 15),
    quantize(gaps.fatG, 15),
    quantize(gaps.carbsG, 30),
    quantize(gaps.fiberG, 6),
    quantize(gaps.waterMl, 300),
  ].join(':');
}

function formatParts(iso: string, timezone: string): Map<string, string> | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date);
    return new Map(parts.map(part => [part.type, part.value]));
  } catch {
    return null;
  }
}

export function localDateForTimestamp(iso: string, timezone: string): string | null {
  const map = formatParts(iso, timezone);
  if (!map) return null;
  const year = map.get('year');
  const month = map.get('month');
  const day = map.get('day');
  return year && month && day ? `${year}-${month}-${day}` : null;
}

export function localHourForTimestamp(iso: string, timezone: string): number | null {
  const map = formatParts(iso, timezone);
  if (!map) return null;
  const hour = Number(map.get('hour'));
  return Number.isFinite(hour) ? hour : null;
}
```

- [ ] **Step 4: Register in `test:unit` and run**

In `package.json`'s `test:unit` script:
1. Append to the tsc file list: ` tests/unit/foodSuggestGaps.test.ts src/lib/food/suggest/gaps.ts`
2. Append to the run chain: ` && node .tmp/unit/tests/unit/foodSuggestGaps.test.js`

Run: `cd "/Volumes/DATA/GRAVITY REPO/medremind-app" && npm run test:unit && npx tsc --noEmit`
Expected: all tests pass (6 new), tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/food/suggest/gaps.ts tests/unit/foodSuggestGaps.test.ts package.json
git commit -m "feat: close-the-gap pure gap math (thresholds, bucket key, tz helpers)"
```

---

### Task 2: `suggestSchema.ts` — types, JSON schema, validator + unit tests

**Files:**
- Create: `src/lib/food/suggest/suggestSchema.ts`
- Create: `tests/unit/foodSuggestSchema.test.ts`
- Modify: `package.json` (`test:unit` script)

**Interfaces:**
- Consumes: `FoodNutrients` from `../../../types/food` (RELATIVE type-only import —
  `src/types/food.ts` is itself import-free, so the `--ignoreConfig` tsc harness compiles
  the graph; `@/types/food` would NOT resolve there).
- Produces (consumed by Tasks 3–5):
  - `type FoodSuggestion = { title: string; description: string; approxNutrients: FoodNutrients; rationale: string }`
  - `FOOD_SUGGEST_SCHEMA` — strict OpenRouter `json_schema` (same style as
    `FOOD_ANALYSIS_SCHEMA` in `src/lib/food/analyze/providers.ts:20-111`)
  - `validateFoodSuggestions(value: unknown): FoodSuggestion[]` — throws on garbage, drops
    invalid items, caps at 3 (the `validateFoodAnalysisDraft` discipline)
  - `FOOD_SUGGEST_SCHEMA_VERSION = 'food-suggest-v1'`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/foodSuggestSchema.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateFoodSuggestions } from '../../src/lib/food/suggest/suggestSchema';

const validSuggestion = {
  title: 'Творог с ягодами',
  description: '200 г творога 5% с горстью черники.',
  rationale: 'Закрывает ~30 г белка при умеренных калориях.',
  approxNutrients: {
    caloriesKcal: 280,
    proteinG: 34,
    totalFatG: 10,
    carbsG: 14,
    fiberG: 2,
  },
};

test('accepts a valid payload and cleans strings/numbers', () => {
  const suggestions = validateFoodSuggestions({
    suggestions: [
      {
        ...validSuggestion,
        title: '  Творог с ягодами  ',
        approxNutrients: { ...validSuggestion.approxNutrients, proteinG: '34' },
      },
    ],
  });
  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].title, 'Творог с ягодами');
  assert.equal(suggestions[0].approxNutrients.proteinG, 34);
});

test('drops items without title/description and keeps valid ones', () => {
  const suggestions = validateFoodSuggestions({
    suggestions: [validSuggestion, { title: '', description: 'x', rationale: '', approxNutrients: {} }],
  });
  assert.equal(suggestions.length, 1);
});

test('caps the list at 3 suggestions', () => {
  const suggestions = validateFoodSuggestions({
    suggestions: [validSuggestion, validSuggestion, validSuggestion, validSuggestion],
  });
  assert.equal(suggestions.length, 3);
});

test('negative and non-finite nutrient values are dropped', () => {
  const [suggestion] = validateFoodSuggestions({
    suggestions: [{
      ...validSuggestion,
      approxNutrients: { caloriesKcal: -5, proteinG: Number.NaN, fiberG: 4 },
    }],
  });
  assert.equal(suggestion.approxNutrients.caloriesKcal, undefined);
  assert.equal(suggestion.approxNutrients.proteinG, undefined);
  assert.equal(suggestion.approxNutrients.fiberG, 4);
});

test('throws when there are no valid suggestions', () => {
  assert.throws(() => validateFoodSuggestions({ suggestions: [] }));
  assert.throws(() => validateFoodSuggestions(null));
  assert.throws(() => validateFoodSuggestions({ suggestions: 'nope' }));
});
```

- [ ] **Step 2: Verify the failing state**

Run:
```bash
cd "/Volumes/DATA/GRAVITY REPO/medremind-app" && npx tsc --ignoreConfig --target ES2020 --module Node16 --moduleResolution node16 --types node --strict --esModuleInterop --skipLibCheck --outDir .tmp/unit-probe --rootDir . --noEmit false tests/unit/foodSuggestSchema.test.ts; rm -rf .tmp/unit-probe
```
Expected: `error TS2307: Cannot find module '../../src/lib/food/suggest/suggestSchema'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/food/suggest/suggestSchema.ts
// Validator + structured-output schema for "Close the Gap" suggestions.
// Clones the validateFoodAnalysisDraft discipline (src/lib/food/analysisSchema.ts):
// clean every field, drop invalid items, throw when nothing valid remains.
// RELATIVE type import on purpose: this module is registered in the
// standalone test:unit harness, which resolves no @/ path aliases.
import type { FoodNutrients } from '../../../types/food';

export const FOOD_SUGGEST_SCHEMA_VERSION = 'food-suggest-v1';
export const MAX_SUGGESTIONS = 3;

export type FoodSuggestion = {
  title: string;
  description: string;
  approxNutrients: FoodNutrients;
  rationale: string;
};

const NUTRIENT_KEYS = [
  'caloriesKcal',
  'proteinG',
  'totalFatG',
  'saturatedFatG',
  'transFatG',
  'carbsG',
  'fiberG',
  'sugarsG',
  'addedSugarsG',
  'sodiumMg',
  'cholesterolMg',
] as const;

const NUTRIENT_SCHEMA_PROPERTIES = Object.fromEntries(
  NUTRIENT_KEYS.map(key => [key, { type: ['number', 'null'] }]),
);

export const FOOD_SUGGEST_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['suggestions'],
  properties: {
    suggestions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'description', 'rationale', 'approxNutrients'],
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          rationale: { type: 'string' },
          approxNutrients: {
            type: 'object',
            additionalProperties: false,
            required: [...NUTRIENT_KEYS],
            properties: NUTRIENT_SCHEMA_PROPERTIES,
          },
        },
      },
    },
  },
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cleanString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function cleanNumber(value: unknown): number | undefined {
  const parsed =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim()) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return Math.round(parsed * 100) / 100;
}

function cleanNutrients(value: unknown): FoodNutrients {
  const source = isRecord(value) ? value : {};
  const nutrients: FoodNutrients = {};
  for (const key of NUTRIENT_KEYS) {
    const cleaned = cleanNumber(source[key]);
    if (cleaned !== undefined) nutrients[key] = cleaned;
  }
  return nutrients;
}

function cleanSuggestion(value: unknown): FoodSuggestion | null {
  if (!isRecord(value)) return null;
  const title = cleanString(value.title);
  const description = cleanString(value.description);
  if (!title || !description) return null;
  return {
    title,
    description,
    rationale: cleanString(value.rationale) ?? '',
    approxNutrients: cleanNutrients(value.approxNutrients),
  };
}

export function validateFoodSuggestions(value: unknown): FoodSuggestion[] {
  if (!isRecord(value) || !Array.isArray(value.suggestions)) {
    throw new Error('Food suggest response must contain a suggestions array.');
  }
  const suggestions = value.suggestions
    .map(cleanSuggestion)
    .filter((item): item is FoodSuggestion => item !== null)
    .slice(0, MAX_SUGGESTIONS);
  if (suggestions.length === 0) {
    throw new Error('Food suggest response must include at least one valid suggestion.');
  }
  return suggestions;
}
```

- [ ] **Step 4: Register in `test:unit` and run**

In `package.json`'s `test:unit` script:
1. Append to the tsc file list: ` tests/unit/foodSuggestSchema.test.ts src/lib/food/suggest/suggestSchema.ts`
2. Append to the run chain: ` && node .tmp/unit/tests/unit/foodSuggestSchema.test.js`

Run: `cd "/Volumes/DATA/GRAVITY REPO/medremind-app" && npm run test:unit && npx tsc --noEmit`
Expected: all tests pass (5 new), tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/food/suggest/suggestSchema.ts tests/unit/foodSuggestSchema.test.ts package.json
git commit -m "feat: close-the-gap suggestion schema + validator"
```

---

### Task 3: `providers.ts` — mock + OpenRouter provider

**Files:**
- Create: `src/lib/food/suggest/providers.ts`

**Interfaces:**
- Consumes: `getOpenRouterFoodVisionModels`, `shouldFallbackOpenRouterFoodModel` from
  `@/lib/food/analyze/openRouterModels` (env-pinned chain + terminal code-default —
  verified text-capable: `analyzeFoodText` already runs on the same chain);
  `validateFoodSuggestions`, `FOOD_SUGGEST_SCHEMA` from `./suggestSchema`;
  `NutrientGaps` from `./gaps`. Env: `FOOD_AI_PROVIDER`, `OPENROUTER_API_KEY`,
  `NEXT_PUBLIC_APP_URL` (same as `analyze/providers.ts`).
- Produces (consumed by Task 4):
  - `suggestFoodForGaps(gaps: NutrientGaps): Promise<{ suggestions: FoodSuggestion[]; model: string }>`
  - Throws coded errors: `food_provider_timeout`, `food_provider_openrouter_<status>`,
    `food_provider_openrouter_exhausted`, `food_suggest_provider_unsupported` — the first
    three deliberately reuse the analyze family so the client's existing
    `foodAnalysisErrorMessage` mapping (food/page.tsx:183-207) covers them.

- [ ] **Step 1: Write the module**

```ts
// src/lib/food/suggest/providers.ts
// Provider layer for "Close the Gap" (B5). Clones the analyzeFoodText
// discipline from src/lib/food/analyze/providers.ts: model fallback chain,
// coded food_provider_* errors, 30s timeout, structured json_schema output,
// server-side validator. Input is six aggregate gap numbers — never raw
// user rows.
import {
  getOpenRouterFoodVisionModels,
  shouldFallbackOpenRouterFoodModel,
} from '@/lib/food/analyze/openRouterModels';
import type { NutrientGaps } from './gaps';
import {
  FOOD_SUGGEST_SCHEMA,
  FOOD_SUGGEST_SCHEMA_VERSION,
  validateFoodSuggestions,
  type FoodSuggestion,
} from './suggestSchema';

const PROVIDER_TIMEOUT_MS = 30_000;

const SUGGEST_PROMPT = [
  'Ты — помощник по питанию. Пользователю осталось добрать до дневных целей',
  'нутриенты, перечисленные в JSON ниже (нулевые значения означают, что цель',
  'уже закрыта). Предложи 2-3 конкретных блюда или перекуса, реально',
  'закрывающих самые большие пробелы. Обычные продукты, без экзотики.',
  'Отвечай на русском. Верни ТОЛЬКО JSON по схеме. Никаких медицинских',
  'советов.',
].join(' ');

export type FoodSuggestResult = { suggestions: FoodSuggestion[]; model: string };

export async function suggestFoodForGaps(gaps: NutrientGaps): Promise<FoodSuggestResult> {
  const provider = process.env.FOOD_AI_PROVIDER;
  if (!provider || provider === 'mock') return mockSuggestions(gaps);
  if (provider !== 'openrouter') {
    // Production uses OpenRouter; other providers can be added when needed
    // (same stance as analyzeFoodText).
    throw new Error('food_suggest_provider_unsupported');
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is required for FOOD_AI_PROVIDER=openrouter.');

  const models = getOpenRouterFoodVisionModels();
  for (let index = 0; index < models.length; index += 1) {
    const model = models[index];
    const response = await fetchWithTimeout('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
        'X-Title': 'MedRemind',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SUGGEST_PROMPT },
          { role: 'user', content: JSON.stringify({ remainingToday: gaps }) },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'food_suggest', strict: true, schema: FOOD_SUGGEST_SCHEMA },
        },
      }),
    });
    if (!response.ok) {
      if (shouldFallbackOpenRouterFoodModel(response.status, model, models[index + 1])) continue;
      throw new Error(`food_provider_openrouter_${response.status}`);
    }
    const payload = await response.json();
    const outputText = payload?.choices?.[0]?.message?.content;
    if (typeof outputText !== 'string' || outputText.trim().length === 0) {
      throw new Error('Food suggest returned no structured output.');
    }
    return { suggestions: validateFoodSuggestions(parseStructuredOutput(outputText)), model };
  }
  throw new Error('food_provider_openrouter_exhausted');
}

function mockSuggestions(gaps: NutrientGaps): FoodSuggestResult {
  const suggestions = validateFoodSuggestions({
    suggestions: [
      {
        title: 'Творог с ягодами',
        description: '200 г творога 5% с горстью черники.',
        rationale: `Закрывает ~34 г из ${gaps.proteinG} г недостающего белка.`,
        approxNutrients: { caloriesKcal: 280, proteinG: 34, totalFatG: 10, carbsG: 14, fiberG: 2 },
      },
      {
        title: 'Чечевичный суп',
        description: 'Тарелка чечевичного супа с цельнозерновым хлебом.',
        rationale: `Даёт ~12 г клетчатки из недостающих ${gaps.fiberG} г.`,
        approxNutrients: { caloriesKcal: 350, proteinG: 18, totalFatG: 6, carbsG: 52, fiberG: 12 },
      },
    ],
  });
  return { suggestions, model: `mock-${FOOD_SUGGEST_SCHEMA_VERSION}` };
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === 'AbortError' || error.name === 'TimeoutError')
    ) {
      throw new Error('food_provider_timeout');
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function parseStructuredOutput(outputText: string): unknown {
  const trimmed = outputText.trim();
  const fencedMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return JSON.parse(fencedMatch ? fencedMatch[1] : trimmed);
}
```

- [ ] **Step 2: Type-check**

Run: `cd "/Volumes/DATA/GRAVITY REPO/medremind-app" && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/lib/food/suggest/providers.ts
git commit -m "feat: close-the-gap OpenRouter provider with analyze-grade fallback discipline"
```

---

### Task 4: `/api/food/suggest` route — server-side gap recomputation

**Files:**
- Create: `src/app/api/food/suggest/route.ts`

**Interfaces:**
- Consumes: `createClient` from `@/lib/supabase/server` (user-scoped RLS client — same as
  `analyze-text/route.ts`); `computeNutrientGaps`, `hasMeaningfulGaps`,
  `localDateForTimestamp` from `@/lib/food/suggest/gaps`; `suggestFoodForGaps` from
  `@/lib/food/suggest/providers`; `Sentry` from `@sentry/nextjs`.
- DB reads (all owner-RLS'd): `profiles.timezone`;
  `nutrition_target_profiles(calories_kcal, protein_g, fat_g, carbs_g, fiber_g, water_ml)`
  (columns per `supabase/006`, unique per user);
  `food_entries(consumed_at, timezone, calories_kcal, protein_g, total_fat_g, carbs_g, fiber_g)`;
  `water_entries(consumed_at, timezone, amount_ml)`.
- Produces: `POST { date: 'YYYY-MM-DD' }` →
  - 401 `{ error: 'Unauthorized' }` without a session;
  - 400 `{ error, reason: 'food_suggest_bad_date' }` on a malformed date;
  - 400 `{ error, reason: 'food_suggest_no_targets' }` when no target profile exists;
  - 200 `{ suggestions: [], reason: 'food_suggest_no_gap' }` when server-computed gaps are
    below thresholds (NO LLM call — this is the "only fires when gaps ≥ thresholds" rule);
  - 200 `{ suggestions, gaps, model }` on success;
  - 502 `{ error: 'Food suggest failed.', reason }` on provider failure (Sentry-captured).

- [ ] **Step 1: Write the route**

```ts
// src/app/api/food/suggest/route.ts
import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import {
  computeNutrientGaps,
  hasMeaningfulGaps,
  localDateForTimestamp,
} from '@/lib/food/suggest/gaps';
import { suggestFoodForGaps } from '@/lib/food/suggest/providers';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type Row = Record<string, unknown>;

function addDays(localDate: string, days: number): string {
  const date = new Date(`${localDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function toNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function rowsForLocalDate(rows: Row[], date: string, fallbackTimezone: string): Row[] {
  return rows.filter(row => {
    if (typeof row.consumed_at !== 'string') return false;
    const timezone =
      typeof row.timezone === 'string' && row.timezone.trim().length > 0
        ? row.timezone
        : fallbackTimezone;
    return localDateForTimestamp(row.consumed_at, timezone) === date;
  });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let date: unknown;
  try {
    ({ date } = await request.json());
  } catch {
    return NextResponse.json(
      { error: 'A date is required.', reason: 'food_suggest_bad_date' },
      { status: 400 },
    );
  }
  if (typeof date !== 'string' || !DATE_RE.test(date)) {
    return NextResponse.json(
      { error: 'A date is required.', reason: 'food_suggest_bad_date' },
      { status: 400 },
    );
  }

  try {
    // The server is the authority on gaps: recompute everything from DB rows
    // via the user-scoped RLS client. Client numbers are never accepted.
    const fromIso = `${addDays(date, -1)}T00:00:00.000Z`;
    const toIso = `${addDays(date, 1)}T23:59:59.999Z`;

    const [profileResult, targetsResult, foodResult, waterResult] = await Promise.all([
      supabase.from('profiles').select('timezone').eq('id', auth.user.id).maybeSingle(),
      supabase
        .from('nutrition_target_profiles')
        .select('calories_kcal, protein_g, fat_g, carbs_g, fiber_g, water_ml')
        .eq('user_id', auth.user.id)
        .maybeSingle(),
      supabase
        .from('food_entries')
        .select('consumed_at, timezone, calories_kcal, protein_g, total_fat_g, carbs_g, fiber_g')
        .eq('user_id', auth.user.id)
        .gte('consumed_at', fromIso)
        .lte('consumed_at', toIso),
      supabase
        .from('water_entries')
        .select('consumed_at, timezone, amount_ml')
        .eq('user_id', auth.user.id)
        .gte('consumed_at', fromIso)
        .lte('consumed_at', toIso),
    ]);

    if (targetsResult.error) throw targetsResult.error;
    if (foodResult.error) throw foodResult.error;
    if (waterResult.error) throw waterResult.error;

    const targetsRow = targetsResult.data as Row | null;
    if (!targetsRow) {
      return NextResponse.json(
        { error: 'Nutrition targets are not configured.', reason: 'food_suggest_no_targets' },
        { status: 400 },
      );
    }

    const timezone =
      typeof (profileResult.data as Row | null)?.timezone === 'string'
        ? String((profileResult.data as Row).timezone)
        : 'UTC';

    const foodRows = rowsForLocalDate((foodResult.data as Row[] | null) ?? [], date, timezone);
    const waterRows = rowsForLocalDate((waterResult.data as Row[] | null) ?? [], date, timezone);

    const totals = {
      caloriesKcal: foodRows.reduce((sum, row) => sum + toNumber(row.calories_kcal), 0),
      proteinG: foodRows.reduce((sum, row) => sum + toNumber(row.protein_g), 0),
      totalFatG: foodRows.reduce((sum, row) => sum + toNumber(row.total_fat_g), 0),
      carbsG: foodRows.reduce((sum, row) => sum + toNumber(row.carbs_g), 0),
      fiberG: foodRows.reduce((sum, row) => sum + toNumber(row.fiber_g), 0),
    };
    const waterTotalMl = waterRows.reduce((sum, row) => sum + toNumber(row.amount_ml), 0);

    const gaps = computeNutrientGaps(totals, waterTotalMl, {
      caloriesKcal: toNumber(targetsRow.calories_kcal),
      proteinG: toNumber(targetsRow.protein_g),
      fatG: toNumber(targetsRow.fat_g),
      carbsG: toNumber(targetsRow.carbs_g),
      fiberG: toNumber(targetsRow.fiber_g),
      waterMl: toNumber(targetsRow.water_ml),
    });

    if (!hasMeaningfulGaps(gaps)) {
      return NextResponse.json({ suggestions: [], gaps, reason: 'food_suggest_no_gap' });
    }

    const result = await suggestFoodForGaps(gaps);
    return NextResponse.json({ suggestions: result.suggestions, gaps, model: result.model });
  } catch (err) {
    Sentry.captureException(err);
    const reason = err instanceof Error && /^food_/.test(err.message) ? err.message : 'unknown';
    return NextResponse.json({ error: 'Food suggest failed.', reason }, { status: 502 });
  }
}
```

- [ ] **Step 2: Type-check and build**

Run: `cd "/Volumes/DATA/GRAVITY REPO/medremind-app" && npx tsc --noEmit && npm run build`
Expected: both clean; the build output lists `ƒ /api/food/suggest`.

- [ ] **Step 3: Smoke-check auth gating (no dev creds needed)**

Run (with the dev server from `.claude/launch.json` running, or skip if none):
```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/food/suggest -H 'Content-Type: application/json' -d '{"date":"2026-07-18"}'
```
Expected: `401`.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/food/suggest/route.ts
git commit -m "feat: /api/food/suggest route with server-side gap recomputation"
```

---

### Task 5: Food page — button, bottom-sheet, prefill, client cache

**Files:**
- Modify: `src/app/app/food/page.tsx`

**Interfaces:**
- Consumes: `computeNutrientGaps`, `hasMeaningfulGaps`, `gapsBucket`,
  `localHourForTimestamp`, `SUGGEST_FROM_HOUR` from `@/lib/food/suggest/gaps`;
  `type FoodSuggestion` from `@/lib/food/suggest/suggestSchema`; existing page state
  (`totals`, `waterTotal`, `targetProfile`, `activeDate`, `today`, `timezone`,
  `setMealText`, `foodAnalysisErrorMessage`).
- Produces: «Чем закрыть день?» button inside the `{targetProfile && …}` fragment directly
  after `<WaterTracker />`; a bottom-sheet listing suggestions; tap → `setMealText(...)`
  (prefill only — Analyze stays a user action).

- [ ] **Step 1: Add imports and state**

Add to the imports (after the `scaleNutrients` import):

```tsx
import {
  computeNutrientGaps,
  gapsBucket,
  hasMeaningfulGaps,
  localHourForTimestamp,
  SUGGEST_FROM_HOUR,
} from '@/lib/food/suggest/gaps';
import type { FoodSuggestion } from '@/lib/food/suggest/suggestSchema';
```

Inside `FoodPage()`, after `const [confirmDeleteEntry, setConfirmDeleteEntry] = useState<FoodEntry | null>(null);` add:

```tsx
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<FoodSuggestion[]>([]);
  const suggestCache = useRef(new Map<string, FoodSuggestion[]>());
```

- [ ] **Step 2: Add derived visibility + fetch handler**

After the `const shouldShowSetup = ...` line (post-W1-B this area also holds the
eating-window memos; order among them does not matter) add:

```tsx
  const gaps = useMemo(
    () =>
      targetProfile
        ? computeNutrientGaps(totals, waterTotal, {
            caloriesKcal: targetProfile.caloriesKcal,
            proteinG: targetProfile.proteinG,
            fatG: targetProfile.fatG,
            carbsG: targetProfile.carbsG,
            fiberG: targetProfile.fiberG,
            waterMl: targetProfile.waterMl,
          })
        : null,
    [targetProfile, totals, waterTotal],
  );
  const localHour = localHourForTimestamp(new Date().toISOString(), timezone);
  const showSuggestButton = Boolean(
    gaps &&
      hasMeaningfulGaps(gaps) &&
      activeDate === today &&
      localHour !== null &&
      localHour >= SUGGEST_FROM_HOUR,
  );

  async function openSuggestions() {
    if (!gaps || suggestLoading) return; // in-flight guard = debounce
    const cacheKey = `${activeDate}:${gapsBucket(gaps)}`;
    const cached = suggestCache.current.get(cacheKey);
    if (cached) {
      setSuggestions(cached);
      setSuggestError(null);
      setSuggestOpen(true);
      return;
    }
    setSuggestLoading(true);
    setSuggestError(null);
    setSuggestions([]);
    setSuggestOpen(true);
    try {
      const response = await fetch('/api/food/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: activeDate }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !Array.isArray(payload?.suggestions)) {
        setSuggestError(foodAnalysisErrorMessage(payload?.reason, 'text'));
        return;
      }
      const nextSuggestions = payload.suggestions as FoodSuggestion[];
      suggestCache.current.set(cacheKey, nextSuggestions);
      setSuggestions(nextSuggestions);
    } catch {
      setSuggestError(foodAnalysisErrorMessage(null, 'text'));
    } finally {
      setSuggestLoading(false);
    }
  }

  function applySuggestion(suggestion: FoodSuggestion) {
    setMealText(`${suggestion.title}. ${suggestion.description}`);
    setSuggestOpen(false);
  }
```

- [ ] **Step 3: Render the button**

Inside the `{targetProfile && ( <> … </> )}` fragment, directly AFTER `<WaterTracker … />`
(and BEFORE the fragment's closing `</>` — the W1-B `EatingWindowCard` lives after the
fragment and is untouched), add:

```tsx
            {showSuggestButton && (
              <button
                type="button"
                onClick={() => void openSuggestions()}
                disabled={suggestLoading}
                className="mt-2 w-full rounded-xl border border-[rgba(16,185,129,0.28)] bg-[rgba(16,185,129,0.08)] px-3 py-2.5 text-sm font-bold text-[#34D399] disabled:opacity-60"
              >
                {suggestLoading ? 'Подбираем…' : 'Чем закрыть день?'}
              </button>
            )}
```

- [ ] **Step 4: Render the bottom-sheet**

Directly before the existing `{confirmDeleteEntry && (` block near the end of the main
return, add (same modal pattern as the delete confirmation, food/page.tsx:984-1007):

```tsx
      {suggestOpen && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/60 px-5 pb-5">
          <div className="w-full max-w-[390px] rounded-2xl border border-[rgba(16,185,129,0.28)] bg-[#161B22] p-4 shadow-2xl">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-base font-bold text-[#F0F6FC]">Чем закрыть день?</h2>
              <button
                type="button"
                onClick={() => setSuggestOpen(false)}
                className="rounded-xl bg-[#30363D] px-3 py-1.5 text-xs font-bold text-[#F0F6FC]"
              >
                Close
              </button>
            </div>
            {suggestLoading && (
              <div className="flex items-center gap-2 py-4 text-xs font-medium text-[#8B949E]">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#10B981] border-t-transparent" />
                Подбираем варианты…
              </div>
            )}
            {suggestError && (
              <div className="rounded-xl border border-[rgba(248,81,73,0.35)] bg-[rgba(248,81,73,0.1)] px-3 py-2 text-xs font-medium text-[#FCA5A5]">
                {suggestError}
              </div>
            )}
            {!suggestLoading && !suggestError && suggestions.length === 0 && (
              <div className="py-4 text-xs text-[#8B949E]">Сегодня все цели уже закрыты.</div>
            )}
            <div className="max-h-[50vh] space-y-2 overflow-y-auto">
              {suggestions.map((suggestion, index) => (
                <button
                  key={`${suggestion.title}-${index}`}
                  type="button"
                  onClick={() => applySuggestion(suggestion)}
                  className="w-full rounded-xl bg-[#0D1117] px-3 py-2.5 text-left"
                >
                  <div className="text-sm font-bold text-[#F0F6FC]">{suggestion.title}</div>
                  <div className="mt-0.5 text-xs text-[#C9D1D9]">{suggestion.description}</div>
                  <div className="mt-1 flex flex-wrap gap-2 text-[10px] font-semibold text-[#8B949E]">
                    {typeof suggestion.approxNutrients.caloriesKcal === 'number' && (
                      <span>{Math.round(suggestion.approxNutrients.caloriesKcal)} kcal</span>
                    )}
                    {typeof suggestion.approxNutrients.proteinG === 'number' && (
                      <span>{Math.round(suggestion.approxNutrients.proteinG)} g protein</span>
                    )}
                    {typeof suggestion.approxNutrients.fiberG === 'number' && (
                      <span>{Math.round(suggestion.approxNutrients.fiberG)} g fiber</span>
                    )}
                  </div>
                  {suggestion.rationale && (
                    <div className="mt-1 text-[10px] text-[#8B949E]">{suggestion.rationale}</div>
                  )}
                </button>
              ))}
            </div>
            <div className="mt-3 text-[10px] text-[#8B949E]">
              Нажмите вариант — он подставится в поле описания еды, дальше обычный Analyze → Save.
            </div>
          </div>
        </div>
      )}
```

- [ ] **Step 5: Verify**

Run: `cd "/Volumes/DATA/GRAVITY REPO/medremind-app" && npx tsc --noEmit && npm run build`
Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add src/app/app/food/page.tsx
git commit -m "feat: close-the-gap button + suggestion bottom-sheet on Food page"
```

---

### Task 6: Playwright E2E (stubbed route), full gates, PR

**Files:**
- Create: `tests/e2e/closeTheGap.spec.ts`

**Interfaces:**
- Consumes: the `page.route` stub pattern (`mockFoodAnalysis` precedent,
  `tests/e2e/food.spec.ts:356-374`), the env-gated login pattern, an authenticated
  anon-key Supabase client for seeding `nutrition_target_profiles` (RLS policy is owner
  ALL per `supabase/006`, so upsert works), and `page.clock.setFixedTime` to pin local
  time at 16:00 (fakes `Date` only — app timers keep running, so sync/boot are unaffected).

- [ ] **Step 1: Write the spec**

```ts
// tests/e2e/closeTheGap.spec.ts
import { expect, test, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const e2eEmail = process.env.E2E_EMAIL;
const e2ePassword = process.env.E2E_PASSWORD;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const hasE2eEnv = Boolean(e2eEmail && e2ePassword && supabaseUrl && supabaseAnonKey);

const SUGGESTION_TITLE = 'E2E Suggest Bowl';

const stubSuggestions = {
  suggestions: [
    {
      title: SUGGESTION_TITLE,
      description: 'A protein bowl to close the day.',
      rationale: 'Closes most of the remaining protein.',
      approxNutrients: { caloriesKcal: 420, proteinG: 38, fiberG: 9 },
    },
  ],
  gaps: { caloriesKcal: 2000, proteinG: 140, fatG: 70, carbsG: 220, fiberG: 30, waterMl: 2000 },
  model: 'e2e-stub',
};

const stubDraft = {
  title: SUGGESTION_TITLE,
  summary: 'A protein bowl to close the day.',
  mealLabel: 'dinner',
  components: [
    { name: 'Protein bowl', category: 'mixed', estimatedQuantity: 1, estimatedUnit: 'bowl', gramsEstimate: 350, confidence: 0.9 },
  ],
  nutrients: { caloriesKcal: 420, proteinG: 38, totalFatG: 12, carbsG: 40, fiberG: 9 },
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

async function seedTargetProfile() {
  const supabase = createClient(supabaseUrl!, supabaseAnonKey!);
  const { data: auth, error: signInError } = await supabase.auth.signInWithPassword({
    email: e2eEmail!,
    password: e2ePassword!,
  });
  if (signInError || !auth.user) throw signInError ?? new Error('no user');
  const { error } = await supabase.from('nutrition_target_profiles').upsert(
    {
      user_id: auth.user.id,
      age_years: 35,
      sex: 'male',
      weight_kg: 80,
      height_cm: 180,
      activity_level: 'moderate',
      body_fat_range: 'unknown',
      goal_mode: 'stabilization',
      calories_kcal: 2400,
      protein_g: 150,
      fat_g: 80,
      carbs_g: 250,
      fiber_g: 35,
      water_ml: 2500,
      algorithm_version: 'e2e',
    },
    { onConflict: 'user_id' },
  );
  if (error) throw error;
  await supabase.auth.signOut();
}

test.describe('close the gap', () => {
  test.skip(!hasE2eEnv, 'E2E credentials are not configured');

  test('button opens stubbed suggestions and a tap prefills the analyze input', async ({
    page,
  }) => {
    await seedTargetProfile();

    // Pin local time to 16:00 today so the ≥15:00 visibility gate passes.
    const fixed = new Date();
    fixed.setHours(16, 0, 0, 0);
    await page.clock.setFixedTime(fixed);

    await page.route('**/api/food/suggest', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(stubSuggestions),
      });
    });
    await page.route('**/api/food/analyze-text', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ draft: stubDraft }),
      });
    });

    await login(page);
    await page.goto('/app/food');
    await expect(page.getByRole('heading', { name: 'Food' })).toBeVisible();

    const suggestButton = page.getByRole('button', { name: 'Чем закрыть день?' });
    await expect(suggestButton).toBeVisible();
    await suggestButton.click();

    await expect(page.getByRole('heading', { name: 'Чем закрыть день?' })).toBeVisible();
    await page.getByRole('button', { name: new RegExp(SUGGESTION_TITLE) }).click();

    // Prefill only — the input holds the text, Analyze is still a user action.
    await expect(page.getByLabel('Describe your meal')).toHaveValue(
      `${SUGGESTION_TITLE}. A protein bowl to close the day.`,
    );

    await page.getByRole('button', { name: 'Analyze' }).click();
    await expect(page.getByRole('heading', { name: SUGGESTION_TITLE })).toBeVisible();

    // Cancel the draft — nothing persisted, nothing to clean up.
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByRole('heading', { name: SUGGESTION_TITLE })).toBeHidden();
  });
});
```

- [ ] **Step 2: Run it (creds-gated)**

Run:
```bash
cd "/Volumes/DATA/GRAVITY REPO/medremind-app" && set -a && source .env.local && set +a && npx playwright test tests/e2e/closeTheGap.spec.ts
```
Expected: 1 passed (or skipped without creds; never red for missing env).

- [ ] **Step 3: Full local gate**

Run:
```bash
cd "/Volumes/DATA/GRAVITY REPO/medremind-app" && npx tsc --noEmit && npm run test:unit && npm run build
```
Expected: all pass. `test:correlation` not required (no correlation files touched), but
running it is harmless. Also: `rg -n "console\.log" src/lib/food/suggest src/app/api/food/suggest src/app/app/food/page.tsx` — expected: no hits.

- [ ] **Step 4: Push and open PR (do NOT merge)**

```bash
git push -u origin codex/w2b-close-the-gap
gh pr create --base main --title "feat: close the gap (B5) — LLM meal suggestions from remaining daily targets" --body "Implements docs/superpowers/plans/2026-07-18-close-the-gap.md (W2-B). New /api/food/suggest route recomputes gaps server-side (never trusts the client) and only calls the LLM when gaps ≥ thresholds; provider clones the analyze fallback/coded-error/timeout discipline; Food page button + bottom-sheet prefills the existing text-analyze flow. No migration, nothing persisted. Test evidence: test:unit (11 new), 1 Playwright E2E with stubbed route."
```

STOP after opening the PR. The owner merges (merge = production deploy).

## Self-review checklist (author-verified)

- Every B5 spec requirement maps to a task: server recompute + threshold gate (T4), schema
  validator discipline (T2), provider fallback/coded-errors/Sentry/30s (T3 + T4 Sentry),
  button + sheet + prefill into analyze-text (T5), debounce + (date,bucket) cache (T5),
  unit tests for gaps + validator (T1/T2), stubbed-route E2E (T6). `suggestion_feedback`
  is a recorded non-goal per spec.
- Reused error-code family verified against `foodAnalysisErrorMessage`
  (food/page.tsx:183-207) so client copy needs no new mapping.
- Column names verified against real migrations: `nutrition_target_profiles`
  (006: calories_kcal…water_ml), `food_entries` (foodSync.ts `nutrientsFromRow`:
  calories_kcal/protein_g/total_fat_g/carbs_g/fiber_g), `water_entries` (006: amount_ml).
- W1-B coexistence stated explicitly; insertion anchors (`WaterTracker`,
  `confirmDeleteEntry` block) are untouched by W1-B's diff.
- No placeholders; all commands runnable from repo root with the quoted path.
