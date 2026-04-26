# Medication Knowledge OpenRouter Multiagent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first production-shaped Medication Knowledge Layer: read active medication maps, normalize drugs/classes, evaluate curated medication lifestyle rules, route AI-assisted classification/review through OpenRouter, and expose medication-aware features to the personalized correlation engine.

**Architecture:** This is a multi-agent build with disjoint write sets. The core is deterministic: Supabase schema, TypeScript types, curated rules, medication map reader, rule evaluator, and feature builders. OpenRouter is used only for structured classification/review/reranking after deterministic inputs exist; all model output is validated before persistence.

**Tech Stack:** Next.js App Router, TypeScript, Supabase Postgres, Node `node:test`, OpenRouter Chat Completions, RxNorm/RxClass HTTP APIs, DailyMed/openFDA evidence references, existing MedRemind protocol/food/hydration/Oura data.

---

## Preconditions

- Start from clean `main`.
- Do not work inside `codex/oura-integration-bootstrap` unless that branch has been reviewed and merged first.
- Apply this plan only after `codex/e2-medication-knowledge-layer-spec` is merged or cherry-picked into the implementation branch.
- Use branch name `codex/e3-medication-knowledge-openrouter`.
- Run implementation in a dedicated worktree.

```bash
git checkout main
git pull --ff-only
git status --short --branch
git worktree add -b codex/e3-medication-knowledge-openrouter "../medremind-app-med-knowledge-impl" main
cd "../medremind-app-med-knowledge-impl"
```

Expected:

```text
## codex/e3-medication-knowledge-openrouter
```

## Multiagent Ownership

Use one worker per task group. Workers are not alone in the codebase and must not revert edits made by other workers.

- **Worker A - Schema and Types:** owns `supabase/008_medication_knowledge.sql`, `src/lib/medKnowledge/types.ts`.
- **Worker B - Curated Rules and Safety:** owns `src/lib/medKnowledge/rules.ts`, `src/lib/medKnowledge/safety.ts`, related tests.
- **Worker C - Map Reader and Normalizer:** owns `src/lib/medKnowledge/mapReader.ts`, `src/lib/medKnowledge/normalizer.ts`, related tests.
- **Worker D - OpenRouter Client:** owns `src/lib/medKnowledge/openRouter.ts`, `src/lib/medKnowledge/aiSchemas.ts`, related tests.
- **Worker E - Evidence and Features:** owns `src/lib/medKnowledge/evidence.ts`, `src/lib/medKnowledge/features.ts`, related tests.
- **Worker F - API and UI:** owns `src/app/api/medication-knowledge/*`, `src/app/app/insights/medications/page.tsx`, navigation changes.
- **Worker G - Docs and Verification:** owns README/current-status updates and final integration checks.

Merge order: A -> B and D in parallel -> C -> E -> F -> G.

---

## Task 1: Schema and Core Types

**Files:**
- Create: `supabase/008_medication_knowledge.sql`
- Create: `src/lib/medKnowledge/types.ts`
- Test: `src/lib/medKnowledge/types.test.mjs`

- [ ] **Step 1: Write the migration**

```sql
-- MedRemind - Medication Knowledge Layer
-- Server-side medication map, normalization, curated rules, evidence, AI runs, jobs, and daily exposures.

create table if not exists medication_map_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  active_protocol_id uuid references active_protocols(id) on delete cascade,
  protocol_item_id uuid references protocol_items(id) on delete cascade,
  drug_id uuid references drugs(id),
  display_name text not null,
  generic_name text,
  dose_amount numeric,
  dose_unit text,
  dose_form text,
  route text,
  frequency_type text,
  times text[] not null default '{}',
  with_food text,
  start_date date,
  end_date date,
  status text not null default 'active' check (status in ('active', 'paused', 'completed', 'abandoned', 'unknown')),
  source_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint medication_map_items_user_item_key unique (user_id, active_protocol_id, protocol_item_id)
);

alter table medication_map_items enable row level security;

drop policy if exists "Owner read medication map" on medication_map_items;
create policy "Owner read medication map" on medication_map_items
  for select using (auth.uid() = user_id);

drop trigger if exists medication_map_items_updated_at on medication_map_items;
create trigger medication_map_items_updated_at
  before update on medication_map_items
  for each row execute function public.set_updated_at();

create table if not exists medication_normalizations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  medication_map_item_id uuid not null references medication_map_items(id) on delete cascade,
  rxnorm_rxcui text,
  normalized_name text not null,
  ingredients text[] not null default '{}',
  class_codes text[] not null default '{}',
  class_labels text[] not null default '{}',
  source text not null check (source in ('seed', 'local_alias', 'rxnorm', 'openrouter', 'manual')),
  confidence numeric not null check (confidence >= 0 and confidence <= 1),
  ambiguity_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint medication_normalizations_item_key unique (medication_map_item_id)
);

alter table medication_normalizations enable row level security;

drop policy if exists "Owner read medication normalizations" on medication_normalizations;
create policy "Owner read medication normalizations" on medication_normalizations
  for select using (auth.uid() = user_id);

drop trigger if exists medication_normalizations_updated_at on medication_normalizations;
create trigger medication_normalizations_updated_at
  before update on medication_normalizations
  for each row execute function public.set_updated_at();

create table if not exists medication_rule_evaluations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  medication_map_item_id uuid references medication_map_items(id) on delete cascade,
  rule_id text not null,
  domain text not null,
  recommendation_kind text not null check (recommendation_kind in ('lifestyle_adjustment', 'tracking_prompt', 'clinician_review')),
  risk_level text not null check (risk_level in ('low', 'medium', 'high')),
  title text not null,
  body text not null,
  evidence_refs jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

alter table medication_rule_evaluations enable row level security;

drop policy if exists "Owner read medication rule evaluations" on medication_rule_evaluations;
create policy "Owner read medication rule evaluations" on medication_rule_evaluations
  for select using (auth.uid() = user_id);

create table if not exists medication_evidence_documents (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('rxnorm', 'rxclass', 'dailymed', 'openfda', 'curated_rule', 'clinical_advisory')),
  source_url text,
  source_version text,
  source_retrieved_at timestamptz not null default now(),
  title text not null,
  section_name text,
  content_hash text not null,
  content_excerpt text not null,
  retrieval_strategy text not null default 'lexical' check (retrieval_strategy in ('lexical', 'model_rerank', 'vector')),
  embedding_model text,
  embedding_vector vector,
  review_status text not null default 'unreviewed' check (review_status in ('unreviewed', 'curated', 'rejected')),
  created_at timestamptz not null default now(),
  constraint medication_evidence_documents_hash_key unique (source, content_hash)
);

alter table medication_evidence_documents enable row level security;

create table if not exists medication_ai_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade,
  pipeline_name text not null,
  model text not null,
  model_version text,
  provider text,
  openrouter_generation_id text,
  usage_prompt_tokens int,
  usage_completion_tokens int,
  usage_total_tokens int,
  input_hash text not null,
  output_json jsonb not null,
  source_evidence_ids uuid[] not null default '{}',
  validation_status text not null check (validation_status in ('accepted', 'rejected', 'error')),
  validation_errors text[] not null default '{}',
  created_at timestamptz not null default now()
);

alter table medication_ai_runs enable row level security;

drop policy if exists "Owner read medication ai runs" on medication_ai_runs;
create policy "Owner read medication ai runs" on medication_ai_runs
  for select using (user_id is null or auth.uid() = user_id);

create table if not exists medication_processing_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  job_type text not null check (job_type in ('medication_map_refresh', 'medication_normalization', 'evidence_refresh', 'daily_feature_build', 'insight_generation')),
  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'failed', 'cancelled')),
  idempotency_key text not null,
  input_window_start date,
  input_window_end date,
  attempt_count int not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint medication_processing_jobs_idempotency_key unique (idempotency_key)
);

alter table medication_processing_jobs enable row level security;

drop policy if exists "Owner read medication jobs" on medication_processing_jobs;
create policy "Owner read medication jobs" on medication_processing_jobs
  for select using (auth.uid() = user_id);

drop trigger if exists medication_processing_jobs_updated_at on medication_processing_jobs;
create trigger medication_processing_jobs_updated_at
  before update on medication_processing_jobs
  for each row execute function public.set_updated_at();

create table if not exists daily_medication_exposures (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  local_date date not null,
  has_glp1_active boolean not null default false,
  days_since_glp1_start int,
  glp1_dose_escalation_phase boolean not null default false,
  has_testosterone_active boolean not null default false,
  testosterone_injection_day_offset int,
  has_beta_blocker_active boolean not null default false,
  has_thyroid_med_active boolean not null default false,
  has_ssri_active boolean not null default false,
  with_food_mismatch_count int not null default 0,
  late_medication_count int not null default 0,
  missed_medication_count int not null default 0,
  medication_class_exposure_score numeric not null default 0,
  medication_review_signal_count int not null default 0,
  source_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint daily_medication_exposures_user_date_key unique (user_id, local_date)
);

alter table daily_medication_exposures enable row level security;

drop policy if exists "Owner read daily medication exposures" on daily_medication_exposures;
create policy "Owner read daily medication exposures" on daily_medication_exposures
  for select using (auth.uid() = user_id);

create index if not exists idx_daily_medication_exposures_user_date
  on daily_medication_exposures(user_id, local_date desc);

drop trigger if exists daily_medication_exposures_updated_at on daily_medication_exposures;
create trigger daily_medication_exposures_updated_at
  before update on daily_medication_exposures
  for each row execute function public.set_updated_at();
```

