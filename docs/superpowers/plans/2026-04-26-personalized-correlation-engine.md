# Personalized Correlation Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a 30-90 day personalized correlation engine that compares medication adherence, food, water, activity, sleep, stress, and recovery signals, then produces explainable lifestyle insights and clinician-review medication flags.

**Architecture:** Add a server-side analytics layer that normalizes existing MedRemind records and Oura-derived daily metrics into day-level feature vectors, computes conservative correlations and confidence bands, stores generated insight cards, and exposes them through a guarded `/app/insights` surface. Medication-related output must never tell the user to stop, pause, reschedule, or dose-adjust a medication; it may only identify a pattern worth reviewing with a clinician.

**Tech Stack:** Next.js App Router, TypeScript, Supabase Postgres, existing food/hydration/protocol tables, Oura daily API data, Node `node:test` for focused logic tests, no new runtime dependencies.

---

## Safety Boundary

This implementation must not generate direct medication-change instructions. The engine can say:

- "This pattern may be worth discussing with your clinician."
- "Do not change medication timing or dosage without medical guidance."
- "Consider tracking whether this repeats."

The engine must not say:

- "Stop this medication."
- "Pause this medication for a few days."
- "Move this prescription to the evening."
- "Reduce or increase dosage."

The code must enforce this boundary with typed recommendation categories and tests that fail if medication-change action verbs appear in user-facing recommendation text.

## File Structure

- Create `supabase/008_correlation_insights.sql`: consent, daily feature snapshots, correlation insight cards.
- Create `src/lib/correlation/types.ts`: data contracts for feature vectors, correlations, and insight cards.
- Create `src/lib/correlation/stats.ts`: dependency-free statistics helpers.
- Create `src/lib/correlation/medicationSafety.ts`: blocked medication action classifier and sanitizer.
- Create `src/lib/correlation/featureBuilder.ts`: converts MedRemind/Oura rows into daily feature vectors.
- Create `src/lib/correlation/engine.ts`: computes correlations and generates insight cards.
- Create `src/lib/correlation/persistence.ts`: Supabase service-role persistence for snapshots and cards.
- Create `src/app/api/insights/correlations/route.ts`: authenticated API for reading/generating insight cards.
- Create `src/app/app/insights/page.tsx`: user-facing insight dashboard.
- Modify `src/components/app/BottomNav.tsx`: add Insights navigation item.
- Modify `README.md`: document migration, safety boundary, and Oura data requirements.

---

### Task 1: Supabase Schema for Consent, Snapshots, and Insight Cards

**Files:**
- Create: `supabase/008_correlation_insights.sql`

- [ ] **Step 1: Write the migration**

