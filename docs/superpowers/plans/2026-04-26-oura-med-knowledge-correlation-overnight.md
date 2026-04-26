# Oura Medication Knowledge Correlation Overnight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land one coordinated overnight build that connects Oura data, prepares an Apple Health-compatible health snapshot boundary, builds the Medication Knowledge Layer through OpenRouter, and exposes medication-aware lifestyle/correlation insights.

**Architecture:** Execute as one orchestrated branch stack, not as one uncontrolled mixed branch. Oura integration lands first, then a neutral external health snapshot layer, then medication knowledge, then correlation insights and UI. Each worker owns a disjoint write set; final integration happens only after each slice passes focused tests.

**Tech Stack:** Next.js App Router, TypeScript, Supabase Postgres, Zustand where existing client state is already used, Oura OAuth2/V2 API, Apple Health-ready source abstraction, OpenRouter Chat Completions with structured outputs, RxNorm/RxClass, DailyMed/openFDA, Node `node:test`, Playwright smoke tests.

---

## Verified External Constraints

- Oura server-side OAuth uses `https://cloud.ouraring.com/oauth/authorize` and `https://api.ouraring.com/oauth/token`; use `response_type=code`, CSRF `state`, and server-side token exchange.
- Oura refresh tokens are single-use. Persist the replacement refresh token atomically after every refresh.
- Oura access must be scoped. The first integration should request only scopes required for product features: `email personal daily heartrate workout session spo2 ring_configuration stress heart_health`.
- Oura V1 is removed; all data reads must use `/v2/usercollection/*`.
- Oura rate limit is documented as 5000 requests per 5 minutes. Nightly jobs must batch by user/date window and retry conservatively.
- OpenRouter uses OpenAI-compatible `POST https://openrouter.ai/api/v1/chat/completions`.
- OpenRouter structured outputs use `response_format: { type: "json_schema", json_schema: { strict: true, schema } }`.
- For structured medication pipelines, set provider preferences with `require_parameters: true` and fail closed when a selected model does not support `response_format`.
- OpenRouter attribution headers should include `HTTP-Referer` and `X-OpenRouter-Title`.

References:

- Oura auth docs: `https://cloud.ouraring.com/docs/authentication`
- Oura error/rate limit docs: `https://cloud.ouraring.com/docs/error-handling`
- OpenRouter API reference: `https://openrouter.ai/docs/api/reference/overview`
- OpenRouter structured outputs: `https://openrouter.ai/docs/guides/features/structured-outputs`

## Product Boundary

The overnight build may generate:

- Oura connection status and daily import status.
- Health snapshots for sleep, readiness, activity, stress, SpO2, heart-health, and workout signals.
- Medication-aware nutrition, hydration, activity, recovery, sleep, and tracking prompts.
- Clinician-review flags when medication/lifestyle/biomarker patterns deserve professional review.
- Explainable correlation cards over 30, 60, and 90 day windows.

The build must not generate direct user instructions to stop, pause, skip, reschedule, delay, reduce, increase, double, or halve prescription medication. Medication-change-adjacent content is clinician-review only.

## Overnight Execution Shape

Run this as a single coordinated session with one orchestrator and six workers.

- **Orchestrator:** owns branch/worktree setup, merge order, migration numbering, final build, final docs.
- **Worker A - Oura Backend:** owns existing Oura bootstrap files and tests.
- **Worker B - External Health Data:** owns neutral health snapshot schema, Oura daily adapter, Apple Health-compatible source boundary.
- **Worker C - Medication Knowledge Core:** owns medication schema, types, curated rules, safety validator.
- **Worker D - Evidence and OpenRouter:** owns RxNorm/RxClass client, DailyMed/openFDA evidence, OpenRouter structured client and AI schemas.
- **Worker E - Correlation Engine:** owns daily feature builder, stats, insight generation, persistence.
- **Worker F - Insights UI/API:** owns user-facing integration cards, insights pages, bottom navigation, settings entry points.

Merge order:

```text
Oura bootstrap
  -> external health snapshots
  -> medication knowledge core
  -> evidence/OpenRouter
  -> correlation engine
  -> insights UI/API
  -> final QA/docs
```

Do not run Workers B-F against the dirty `codex/oura-integration-bootstrap` worktree. First convert that worktree into a checkpoint commit, then merge or cherry-pick it into the integration branch.

## Branch And Worktree Setup

- [ ] **Step 1: Verify current worktrees**

Run from `/Volumes/DATA/GRAVITY REPO/medremind-app`:

```bash
git worktree list
git status --short --branch
```

Expected:

```text
codex/oura-integration-bootstrap has Oura changes only
codex/e1-correlation-engine-plan is clean
codex/e2-medication-knowledge-layer-spec is clean
```