- [ ] **Step 2: Write the failing type test**

Create `src/lib/medKnowledge/types.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { MEDICATION_KNOWLEDGE_DOMAINS, RECOMMENDATION_KINDS } from './types.ts';

test('medication knowledge domains include nutrition and medication review', () => {
  assert.ok(MEDICATION_KNOWLEDGE_DOMAINS.includes('nutrition'));
  assert.ok(MEDICATION_KNOWLEDGE_DOMAINS.includes('medication_review'));
});

test('recommendation kinds exclude direct medication change actions', () => {
  assert.deepEqual(RECOMMENDATION_KINDS, [
    'lifestyle_adjustment',
    'tracking_prompt',
    'clinician_review',
  ]);
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
node --experimental-strip-types --test src/lib/medKnowledge/types.test.mjs
```

Expected: FAIL with module not found for `src/lib/medKnowledge/types.ts`.

- [ ] **Step 4: Create core types**

Create `src/lib/medKnowledge/types.ts`:

```ts
export const MEDICATION_KNOWLEDGE_DOMAINS = [
  'nutrition',
  'hydration',
  'activity',
  'sleep',
  'stress',
  'adherence',
  'lab_monitoring',
  'medication_review',
] as const;

export type MedicationKnowledgeDomain = typeof MEDICATION_KNOWLEDGE_DOMAINS[number];

export const RECOMMENDATION_KINDS = [
  'lifestyle_adjustment',
  'tracking_prompt',
  'clinician_review',
] as const;

export type MedicationRecommendationKind = typeof RECOMMENDATION_KINDS[number];

export type MedicationRiskLevel = 'low' | 'medium' | 'high';

export type MedicationMapItem = {
  id: string;
  userId: string;
  activeProtocolId: string | null;
  protocolItemId: string | null;
  drugId: string | null;
  displayName: string;
  genericName: string | null;
  doseAmount: number | null;
  doseUnit: string | null;
  doseForm: string | null;
  route: string | null;
  frequencyType: string | null;
  times: string[];
  withFood: 'yes' | 'no' | 'any' | null;
  startDate: string | null;
  endDate: string | null;
  status: 'active' | 'paused' | 'completed' | 'abandoned' | 'unknown';
  sourceHash: string;
};

export type MedicationNormalization = {
  medicationMapItemId: string;
  rxnormRxcui: string | null;
  normalizedName: string;
  ingredients: string[];
  classCodes: string[];
  classLabels: string[];
  source: 'seed' | 'local_alias' | 'rxnorm' | 'openrouter' | 'manual';
  confidence: number;
  ambiguityNotes: string | null;
};

export type MedicationLifestyleRule = {
  id: string;
  appliesTo: {
    localDrugIds?: string[];
    rxnormRxcuis?: string[];
    ingredients?: string[];
    classLabels?: string[];
  };
  domain: MedicationKnowledgeDomain;
  trigger: string;
  effect: string;
  recommendationKind: MedicationRecommendationKind;
  riskLevel: MedicationRiskLevel;
  title: string;
  body: string;
  evidenceRefs: Array<{ label: string; url: string }>;
};

export type DailyMedicationExposure = {
  userId: string;
  localDate: string;
  hasGlp1Active: boolean;
  daysSinceGlp1Start: number | null;
  glp1DoseEscalationPhase: boolean;
  hasTestosteroneActive: boolean;
  testosteroneInjectionDayOffset: number | null;
  hasBetaBlockerActive: boolean;
  hasThyroidMedActive: boolean;
  hasSsriActive: boolean;
  withFoodMismatchCount: number;
  lateMedicationCount: number;
  missedMedicationCount: number;
  medicationClassExposureScore: number;
  medicationReviewSignalCount: number;
};
```

- [ ] **Step 5: Run test to verify it passes**

```bash
node --experimental-strip-types --test src/lib/medKnowledge/types.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/008_medication_knowledge.sql src/lib/medKnowledge/types.ts src/lib/medKnowledge/types.test.mjs
git commit -m "feat: add medication knowledge schema and types"
```

---

## Task 2: Curated Rules and Medication Safety

**Files:**
- Create: `src/lib/medKnowledge/rules.ts`
- Create: `src/lib/medKnowledge/safety.ts`
- Test: `src/lib/medKnowledge/rules.test.mjs`
- Test: `src/lib/medKnowledge/safety.test.mjs`

- [ ] **Step 1: Write failing rules test**

Create `src/lib/medKnowledge/rules.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { CURATED_MEDICATION_RULES, findRulesForMedication } from './rules.ts';

test('curated rules include GLP-1 protein and resistance training guidance', () => {
  const rules = findRulesForMedication({
    localDrugId: 'd-028',
    ingredients: ['semaglutide'],
    classLabels: ['GLP-1 receptor agonist'],
  });

  assert.ok(rules.some((rule) => rule.domain === 'nutrition' && /protein/i.test(rule.body)));
  assert.ok(rules.some((rule) => rule.domain === 'activity' && /resistance/i.test(rule.body)));
});

test('curated rules include testosterone recovery review guidance', () => {
  const rules = findRulesForMedication({
    localDrugId: 'd-025',
    ingredients: ['testosterone'],
    classLabels: ['androgen'],
  });

  assert.ok(rules.some((rule) => rule.domain === 'activity'));
  assert.ok(rules.some((rule) => rule.recommendationKind === 'clinician_review'));
});

test('curated rules are non-empty and have evidence references', () => {
  assert.ok(CURATED_MEDICATION_RULES.length >= 8);
  assert.ok(CURATED_MEDICATION_RULES.every((rule) => rule.evidenceRefs.length > 0));
});
```

- [ ] **Step 2: Write failing safety test**