```sql
-- MedRemind - Personalized correlation insights
-- Stores explicit consent, daily normalized analytics snapshots, and generated insight cards.

create table if not exists correlation_consents (
  user_id uuid primary key references profiles(id) on delete cascade,
  enabled boolean not null default false,
  includes_medication_patterns boolean not null default false,
  includes_oura_data boolean not null default false,
  acknowledged_no_med_changes boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table correlation_consents enable row level security;

drop policy if exists "Owner access" on correlation_consents;
create policy "Owner access" on correlation_consents
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop trigger if exists correlation_consents_updated_at on correlation_consents;
create trigger correlation_consents_updated_at
  before update on correlation_consents
  for each row execute function public.set_updated_at();

create table if not exists daily_lifestyle_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  local_date date not null,
  timezone text not null default 'UTC',
  medication_adherence_ratio numeric,
  medication_taken_count int not null default 0,
  medication_missed_count int not null default 0,
  calories_kcal int,
  protein_g numeric,
  carbs_g numeric,
  fat_g numeric,
  fiber_g numeric,
  water_ml int,
  oura_sleep_score int,
  oura_readiness_score int,
  oura_activity_score int,
  oura_stress_high_seconds int,
  oura_recovery_high_seconds int,
  oura_steps int,
  oura_active_calories int,
  oura_total_calories int,
  oura_spo2_avg numeric,
  oura_breathing_disturbance_index int,
  oura_resilience_level text,
  oura_vo2_max numeric,
  source_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint daily_lifestyle_snapshots_user_date_key unique (user_id, local_date)
);

alter table daily_lifestyle_snapshots enable row level security;

drop policy if exists "Owner read own snapshots" on daily_lifestyle_snapshots;
create policy "Owner read own snapshots" on daily_lifestyle_snapshots
  for select using (auth.uid() = user_id);

create index if not exists idx_daily_lifestyle_snapshots_user_date
  on daily_lifestyle_snapshots(user_id, local_date desc);

drop trigger if exists daily_lifestyle_snapshots_updated_at on daily_lifestyle_snapshots;
create trigger daily_lifestyle_snapshots_updated_at
  before update on daily_lifestyle_snapshots
  for each row execute function public.set_updated_at();

create table if not exists correlation_insight_cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  window_days int not null check (window_days in (30, 60, 90)),
  category text not null check (category in (
    'sleep',
    'nutrition',
    'hydration',
    'activity',
    'stress',
    'medication_review'
  )),
  severity text not null check (severity in ('info', 'watch', 'review')),
  title text not null,
  body text not null,
  evidence jsonb not null default '{}'::jsonb,
  recommendation_kind text not null check (recommendation_kind in (
    'lifestyle_adjustment',
    'tracking_prompt',
    'clinician_review'
  )),
  generated_at timestamptz not null default now(),
  dismissed_at timestamptz,
  constraint correlation_insight_cards_no_direct_med_action
    check (recommendation_kind <> 'clinician_review' or category = 'medication_review')
);

alter table correlation_insight_cards enable row level security;

drop policy if exists "Owner access" on correlation_insight_cards;
create policy "Owner access" on correlation_insight_cards
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists idx_correlation_insight_cards_user_generated
  on correlation_insight_cards(user_id, generated_at desc);
```

- [ ] **Step 2: Apply migration in a safe environment**

Run:

```bash
# Paste supabase/008_correlation_insights.sql into the Supabase SQL editor for the target environment.
# Do not run on production before applying it to a staging project.
```

Expected: SQL completes without errors and creates `correlation_consents`, `daily_lifestyle_snapshots`, and `correlation_insight_cards`.

- [ ] **Step 3: Commit migration**

```bash
git add supabase/008_correlation_insights.sql
git commit -m "feat: add correlation insight schema"
```

---

### Task 2: Core Types and Statistics Helpers

**Files:**
- Create: `src/lib/correlation/types.ts`
- Create: `src/lib/correlation/stats.ts`
- Test: `src/lib/correlation/stats.test.mjs`

- [ ] **Step 1: Write the failing stats test**

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { pearsonCorrelation, rankByAbsoluteCorrelation } from './stats.ts';

test('pearsonCorrelation returns a strong positive correlation for aligned values', () => {
  assert.equal(pearsonCorrelation([1, 2, 3, 4], [2, 4, 6, 8]), 1);
});

test('pearsonCorrelation returns null when there are fewer than 4 paired values', () => {
  assert.equal(pearsonCorrelation([1, 2, 3], [3, 2, 1]), null);
});