- [ ] **Step 2: Checkpoint the current Oura bootstrap branch**

Run from `/Volumes/DATA/GRAVITY REPO/medremind-app`:

```bash
git status --short --branch
npm run build
node --experimental-strip-types --test src/lib/oura/oauth.test.mjs src/lib/oura/tokenCrypto.test.mjs
git diff --check
```

Expected:

```text
Build passes
Oura tests pass
git diff --check has no output
```

If and only if the diff contains only Oura integration files, commit:

```bash
git add README.md src/app/api/integrations/oura src/lib/oura supabase/007_oura_integrations.sql
git commit -m "feat: add Oura integration bootstrap"
```

- [ ] **Step 3: Create the combined implementation worktree**

Run from `/Volumes/DATA/GRAVITY REPO/medremind-app`:

```bash
git fetch --all --prune
git worktree add -b codex/e5-oura-med-knowledge-correlation "../medremind-app-overnight-impl" main
cd "../medremind-app-overnight-impl"
git status --short --branch
```

Expected:

```text
## codex/e5-oura-med-knowledge-correlation
```

- [ ] **Step 4: Bring in documentation context and Oura bootstrap**

Run inside `/Volumes/DATA/GRAVITY REPO/medremind-app-overnight-impl`:

```bash
git cherry-pick codex/oura-integration-bootstrap
git cherry-pick codex/e1-correlation-engine-plan
git cherry-pick codex/e2-medication-knowledge-layer-spec
```

Expected:

```text
Each cherry-pick applies cleanly
```

If migration numbering conflicts, stop and renumber before continuing:

```text
007_oura_integrations.sql
008_external_health_snapshots.sql
009_medication_knowledge.sql
010_correlation_insights.sql
```

## File Ownership Map

### Worker A - Oura Backend

- `supabase/007_oura_integrations.sql`
- `src/lib/oura/config.ts`
- `src/lib/oura/oauth.ts`
- `src/lib/oura/client.ts`
- `src/lib/oura/tokenCrypto.ts`
- `src/lib/oura/tokenStore.ts`
- `src/lib/oura/*.test.mjs`
- `src/app/api/integrations/oura/connect/route.ts`
- `src/app/api/integrations/oura/callback/route.ts`
- `src/app/api/integrations/oura/status/route.ts`
- `src/app/api/integrations/oura/daily/route.ts`

### Worker B - External Health Data

- `supabase/008_external_health_snapshots.sql`
- `src/lib/health/types.ts`
- `src/lib/health/sourceRegistry.ts`
- `src/lib/health/ouraDailyMapper.ts`
- `src/lib/health/persistence.ts`
- `src/lib/health/*.test.mjs`
- `src/app/api/integrations/health/sync/route.ts`

### Worker C - Medication Knowledge Core

- `supabase/009_medication_knowledge.sql`
- `src/lib/medKnowledge/types.ts`
- `src/lib/medKnowledge/rules.ts`
- `src/lib/medKnowledge/safety.ts`
- `src/lib/medKnowledge/mapReader.ts`
- `src/lib/medKnowledge/features.ts`
- `src/lib/medKnowledge/*.test.mjs`

### Worker D - Evidence and OpenRouter

- `src/lib/medKnowledge/normalizer.ts`
- `src/lib/medKnowledge/evidence.ts`
- `src/lib/medKnowledge/aiSchemas.ts`
- `src/lib/medKnowledge/openRouter.ts`
- `src/lib/medKnowledge/openRouterModels.ts`
- `src/lib/medKnowledge/*.test.mjs`

### Worker E - Correlation Engine

- `supabase/010_correlation_insights.sql`
- `src/lib/correlation/types.ts`
- `src/lib/correlation/stats.ts`
- `src/lib/correlation/featureBuilder.ts`
- `src/lib/correlation/engine.ts`
- `src/lib/correlation/persistence.ts`
- `src/lib/correlation/medicationSafety.ts`
- `src/lib/correlation/*.test.mjs`
- `src/app/api/insights/correlations/route.ts`

### Worker F - Insights UI/API

- `src/app/app/insights/page.tsx`
- `src/app/app/insights/medications/page.tsx`
- `src/app/api/medication-knowledge/refresh/route.ts`
- `src/app/api/medication-knowledge/status/route.ts`
- `src/components/app/BottomNav.tsx`
- `src/app/app/settings/page.tsx`
- UI smoke tests if added under `tests/e2e/`

### Orchestrator - Docs and Final Gate

- `README.md`
- `docs/current-status.md`
- `docs/architecture-current-main.md`
- `docs/agent-handoff-current-main.md`
- final build/test logs

## Phase 1: Finish Oura Integration

- [ ] **Step 1: Verify OAuth state generation and callback validation**

Run:

```bash
node --experimental-strip-types --test src/lib/oura/oauth.test.mjs
```

Expected:

```text
ok
```

Implementation must ensure:

- `state` includes a random nonce and user/session binding.
- callback rejects missing, mismatched, or expired state.
- callback rejects missing `code`.
- callback handles `error=access_denied` without storing tokens.

- [ ] **Step 2: Verify token encryption**

Run:

```bash
node --experimental-strip-types --test src/lib/oura/tokenCrypto.test.mjs
```

Expected:

```text
ok
```

Implementation must ensure:

- AES-GCM or equivalent authenticated encryption.
- no token plaintext is returned to browser routes.
- invalid key length fails at startup.
- `OURA_TOKEN_ENCRYPTION_KEY` accepts exactly 32 UTF-8 bytes or base64-decoded 32 bytes.

- [ ] **Step 3: Verify route behavior**

Run:

```bash
rg -n "accessToken|refreshToken|clientSecret|OURA_CLIENT_SECRET" src/app/api/integrations/oura src/lib/oura
```

Expected:

```text
Matches only in server-side token exchange/storage code and tests.
No route returns token values in JSON.
```

- [ ] **Step 4: Build**

Run:

```bash
npm run build
```

Expected:

```text
Compiled successfully
```

- [ ] **Step 5: Commit Oura phase**

```bash
git add README.md src/app/api/integrations/oura src/lib/oura supabase/007_oura_integrations.sql
git commit -m "feat: connect Oura OAuth integration"
```

## Phase 2: External Health Snapshot Boundary

This phase prevents Oura-specific data from leaking into correlation and UI code. It also creates the future Apple Health boundary.

- [ ] **Step 1: Create health snapshot migration**

Create `supabase/008_external_health_snapshots.sql`:

```sql
-- MedRemind - external health daily snapshots.
-- Stores normalized daily health metrics from Oura now and Apple Health/HealthKit later.

create table if not exists external_health_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  source text not null check (source in ('oura', 'apple_health')),
  status text not null default 'connected' check (status in ('connected', 'disconnected', 'error')),
  scopes text[] not null default '{}',
  last_sync_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint external_health_connections_user_source_key unique (user_id, source)
);

alter table external_health_connections enable row level security;

drop policy if exists "Owner read external health connections" on external_health_connections;
create policy "Owner read external health connections" on external_health_connections
  for select using (auth.uid() = user_id);

create table if not exists external_health_daily_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  source text not null check (source in ('oura', 'apple_health')),
  local_date date not null,
  timezone text not null default 'UTC',
  sleep_score int,
  readiness_score int,
  activity_score int,
  stress_high_seconds int,
  recovery_high_seconds int,
  steps int,
  active_calories int,
  total_calories int,
  average_spo2 numeric,
  breathing_disturbance_index int,
  vo2_max numeric,
  resting_heart_rate numeric,
  hrv_balance text,
  resilience_level text,
  workout_count int not null default 0,
  raw_payload jsonb not null default '{}'::jsonb,
  imported_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint external_health_daily_snapshots_user_source_date_key unique (user_id, source, local_date)
);

alter table external_health_daily_snapshots enable row level security;

drop policy if exists "Owner read external health snapshots" on external_health_daily_snapshots;
create policy "Owner read external health snapshots" on external_health_daily_snapshots
  for select using (auth.uid() = user_id);

create index if not exists idx_external_health_daily_snapshots_user_date
  on external_health_daily_snapshots(user_id, local_date desc);
```

- [ ] **Step 2: Add health types and Oura mapper tests**

Create `src/lib/health/ouraDailyMapper.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { mapOuraDailyPayloadToHealthSnapshot } from './ouraDailyMapper.ts';

test('mapOuraDailyPayloadToHealthSnapshot maps daily sleep/readiness/activity/stress fields', () => {
  const snapshot = mapOuraDailyPayloadToHealthSnapshot({
    userId: 'u-1',
    localDate: '2026-04-25',
    timezone: 'Europe/London',
    dailySleep: { score: 82, contributors: { restfulness: 78 } },
    dailyReadiness: { score: 77 },
    dailyActivity: { score: 74, steps: 8600, active_calories: 520, total_calories: 2420 },
    dailyStress: { stress_high: 3600, recovery_high: 7200 },
    dailySpO2: { spo2_percentage: { average: 97.2 }, breathing_disturbance_index: 2 },
  });

  assert.equal(snapshot.source, 'oura');
  assert.equal(snapshot.userId, 'u-1');
  assert.equal(snapshot.localDate, '2026-04-25');
  assert.equal(snapshot.sleepScore, 82);
  assert.equal(snapshot.readinessScore, 77);
  assert.equal(snapshot.activityScore, 74);
  assert.equal(snapshot.steps, 8600);
  assert.equal(snapshot.averageSpo2, 97.2);
});
```