Create `src/lib/medKnowledge/safety.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { assertSafeMedicationKnowledgeText, sanitizeMedicationKnowledgeText } from './safety.ts';

test('assertSafeMedicationKnowledgeText rejects direct medication changes', () => {
  assert.throws(
    () => assertSafeMedicationKnowledgeText('Stop testosterone for three days.'),
    /Unsafe medication knowledge text/,
  );
});

test('sanitizeMedicationKnowledgeText replaces direct changes with clinician review text', () => {
  assert.equal(
    sanitizeMedicationKnowledgeText('Move semaglutide to another day.'),
    'A medication-related pattern was detected. Review this with a qualified clinician before changing medication timing, dosage, or schedule.',
  );
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
node --experimental-strip-types --test \
  src/lib/medKnowledge/rules.test.mjs \
  src/lib/medKnowledge/safety.test.mjs
```

Expected: FAIL with module not found errors for `rules.ts` and `safety.ts`.

- [ ] **Step 4: Create safety implementation**

Create `src/lib/medKnowledge/safety.ts`:

```ts
const BLOCKED_DIRECT_MED_ACTION_RE =
  /\b(stop|stopping|pause|pausing|skip|skipping|cancel|cancelling|discontinue|discontinuing|move|reschedule|delay|reduce|increase|double|halve)\b/i;

export const MEDICATION_CLINICIAN_REVIEW_TEXT =
  'A medication-related pattern was detected. Review this with a qualified clinician before changing medication timing, dosage, or schedule.';

export function assertSafeMedicationKnowledgeText(text: string): void {
  if (BLOCKED_DIRECT_MED_ACTION_RE.test(text)) {
    throw new Error('Unsafe medication knowledge text');
  }
}

export function sanitizeMedicationKnowledgeText(text: string): string {
  if (BLOCKED_DIRECT_MED_ACTION_RE.test(text)) {
    return MEDICATION_CLINICIAN_REVIEW_TEXT;
  }

  return text;
}
```

- [ ] **Step 5: Create curated rules implementation**

Create `src/lib/medKnowledge/rules.ts`:

```ts
import { MedicationLifestyleRule } from './types';

export const CURATED_MEDICATION_RULES: MedicationLifestyleRule[] = [
  {
    id: 'glp1-protein-priority',
    appliesTo: {
      localDrugIds: ['d-028'],
      ingredients: ['semaglutide', 'tirzepatide', 'liraglutide', 'dulaglutide'],
      classLabels: ['GLP-1 receptor agonist'],
    },
    domain: 'nutrition',
    trigger: 'GLP-1 active and protein intake below target',
    effect: 'Increase protein priority in nutrition insights',
    recommendationKind: 'lifestyle_adjustment',
    riskLevel: 'low',
    title: 'Protein priority while GLP-1 is active',
    body: 'GLP-1 medications can reduce appetite, so protein-forward meals are prioritized to support lean-mass preservation.',
    evidenceRefs: [
      {
        label: 'Obesity Medicine Association GLP-1 nutrition advisory',
        url: 'https://www.obesity.org/nutritional-priorities-to-support-glp-1-therapy-for-obesity/',
      },
    ],
  },
  {
    id: 'glp1-resistance-training',
    appliesTo: {
      localDrugIds: ['d-028'],
      ingredients: ['semaglutide', 'tirzepatide', 'liraglutide', 'dulaglutide'],
      classLabels: ['GLP-1 receptor agonist'],
    },
    domain: 'activity',
    trigger: 'GLP-1 active and resistance training absent',
    effect: 'Prompt resistance training planning when recovery is adequate',
    recommendationKind: 'lifestyle_adjustment',
    riskLevel: 'low',
    title: 'Resistance training support',
    body: 'When GLP-1 therapy is active, resistance training is prioritized when recovery signals are stable.',
    evidenceRefs: [
      {
        label: 'Obesity Medicine Association GLP-1 nutrition advisory',
        url: 'https://www.obesity.org/nutritional-priorities-to-support-glp-1-therapy-for-obesity/',
      },
    ],
  },
  {
    id: 'glp1-hydration-fiber',
    appliesTo: {
      localDrugIds: ['d-028'],
      ingredients: ['semaglutide', 'tirzepatide', 'liraglutide', 'dulaglutide'],
      classLabels: ['GLP-1 receptor agonist'],
    },
    domain: 'hydration',
    trigger: 'GLP-1 active and water or fiber below target',
    effect: 'Prioritize hydration and fiber tracking',
    recommendationKind: 'tracking_prompt',
    riskLevel: 'low',
    title: 'Hydration and fiber tracking',
    body: 'Hydration and fiber are tracked closely while GLP-1 therapy is active because appetite and GI tolerance can change.',
    evidenceRefs: [
      {
        label: 'DailyMed semaglutide label',
        url: 'https://dailymed.nlm.nih.gov/',
      },
    ],
  },
  {
    id: 'testosterone-recovery-training',
    appliesTo: {
      localDrugIds: ['d-025'],
      ingredients: ['testosterone'],
      classLabels: ['androgen'],
    },
    domain: 'activity',
    trigger: 'Testosterone active and recovery signals stable',
    effect: 'Use recovery-aware strength training prompts',
    recommendationKind: 'lifestyle_adjustment',
    riskLevel: 'medium',
    title: 'Recovery-aware training',
    body: 'When testosterone is active, strength training prompts should account for sleep, stress, and recovery trends.',
    evidenceRefs: [
      {
        label: 'FDA testosterone labeling update',
        url: 'https://www.fda.gov/drugs/drug-safety-and-availability/fda-announces-class-wide-labeling-changes-testosterone-products',
      },
    ],
  },
  {
    id: 'testosterone-cardio-review',
    appliesTo: {
      localDrugIds: ['d-025'],
      ingredients: ['testosterone'],
      classLabels: ['androgen'],
    },
    domain: 'medication_review',
    trigger: 'Testosterone active and cardiovascular strain markers persist',
    effect: 'Create clinician-review insight',
    recommendationKind: 'clinician_review',
    riskLevel: 'high',
    title: 'Cardio strain review',
    body: 'Cardiovascular strain markers while testosterone is active should be reviewed with a clinician if they persist.',
    evidenceRefs: [
      {
        label: 'FDA testosterone labeling update',
        url: 'https://www.fda.gov/drugs/drug-safety-and-availability/fda-announces-class-wide-labeling-changes-testosterone-products',
      },
    ],
  },
  {
    id: 'levothyroxine-food-spacing',
    appliesTo: {
      localDrugIds: ['d-007'],
      ingredients: ['levothyroxine'],
      classLabels: ['thyroid hormones'],
    },
    domain: 'adherence',
    trigger: 'Levothyroxine active and food or mineral supplement timing conflicts',
    effect: 'Create timing consistency education prompt',
    recommendationKind: 'tracking_prompt',
    riskLevel: 'medium',
    title: 'Timing consistency for thyroid medication',
    body: 'Thyroid medication timing is tracked because food and mineral supplement timing can matter for consistency.',
    evidenceRefs: [{ label: 'DailyMed levothyroxine label', url: 'https://dailymed.nlm.nih.gov/' }],
  },
  {
    id: 'ssri-sleep-tracking',
    appliesTo: {
      localDrugIds: ['d-016', 'd-017'],
      ingredients: ['sertraline', 'escitalopram'],
      classLabels: ['selective serotonin reuptake inhibitors'],
    },
    domain: 'sleep',
    trigger: 'SSRI active and poor sleep pattern repeats',
    effect: 'Create sleep tracking prompt',
    recommendationKind: 'tracking_prompt',
    riskLevel: 'medium',
    title: 'Sleep pattern tracking',
    body: 'Sleep trends are tracked while SSRI therapy is active so recurring patterns can be reviewed with better context.',
    evidenceRefs: [{ label: 'DailyMed SSRI labels', url: 'https://dailymed.nlm.nih.gov/' }],
  },
  {
    id: 'metformin-gi-food-context',
    appliesTo: {
      localDrugIds: ['d-001'],
      ingredients: ['metformin'],
      classLabels: ['biguanides'],
    },
    domain: 'nutrition',
    trigger: 'Metformin active and GI-tolerance pattern suspected',
    effect: 'Track meal context around medication actions',
    recommendationKind: 'tracking_prompt',
    riskLevel: 'low',
    title: 'Meal context tracking',
    body: 'Meal context is tracked around metformin doses because GI tolerance can vary with intake patterns.',
    evidenceRefs: [{ label: 'DailyMed metformin label', url: 'https://dailymed.nlm.nih.gov/' }],
  },
];

function includesAny(values: string[] | undefined, candidates: string[]): boolean {
  if (!values || values.length === 0) return false;
  const normalized = values.map((value) => value.toLowerCase());
  return candidates.some((candidate) => normalized.includes(candidate.toLowerCase()));
}

export function findRulesForMedication(input: {
  localDrugId: string | null;
  ingredients: string[];
  classLabels: string[];
}): MedicationLifestyleRule[] {
  return CURATED_MEDICATION_RULES.filter((rule) => {
    const localMatch = input.localDrugId ? rule.appliesTo.localDrugIds?.includes(input.localDrugId) : false;
    const ingredientMatch = includesAny(input.ingredients, rule.appliesTo.ingredients ?? []);
    const classMatch = includesAny(input.classLabels, rule.appliesTo.classLabels ?? []);
    return Boolean(localMatch || ingredientMatch || classMatch);
  });
}
```