test('rankByAbsoluteCorrelation sorts by strongest absolute value first', () => {
  assert.deepEqual(
    rankByAbsoluteCorrelation([
      { feature: 'sleep', outcome: 'adherence', r: -0.2, n: 30 },
      { feature: 'stress', outcome: 'adherence', r: -0.61, n: 30 },
      { feature: 'water', outcome: 'readiness', r: 0.44, n: 30 },
    ]).map((row) => row.feature),
    ['stress', 'water', 'sleep'],
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --experimental-strip-types --test src/lib/correlation/stats.test.mjs
```

Expected: FAIL with module not found for `src/lib/correlation/stats.ts`.

- [ ] **Step 3: Add types**

```ts
export type CorrelationFeatureName =
  | 'medication_adherence_ratio'
  | 'calories_kcal'
  | 'protein_g'
  | 'carbs_g'
  | 'fat_g'
  | 'fiber_g'
  | 'water_ml'
  | 'oura_sleep_score'
  | 'oura_readiness_score'
  | 'oura_activity_score'
  | 'oura_stress_high_seconds'
  | 'oura_recovery_high_seconds'
  | 'oura_steps'
  | 'oura_active_calories'
  | 'oura_spo2_avg'
  | 'oura_vo2_max';

export type DailyLifestyleSnapshot = {
  localDate: string;
  medicationAdherenceRatio: number | null;
  caloriesKcal: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  fiberG: number | null;
  waterMl: number | null;
  ouraSleepScore: number | null;
  ouraReadinessScore: number | null;
  ouraActivityScore: number | null;
  ouraStressHighSeconds: number | null;
  ouraRecoveryHighSeconds: number | null;
  ouraSteps: number | null;
  ouraActiveCalories: number | null;
  ouraSpo2Avg: number | null;
  ouraVo2Max: number | null;
};

export type CorrelationResult = {
  feature: CorrelationFeatureName;
  outcome: CorrelationFeatureName;
  r: number;
  n: number;
};

export type CorrelationInsightCategory =
  | 'sleep'
  | 'nutrition'
  | 'hydration'
  | 'activity'
  | 'stress'
  | 'medication_review';

export type CorrelationRecommendationKind =
  | 'lifestyle_adjustment'
  | 'tracking_prompt'
  | 'clinician_review';

export type CorrelationInsightCard = {
  category: CorrelationInsightCategory;
  severity: 'info' | 'watch' | 'review';
  title: string;
  body: string;
  recommendationKind: CorrelationRecommendationKind;
  evidence: {
    windowDays: 30 | 60 | 90;
    feature: CorrelationFeatureName;
    outcome: CorrelationFeatureName;
    r: number;
    n: number;
  };
};
```

- [ ] **Step 4: Add stats implementation**

```ts
import { CorrelationResult } from './types';

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function pearsonCorrelation(xs: Array<number | null>, ys: Array<number | null>): number | null {
  const pairs = xs
    .map((x, index) => [x, ys[index]] as const)
    .filter((pair): pair is readonly [number, number] => pair[0] !== null && pair[1] !== null);

  if (pairs.length < 4) return null;

  const meanX = pairs.reduce((sum, [x]) => sum + x, 0) / pairs.length;
  const meanY = pairs.reduce((sum, [, y]) => sum + y, 0) / pairs.length;

  let numerator = 0;
  let denominatorX = 0;
  let denominatorY = 0;

  for (const [x, y] of pairs) {
    const dx = x - meanX;
    const dy = y - meanY;
    numerator += dx * dy;
    denominatorX += dx * dx;
    denominatorY += dy * dy;
  }

  if (denominatorX === 0 || denominatorY === 0) return null;

  return round(numerator / Math.sqrt(denominatorX * denominatorY));
}

export function rankByAbsoluteCorrelation(results: CorrelationResult[]): CorrelationResult[] {
  return [...results].sort((a, b) => Math.abs(b.r) - Math.abs(a.r));
}
```

- [ ] **Step 5: Run test to verify it passes**

Run:

```bash
node --experimental-strip-types --test src/lib/correlation/stats.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/correlation/types.ts src/lib/correlation/stats.ts src/lib/correlation/stats.test.mjs
git commit -m "feat: add correlation statistics helpers"
```

---

### Task 3: Medication Safety Guardrails

**Files:**
- Create: `src/lib/correlation/medicationSafety.ts`
- Test: `src/lib/correlation/medicationSafety.test.mjs`

- [ ] **Step 1: Write the failing safety test**

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { assertMedicationSafeText, sanitizeMedicationInsight } from './medicationSafety.ts';

test('assertMedicationSafeText rejects direct medication stop instructions', () => {
  assert.throws(
    () => assertMedicationSafeText('Stop taking Metformin for three days.'),
    /Unsafe medication recommendation/,
  );
});

test('sanitizeMedicationInsight rewrites medication action into clinician review language', () => {
  assert.equal(
    sanitizeMedicationInsight('Move your medication to the evening because sleep was worse.'),
    'A medication timing pattern was detected. Review this with a qualified clinician before changing medication timing, dosage, or schedule.',
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --experimental-strip-types --test src/lib/correlation/medicationSafety.test.mjs
```

Expected: FAIL with module not found for `medicationSafety.ts`.

- [ ] **Step 3: Add safety implementation**

```ts
const BLOCKED_MEDICATION_ACTION_RE =
  /\b(stop|stopping|pause|pausing|skip|skipping|cancel|cancelling|discontinue|discontinuing|move|reschedule|delay|reduce|increase|double|halve)\b/i;

export const MEDICATION_REVIEW_TEXT =
  'A medication timing pattern was detected. Review this with a qualified clinician before changing medication timing, dosage, or schedule.';

export function assertMedicationSafeText(text: string): void {
  if (BLOCKED_MEDICATION_ACTION_RE.test(text)) {
    throw new Error('Unsafe medication recommendation');
  }
}

export function sanitizeMedicationInsight(text: string): string {
  if (BLOCKED_MEDICATION_ACTION_RE.test(text)) {
    return MEDICATION_REVIEW_TEXT;
  }

  return text;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
node --experimental-strip-types --test src/lib/correlation/medicationSafety.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/correlation/medicationSafety.ts src/lib/correlation/medicationSafety.test.mjs
git commit -m "feat: guard medication insight language"
```

---

### Task 4: Daily Feature Builder

**Files:**
- Create: `src/lib/correlation/featureBuilder.ts`
- Test: `src/lib/correlation/featureBuilder.test.mjs`

- [ ] **Step 1: Write the failing feature-builder test**

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { buildDailyLifestyleSnapshots } from './featureBuilder.ts';

test('buildDailyLifestyleSnapshots joins meds food water and Oura rows by local date', () => {
  const snapshots = buildDailyLifestyleSnapshots({
    startDate: '2026-04-01',
    endDate: '2026-04-02',
    medicationDays: [
      { localDate: '2026-04-01', taken: 2, missed: 1 },
      { localDate: '2026-04-02', taken: 3, missed: 0 },
    ],
    foodDays: [
      { localDate: '2026-04-01', caloriesKcal: 2200, proteinG: 140, carbsG: 220, fatG: 70, fiberG: 28 },
    ],
    waterDays: [
      { localDate: '2026-04-01', waterMl: 1800 },
      { localDate: '2026-04-02', waterMl: 2600 },
    ],
    ouraDays: [
      {
        localDate: '2026-04-01',
        sleepScore: 72,
        readinessScore: 68,
        activityScore: 81,
        stressHighSeconds: 3600,
        recoveryHighSeconds: 5400,
        steps: 9000,
        activeCalories: 520,
        spo2Avg: 97.2,
        vo2Max: 43.1,
      },
    ],
  });

  assert.equal(snapshots.length, 2);
  assert.equal(snapshots[0].medicationAdherenceRatio, 0.667);
  assert.equal(snapshots[0].caloriesKcal, 2200);
  assert.equal(snapshots[0].ouraSleepScore, 72);
  assert.equal(snapshots[1].waterMl, 2600);
  assert.equal(snapshots[1].ouraSleepScore, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --experimental-strip-types --test src/lib/correlation/featureBuilder.test.mjs
```

Expected: FAIL with module not found for `featureBuilder.ts`.

- [ ] **Step 3: Add feature builder implementation**

```ts
import { DailyLifestyleSnapshot } from './types';

type MedicationDay = { localDate: string; taken: number; missed: number };
type FoodDay = {
  localDate: string;
  caloriesKcal: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  fiberG: number | null;
};
type WaterDay = { localDate: string; waterMl: number | null };
type OuraDay = {
  localDate: string;
  sleepScore: number | null;
  readinessScore: number | null;
  activityScore: number | null;
  stressHighSeconds: number | null;
  recoveryHighSeconds: number | null;
  steps: number | null;
  activeCalories: number | null;
  spo2Avg: number | null;
  vo2Max: number | null;
};

export type BuildDailyLifestyleSnapshotsInput = {
  startDate: string;
  endDate: string;
  medicationDays: MedicationDay[];
  foodDays: FoodDay[];
  waterDays: WaterDay[];
  ouraDays: OuraDay[];
};

function dateRange(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);

  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return dates;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function byDate<T extends { localDate: string }>(rows: T[]): Map<string, T> {
  return new Map(rows.map((row) => [row.localDate, row]));
}

export function buildDailyLifestyleSnapshots(input: BuildDailyLifestyleSnapshotsInput): DailyLifestyleSnapshot[] {
  const medicationByDate = byDate(input.medicationDays);
  const foodByDate = byDate(input.foodDays);
  const waterByDate = byDate(input.waterDays);
  const ouraByDate = byDate(input.ouraDays);

  return dateRange(input.startDate, input.endDate).map((localDate) => {
    const medication = medicationByDate.get(localDate);
    const food = foodByDate.get(localDate);
    const water = waterByDate.get(localDate);
    const oura = ouraByDate.get(localDate);
    const medTotal = medication ? medication.taken + medication.missed : 0;

    return {
      localDate,
      medicationAdherenceRatio: medTotal > 0 && medication ? round(medication.taken / medTotal) : null,
      caloriesKcal: food?.caloriesKcal ?? null,
      proteinG: food?.proteinG ?? null,
      carbsG: food?.carbsG ?? null,
      fatG: food?.fatG ?? null,
      fiberG: food?.fiberG ?? null,
      waterMl: water?.waterMl ?? null,
      ouraSleepScore: oura?.sleepScore ?? null,
      ouraReadinessScore: oura?.readinessScore ?? null,
      ouraActivityScore: oura?.activityScore ?? null,
      ouraStressHighSeconds: oura?.stressHighSeconds ?? null,
      ouraRecoveryHighSeconds: oura?.recoveryHighSeconds ?? null,
      ouraSteps: oura?.steps ?? null,
      ouraActiveCalories: oura?.activeCalories ?? null,
      ouraSpo2Avg: oura?.spo2Avg ?? null,
      ouraVo2Max: oura?.vo2Max ?? null,
    };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
node --experimental-strip-types --test src/lib/correlation/featureBuilder.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/correlation/featureBuilder.ts src/lib/correlation/featureBuilder.test.mjs
git commit -m "feat: build daily lifestyle feature snapshots"
```

---

### Task 5: Insight Engine

**Files:**
- Create: `src/lib/correlation/engine.ts`
- Test: `src/lib/correlation/engine.test.mjs`

- [ ] **Step 1: Write the failing insight-engine test**

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { generateCorrelationInsights } from './engine.ts';

function makeRows() {
  return Array.from({ length: 30 }, (_, index) => {
    const day = String(index + 1).padStart(2, '0');
    const stress = index + 1;
    return {
      localDate: `2026-04-${day}`,
      medicationAdherenceRatio: index < 15 ? 1 : 0.5,
      caloriesKcal: 2200,
      proteinG: 140,
      carbsG: 220,
      fatG: 70,
      fiberG: 28,
      waterMl: 2000 + index * 20,
      ouraSleepScore: 90 - index,
      ouraReadinessScore: 88 - index,
      ouraActivityScore: 70,
      ouraStressHighSeconds: stress * 100,
      ouraRecoveryHighSeconds: 5000 - stress * 50,
      ouraSteps: 8000,
      ouraActiveCalories: 450,
      ouraSpo2Avg: 97,
      ouraVo2Max: 43,
    };
  });
}

test('generateCorrelationInsights creates clinician review medication cards without medication action instructions', () => {
  const cards = generateCorrelationInsights(makeRows(), 30);
  const medCard = cards.find((card) => card.category === 'medication_review');

  assert.ok(medCard);
  assert.equal(medCard.recommendationKind, 'clinician_review');
  assert.match(medCard.body, /clinician/i);
  assert.doesNotMatch(medCard.body, /\b(stop|pause|move|reschedule|reduce|increase)\b/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --experimental-strip-types --test src/lib/correlation/engine.test.mjs
```

Expected: FAIL with module not found for `engine.ts`.

- [ ] **Step 3: Add engine implementation**

```ts
import {
  CorrelationFeatureName,
  CorrelationInsightCard,
  DailyLifestyleSnapshot,
} from './types';
import { sanitizeMedicationInsight } from './medicationSafety';
import { pearsonCorrelation, rankByAbsoluteCorrelation } from './stats';

const OUTCOMES: CorrelationFeatureName[] = [
  'medication_adherence_ratio',
  'oura_sleep_score',
  'oura_readiness_score',
];

const INPUTS: CorrelationFeatureName[] = [
  'calories_kcal',
  'protein_g',
  'carbs_g',
  'fat_g',
  'fiber_g',
  'water_ml',
  'oura_stress_high_seconds',
  'oura_recovery_high_seconds',
  'oura_steps',
  'oura_active_calories',
];

function getValue(row: DailyLifestyleSnapshot, feature: CorrelationFeatureName): number | null {
  const map: Record<CorrelationFeatureName, number | null> = {
    medication_adherence_ratio: row.medicationAdherenceRatio,
    calories_kcal: row.caloriesKcal,
    protein_g: row.proteinG,
    carbs_g: row.carbsG,
    fat_g: row.fatG,
    fiber_g: row.fiberG,
    water_ml: row.waterMl,
    oura_sleep_score: row.ouraSleepScore,
    oura_readiness_score: row.ouraReadinessScore,
    oura_activity_score: row.ouraActivityScore,
    oura_stress_high_seconds: row.ouraStressHighSeconds,
    oura_recovery_high_seconds: row.ouraRecoveryHighSeconds,
    oura_steps: row.ouraSteps,
    oura_active_calories: row.ouraActiveCalories,
    oura_spo2_avg: row.ouraSpo2Avg,
    oura_vo2_max: row.ouraVo2Max,
  };

  return map[feature];
}

function label(feature: CorrelationFeatureName): string {
  return feature.replaceAll('_', ' ');
}

export function generateCorrelationInsights(
  snapshots: DailyLifestyleSnapshot[],
  windowDays: 30 | 60 | 90,
): CorrelationInsightCard[] {
  const correlations = [];

  for (const feature of INPUTS) {
    for (const outcome of OUTCOMES) {
      if (feature === outcome) continue;
      const xs = snapshots.map((row) => getValue(row, feature));
      const ys = snapshots.map((row) => getValue(row, outcome));
      const r = pearsonCorrelation(xs, ys);
      const n = xs.filter((x, index) => x !== null && ys[index] !== null).length;
      if (r !== null && n >= 14 && Math.abs(r) >= 0.35) {
        correlations.push({ feature, outcome, r, n });
      }
    }
  }

  return rankByAbsoluteCorrelation(correlations).slice(0, 5).map((result) => {
    if (result.outcome === 'medication_adherence_ratio') {
      return {
        category: 'medication_review',
        severity: 'review',
        title: 'Medication pattern worth reviewing',
        body: sanitizeMedicationInsight(
          `A ${windowDays}-day pattern links ${label(result.feature)} with medication adherence. Review this with a qualified clinician before changing medication timing, dosage, or schedule.`,
        ),
        recommendationKind: 'clinician_review',
        evidence: { windowDays, ...result },
      };
    }

    return {
      category: result.feature.includes('water') ? 'hydration' : 'stress',
      severity: Math.abs(result.r) >= 0.55 ? 'watch' : 'info',
      title: 'Lifestyle pattern detected',
      body: `A ${windowDays}-day pattern links ${label(result.feature)} with ${label(result.outcome)}. Track this for another week before treating it as meaningful.`,
      recommendationKind: 'tracking_prompt',
      evidence: { windowDays, ...result },
    };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
node --experimental-strip-types --test src/lib/correlation/engine.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/correlation/engine.ts src/lib/correlation/engine.test.mjs
git commit -m "feat: generate guarded correlation insights"
```

---

### Task 6: Persistence and API Route

**Files:**
- Create: `src/lib/correlation/persistence.ts`
- Create: `src/app/api/insights/correlations/route.ts`

- [ ] **Step 1: Add persistence helper**

```ts
import { createClient } from '@supabase/supabase-js';

import { CorrelationInsightCard, DailyLifestyleSnapshot } from './types';

function getServiceClient() {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Supabase service role environment is required for correlation insights');
  }

  return createClient(supabaseUrl, serviceRoleKey);
}

export async function getCorrelationConsent(userId: string): Promise<boolean> {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from('correlation_consents')
    .select('enabled, includes_medication_patterns, includes_oura_data, acknowledged_no_med_changes')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw error;

  return Boolean(
    data?.enabled &&
      data.includes_medication_patterns &&
      data.includes_oura_data &&
      data.acknowledged_no_med_changes,
  );
}

export async function saveDailyLifestyleSnapshots(userId: string, snapshots: DailyLifestyleSnapshot[]) {
  const supabase = getServiceClient();
  const rows = snapshots.map((snapshot) => ({
    user_id: userId,
    local_date: snapshot.localDate,
    medication_adherence_ratio: snapshot.medicationAdherenceRatio,
    calories_kcal: snapshot.caloriesKcal,
    protein_g: snapshot.proteinG,
    carbs_g: snapshot.carbsG,
    fat_g: snapshot.fatG,
    fiber_g: snapshot.fiberG,
    water_ml: snapshot.waterMl,
    oura_sleep_score: snapshot.ouraSleepScore,
    oura_readiness_score: snapshot.ouraReadinessScore,
    oura_activity_score: snapshot.ouraActivityScore,
    oura_stress_high_seconds: snapshot.ouraStressHighSeconds,
    oura_recovery_high_seconds: snapshot.ouraRecoveryHighSeconds,
    oura_steps: snapshot.ouraSteps,
    oura_active_calories: snapshot.ouraActiveCalories,
    oura_spo2_avg: snapshot.ouraSpo2Avg,
    oura_vo2_max: snapshot.ouraVo2Max,
  }));

  const { error } = await supabase
    .from('daily_lifestyle_snapshots')
    .upsert(rows, { onConflict: 'user_id,local_date' });

  if (error) throw error;
}

export async function saveCorrelationInsightCards(
  userId: string,
  windowDays: 30 | 60 | 90,
  cards: CorrelationInsightCard[],
) {
  const supabase = getServiceClient();
  const rows = cards.map((card) => ({
    user_id: userId,
    window_days: windowDays,
    category: card.category,
    severity: card.severity,
    title: card.title,
    body: card.body,
    evidence: card.evidence,
    recommendation_kind: card.recommendationKind,
  }));

  const { error } = await supabase.from('correlation_insight_cards').insert(rows);
  if (error) throw error;
}
```

- [ ] **Step 2: Add authenticated route**

```ts
import { NextRequest, NextResponse } from 'next/server';

import { generateCorrelationInsights } from '@/lib/correlation/engine';
import { buildDailyLifestyleSnapshots } from '@/lib/correlation/featureBuilder';
import {
  getCorrelationConsent,
  saveCorrelationInsightCards,
  saveDailyLifestyleSnapshots,
} from '@/lib/correlation/persistence';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

function parseWindowDays(value: string | null): 30 | 60 | 90 {
  return value === '60' ? 60 : value === '90' ? 90 : 30;
}

function dateDaysAgo(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days + 1);
  return date.toISOString().slice(0, 10);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const windowDays = parseWindowDays(request.nextUrl.searchParams.get('window_days'));
  const consented = await getCorrelationConsent(data.user.id);

  if (!consented) {
    return NextResponse.json({ error: 'Correlation insights require explicit consent.' }, { status: 403 });
  }

  const startDate = dateDaysAgo(windowDays);
  const endDate = today();

  const snapshots = buildDailyLifestyleSnapshots({
    startDate,
    endDate,
    medicationDays: [],
    foodDays: [],
    waterDays: [],
    ouraDays: [],
  });

  await saveDailyLifestyleSnapshots(data.user.id, snapshots);
  const cards = generateCorrelationInsights(snapshots, windowDays);
  await saveCorrelationInsightCards(data.user.id, windowDays, cards);

  return NextResponse.json({ windowDays, cards });
}
```

- [ ] **Step 3: Build to verify route compiles**

Run:

```bash
npm run build
```

Expected: PASS. The route list includes `/api/insights/correlations`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/correlation/persistence.ts src/app/api/insights/correlations/route.ts
git commit -m "feat: add correlation insights API"
```

---

### Task 7: Insights Page and Navigation

**Files:**
- Create: `src/app/app/insights/page.tsx`
- Modify: `src/components/app/BottomNav.tsx`

- [ ] **Step 1: Add Insights page**

```tsx
'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/Button';

type InsightCard = {
  category: string;
  severity: string;
  title: string;
  body: string;
  recommendationKind: string;
  evidence: {
    windowDays: number;
    feature: string;
    outcome: string;
    r: number;
    n: number;
  };
};

export default function InsightsPage() {
  const [cards, setCards] = useState<InsightCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/insights/correlations?window_days=30', {
        method: 'POST',
      });
      const payload = await response.json();

      if (!response.ok) {
        setError(payload.error ?? 'Unable to generate insights.');
        return;
      }

      setCards(payload.cards ?? []);
    } catch {
      setError('Unable to generate insights.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-neutral-50 px-4 pb-24 pt-6">
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <header>
          <h1 className="text-2xl font-semibold text-neutral-950">Insights</h1>
          <p className="mt-1 text-sm text-neutral-600">
            Pattern analysis across medication adherence, nutrition, hydration, activity, sleep, and stress.
          </p>
        </header>

        <section className="rounded-lg border border-neutral-200 bg-white p-4">
          <p className="text-sm text-neutral-700">
            Medication-related patterns are shown as clinician-review prompts only. Do not change medication timing,
            dosage, or schedule without qualified medical guidance.
          </p>
          <Button className="mt-4" onClick={generate} disabled={loading}>
            {loading ? 'Analyzing...' : 'Analyze last 30 days'}
          </Button>
          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        </section>

        {cards.map((card, index) => (
          <article key={`${card.title}-${index}`} className="rounded-lg border border-neutral-200 bg-white p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">{card.category}</div>
            <h2 className="mt-1 text-lg font-semibold text-neutral-950">{card.title}</h2>
            <p className="mt-2 text-sm text-neutral-700">{card.body}</p>
            <p className="mt-3 text-xs text-neutral-500">
              Evidence: r={card.evidence.r}, n={card.evidence.n}, window={card.evidence.windowDays}d
            </p>
          </article>
        ))}
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Add bottom nav item**

Open `src/components/app/BottomNav.tsx` and add this item to the existing nav item list, following the local component pattern:

```ts
{
  href: '/app/insights',
  label: 'Insights',
  icon: 'chart',
}
```

If `BottomNav.tsx` uses a different icon registry shape, use the existing closest analytics/progress icon rather than introducing a new dependency.

- [ ] **Step 3: Build**

Run:

```bash
npm run build
```

Expected: PASS. The route list includes `/app/insights`.

- [ ] **Step 4: Commit**

```bash
git add src/app/app/insights/page.tsx src/components/app/BottomNav.tsx
git commit -m "feat: add correlation insights page"
```

---

### Task 8: Documentation and Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/current-status.md`

- [ ] **Step 1: Update README**

Add this text under functional scope:

```markdown
- Insights:
  - opt-in 30/60/90-day lifestyle correlation analysis
  - compares medication adherence, food, hydration, activity, sleep, stress, and recovery signals
  - medication-related findings are clinician-review prompts only and never direct medication-change instructions
```

Add this text under environment/setup:

```markdown
Correlation insights require:

- `supabase/008_correlation_insights.sql`
- Oura integration data for sleep/readiness/activity/stress where available
- explicit user consent in `correlation_consents`
```

- [ ] **Step 2: Update current status**

Add this section:

```markdown
### Personalized correlation insights

- Adds opt-in 30/60/90-day correlation analysis across medication adherence, food, hydration, and Oura lifestyle signals.
- User-facing medication-related output is limited to clinician-review prompts.
- The engine does not recommend medication cancellation, pausing, rescheduling, or dosage changes.
```

- [ ] **Step 3: Run focused tests**

Run:

```bash
node --experimental-strip-types --test \
  src/lib/correlation/stats.test.mjs \
  src/lib/correlation/medicationSafety.test.mjs \
  src/lib/correlation/featureBuilder.test.mjs \
  src/lib/correlation/engine.test.mjs
```

Expected: PASS.

- [ ] **Step 4: Run build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 5: Commit docs**

```bash
git add README.md docs/current-status.md
git commit -m "docs: document correlation insights"
```

---

## Self-Review

Spec coverage:

- 30-90 day personalized correlations: covered by schema window days, stats helpers, engine, and API.
- Medication, food, water, activity, sleep, stress: covered by daily snapshot columns and feature builder.
- Oura external data: covered by Oura-derived snapshot fields and README requirements.
- Advanced correlation: covered by Pearson correlation and ranked insight generation.
- False-conclusion protection: covered by minimum paired sample threshold, evidence display, tracking prompts, and clinician-review category.
- Medication safety: covered by safety boundary, typed recommendation kinds, and blocked action tests.

Placeholder scan:

- No open implementation placeholders remain.
- One navigation step references adapting to the existing `BottomNav.tsx` shape because that file can vary; the required behavior and exact nav object are specified.

Type consistency:

- `DailyLifestyleSnapshot`, `CorrelationResult`, and `CorrelationInsightCard` names are consistent across tasks.
- Feature names use snake_case in analytics output and camelCase in in-memory snapshot objects by design.