Run:

```bash
node --experimental-strip-types --test src/lib/health/ouraDailyMapper.test.mjs
```

Expected before implementation:

```text
ERR_MODULE_NOT_FOUND
```

- [ ] **Step 3: Implement health types and mapper**

Create `src/lib/health/types.ts`:

```ts
export type ExternalHealthSource = 'oura' | 'apple_health';

export type ExternalHealthDailySnapshot = {
  userId: string;
  source: ExternalHealthSource;
  localDate: string;
  timezone: string;
  sleepScore: number | null;
  readinessScore: number | null;
  activityScore: number | null;
  stressHighSeconds: number | null;
  recoveryHighSeconds: number | null;
  steps: number | null;
  activeCalories: number | null;
  totalCalories: number | null;
  averageSpo2: number | null;
  breathingDisturbanceIndex: number | null;
  vo2Max: number | null;
  restingHeartRate: number | null;
  resilienceLevel: string | null;
  workoutCount: number;
  rawPayload: Record<string, unknown>;
};
```

Create `src/lib/health/ouraDailyMapper.ts`:

```ts
import type { ExternalHealthDailySnapshot } from './types';

type OuraDailyPayload = {
  userId: string;
  localDate: string;
  timezone?: string;
  dailySleep?: { score?: number | null } | null;
  dailyReadiness?: { score?: number | null } | null;
  dailyActivity?: {
    score?: number | null;
    steps?: number | null;
    active_calories?: number | null;
    total_calories?: number | null;
  } | null;
  dailyStress?: { stress_high?: number | null; recovery_high?: number | null } | null;
  dailySpO2?: {
    spo2_percentage?: { average?: number | null } | null;
    breathing_disturbance_index?: number | null;
  } | null;
  heartHealth?: { vo2_max?: number | null } | null;
  workouts?: unknown[] | null;
};

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function mapOuraDailyPayloadToHealthSnapshot(input: OuraDailyPayload): ExternalHealthDailySnapshot {
  return {
    userId: input.userId,
    source: 'oura',
    localDate: input.localDate,
    timezone: input.timezone ?? 'UTC',
    sleepScore: numberOrNull(input.dailySleep?.score),
    readinessScore: numberOrNull(input.dailyReadiness?.score),
    activityScore: numberOrNull(input.dailyActivity?.score),
    stressHighSeconds: numberOrNull(input.dailyStress?.stress_high),
    recoveryHighSeconds: numberOrNull(input.dailyStress?.recovery_high),
    steps: numberOrNull(input.dailyActivity?.steps),
    activeCalories: numberOrNull(input.dailyActivity?.active_calories),
    totalCalories: numberOrNull(input.dailyActivity?.total_calories),
    averageSpo2: numberOrNull(input.dailySpO2?.spo2_percentage?.average),
    breathingDisturbanceIndex: numberOrNull(input.dailySpO2?.breathing_disturbance_index),
    vo2Max: numberOrNull(input.heartHealth?.vo2_max),
    restingHeartRate: null,
    resilienceLevel: null,
    workoutCount: Array.isArray(input.workouts) ? input.workouts.length : 0,
    rawPayload: input as unknown as Record<string, unknown>,
  };
}
```

- [ ] **Step 4: Implement health persistence and sync route**

Create `src/lib/health/persistence.ts` with a service-role-only upsert helper for `external_health_daily_snapshots`. Do not import it from client components.

Create `src/app/api/integrations/health/sync/route.ts` that:

- authenticates the Supabase user;
- checks enabled health connections;
- for Oura, calls the existing Oura daily route/client internally;
- maps each day through `mapOuraDailyPayloadToHealthSnapshot`;
- upserts snapshots by `(user_id, source, local_date)`;
- returns counts only, not raw health payloads.

- [ ] **Step 5: Test and commit**

Run:

```bash
node --experimental-strip-types --test src/lib/health/ouraDailyMapper.test.mjs
npm run build
```

Expected:

```text
ok
Compiled successfully
```

Commit:

```bash
git add supabase/008_external_health_snapshots.sql src/lib/health src/app/api/integrations/health/sync/route.ts
git commit -m "feat: normalize external health snapshots"
```

## Phase 3: Medication Knowledge Core

Use the existing medication knowledge design as the detailed source. The implementation must use migration number `009`, not `008`.

- [ ] **Step 1: Create schema and types**

Create:

- `supabase/009_medication_knowledge.sql`
- `src/lib/medKnowledge/types.ts`
- `src/lib/medKnowledge/types.test.mjs`

Use the entity set from the Medication Knowledge plan:

- `medication_map_items`
- `medication_normalizations`
- `medication_rule_evaluations`
- `medication_evidence_documents`
- `medication_ai_runs`
- `medication_processing_jobs`
- `daily_medication_exposures`

Run:

```bash
node --experimental-strip-types --test src/lib/medKnowledge/types.test.mjs
```

Expected:

```text
ok
```

- [ ] **Step 2: Create safety validator before rule text**

Create `src/lib/medKnowledge/safety.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { assertSafeMedicationKnowledgeText } from './safety.ts';

test('allows lifestyle language', () => {
  assert.doesNotThrow(() => assertSafeMedicationKnowledgeText('Prioritize protein-forward meals when appetite is low.'));
});

test('blocks direct medication change language', () => {
  assert.throws(
    () => assertSafeMedicationKnowledgeText('Stop testosterone for three days.'),
    /Direct medication-change language is not allowed/,
  );
});
```

Create `src/lib/medKnowledge/safety.ts`:

```ts
const DIRECT_MEDICATION_CHANGE =
  /\b(stop|stopping|pause|pausing|skip|skipping|cancel|cancelling|discontinue|discontinuing|move|reschedule|delay|reduce|increase|double|halve)\b/i;

export function assertSafeMedicationKnowledgeText(text: string): void {
  if (DIRECT_MEDICATION_CHANGE.test(text)) {
    throw new Error('Direct medication-change language is not allowed');
  }
}
```

Run:

```bash
node --experimental-strip-types --test src/lib/medKnowledge/safety.test.mjs
```

Expected:

```text
ok
```

- [ ] **Step 3: Add curated rules**

Create `src/lib/medKnowledge/rules.ts` and tests for at least:

- GLP-1 nutrition protein priority.
- GLP-1 hydration/fiber/GI tolerance.
- Testosterone recovery-aware training.
- Testosterone cardiovascular clinician-review flag.
- Thyroid empty-stomach adherence monitoring.
- SSRI sleep/stress tracking prompt.
- Metformin GI tolerance/nutrition prompt.

All rule bodies must pass `assertSafeMedicationKnowledgeText`.

- [ ] **Step 4: Add medication map reader**

Create `src/lib/medKnowledge/mapReader.ts` to derive medication map items from:

- `active_protocols`
- `protocol_items`
- `drugs`
- current protocol status and date window

Do not read from Zustand in server code. Use Supabase rows and typed DTOs.

- [ ] **Step 5: Add daily exposure builder**

Create `src/lib/medKnowledge/features.ts` to generate:

- `hasGlp1Active`
- `daysSinceGlp1Start`
- `hasTestosteroneActive`
- `testosteroneInjectionDayOffset`
- `hasBetaBlockerActive`
- `hasThyroidMedActive`
- `hasSsriActive`
- `withFoodMismatchCount`
- `lateMedicationCount`
- `missedMedicationCount`
- `medicationReviewSignalCount`

- [ ] **Step 6: Test and commit**

Run:

```bash
node --experimental-strip-types --test \
  src/lib/medKnowledge/types.test.mjs \
  src/lib/medKnowledge/safety.test.mjs \
  src/lib/medKnowledge/rules.test.mjs \
  src/lib/medKnowledge/mapReader.test.mjs \
  src/lib/medKnowledge/features.test.mjs
npm run build
```

Expected:

```text
ok
Compiled successfully
```

Commit:

```bash
git add supabase/009_medication_knowledge.sql src/lib/medKnowledge
git commit -m "feat: add medication knowledge core"
```

## Phase 4: Evidence And OpenRouter Layer

- [ ] **Step 1: Add OpenRouter model config**

Create `src/lib/medKnowledge/openRouterModels.ts`:

```ts
export type MedicationKnowledgeModelConfig = {
  baseUrl: string;
  apiKey: string;
  appReferer: string | null;
  appTitle: string;
  fastModel: string;
  reasoningModel: string;
  secondOpinionModel: string;
  nanoModel: string;
  longContextModel: string;
  fallbackModel: string;
};

export function getMedicationKnowledgeModelConfig(env: NodeJS.ProcessEnv = process.env): MedicationKnowledgeModelConfig {
  const apiKey = env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is required');

  return {
    baseUrl: env.OPENROUTER_API_BASE_URL ?? 'https://openrouter.ai/api/v1',
    apiKey,
    appReferer: env.OPENROUTER_HTTP_REFERER ?? env.NEXT_PUBLIC_APP_URL ?? null,
    appTitle: env.OPENROUTER_APP_TITLE ?? 'MedRemind',
    fastModel: env.MED_KNOWLEDGE_FAST_MODEL ?? 'google/gemini-2.5-flash',
    reasoningModel: env.MED_KNOWLEDGE_REASONING_MODEL ?? 'anthropic/claude-sonnet-4.5',
    secondOpinionModel: env.MED_KNOWLEDGE_SECOND_OPINION_MODEL ?? 'google/gemini-2.5-pro',
    nanoModel: env.MED_KNOWLEDGE_NANO_MODEL ?? 'google/gemini-2.5-flash-lite',
    longContextModel: env.MED_KNOWLEDGE_LONG_CONTEXT_MODEL ?? 'qwen/qwen3.6-plus',
    fallbackModel: env.MED_KNOWLEDGE_AUTO_FALLBACK_MODEL ?? 'openrouter/auto',
  };
}
```