- [ ] **Step 6: Run tests**

```bash
node --experimental-strip-types --test \
  src/lib/medKnowledge/rules.test.mjs \
  src/lib/medKnowledge/safety.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/medKnowledge/rules.ts src/lib/medKnowledge/safety.ts src/lib/medKnowledge/rules.test.mjs src/lib/medKnowledge/safety.test.mjs
git commit -m "feat: add medication lifestyle rules"
```

---

## Task 3: Medication Map Reader

**Files:**
- Create: `src/lib/medKnowledge/mapReader.ts`
- Test: `src/lib/medKnowledge/mapReader.test.mjs`

- [ ] **Step 1: Write failing map-reader test**

Create `src/lib/medKnowledge/mapReader.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { buildMedicationMapItems } from './mapReader.ts';

test('buildMedicationMapItems maps active medication protocol items into stable medication map rows', () => {
  const rows = buildMedicationMapItems({
    userId: 'user-1',
    activeProtocols: [
      {
        id: 'ap-1',
        status: 'active',
        startDate: '2026-04-01',
        endDate: null,
        protocol: {
          items: [
            {
              id: 'pi-1',
              itemType: 'medication',
              name: 'Semaglutide',
              drugId: 'd-028',
              doseAmount: 0.5,
              doseUnit: 'mg',
              doseForm: 'injection',
              route: 'subcutaneous',
              frequencyType: 'weekly',
              times: ['08:00'],
              withFood: 'any',
            },
            {
              id: 'pi-2',
              itemType: 'analysis',
              name: 'HbA1c',
              frequencyType: 'every_n_days',
              times: [],
            },
          ],
        },
      },
    ],
    drugs: [
      { id: 'd-028', name: 'Semaglutide', genericName: 'Semaglutide' },
    ],
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].displayName, 'Semaglutide');
  assert.equal(rows[0].genericName, 'Semaglutide');
  assert.equal(rows[0].sourceHash.length, 64);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --experimental-strip-types --test src/lib/medKnowledge/mapReader.test.mjs
```

Expected: FAIL with module not found for `mapReader.ts`.

- [ ] **Step 3: Create map reader**

Create `src/lib/medKnowledge/mapReader.ts`:

```ts
import { createHash } from 'node:crypto';

import { MedicationMapItem } from './types';

type RawDrug = {
  id: string;
  name: string;
  genericName?: string | null;
};

type RawProtocolItem = {
  id: string;
  itemType: string;
  name: string;
  drugId?: string | null;
  doseAmount?: number | null;
  doseUnit?: string | null;
  doseForm?: string | null;
  route?: string | null;
  frequencyType?: string | null;
  times?: string[];
  withFood?: 'yes' | 'no' | 'any' | null;
};

type RawActiveProtocol = {
  id: string;
  status: 'active' | 'paused' | 'completed' | 'abandoned';
  startDate: string;
  endDate?: string | null;
  protocol: {
    items: RawProtocolItem[];
  };
};

export type BuildMedicationMapItemsInput = {
  userId: string;
  activeProtocols: RawActiveProtocol[];
  drugs: RawDrug[];
};

function hashSource(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function buildMedicationMapItems(input: BuildMedicationMapItemsInput): MedicationMapItem[] {
  const drugById = new Map(input.drugs.map((drug) => [drug.id, drug]));

  return input.activeProtocols.flatMap((activeProtocol) => {
    return activeProtocol.protocol.items
      .filter((item) => item.itemType === 'medication')
      .map((item) => {
        const drug = item.drugId ? drugById.get(item.drugId) : undefined;
        const source = {
          activeProtocolId: activeProtocol.id,
          protocolItemId: item.id,
          drugId: item.drugId ?? null,
          name: item.name,
          doseAmount: item.doseAmount ?? null,
          doseUnit: item.doseUnit ?? null,
          doseForm: item.doseForm ?? null,
          route: item.route ?? null,
          frequencyType: item.frequencyType ?? null,
          times: item.times ?? [],
          withFood: item.withFood ?? null,
          status: activeProtocol.status,
        };

        return {
          id: `${activeProtocol.id}:${item.id}`,
          userId: input.userId,
          activeProtocolId: activeProtocol.id,
          protocolItemId: item.id,
          drugId: item.drugId ?? null,
          displayName: drug?.name ?? item.name,
          genericName: drug?.genericName ?? null,
          doseAmount: item.doseAmount ?? null,
          doseUnit: item.doseUnit ?? null,
          doseForm: item.doseForm ?? null,
          route: item.route ?? null,
          frequencyType: item.frequencyType ?? null,
          times: item.times ?? [],
          withFood: item.withFood ?? null,
          startDate: activeProtocol.startDate,
          endDate: activeProtocol.endDate ?? null,
          status: activeProtocol.status,
          sourceHash: hashSource(source),
        };
      });
  });
}
```

- [ ] **Step 4: Run test**

```bash
node --experimental-strip-types --test src/lib/medKnowledge/mapReader.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/medKnowledge/mapReader.ts src/lib/medKnowledge/mapReader.test.mjs
git commit -m "feat: build medication map items"
```

---

## Task 4: Normalizer and RxNorm Client

**Files:**
- Create: `src/lib/medKnowledge/normalizer.ts`
- Test: `src/lib/medKnowledge/normalizer.test.mjs`

- [ ] **Step 1: Write failing normalizer test**

Create `src/lib/medKnowledge/normalizer.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeMedicationFromLocalRules } from './normalizer.ts';

test('normalizeMedicationFromLocalRules recognizes semaglutide as GLP-1', () => {
  const result = normalizeMedicationFromLocalRules({
    medicationMapItemId: 'ap-1:pi-1',
    drugId: 'd-028',
    displayName: 'Semaglutide',
    genericName: 'Semaglutide',
  });

  assert.equal(result.normalizedName, 'Semaglutide');
  assert.deepEqual(result.ingredients, ['semaglutide']);
  assert.ok(result.classLabels.includes('GLP-1 receptor agonist'));
  assert.equal(result.source, 'seed');
});

test('normalizeMedicationFromLocalRules returns low confidence manual candidate for unknown medication', () => {
  const result = normalizeMedicationFromLocalRules({
    medicationMapItemId: 'ap-1:pi-2',
    drugId: null,
    displayName: 'Unknown Custom Compound',
    genericName: null,
  });

  assert.equal(result.source, 'manual');
  assert.equal(result.confidence, 0.2);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --experimental-strip-types --test src/lib/medKnowledge/normalizer.test.mjs
```

Expected: FAIL with module not found for `normalizer.ts`.

- [ ] **Step 3: Create normalizer**

Create `src/lib/medKnowledge/normalizer.ts`:

```ts
import { MedicationNormalization } from './types';

type NormalizeInput = {
  medicationMapItemId: string;
  drugId: string | null;
  displayName: string;
  genericName: string | null;
};

const LOCAL_NORMALIZATION_RULES: Record<string, Omit<MedicationNormalization, 'medicationMapItemId'>> = {
  'd-028': {
    rxnormRxcui: null,
    normalizedName: 'Semaglutide',
    ingredients: ['semaglutide'],
    classCodes: ['local:glp1'],
    classLabels: ['GLP-1 receptor agonist'],
    source: 'seed',
    confidence: 0.98,
    ambiguityNotes: null,
  },
  'd-025': {
    rxnormRxcui: null,
    normalizedName: 'Testosterone',
    ingredients: ['testosterone'],
    classCodes: ['local:androgen'],
    classLabels: ['androgen'],
    source: 'seed',
    confidence: 0.98,
    ambiguityNotes: null,
  },
  'd-007': {
    rxnormRxcui: null,
    normalizedName: 'Levothyroxine',
    ingredients: ['levothyroxine'],
    classCodes: ['local:thyroid_hormone'],
    classLabels: ['thyroid hormones'],
    source: 'seed',
    confidence: 0.96,
    ambiguityNotes: null,
  },
  'd-016': {
    rxnormRxcui: null,
    normalizedName: 'Sertraline',
    ingredients: ['sertraline'],
    classCodes: ['local:ssri'],
    classLabels: ['selective serotonin reuptake inhibitors'],
    source: 'seed',
    confidence: 0.96,
    ambiguityNotes: null,
  },
  'd-017': {
    rxnormRxcui: null,
    normalizedName: 'Escitalopram',
    ingredients: ['escitalopram'],
    classCodes: ['local:ssri'],
    classLabels: ['selective serotonin reuptake inhibitors'],
    source: 'seed',
    confidence: 0.96,
    ambiguityNotes: null,
  },
};

export function normalizeMedicationFromLocalRules(input: NormalizeInput): MedicationNormalization {
  const local = input.drugId ? LOCAL_NORMALIZATION_RULES[input.drugId] : undefined;
  if (local) {
    return { medicationMapItemId: input.medicationMapItemId, ...local };
  }

  return {
    medicationMapItemId: input.medicationMapItemId,
    rxnormRxcui: null,
    normalizedName: input.genericName ?? input.displayName,
    ingredients: [],
    classCodes: [],
    classLabels: [],
    source: 'manual',
    confidence: 0.2,
    ambiguityNotes: 'No deterministic local medication knowledge match.',
  };
}

export async function lookupRxNormApproximate(name: string): Promise<unknown> {
  const url = new URL('https://rxnav.nlm.nih.gov/REST/approximateTerm.json');
  url.searchParams.set('term', name);
  url.searchParams.set('maxEntries', '5');
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`RxNorm lookup failed: ${response.status}`);
  }
  return response.json();
}
```

- [ ] **Step 4: Run test**

```bash
node --experimental-strip-types --test src/lib/medKnowledge/normalizer.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/medKnowledge/normalizer.ts src/lib/medKnowledge/normalizer.test.mjs
git commit -m "feat: normalize medication classes"
```

---

## Task 5: OpenRouter Structured Client

**Files:**
- Create: `src/lib/medKnowledge/aiSchemas.ts`
- Create: `src/lib/medKnowledge/openRouter.ts`
- Test: `src/lib/medKnowledge/openRouter.test.mjs`

- [ ] **Step 1: Write failing OpenRouter request test**

Create `src/lib/medKnowledge/openRouter.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { buildOpenRouterStructuredRequest } from './openRouter.ts';
import { MEDICATION_CLASSIFICATION_SCHEMA } from './aiSchemas.ts';

test('buildOpenRouterStructuredRequest includes strict json schema and provider requirements', () => {
  const request = buildOpenRouterStructuredRequest({
    model: 'google/gemini-2.5-flash',
    schemaName: 'MedicationClassificationCandidate',
    schema: MEDICATION_CLASSIFICATION_SCHEMA,
    messages: [{ role: 'user', content: 'Classify semaglutide.' }],
  });

  assert.equal(request.model, 'google/gemini-2.5-flash');
  assert.equal(request.response_format.type, 'json_schema');
  assert.equal(request.response_format.json_schema.strict, true);
  assert.equal(request.provider.require_parameters, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --experimental-strip-types --test src/lib/medKnowledge/openRouter.test.mjs
```

Expected: FAIL with module not found for `openRouter.ts`.

- [ ] **Step 3: Create AI schemas**

Create `src/lib/medKnowledge/aiSchemas.ts`:

```ts
export const MEDICATION_CLASSIFICATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    normalizedName: { type: 'string' },
    ingredients: { type: 'array', items: { type: 'string' } },
    classLabels: { type: 'array', items: { type: 'string' } },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    ambiguityNotes: { type: ['string', 'null'] },
  },
  required: ['normalizedName', 'ingredients', 'classLabels', 'confidence', 'ambiguityNotes'],
} as const;

export const INSIGHT_DRAFT_REVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    accepted: { type: 'boolean' },
    severity: { type: 'string', enum: ['info', 'watch', 'review'] },
    recommendationKind: { type: 'string', enum: ['lifestyle_adjustment', 'tracking_prompt', 'clinician_review'] },
    safeTitle: { type: 'string' },
    safeBody: { type: 'string' },
    reasons: { type: 'array', items: { type: 'string' } },
  },
  required: ['accepted', 'severity', 'recommendationKind', 'safeTitle', 'safeBody', 'reasons'],
} as const;
```

- [ ] **Step 4: Create OpenRouter helper**

Create `src/lib/medKnowledge/openRouter.ts`:

```ts
type OpenRouterMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

type BuildOpenRouterStructuredRequestInput = {
  model: string;
  schemaName: string;
  schema: object;
  messages: OpenRouterMessage[];
};

export function getOpenRouterConfig(env: NodeJS.ProcessEnv = process.env) {
  return {
    apiBaseUrl: env.OPENROUTER_API_BASE_URL ?? 'https://openrouter.ai/api/v1',
    apiKey: env.OPENROUTER_API_KEY ?? '',
    httpReferer: env.OPENROUTER_HTTP_REFERER ?? env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
    appTitle: env.OPENROUTER_APP_TITLE ?? 'MedRemind',
    fastModel: env.MED_KNOWLEDGE_FAST_MODEL ?? 'google/gemini-2.5-flash',
    reasoningModel: env.MED_KNOWLEDGE_REASONING_MODEL ?? 'anthropic/claude-sonnet-4.5',
    secondOpinionModel: env.MED_KNOWLEDGE_SECOND_OPINION_MODEL ?? 'google/gemini-2.5-pro',
    nanoModel: env.MED_KNOWLEDGE_NANO_MODEL ?? 'google/gemini-2.5-flash-lite',
    longContextModel: env.MED_KNOWLEDGE_LONG_CONTEXT_MODEL ?? 'qwen/qwen3.6-plus',
    autoFallbackModel: env.MED_KNOWLEDGE_AUTO_FALLBACK_MODEL ?? 'openrouter/auto',
  };
}

export function buildOpenRouterStructuredRequest(input: BuildOpenRouterStructuredRequestInput) {
  return {
    model: input.model,
    messages: input.messages,
    response_format: {
      type: 'json_schema' as const,
      json_schema: {
        name: input.schemaName,
        strict: true,
        schema: input.schema,
      },
    },
    provider: {
      require_parameters: true,
    },
    temperature: 0,
  };
}

export async function callOpenRouterStructuredJson<T>(input: BuildOpenRouterStructuredRequestInput): Promise<T> {
  const config = getOpenRouterConfig();
  if (!config.apiKey) {
    throw new Error('OPENROUTER_API_KEY is required');
  }

  const response = await fetch(`${config.apiBaseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': config.httpReferer,
      'X-OpenRouter-Title': config.appTitle,
    },
    body: JSON.stringify(buildOpenRouterStructuredRequest(input)),
  });

  if (!response.ok) {
    throw new Error(`OpenRouter request failed: ${response.status}`);
  }

  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    throw new Error('OpenRouter response missing message content');
  }

  return JSON.parse(content) as T;
}
```

- [ ] **Step 5: Run test**

```bash
node --experimental-strip-types --test src/lib/medKnowledge/openRouter.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/medKnowledge/aiSchemas.ts src/lib/medKnowledge/openRouter.ts src/lib/medKnowledge/openRouter.test.mjs
git commit -m "feat: add OpenRouter structured client"
```

---

## Task 6: Evidence Indexing and Daily Exposure Features

**Files:**
- Create: `src/lib/medKnowledge/evidence.ts`
- Create: `src/lib/medKnowledge/features.ts`
- Test: `src/lib/medKnowledge/features.test.mjs`

- [ ] **Step 1: Write failing feature test**

Create `src/lib/medKnowledge/features.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { buildDailyMedicationExposure } from './features.ts';