- [ ] **Step 2: Add strict AI schemas**

Create `src/lib/medKnowledge/aiSchemas.ts` with JSON schemas for:

- `MedicationClassificationCandidate`
- `EvidenceSummary`
- `InsightDraftReview`
- `SecondOpinionReview`
- `InsightDeduplicationDecision`

Every schema must use:

```ts
additionalProperties: false
```

- [ ] **Step 3: Add OpenRouter client**

Create `src/lib/medKnowledge/openRouter.ts` that:

- sends requests to `/chat/completions`;
- includes `Authorization`, `Content-Type`, `HTTP-Referer`, `X-OpenRouter-Title`;
- passes `response_format` for strict schemas;
- sets `provider.require_parameters = true` for schema-critical calls;
- rejects malformed JSON;
- returns `{ model, usage, output }`;
- never logs prompts, evidence excerpts, medication names, or user identifiers.

- [ ] **Step 4: Add RxNorm/RxClass and evidence retrieval**

Create:

- `src/lib/medKnowledge/normalizer.ts`
- `src/lib/medKnowledge/evidence.ts`

Behavior:

- first use seed/local aliases;
- then RxNorm/RxClass lookup;
- then deterministic evidence matching by RxCUI, ingredient, class label, and content hash;
- use OpenRouter only for ambiguous classification or short evidence summarization;
- fail closed for high-risk medication-adjacent output without evidence references.

- [ ] **Step 5: Test and commit**

Run:

```bash
node --experimental-strip-types --test \
  src/lib/medKnowledge/openRouter.test.mjs \
  src/lib/medKnowledge/normalizer.test.mjs \
  src/lib/medKnowledge/evidence.test.mjs
npm run build
```

Expected:

```text
ok
Compiled successfully
```

Commit:

```bash
git add src/lib/medKnowledge/openRouterModels.ts src/lib/medKnowledge/aiSchemas.ts src/lib/medKnowledge/openRouter.ts src/lib/medKnowledge/normalizer.ts src/lib/medKnowledge/evidence.ts src/lib/medKnowledge/*.test.mjs
git commit -m "feat: add medication evidence and OpenRouter review"
```

## Phase 5: Correlation Engine

Use migration number `010`, not `008`.

- [ ] **Step 1: Create correlation schema**

Create `supabase/010_correlation_insights.sql` with:

- `correlation_consents`
- `daily_lifestyle_snapshots`
- `correlation_insight_cards`

The schema must include consent columns:

- `enabled`
- `includes_medication_patterns`
- `includes_health_data`
- `acknowledged_no_med_changes`

- [ ] **Step 2: Add stats tests first**

Create `src/lib/correlation/stats.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { pearsonCorrelation, rankByAbsoluteCorrelation } from './stats.ts';

test('pearsonCorrelation returns strong positive correlation for aligned values', () => {
  assert.equal(pearsonCorrelation([1, 2, 3, 4], [2, 4, 6, 8]), 1);
});

test('pearsonCorrelation returns null with fewer than four paired values', () => {
  assert.equal(pearsonCorrelation([1, 2, 3], [3, 2, 1]), null);
});

test('rankByAbsoluteCorrelation sorts strongest absolute values first', () => {
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

- [ ] **Step 3: Implement stats and feature builder**

Create:

- `src/lib/correlation/types.ts`
- `src/lib/correlation/stats.ts`
- `src/lib/correlation/featureBuilder.ts`

Feature builder inputs:

- scheduled/taken/skipped medication rows;
- confirmed food entries and nutrients;
- water entries;
- `external_health_daily_snapshots`;
- `daily_medication_exposures`.

Output one daily vector per local date.

- [ ] **Step 4: Implement insight engine**

Create:

- `src/lib/correlation/medicationSafety.ts`
- `src/lib/correlation/engine.ts`
- `src/lib/correlation/persistence.ts`

Engine requirements:

- compute 30, 60, and 90 day windows;
- require at least 14 paired days for any insight card;
- mark weak correlations as tracking prompts, not advice;
- cap insight cards per generation run;
- attach evidence explaining which features and dates supported the card;
- run medication text through safety validator before persistence.

- [ ] **Step 5: Add correlation API**

Create `src/app/api/insights/correlations/route.ts`:

- `GET` returns latest cards and consent state.
- `POST` checks consent and queues/generates refreshed cards for the authenticated user.
- Do not return raw health or medication payloads in card evidence; return aggregates and date ranges.

- [ ] **Step 6: Test and commit**

Run:

```bash
node --experimental-strip-types --test \
  src/lib/correlation/stats.test.mjs \
  src/lib/correlation/medicationSafety.test.mjs \
  src/lib/correlation/featureBuilder.test.mjs \
  src/lib/correlation/engine.test.mjs