test('buildDailyMedicationExposure marks GLP-1 and testosterone exposure', () => {
  const exposure = buildDailyMedicationExposure({
    userId: 'user-1',
    localDate: '2026-04-10',
    medications: [
      {
        startDate: '2026-04-01',
        classLabels: ['GLP-1 receptor agonist'],
        ingredients: ['semaglutide'],
        times: ['08:00'],
        route: 'subcutaneous',
      },
      {
        startDate: '2026-04-08',
        classLabels: ['androgen'],
        ingredients: ['testosterone'],
        times: ['09:00'],
        route: 'subcutaneous',
      },
    ],
    missedMedicationCount: 1,
    lateMedicationCount: 2,
    withFoodMismatchCount: 0,
  });

  assert.equal(exposure.hasGlp1Active, true);
  assert.equal(exposure.daysSinceGlp1Start, 9);
  assert.equal(exposure.hasTestosteroneActive, true);
  assert.equal(exposure.testosteroneInjectionDayOffset, 2);
  assert.equal(exposure.missedMedicationCount, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --experimental-strip-types --test src/lib/medKnowledge/features.test.mjs
```

Expected: FAIL with module not found for `features.ts`.

- [ ] **Step 3: Create evidence helper**

Create `src/lib/medKnowledge/evidence.ts`:

```ts
import { createHash } from 'node:crypto';

export type MedicationEvidenceDocument = {
  source: 'rxnorm' | 'rxclass' | 'dailymed' | 'openfda' | 'curated_rule' | 'clinical_advisory';
  sourceUrl: string | null;
  title: string;
  sectionName: string | null;
  contentExcerpt: string;
  contentHash: string;
  retrievalStrategy: 'lexical' | 'model_rerank' | 'vector';
};

export function buildEvidenceDocument(input: Omit<MedicationEvidenceDocument, 'contentHash'>): MedicationEvidenceDocument {
  const contentHash = createHash('sha256')
    .update([input.source, input.sourceUrl ?? '', input.title, input.sectionName ?? '', input.contentExcerpt].join('\n'))
    .digest('hex');

  return { ...input, contentHash };
}

export function lexicalEvidenceScore(query: string, document: MedicationEvidenceDocument): number {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const haystack = `${document.title} ${document.sectionName ?? ''} ${document.contentExcerpt}`.toLowerCase();
  return terms.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0);
}
```

- [ ] **Step 4: Create daily exposure feature builder**

Create `src/lib/medKnowledge/features.ts`:

```ts
import { DailyMedicationExposure } from './types';

type MedicationForExposure = {
  startDate: string | null;
  classLabels: string[];
  ingredients: string[];
  times: string[];
  route: string | null;
};

type BuildDailyMedicationExposureInput = {
  userId: string;
  localDate: string;
  medications: MedicationForExposure[];
  missedMedicationCount: number;
  lateMedicationCount: number;
  withFoodMismatchCount: number;
};

function includesLower(values: string[], needle: string): boolean {
  return values.some((value) => value.toLowerCase().includes(needle.toLowerCase()));
}

function daysBetween(startDate: string | null, localDate: string): number | null {
  if (!startDate) return null;
  const start = Date.parse(`${startDate}T00:00:00.000Z`);
  const end = Date.parse(`${localDate}T00:00:00.000Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(0, Math.round((end - start) / 86_400_000));
}

export function buildDailyMedicationExposure(input: BuildDailyMedicationExposureInput): DailyMedicationExposure {
  const glp1 = input.medications.find((med) => (
    includesLower(med.classLabels, 'GLP-1') ||
    includesLower(med.ingredients, 'semaglutide') ||
    includesLower(med.ingredients, 'tirzepatide')
  ));
  const testosterone = input.medications.find((med) => includesLower(med.ingredients, 'testosterone') || includesLower(med.classLabels, 'androgen'));
  const betaBlocker = input.medications.some((med) => includesLower(med.classLabels, 'beta blocker'));
  const thyroid = input.medications.some((med) => includesLower(med.ingredients, 'levothyroxine') || includesLower(med.classLabels, 'thyroid'));
  const ssri = input.medications.some((med) => includesLower(med.classLabels, 'selective serotonin reuptake inhibitors'));
  const daysSinceGlp1Start = daysBetween(glp1?.startDate ?? null, input.localDate);

  const medicationReviewSignalCount =
    Number(Boolean(testosterone)) +
    Number(input.missedMedicationCount > 0) +
    Number(input.lateMedicationCount > 1);

  return {
    userId: input.userId,
    localDate: input.localDate,
    hasGlp1Active: Boolean(glp1),
    daysSinceGlp1Start,
    glp1DoseEscalationPhase: daysSinceGlp1Start !== null && daysSinceGlp1Start <= 56,
    hasTestosteroneActive: Boolean(testosterone),
    testosteroneInjectionDayOffset: daysBetween(testosterone?.startDate ?? null, input.localDate),
    hasBetaBlockerActive: betaBlocker,
    hasThyroidMedActive: thyroid,
    hasSsriActive: ssri,
    withFoodMismatchCount: input.withFoodMismatchCount,
    lateMedicationCount: input.lateMedicationCount,
    missedMedicationCount: input.missedMedicationCount,
    medicationClassExposureScore: input.medications.length,
    medicationReviewSignalCount,
  };
}
```

- [ ] **Step 5: Run test**

```bash
node --experimental-strip-types --test src/lib/medKnowledge/features.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/medKnowledge/evidence.ts src/lib/medKnowledge/features.ts src/lib/medKnowledge/features.test.mjs
git commit -m "feat: build medication exposure features"
```

---

## Task 7: Persistence and API Routes

**Files:**
- Create: `src/lib/medKnowledge/persistence.ts`
- Create: `src/app/api/medication-knowledge/refresh/route.ts`
- Create: `src/app/api/medication-knowledge/profile/route.ts`

- [ ] **Step 1: Create persistence helper**

Create `src/lib/medKnowledge/persistence.ts`:

```ts
import { createClient } from '@supabase/supabase-js';

import { DailyMedicationExposure, MedicationMapItem, MedicationNormalization } from './types';

function getServiceClient() {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Supabase service role environment is required for medication knowledge');
  }

  return createClient(supabaseUrl, serviceRoleKey);
}

export async function saveMedicationMapItems(items: MedicationMapItem[]) {
  if (items.length === 0) return;
  const supabase = getServiceClient();
  const rows = items.map((item) => ({
    user_id: item.userId,
    active_protocol_id: item.activeProtocolId,
    protocol_item_id: item.protocolItemId,
    drug_id: item.drugId,
    display_name: item.displayName,
    generic_name: item.genericName,
    dose_amount: item.doseAmount,
    dose_unit: item.doseUnit,
    dose_form: item.doseForm,
    route: item.route,
    frequency_type: item.frequencyType,
    times: item.times,
    with_food: item.withFood,
    start_date: item.startDate,
    end_date: item.endDate,
    status: item.status,
    source_hash: item.sourceHash,
  }));

  const { error } = await supabase
    .from('medication_map_items')
    .upsert(rows, { onConflict: 'user_id,active_protocol_id,protocol_item_id' });

  if (error) throw error;
}

export async function saveMedicationNormalizations(userId: string, normalizations: MedicationNormalization[]) {
  if (normalizations.length === 0) return;
  const supabase = getServiceClient();
  const rows = normalizations.map((normalization) => ({
    user_id: userId,
    medication_map_item_id: normalization.medicationMapItemId,
    rxnorm_rxcui: normalization.rxnormRxcui,
    normalized_name: normalization.normalizedName,
    ingredients: normalization.ingredients,
    class_codes: normalization.classCodes,
    class_labels: normalization.classLabels,
    source: normalization.source,
    confidence: normalization.confidence,
    ambiguity_notes: normalization.ambiguityNotes,
  }));

  const { error } = await supabase
    .from('medication_normalizations')
    .upsert(rows, { onConflict: 'medication_map_item_id' });

  if (error) throw error;
}

export async function saveDailyMedicationExposure(exposure: DailyMedicationExposure) {
  const supabase = getServiceClient();
  const { error } = await supabase
    .from('daily_medication_exposures')
    .upsert({
      user_id: exposure.userId,
      local_date: exposure.localDate,
      has_glp1_active: exposure.hasGlp1Active,
      days_since_glp1_start: exposure.daysSinceGlp1Start,
      glp1_dose_escalation_phase: exposure.glp1DoseEscalationPhase,
      has_testosterone_active: exposure.hasTestosteroneActive,
      testosterone_injection_day_offset: exposure.testosteroneInjectionDayOffset,
      has_beta_blocker_active: exposure.hasBetaBlockerActive,
      has_thyroid_med_active: exposure.hasThyroidMedActive,
      has_ssri_active: exposure.hasSsriActive,
      with_food_mismatch_count: exposure.withFoodMismatchCount,
      late_medication_count: exposure.lateMedicationCount,
      missed_medication_count: exposure.missedMedicationCount,
      medication_class_exposure_score: exposure.medicationClassExposureScore,
      medication_review_signal_count: exposure.medicationReviewSignalCount,
    }, { onConflict: 'user_id,local_date' });

  if (error) throw error;
}
```

- [ ] **Step 2: Create refresh route**

Create `src/app/api/medication-knowledge/refresh/route.ts`:

```ts
import { NextResponse } from 'next/server';

import { buildMedicationMapItems } from '@/lib/medKnowledge/mapReader';
import { normalizeMedicationFromLocalRules } from '@/lib/medKnowledge/normalizer';
import { saveMedicationMapItems, saveMedicationNormalizations } from '@/lib/medKnowledge/persistence';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

export async function POST() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: activeProtocols, error: activeError } = await supabase
    .from('active_protocols')
    .select('id, status, start_date, end_date, protocols(protocol_items(*))')
    .eq('user_id', data.user.id)
    .in('status', ['active', 'paused']);

  if (activeError) {
    return NextResponse.json({ error: 'Unable to load active protocols.' }, { status: 500 });
  }

  const { data: drugs, error: drugsError } = await supabase
    .from('drugs')
    .select('id, name, generic_name');

  if (drugsError) {
    return NextResponse.json({ error: 'Unable to load drugs.' }, { status: 500 });
  }

  const mappedActiveProtocols = (activeProtocols ?? []).map((row) => ({
    id: row.id,
    status: row.status,
    startDate: row.start_date,
    endDate: row.end_date,
    protocol: {
      items: ((row.protocols?.protocol_items ?? []) as Array<Record<string, unknown>>).map((item) => ({
        id: String(item.id),
        itemType: String(item.item_type),
        name: String(item.name),
        drugId: item.drug_id ? String(item.drug_id) : null,
        doseAmount: item.dose_amount === null ? null : Number(item.dose_amount),
        doseUnit: item.dose_unit ? String(item.dose_unit) : null,
        doseForm: item.dose_form ? String(item.dose_form) : null,
        route: item.route ? String(item.route) : null,
        frequencyType: item.frequency_type ? String(item.frequency_type) : null,
        times: Array.isArray(item.times) ? item.times.map(String) : [],
        withFood: item.with_food === 'yes' || item.with_food === 'no' || item.with_food === 'any' ? item.with_food : null,
      })),
    },
  }));

  const mappedDrugs = (drugs ?? []).map((drug) => ({
    id: drug.id,
    name: drug.name,
    genericName: drug.generic_name,
  }));

  const mapItems = buildMedicationMapItems({
    userId: data.user.id,
    activeProtocols: mappedActiveProtocols,
    drugs: mappedDrugs,
  });

  await saveMedicationMapItems(mapItems);

  const normalizations = mapItems.map((item) => normalizeMedicationFromLocalRules({
    medicationMapItemId: item.id,
    drugId: item.drugId,
    displayName: item.displayName,
    genericName: item.genericName,
  }));

  await saveMedicationNormalizations(data.user.id, normalizations);

  return NextResponse.json({
    medicationCount: mapItems.length,
    normalizedCount: normalizations.length,
  });
}
```

- [ ] **Step 3: Create profile route**

Create `src/app/api/medication-knowledge/profile/route.ts`:

```ts
import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

export async function GET() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: rows, error: rowsError } = await supabase
    .from('medication_map_items')
    .select('id, display_name, generic_name, route, dose_amount, dose_unit, medication_normalizations(normalized_name, ingredients, class_labels, confidence, source)')
    .eq('user_id', data.user.id)
    .order('display_name');

  if (rowsError) {
    return NextResponse.json({ error: 'Unable to load medication profile.' }, { status: 500 });
  }

  return NextResponse.json({ medications: rows ?? [] });
}
```

- [ ] **Step 4: Build**

```bash
npm run build
```

Expected: PASS. The route list includes `/api/medication-knowledge/profile` and `/api/medication-knowledge/refresh`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/medKnowledge/persistence.ts src/app/api/medication-knowledge/refresh/route.ts src/app/api/medication-knowledge/profile/route.ts
git commit -m "feat: add medication knowledge API"
```

---

## Task 8: Medication Intelligence UI and Docs

**Files:**
- Create: `src/app/app/insights/medications/page.tsx`
- Modify: `README.md`
- Modify: `docs/current-status.md`

- [ ] **Step 1: Create medication intelligence page**

Create `src/app/app/insights/medications/page.tsx`:

```tsx
'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/Button';

type MedicationProfileRow = {
  id: string;
  display_name: string;
  generic_name: string | null;
  route: string | null;
  dose_amount: number | null;
  dose_unit: string | null;
  medication_normalizations?: Array<{
    normalized_name: string;
    ingredients: string[];
    class_labels: string[];
    confidence: number;
    source: string;
  }>;
};

export default function MedicationInsightsPage() {
  const [medications, setMedications] = useState<MedicationProfileRow[]>([]);
  const [status, setStatus] = useState<string>('Idle');

  async function refresh() {
    setStatus('Refreshing medication intelligence...');
    const refreshResponse = await fetch('/api/medication-knowledge/refresh', { method: 'POST' });
    if (!refreshResponse.ok) {
      setStatus('Refresh failed.');
      return;
    }

    const profileResponse = await fetch('/api/medication-knowledge/profile');
    if (!profileResponse.ok) {
      setStatus('Profile load failed.');
      return;
    }

    const payload = await profileResponse.json();
    setMedications(payload.medications ?? []);
    setStatus('Medication intelligence refreshed.');
  }

  return (
    <main className="min-h-screen bg-neutral-50 px-4 pb-24 pt-6">
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <header>
          <h1 className="text-2xl font-semibold text-neutral-950">Medication Intelligence</h1>
          <p className="mt-1 text-sm text-neutral-600">
            Review how your active medication map is classified for nutrition, hydration, activity, sleep, stress, and adherence analysis.
          </p>
        </header>

        <section className="rounded-lg border border-neutral-200 bg-white p-4">
          <p className="text-sm text-neutral-700">
            Medication-related findings are used for lifestyle analysis and clinician-review prompts. The app does not change medication timing, dosage, or schedules.
          </p>
          <Button className="mt-4" onClick={refresh}>Refresh medication map</Button>
          <p className="mt-3 text-sm text-neutral-500">{status}</p>
        </section>

        {medications.map((medication) => {
          const normalization = medication.medication_normalizations?.[0];
          return (
            <article key={medication.id} className="rounded-lg border border-neutral-200 bg-white p-4">
              <h2 className="text-lg font-semibold text-neutral-950">{medication.display_name}</h2>
              <p className="mt-1 text-sm text-neutral-600">
                {medication.dose_amount ?? ''} {medication.dose_unit ?? ''} {medication.route ?? ''}
              </p>
              {normalization && (
                <div className="mt-3 text-sm text-neutral-700">
                  <p>Normalized: {normalization.normalized_name}</p>
                  <p>Classes: {normalization.class_labels.join(', ') || 'None'}</p>
                  <p>Confidence: {Math.round(normalization.confidence * 100)}%</p>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Update README functional scope**

Add under `Current Functional Scope`:

```markdown
- Medication Intelligence:
  - reads active medication protocols into a normalized medication map
  - classifies high-value medication classes such as GLP-1, testosterone, thyroid medication, SSRIs, and metabolic/cardiovascular classes
  - feeds medication-aware lifestyle features into the correlation engine
  - uses OpenRouter structured outputs for AI-assisted classification and review
```

- [ ] **Step 3: Update README environment variables**

Add under environment variables:

```markdown
Medication Knowledge / OpenRouter:

- `OPENROUTER_API_KEY`
- `OPENROUTER_API_BASE_URL`: optional; defaults to `https://openrouter.ai/api/v1`
- `OPENROUTER_HTTP_REFERER`: optional; defaults to `NEXT_PUBLIC_APP_URL`
- `OPENROUTER_APP_TITLE`: optional; defaults to `MedRemind`
- `MED_KNOWLEDGE_FAST_MODEL`: optional; defaults to `google/gemini-2.5-flash`
- `MED_KNOWLEDGE_REASONING_MODEL`: optional; defaults to `anthropic/claude-sonnet-4.5`
- `MED_KNOWLEDGE_SECOND_OPINION_MODEL`: optional; defaults to `google/gemini-2.5-pro`
- `MED_KNOWLEDGE_NANO_MODEL`: optional; defaults to `google/gemini-2.5-flash-lite`
- `MED_KNOWLEDGE_LONG_CONTEXT_MODEL`: optional; defaults to `qwen/qwen3.6-plus`
```

- [ ] **Step 4: Update current status**

Add under landed behavior after the feature lands:

```markdown
### Medication Intelligence

- Active medication protocols can be read into a normalized medication map.
- Curated deterministic rules cover first-pass medication lifestyle implications for GLP-1, testosterone, thyroid, SSRI, metabolic, cardiovascular, and supplement classes.
- OpenRouter is the AI provider for structured classification/review pipelines.
- Medication-related outputs remain lifestyle prompts or clinician-review flags; protocol schedules and dosages are not changed automatically.
```

- [ ] **Step 5: Run full verification**

```bash
node --experimental-strip-types --test \
  src/lib/medKnowledge/types.test.mjs \
  src/lib/medKnowledge/rules.test.mjs \
  src/lib/medKnowledge/safety.test.mjs \
  src/lib/medKnowledge/mapReader.test.mjs \
  src/lib/medKnowledge/normalizer.test.mjs \
  src/lib/medKnowledge/openRouter.test.mjs \
  src/lib/medKnowledge/features.test.mjs
npm run build
```

Expected: all tests PASS and `npm run build` PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/app/insights/medications/page.tsx README.md docs/current-status.md
git commit -m "feat: add medication intelligence UI"
```

---

## Task 9: Multiagent Integration Gate

**Files:**
- No new files.
- Inspect all files changed by Tasks 1-8.

- [ ] **Step 1: Check branch cleanliness and commits**

```bash
git status --short --branch
git log --oneline --max-count=10
```

Expected: clean working tree after the final task commit.

- [ ] **Step 2: Run all project checks**

```bash
node --experimental-strip-types --test \
  src/lib/medKnowledge/types.test.mjs \
  src/lib/medKnowledge/rules.test.mjs \
  src/lib/medKnowledge/safety.test.mjs \
  src/lib/medKnowledge/mapReader.test.mjs \
  src/lib/medKnowledge/normalizer.test.mjs \
  src/lib/medKnowledge/openRouter.test.mjs \
  src/lib/medKnowledge/features.test.mjs
npm run build
```

Expected: PASS.

- [ ] **Step 3: Review safety constraints**

Run:

```bash
rg -n "\\b(stop|pause|skip|cancel|discontinue|move|reschedule|delay|reduce|increase|double|halve)\\b" src/lib/medKnowledge src/app/app/insights/medications README.md docs/current-status.md
```

Expected: matches only in test fixtures, safety regex definitions, or explicit "does not change medication" wording. No user-facing recommendation should instruct a medication change.

- [ ] **Step 4: Verify no secrets were added**

```bash
git diff main...HEAD -- . ':(exclude)docs/superpowers/plans/2026-04-26-medication-knowledge-openrouter-multiagent.md' | rg -n "OPENROUTER_API_KEY=|sk-|Bearer [A-Za-z0-9_-]{20,}|OURA_CLIENT_SECRET=" || true
```

Expected: no output.

- [ ] **Step 5: Final commit if documentation changed during integration**

```bash
git status --short
```

Expected: no output. If documentation was adjusted during integration, commit it:

```bash
git add README.md docs/current-status.md
git commit -m "docs: finalize medication knowledge implementation notes"
```

---

## Self-Review

Spec coverage:

- Hybrid curated + RxNorm + DailyMed/openFDA design is covered by Tasks 1, 2, 4, and 6.
- OpenRouter model stack is covered by Task 5 and README env docs in Task 8.
- Sync/storage/processing is covered by Task 1 schema and Task 7 persistence/API.
- Medication map reader is covered by Task 3.
- GLP-1 and testosterone examples are covered by Task 2 rules and Task 6 exposure features.
- Multiagent execution is covered by explicit worker ownership and merge order.

Placeholder scan:

- No open implementation placeholders remain.
- Every task has concrete files, commands, and expected outcomes.

Type consistency:

- `MedicationMapItem`, `MedicationNormalization`, `MedicationLifestyleRule`, and `DailyMedicationExposure` are defined once in Task 1 and used consistently in later tasks.
- OpenRouter model env names match the design spec.

Safety check:

- The plan contains direct medication-change verbs only inside blocked regex/test assertions or safety-boundary wording.
- Generated application behavior is limited to lifestyle prompts and clinician-review flags.