npm run build
```

Expected:

```text
ok
Compiled successfully
```

Commit:

```bash
git add supabase/010_correlation_insights.sql src/lib/correlation src/app/api/insights/correlations/route.ts
git commit -m "feat: add personalized correlation engine"
```

## Phase 6: Insights UI And Settings

- [ ] **Step 1: Add Insights navigation**

Modify `src/components/app/BottomNav.tsx` to include:

```ts
{ href: '/app/insights', icon: '🧭', label: 'Insights' }
```

Keep labels short enough for mobile. If the nav becomes cramped, use compact labels and verify at mobile width.

- [ ] **Step 2: Add `/app/insights` page**

Create `src/app/app/insights/page.tsx` with:

- Oura connection status card.
- Health sync status card.
- Medication knowledge status card.
- Correlation insight cards.
- Consent toggle/acknowledgement for medication and health-data analysis.
- Refresh button that calls `POST /api/insights/correlations`.

No visible copy should claim diagnosis or treatment. Medication-review cards must use clinician-review language.

- [ ] **Step 3: Add medication-specific insights page**

Create `src/app/app/insights/medications/page.tsx` with:

- active medication map summary;
- matched classes;
- lifestyle rule cards;
- evidence source labels;
- clinician-review flags.

- [ ] **Step 4: Add medication knowledge API routes**

Create:

- `src/app/api/medication-knowledge/refresh/route.ts`
- `src/app/api/medication-knowledge/status/route.ts`

Behavior:

- authenticated user only;
- `refresh` builds map, normalizations, rule evaluations, evidence, daily exposure features;
- `status` returns counts and last run metadata;
- no raw token, prompt, or private evidence dump in browser JSON.

- [ ] **Step 5: Add Settings integration controls**

Modify `src/app/app/settings/page.tsx`:

- show Oura connection status;
- add connect/disconnect link actions;
- show health sync last run;
- link to `/app/insights`;
- do not expose tokens or client secret values.

- [ ] **Step 6: Browser smoke**

Start dev server:

```bash
npm run dev
```

Use Chrome DevTools MCP or Playwright to verify:

- `/app/settings` renders.
- `/app/insights` renders.
- `/app/insights/medications` renders.
- bottom nav is usable on mobile viewport.
- console has no runtime errors.

- [ ] **Step 7: Commit UI/API phase**

Run:

```bash
npm run build
```

Expected:

```text
Compiled successfully
```

Commit:

```bash
git add src/app/app/insights src/app/api/medication-knowledge src/components/app/BottomNav.tsx src/app/app/settings/page.tsx
git commit -m "feat: add health and medication insights UI"
```

## Phase 7: Documentation And Environment

- [ ] **Step 1: Update README**

Modify `README.md` to document only variable names, never values:

```text
Oura:
- OURA_CLIENT_ID
- OURA_CLIENT_SECRET
- OURA_REDIRECT_URI
- OURA_TOKEN_ENCRYPTION_KEY
- OURA_SCOPES

OpenRouter:
- OPENROUTER_API_KEY
- OPENROUTER_API_BASE_URL
- OPENROUTER_HTTP_REFERER
- OPENROUTER_APP_TITLE
- MED_KNOWLEDGE_FAST_MODEL
- MED_KNOWLEDGE_REASONING_MODEL
- MED_KNOWLEDGE_SECOND_OPINION_MODEL
- MED_KNOWLEDGE_NANO_MODEL
- MED_KNOWLEDGE_LONG_CONTEXT_MODEL
- MED_KNOWLEDGE_AUTO_FALLBACK_MODEL
```

- [ ] **Step 2: Update current docs**

Modify:

- `docs/current-status.md`
- `docs/architecture-current-main.md`
- `docs/agent-handoff-current-main.md`

Document:

- Oura integration routes and migration.
- External health snapshot boundary.
- Medication Knowledge Layer.
- OpenRouter model-routing boundary.
- Correlation insight engine.
- User consent requirement.
- Safety rule: no direct medication-change instructions.

- [ ] **Step 3: Commit docs**

Run:

```bash
git diff --check
git add README.md docs/current-status.md docs/architecture-current-main.md docs/agent-handoff-current-main.md
git commit -m "docs: document health and medication insights architecture"
```

Expected:

```text
Commit succeeds
```

## Phase 8: Final Verification Gate

- [ ] **Step 1: Run unit tests**

```bash
npm run test:unit
node --experimental-strip-types --test \
  src/lib/oura/oauth.test.mjs \
  src/lib/oura/tokenCrypto.test.mjs \
  src/lib/health/ouraDailyMapper.test.mjs \
  src/lib/medKnowledge/types.test.mjs \
  src/lib/medKnowledge/safety.test.mjs \
  src/lib/medKnowledge/rules.test.mjs \
  src/lib/medKnowledge/mapReader.test.mjs \
  src/lib/medKnowledge/features.test.mjs \
  src/lib/medKnowledge/openRouter.test.mjs \
  src/lib/medKnowledge/normalizer.test.mjs \
  src/lib/medKnowledge/evidence.test.mjs \
  src/lib/correlation/stats.test.mjs \
  src/lib/correlation/medicationSafety.test.mjs \
  src/lib/correlation/featureBuilder.test.mjs \
  src/lib/correlation/engine.test.mjs
```

Expected:

```text
All tests pass
```

- [ ] **Step 2: Run build**

```bash
npm run build
```

Expected:

```text
Compiled successfully
```

- [ ] **Step 3: Run focused e2e smoke**

```bash
npm run test:e2e -- --grep "public|food|settings|insights"
```

Expected:

```text
All matching specs pass
```

If no insights e2e exists yet, add a small smoke spec before relying on manual browser checks.

- [ ] **Step 4: Run secret scan**

```bash
git diff main...HEAD | rg -n "sk-|OPENROUTER_API_KEY=|OURA_CLIENT_SECRET=|OURA_PERSONAL_ACCESS_TOKEN=|Bearer [A-Za-z0-9._-]{20,}|refresh_token|access_token" || true
```

Expected:

```text
No committed secret values.
Allowed matches only for variable names, type names, and server-side field names.
```

- [ ] **Step 5: Run medication language safety scan**

```bash
rg -n "\\b(stop|pause|skip|cancel|discontinue|move|reschedule|delay|reduce|increase|double|halve)\\b" src/lib/medKnowledge src/lib/correlation src/app/app/insights src/app/api/medication-knowledge src/app/api/insights
```

Expected:

```text
Matches only in safety regex, tests, or explicit blocked-language documentation.
No user-facing recommendation instructs medication changes.
```

- [ ] **Step 6: Review migration order**

```bash
ls supabase | sort | tail -n 10
```

Expected:

```text
005_food_intake.sql
006_nutrition_targets_and_hydration.sql
007_oura_integrations.sql
008_external_health_snapshots.sql
009_medication_knowledge.sql
010_correlation_insights.sql
```

- [ ] **Step 7: Final status**

```bash
git status --short --branch
git log --oneline --max-count=12
```

Expected:

```text
Working tree clean.
Recent commits show Oura, health snapshots, medication knowledge, evidence/OpenRouter, correlation, UI, docs.
```

## Rollback And Stop Conditions

Stop the overnight run and report instead of forcing through when any of these occurs:

- Oura branch contains non-Oura unrelated changes.
- migration numbering conflicts cannot be resolved cleanly.
- Supabase RLS policy would expose token rows, prompts, or raw private health payloads to browser clients.
- OpenRouter structured output support is unavailable for a required model and no safe model alternative is configured.
- medication safety scan finds direct medication-change language in user-facing code.
- build fails after two targeted fix attempts.
- `git status --short` shows unrelated files owned by another worker.

## Self-Review

Spec coverage:

- Oura integration is covered by Phase 1.
- Apple Health is handled as a source-compatible health snapshot boundary in Phase 2; direct HealthKit ingestion remains a future native/iOS bridge, not a fake web API.
- Medication Knowledge Layer is covered by Phases 3 and 4.
- OpenRouter model usage is covered by Phase 4.
- Correlation Engine is covered by Phase 5.
- User-facing app integration is covered by Phase 6.
- Docs, env, migration ordering, and verification are covered by Phases 7 and 8.

Placeholder scan:

- No open implementation placeholders are intentionally left in this plan.
- Each phase has file ownership, commands, expected outcomes, and commit points.

Type consistency:

- `external_health_daily_snapshots` feeds `DailyLifestyleSnapshot`.
- `daily_medication_exposures` feeds the correlation engine.
- OpenRouter outputs are validated before persistence and audited through `medication_ai_runs`.

Safety check:

- Direct medication-change verbs are allowed only in safety regexes, tests, and blocked-language checks.
- Product behavior is limited to lifestyle prompts, tracking prompts, and clinician-review flags.
