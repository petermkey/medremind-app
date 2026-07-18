# Nutrient Balance (B1, flagship) — Implementation Plan (W2-C)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or
> superpowers:subagent-driven-development when orchestrated) to implement this plan
> task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Read
> `docs/superpowers/plans/2026-07-18-feature-wave-master.md` FIRST — its Global
> Constraints, Migration Ledger (026 belongs to THIS feature) and file-ownership matrix
> bind this plan. The migration numbers printed inside `docs/backlog-wellbeing-features.md`
> (020) are STALE — this plan writes **026**.

**Goal:** Cross the food diary with the active supplement stack. Three output buckets:
1. **Deficits** — food (rolling 14-day avg) + stack contribution < target.
2. **Covered / redundant** — diet already supplies most of what a supplement adds.
3. **Possible excess** — food + stack approaches a **curated** upper limit (UL) —
   ULs are NEVER LLM-sourced; they ship versioned in-repo with citations.

**Architecture:**

```
medication_map_items (status='active') ──▶ normalizeSupplementName
        │                                        │
        │                     supplement_nutrient_facts (026)  ◀── factsExtractor
        │                     (ONE LLM call per unique normalized      (OpenRouter
        │                      supplement+dose, cached FOREVER,         structured,
        │                      validation_status machinery)             validated)
        ▼                                        │
food_entries (14d, typed cols + extended_nutrients) ─▶ aggregate (pure TS) ─┐
stack facts × dosesPerDay ──────────────────────────────────────────────────┼─▶ engine.ts
targets (nutrition_target_profiles) + curated RDAs/ULs (limits.ts) ─────────┘  (pure,
                                                                                deterministic)
                                       ▼
             /api/insights/nutrient-balance  (server route; per-user/day cache
              row in nutrient_balance_reports — cache DECISION: B1 prefers the
              cache to keep the card instant, and the table shares migration 026)
                                       ▼
             Progress page card (three expandable buckets, contribution
              breakdown, unverified chips, medKnowledge disclaimer)
```

LLM runs ONLY at extraction time (one structured call per unique supplement, cached in the
026 table). The analysis itself is deterministic TypeScript — reruns are free and testable.

**Tech Stack:** Next.js 16 App Router, TypeScript strict, Supabase (service-role server
client — the `createCorrelationServiceClient` pattern), OpenRouter structured outputs via
the existing `src/lib/medKnowledge/openRouter.ts` caller, standalone `test:unit` harness
(`tsc --ignoreConfig` — **relative imports only** in every module it compiles), Playwright
E2E with seeded data.

## Spec

### Requirements

1. Migration `supabase/026_supplement_nutrient_facts.sql` — idempotent; two tables
   (`supplement_nutrient_facts` global fact cache + `nutrient_balance_reports` per-user/day
   report cache). **The implementing agent writes the file and STOPS — it never applies
   migrations** (owner/orchestrator applies via the Supabase Management API, project
   `hagypgvfkjkncznoctoq`, see `docs/agent-handoff-current-main.md` §0b).
2. `src/lib/nutrientBalance/limits.ts` — curated RDAs/ULs for 30 nutrients, versioned,
   each row cited (NIH ODS / IOM-DRI / DGA / EFSA). Includes a per-row `ulScope`
   (`'total'` vs `'supplemental'`) because several ULs (magnesium, niacin, folate,
   vitamin E) legally apply to supplemental intake only.
3. `src/lib/nutrientBalance/engine.ts` — pure deterministic bucket math (deficits /
   covered-redundant / possible-excess) from 14-day food averages + stack contribution vs
   targets and curated ULs; plus the food aggregation and `dosesPerDay` helpers. Unit-tested.
4. `src/lib/nutrientBalance/factsSchema.ts` + `factsExtractor.ts` — one structured LLM call
   per unique normalized supplement, cached forever in the 026 table, inserted with
   `validation_status='pending'` (the medKnowledge status machinery: rows carry
   `pending|verified|rejected`; UI shows an "unverified" chip for anything not `verified`).
5. Server route `/api/insights/nutrient-balance` with a per-user/day cache row
   (`nutrient_balance_reports`; `?refresh=1` bypasses).
6. Progress page card: three expandable buckets + contribution breakdown + unverified chip
   + medKnowledge-style disclaimer. **Excess bucket requires a curated UL by construction**
   — the engine reads ULs exclusively from `limits.ts`; fact rows carry no UL field at all.
7. Unit tests for engine buckets/boundaries; extractor schema-validation test with a mock
   provider (`fetchImpl` injection); E2E with seeded data.

### Bucket rules (concrete — recorded decisions)

Let `target = profile override (protein/fiber) ?? RDA from limits.ts`,
`total = foodAvgPerDay + stackPerDay`:

- **Skip** any nutrient with `foodAvgPerDay === 0 && stackPerDay === 0` — *no data is not
  a deficit* (otherwise every untracked micronutrient floods the deficit bucket).
- **Deficit**: `target !== null && total < 0.7 × target`.
- **Covered / redundant**: `target !== null && total ≥ target && stackPerDay > 0 &&
  foodAvgPerDay ≥ 0.75 × target` (diet alone already supplies ≥75% — the supplement is
  the redundancy).
- **Possible excess**: `ul !== null` AND the scoped basis
  (`stackPerDay` when `ulScope='supplemental'`, else `total`) `≥ 0.8 × ul` ("approaches").
- A finding is `unverified` when any contributing fact row has
  `validation_status !== 'verified'`.
- Report additionally flags `insufficientFoodData` when < 3 distinct days of the 14 have
  food entries (deficit math over 1 logged day would be noise).

### Acceptance criteria

- `npx tsc --noEmit`, `npm run build`, `npm run test:unit` all pass
  (`test:correlation` untouched).
- Migration file present, idempotent (re-runnable), NOT applied by the agent.
- GET `/api/insights/nutrient-balance` (authed) returns
  `{ report, pendingItems, loggedDays, insufficientFoodData, limitsVersion }` and writes a
  cache row; a second GET the same day is served from the cache (no LLM, no recompute).
- Progress page renders the card with three buckets, expandable rows, unverified chips,
  and the disclaimer.
- Extractor is called at most once per unique `(normalized_name, dose_amount, dose_unit)`
  ever (unique constraint + lookup-before-extract).

### Non-goals

- No Food-page entry-point badge (B1 lists it; deferred — the card ships on Progress,
  where the master plan's ownership matrix places W2-C's UI surface).
- No human verification workflow for `validation_status` (rows stay `pending` until a
  future admin flow; the chip communicates this honestly).
- No Stack Guard logic (W3-A consumes the 026 groundwork later).
- No IU→metric unit conversion for `extended_nutrients` keys expressed in IU (recorded
  limitation; alias matching is metric-only).

## Global Constraints (from the master plan — restated, binding)

- Branch: `codex/w2c-nutrient-balance`, off fresh `origin/main` (post-Wave-1), after
  `bash scripts/git-state-check.sh`. Never push to `main`; end in a PR; DO NOT merge.
- Migration 026 is written by this agent, applied ONLY by the owner/orchestrator. If an
  extra migration were ever needed, take the next free number AND update the master-plan
  ledger in the PR (not expected — the cache table shares 026 by design).
- LLM discipline: OpenRouter structured `json_schema` → server-side validator → model
  fallback chain → coded `*_provider_*` errors → `Sentry.captureException`. Aggregates in,
  never raw user rows (the extractor sees only a supplement name + dose — no user data).
- Safety: card carries the non-medical-advice disclaimer; LLM-derived facts carry
  `validation_status`; excess findings require curated ULs.
- `test:unit`-registered modules (`limits.ts`, `engine.ts`, `factsSchema.ts`,
  `factsExtractor.ts`) use RELATIVE imports only (`tsc --ignoreConfig` resolves no `@/`
  aliases). `service.ts`/route/card are Next/tsc-only — aliases fine there.
- TypeScript strict; no new `any`; no `console.log`; conventional commits; PR at the end;
  STOP before merge.
- File ownership (matrix): new `src/lib/nutrientBalance/*`, migration 026, the new route,
  one insertion in `src/app/app/progress/page.tsx` (+ new card component file). W3-A reads
  these later; nobody else touches them this wave.

## File Structure

- Create: `supabase/026_supplement_nutrient_facts.sql`
- Create: `src/lib/nutrientBalance/limits.ts` — curated RDA/UL table (versioned).
- Create: `src/lib/nutrientBalance/engine.ts` — pure bucket math + aggregation helpers.
- Create: `src/lib/nutrientBalance/factsSchema.ts` — JSON schema + validator + name normalizer.
- Create: `src/lib/nutrientBalance/factsExtractor.ts` — LLM call with fallback chain.
- Create: `src/lib/nutrientBalance/service.ts` — orchestration + cache (server-only).
- Create: `src/app/api/insights/nutrient-balance/route.ts`
- Create: `src/components/app/nutrientBalance/NutrientBalanceCard.tsx`
- Modify: `src/app/app/progress/page.tsx` — one import + one JSX insertion.
- Create: `tests/unit/nutrientBalanceLimits.test.ts`, `tests/unit/nutrientBalanceEngine.test.ts`,
  `tests/unit/factsExtractor.test.ts`
- Modify: `package.json` — register the new files in `test:unit`.
- Create: `tests/e2e/nutrientBalance.spec.ts`

---

### Task 1: Migration 026 (write only — never apply)

**Files:**
- Create: `supabase/026_supplement_nutrient_facts.sql`

**Interfaces:**
- Produces: table `supplement_nutrient_facts` (global LLM-fact cache, keyed
  `(normalized_name, dose_amount, dose_unit)`, `validation_status` check-constrained to
  the medKnowledge statuses) and table `nutrient_balance_reports` (per-user/day cache,
  keyed `(user_id, report_date)`). Consumed by Tasks 4–6 and later by W3-A Stack Guard.
- RLS style mirrors `supabase/022_oura_tags.sql` (idempotent `do $$ … duplicate_object`
  policy blocks). `supplement_nutrient_facts` gets RLS enabled with NO policies on
  purpose: it holds no user data and is read/written only through the service-role client
  (which bypasses RLS) — anon/authed roles see nothing.

- [ ] **Step 1: Write the migration**

```sql
-- 026: Nutrient Balance (B1).
-- (a) supplement_nutrient_facts: LLM-extracted per-dose nutrient content per
--     normalized supplement, cached forever (one extraction per unique
--     name+dose+unit, medKnowledge-style validation_status machinery).
--     Global cache — no user_id, service-role access only.
-- (b) nutrient_balance_reports: per-user/day report cache so the Progress
--     card is instant (B1 spec prefers cache over recompute).
create table if not exists supplement_nutrient_facts (
  id uuid primary key default gen_random_uuid(),
  normalized_name text not null,
  dose_amount numeric not null,
  dose_unit text not null,
  nutrients jsonb not null,
  model text not null,
  validation_status text not null default 'pending'
    check (validation_status in ('pending', 'verified', 'rejected')),
  created_at timestamptz not null default now(),
  unique (normalized_name, dose_amount, dose_unit)
);
alter table supplement_nutrient_facts enable row level security;
-- Intentionally no policies: not user data; only the service-role client
-- (RLS-bypassing) reads/writes this cache.

create table if not exists nutrient_balance_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  report_date date not null,
  payload jsonb not null,
  limits_version text not null,
  computed_at timestamptz not null default now(),
  unique (user_id, report_date)
);
alter table nutrient_balance_reports enable row level security;
do $$ begin
  create policy "Owner read nutrient balance reports" on nutrient_balance_reports
    for select using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
create index if not exists idx_nutrient_balance_reports_user_date
  on nutrient_balance_reports(user_id, report_date);
```

- [ ] **Step 2: Sanity-check the file (no DB access — the agent never applies it)**

Run: `cd "/Volumes/DATA/GRAVITY REPO/medremind-app" && cat supabase/026_supplement_nutrient_facts.sql`
Expected: the file prints exactly as above. Do NOT run it anywhere.

- [ ] **Step 3: Commit**

```bash
git add supabase/026_supplement_nutrient_facts.sql
git commit -m "feat: migration 026 — supplement nutrient facts + nutrient balance report cache"
```

---

### Task 2: `limits.ts` — curated RDA/UL table (versioned, cited) + unit tests

**Files:**
- Create: `src/lib/nutrientBalance/limits.ts`
- Create: `tests/unit/nutrientBalanceLimits.test.ts`
- Modify: `package.json` (`test:unit` script)

**Interfaces:**
- Produces (consumed by Tasks 3–4 and the card):
  - `type NutrientUnit = 'g' | 'mg' | 'mcg'`
  - `type UlScope = 'total' | 'supplemental'`
  - `type NutrientDef = { key: string; label: string; unit: NutrientUnit; aliases: string[]; rda: number | null; ul: number | null; ulScope: UlScope; source: string }`
  - `NUTRIENT_LIMITS_VERSION` (bump whenever a value changes)
  - `NUTRIENT_DEFS: NutrientDef[]` (30 entries)
  - `findNutrientDef(rawKey: string): NutrientDef | null` — alias matching, tolerant to
    case/underscores (matches free-form `extended_nutrients` keys from the food LLM).
- Zero imports (leaf module).
- Reference values are adult-male-19-50 RDAs/AIs (single-profile app, owner is male; the
  per-user macro targets from `nutrition_target_profiles` override protein/fiber anyway).
  `source` strings cite the authority per row.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/nutrientBalanceLimits.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  findNutrientDef,
  NUTRIENT_DEFS,
  NUTRIENT_LIMITS_VERSION,
} from '../../src/lib/nutrientBalance/limits';

test('table has 30 cited, well-formed entries with unique keys', () => {
  assert.equal(NUTRIENT_DEFS.length, 30);
  assert.match(NUTRIENT_LIMITS_VERSION, /^nb-limits-\d{4}-\d{2}-\d{2}/);
  const keys = new Set<string>();
  for (const def of NUTRIENT_DEFS) {
    assert.ok(def.key.length > 0);
    assert.ok(!keys.has(def.key), `duplicate key ${def.key}`);
    keys.add(def.key);
    assert.ok(def.source.length > 10, `${def.key} must carry a citation`);
    assert.ok(['g', 'mg', 'mcg'].includes(def.unit));
    if (def.ul !== null) assert.ok(def.ul > 0);
    if (def.rda !== null) assert.ok(def.rda > 0);
    if (def.rda !== null && def.ul !== null && def.ulScope === 'total') {
      assert.ok(def.ul > def.rda, `${def.key}: total-scope UL must exceed RDA`);
    }
  }
});

test('known reference values are present (spot checks against NIH ODS)', () => {
  const magnesium = NUTRIENT_DEFS.find(def => def.key === 'magnesiumMg');
  assert.equal(magnesium?.rda, 420);
  assert.equal(magnesium?.ul, 350);
  assert.equal(magnesium?.ulScope, 'supplemental');

  const vitaminD = NUTRIENT_DEFS.find(def => def.key === 'vitaminDMcg');
  assert.equal(vitaminD?.rda, 15);
  assert.equal(vitaminD?.ul, 100);

  const zinc = NUTRIENT_DEFS.find(def => def.key === 'zincMg');
  assert.equal(zinc?.ul, 40);
  assert.equal(zinc?.ulScope, 'total');
});

test('findNutrientDef matches keys and aliases case/separator-insensitively', () => {
  assert.equal(findNutrientDef('magnesiumMg')?.key, 'magnesiumMg');
  assert.equal(findNutrientDef('magnesium_mg')?.key, 'magnesiumMg');
  assert.equal(findNutrientDef('Magnesium')?.key, 'magnesiumMg');
  assert.equal(findNutrientDef('vitamin_d')?.key, 'vitaminDMcg');
  assert.equal(findNutrientDef('cholecalciferol')?.key, 'vitaminDMcg');
  assert.equal(findNutrientDef('epaDhaMg')?.key, 'omega3EpaDhaMg');
  assert.equal(findNutrientDef('unobtainium'), null);
});
```

- [ ] **Step 2: Verify the failing state**

Run:
```bash
cd "/Volumes/DATA/GRAVITY REPO/medremind-app" && npx tsc --ignoreConfig --target ES2020 --module Node16 --moduleResolution node16 --types node --strict --esModuleInterop --skipLibCheck --outDir .tmp/unit-probe --rootDir . --noEmit false tests/unit/nutrientBalanceLimits.test.ts; rm -rf .tmp/unit-probe
```
Expected: `error TS2307: Cannot find module '../../src/lib/nutrientBalance/limits'`.

- [ ] **Step 3: Write the implementation (the ACTUAL curated table)**

```ts
// src/lib/nutrientBalance/limits.ts
// Curated reference intakes (RDA/AI) and tolerable upper limits (UL) for the
// Nutrient Balance engine. Versioned in-repo, each row cited. NEVER
// LLM-generated at runtime — the excess bucket depends on these being
// human-curated (B1 safety rule). Values are adult male 19-50 unless noted;
// per-user protein/fiber targets from nutrition_target_profiles override the
// macro rows at engine level.
// Zero imports (leaf module for the standalone test:unit harness).

export type NutrientUnit = 'g' | 'mg' | 'mcg';
/**
 * 'total'        — UL applies to food + supplements combined.
 * 'supplemental' — UL applies to supplemental intake only (e.g. magnesium,
 *                  niacin, folic acid, vitamin E per NIH ODS).
 */
export type UlScope = 'total' | 'supplemental';

export type NutrientDef = {
  key: string;
  label: string;
  unit: NutrientUnit;
  aliases: string[];
  rda: number | null;
  ul: number | null;
  ulScope: UlScope;
  source: string;
};

export const NUTRIENT_LIMITS_VERSION = 'nb-limits-2026-07-18.1';

const ODS = 'NIH ODS Fact Sheet for Health Professionals';

export const NUTRIENT_DEFS: NutrientDef[] = [
  { key: 'proteinG', label: 'Protein', unit: 'g', aliases: ['protein'], rda: 56, ul: null, ulScope: 'total', source: 'IOM DRI 2005: RDA 0.8 g/kg (~56 g, 70 kg adult male); no UL set' },
  { key: 'fiberG', label: 'Fiber', unit: 'g', aliases: ['fiber', 'dietaryfiber', 'fibre'], rda: 38, ul: null, ulScope: 'total', source: 'IOM DRI 2005: AI 38 g/day men 19-50; no UL set' },
  { key: 'omega3EpaDhaMg', label: 'Omega-3 (EPA+DHA)', unit: 'mg', aliases: ['omega3', 'epadha', 'epadhamg', 'fishoil', 'epa', 'dha'], rda: 250, ul: 5000, ulScope: 'supplemental', source: 'EFSA 2010 AI 250 mg EPA+DHA; EFSA 2012 opinion: supplemental EPA+DHA up to 5 g/day raises no safety concern' },
  { key: 'vitaminAMcg', label: 'Vitamin A', unit: 'mcg', aliases: ['vitamina', 'retinol', 'vitaminamcg'], rda: 900, ul: 3000, ulScope: 'total', source: `${ODS} Vitamin A 2022: RDA 900 mcg RAE men; UL 3000 mcg preformed` },
  { key: 'vitaminCMg', label: 'Vitamin C', unit: 'mg', aliases: ['vitaminc', 'ascorbicacid'], rda: 90, ul: 2000, ulScope: 'total', source: `${ODS} Vitamin C 2021: RDA 90 mg men; UL 2000 mg` },
  { key: 'vitaminDMcg', label: 'Vitamin D', unit: 'mcg', aliases: ['vitamind', 'vitamind3', 'cholecalciferol'], rda: 15, ul: 100, ulScope: 'total', source: `${ODS} Vitamin D 2024: RDA 15 mcg (600 IU) 19-70; UL 100 mcg (4000 IU)` },
  { key: 'vitaminEMg', label: 'Vitamin E', unit: 'mg', aliases: ['vitamine', 'tocopherol', 'alphatocopherol'], rda: 15, ul: 1000, ulScope: 'supplemental', source: `${ODS} Vitamin E 2021: RDA 15 mg; UL 1000 mg applies to supplemental alpha-tocopherol` },
  { key: 'vitaminKMcg', label: 'Vitamin K', unit: 'mcg', aliases: ['vitamink', 'phylloquinone', 'menaquinone', 'vitamink2'], rda: 120, ul: null, ulScope: 'total', source: `${ODS} Vitamin K 2021: AI 120 mcg men; no UL set` },
  { key: 'thiaminMg', label: 'Thiamin (B1)', unit: 'mg', aliases: ['thiamin', 'thiamine', 'vitaminb1'], rda: 1.2, ul: null, ulScope: 'total', source: `${ODS} Thiamin 2021: RDA 1.2 mg men; no UL set` },
  { key: 'riboflavinMg', label: 'Riboflavin (B2)', unit: 'mg', aliases: ['riboflavin', 'vitaminb2'], rda: 1.3, ul: null, ulScope: 'total', source: `${ODS} Riboflavin 2022: RDA 1.3 mg men; no UL set` },
  { key: 'niacinMg', label: 'Niacin (B3)', unit: 'mg', aliases: ['niacin', 'vitaminb3', 'nicotinamide', 'nicotinicacid'], rda: 16, ul: 35, ulScope: 'supplemental', source: `${ODS} Niacin 2022: RDA 16 mg NE men; UL 35 mg applies to supplemental forms` },
  { key: 'vitaminB6Mg', label: 'Vitamin B6', unit: 'mg', aliases: ['vitaminb6', 'pyridoxine'], rda: 1.3, ul: 100, ulScope: 'total', source: `${ODS} Vitamin B6 2023: RDA 1.3 mg 19-50; UL 100 mg` },
  { key: 'folateMcg', label: 'Folate', unit: 'mcg', aliases: ['folate', 'folicacid', 'vitaminb9', 'methylfolate'], rda: 400, ul: 1000, ulScope: 'supplemental', source: `${ODS} Folate 2022: RDA 400 mcg DFE; UL 1000 mcg applies to folic acid from fortified food/supplements` },
  { key: 'vitaminB12Mcg', label: 'Vitamin B12', unit: 'mcg', aliases: ['vitaminb12', 'cobalamin', 'methylcobalamin', 'cyanocobalamin'], rda: 2.4, ul: null, ulScope: 'total', source: `${ODS} Vitamin B12 2024: RDA 2.4 mcg; no UL set` },
  { key: 'biotinMcg', label: 'Biotin', unit: 'mcg', aliases: ['biotin', 'vitaminb7'], rda: 30, ul: null, ulScope: 'total', source: `${ODS} Biotin 2022: AI 30 mcg; no UL set` },
  { key: 'pantothenicAcidMg', label: 'Pantothenic acid (B5)', unit: 'mg', aliases: ['pantothenicacid', 'vitaminb5', 'pantothenate'], rda: 5, ul: null, ulScope: 'total', source: `${ODS} Pantothenic Acid 2021: AI 5 mg; no UL set` },
  { key: 'cholineMg', label: 'Choline', unit: 'mg', aliases: ['choline'], rda: 550, ul: 3500, ulScope: 'total', source: `${ODS} Choline 2022: AI 550 mg men; UL 3500 mg` },
  { key: 'calciumMg', label: 'Calcium', unit: 'mg', aliases: ['calcium'], rda: 1000, ul: 2500, ulScope: 'total', source: `${ODS} Calcium 2024: RDA 1000 mg 19-50; UL 2500 mg` },
  { key: 'ironMg', label: 'Iron', unit: 'mg', aliases: ['iron'], rda: 8, ul: 45, ulScope: 'total', source: `${ODS} Iron 2024: RDA 8 mg men; UL 45 mg` },
  { key: 'magnesiumMg', label: 'Magnesium', unit: 'mg', aliases: ['magnesium', 'magnesiumcitrate', 'magnesiumglycinate'], rda: 420, ul: 350, ulScope: 'supplemental', source: `${ODS} Magnesium 2022: RDA 420 mg men 31+; UL 350 mg applies to SUPPLEMENTAL magnesium only` },
  { key: 'zincMg', label: 'Zinc', unit: 'mg', aliases: ['zinc', 'zincpicolinate'], rda: 11, ul: 40, ulScope: 'total', source: `${ODS} Zinc 2022: RDA 11 mg men; UL 40 mg` },
  { key: 'copperMg', label: 'Copper', unit: 'mg', aliases: ['copper'], rda: 0.9, ul: 10, ulScope: 'total', source: `${ODS} Copper 2022: RDA 0.9 mg; UL 10 mg` },
  { key: 'manganeseMg', label: 'Manganese', unit: 'mg', aliases: ['manganese'], rda: 2.3, ul: 11, ulScope: 'total', source: `${ODS} Manganese 2021: AI 2.3 mg men; UL 11 mg` },
  { key: 'seleniumMcg', label: 'Selenium', unit: 'mcg', aliases: ['selenium'], rda: 55, ul: 400, ulScope: 'total', source: `${ODS} Selenium 2021: RDA 55 mcg; UL 400 mcg` },
  { key: 'iodineMcg', label: 'Iodine', unit: 'mcg', aliases: ['iodine', 'potassiumiodide'], rda: 150, ul: 1100, ulScope: 'total', source: `${ODS} Iodine 2024: RDA 150 mcg; UL 1100 mcg` },
  { key: 'potassiumMg', label: 'Potassium', unit: 'mg', aliases: ['potassium'], rda: 3400, ul: null, ulScope: 'total', source: `${ODS} Potassium 2022: AI 3400 mg men; no UL set` },
  { key: 'sodiumMg', label: 'Sodium', unit: 'mg', aliases: ['sodium', 'salt'], rda: 1500, ul: 2300, ulScope: 'total', source: 'DGA 2020-2025 / NASEM 2019: AI 1500 mg; CDRR 2300 mg treated as the excess limit' },
  { key: 'phosphorusMg', label: 'Phosphorus', unit: 'mg', aliases: ['phosphorus'], rda: 700, ul: 4000, ulScope: 'total', source: `${ODS} Phosphorus 2023: RDA 700 mg; UL 4000 mg` },
  { key: 'chromiumMcg', label: 'Chromium', unit: 'mcg', aliases: ['chromium', 'chromiumpicolinate'], rda: 35, ul: null, ulScope: 'total', source: `${ODS} Chromium 2022: AI 35 mcg men 19-50; no UL set` },
  { key: 'molybdenumMcg', label: 'Molybdenum', unit: 'mcg', aliases: ['molybdenum'], rda: 45, ul: 2000, ulScope: 'total', source: `${ODS} Molybdenum 2022: RDA 45 mcg; UL 2000 mcg` },
];

function normalizeKey(rawKey: string): string {
  return rawKey.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const DEF_INDEX = new Map<string, NutrientDef>();
for (const def of NUTRIENT_DEFS) {
  DEF_INDEX.set(normalizeKey(def.key), def);
  for (const alias of def.aliases) DEF_INDEX.set(normalizeKey(alias), def);
}
// Extra alias for the common combined key shape used by food LLM output.
DEF_INDEX.set(normalizeKey('epaDhaMg'), DEF_INDEX.get(normalizeKey('omega3EpaDhaMg'))!);

export function findNutrientDef(rawKey: string): NutrientDef | null {
  return DEF_INDEX.get(normalizeKey(rawKey)) ?? null;
}
```

- [ ] **Step 4: Register in `test:unit` and run**

In `package.json`'s `test:unit` script:
1. Append to the tsc file list: ` tests/unit/nutrientBalanceLimits.test.ts src/lib/nutrientBalance/limits.ts`
2. Append to the run chain: ` && node .tmp/unit/tests/unit/nutrientBalanceLimits.test.js`

Run: `cd "/Volumes/DATA/GRAVITY REPO/medremind-app" && npm run test:unit && npx tsc --noEmit`
Expected: all pass (3 new tests), tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/nutrientBalance/limits.ts tests/unit/nutrientBalanceLimits.test.ts package.json
git commit -m "feat: curated nutrient RDA/UL table (30 entries, cited, versioned)"
```

---

### Task 3: `engine.ts` — pure deterministic bucket math + unit tests

**Files:**
- Create: `src/lib/nutrientBalance/engine.ts`
- Create: `tests/unit/nutrientBalanceEngine.test.ts`
- Modify: `package.json` (`test:unit` script)

**Interfaces:**
- Consumes: `NUTRIENT_DEFS`, `NUTRIENT_LIMITS_VERSION`, `findNutrientDef`, `NutrientDef`
  from `./limits` (relative).
- Produces (consumed by Task 5 service and the card's payload contract):

```ts
export type StackItemInput = {
  displayName: string;
  nutrients: Record<string, number>; // canonical keys, PER SINGLE DOSE
  dosesPerDay: number;
  validationStatus: string; // 'pending' | 'verified' | 'rejected'
};
export type NutrientContributor = { displayName: string; amountPerDay: number; validationStatus: string };
export type NutrientFinding = {
  nutrientKey: string; label: string; unit: string;
  foodAvgPerDay: number; stackPerDay: number; totalPerDay: number;
  target: number | null; ul: number | null; ulScope: 'total' | 'supplemental';
  pctOfTarget: number | null;
  contributors: NutrientContributor[];
  unverified: boolean;
};
export type NutrientBalanceReport = {
  version: string;
  buckets: { deficits: NutrientFinding[]; covered: NutrientFinding[]; excess: NutrientFinding[] };
};
export function dosesPerDay(frequencyType: string, times: string[] | null): number;
export function aggregateFoodDailyAverages(rows: Array<Record<string, unknown>>, loggedDays: number): Record<string, number>;
export function buildNutrientBalanceReport(input: {
  foodDailyAvg: Record<string, number>;
  stack: StackItemInput[];
  targets: { proteinG?: number | null; fiberG?: number | null };
}): NutrientBalanceReport;
```

- `dosesPerDay` mapping (from `FrequencyType` in `src/types/index.ts:15-17`):
  `daily` → `max(times.length, 1)`; `twice_daily` → 2; `three_times_daily` → 3;
  `weekly` → 1/7; anything else (`every_n_hours`, `every_n_days`, `custom`) → 1
  (conservative — intervals are not stored on `medication_map_items`).
- `aggregateFoodDailyAverages` reads DB-row shapes: typed columns `protein_g`, `fiber_g`
  (mapped to `proteinG`/`fiberG`) plus the `extended_nutrients` jsonb record matched via
  `findNutrientDef`; sums ÷ `loggedDays` (min 1), rounded to 2dp.
- `validationStatus` of a fact row propagates to `unverified` — rejected facts are
  EXCLUDED from math entirely (a rejected extraction must not shape buckets).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/nutrientBalanceEngine.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  aggregateFoodDailyAverages,
  buildNutrientBalanceReport,
  dosesPerDay,
} from '../../src/lib/nutrientBalance/engine';

function findingFor(report: ReturnType<typeof buildNutrientBalanceReport>, bucket: 'deficits' | 'covered' | 'excess', key: string) {
  return report.buckets[bucket].find(finding => finding.nutrientKey === key);
}

test('dosesPerDay maps frequency types conservatively', () => {
  assert.equal(dosesPerDay('daily', ['08:00']), 1);
  assert.equal(dosesPerDay('daily', ['08:00', '20:00']), 2);
  assert.equal(dosesPerDay('daily', null), 1);
  assert.equal(dosesPerDay('twice_daily', null), 2);
  assert.equal(dosesPerDay('three_times_daily', null), 3);
  assert.equal(Math.round(dosesPerDay('weekly', null) * 1000) / 1000, 0.143);
  assert.equal(dosesPerDay('every_n_hours', null), 1);
  assert.equal(dosesPerDay('custom', null), 1);
});

test('aggregateFoodDailyAverages reads typed columns and extended aliases', () => {
  const avg = aggregateFoodDailyAverages(
    [
      { protein_g: 40, fiber_g: 10, extended_nutrients: { magnesium: 100, vitamin_d: 5 } },
      { protein_g: 60, fiber_g: 10, extended_nutrients: { magnesiumMg: 100, unknownStuff: 9 } },
    ],
    2,
  );
  assert.equal(avg.proteinG, 50);
  assert.equal(avg.fiberG, 10);
  assert.equal(avg.magnesiumMg, 100);
  assert.equal(avg.vitaminDMcg, 2.5);
  assert.equal(avg.unknownStuff, undefined);
});

test('deficit: total below 70% of target lands in deficits (profile target overrides RDA)', () => {
  const report = buildNutrientBalanceReport({
    foodDailyAvg: { fiberG: 12 },
    stack: [],
    targets: { fiberG: 35 },
  });
  const fiber = findingFor(report, 'deficits', 'fiberG');
  assert.ok(fiber);
  assert.equal(fiber.target, 35);
  assert.equal(fiber.totalPerDay, 12);
  // exactly 70% is NOT a deficit (strict <)
  const boundary = buildNutrientBalanceReport({
    foodDailyAvg: { fiberG: 24.5 },
    stack: [],
    targets: { fiberG: 35 },
  });
  assert.equal(findingFor(boundary, 'deficits', 'fiberG'), undefined);
});

test('covered/redundant: food supplies ≥75% of target AND a supplement adds more', () => {
  const report = buildNutrientBalanceReport({
    foodDailyAvg: { omega3EpaDhaMg: 220 },
    stack: [
      { displayName: 'Omega-3', nutrients: { omega3EpaDhaMg: 600 }, dosesPerDay: 1, validationStatus: 'verified' },
    ],
    targets: {},
  });
  const omega = findingFor(report, 'covered', 'omega3EpaDhaMg');
  assert.ok(omega);
  assert.equal(omega.stackPerDay, 600);
  assert.equal(omega.unverified, false);
  assert.deepEqual(omega.contributors, [
    { displayName: 'Omega-3', amountPerDay: 600, validationStatus: 'verified' },
  ]);
});

test('excess with supplemental UL scope uses stack-only basis (magnesium)', () => {
  // Mg UL 350 supplemental. Stack 300 ≥ 0.8*350=280 → excess even though food is modest.
  const report = buildNutrientBalanceReport({
    foodDailyAvg: { magnesiumMg: 200 },
    stack: [
      { displayName: 'Mg glycinate', nutrients: { magnesiumMg: 150 }, dosesPerDay: 2, validationStatus: 'pending' },
    ],
    targets: {},
  });
  const magnesium = findingFor(report, 'excess', 'magnesiumMg');
  assert.ok(magnesium);
  assert.equal(magnesium.stackPerDay, 300);
  assert.equal(magnesium.unverified, true); // pending fact → unverified chip
});

test('excess with total UL scope uses food+stack basis (zinc)', () => {
  // Zinc UL 40 total. Food 10 + stack 25 = 35 ≥ 32 → excess.
  const report = buildNutrientBalanceReport({
    foodDailyAvg: { zincMg: 10 },
    stack: [{ displayName: 'Zinc', nutrients: { zincMg: 25 }, dosesPerDay: 1, validationStatus: 'verified' }],
    targets: {},
  });
  assert.ok(findingFor(report, 'excess', 'zincMg'));
  // Below 80% of UL → no excess.
  const below = buildNutrientBalanceReport({
    foodDailyAvg: { zincMg: 5 },
    stack: [{ displayName: 'Zinc', nutrients: { zincMg: 10 }, dosesPerDay: 1, validationStatus: 'verified' }],
    targets: {},
  });
  assert.equal(findingFor(below, 'excess', 'zincMg'), undefined);
});

test('nutrients with zero data everywhere are skipped (no data ≠ deficit)', () => {
  const report = buildNutrientBalanceReport({ foodDailyAvg: {}, stack: [], targets: {} });
  assert.equal(report.buckets.deficits.length, 0);
  assert.equal(report.buckets.covered.length, 0);
  assert.equal(report.buckets.excess.length, 0);
});

test('rejected facts are excluded from the math entirely', () => {
  const report = buildNutrientBalanceReport({
    foodDailyAvg: {},
    stack: [
      { displayName: 'Bad extract', nutrients: { zincMg: 500 }, dosesPerDay: 1, validationStatus: 'rejected' },
    ],
    targets: {},
  });
  assert.equal(findingFor(report, 'excess', 'zincMg'), undefined);
});

test('deficits sort by severity (lowest % of target first)', () => {
  const report = buildNutrientBalanceReport({
    foodDailyAvg: { fiberG: 20, proteinG: 30 },
    stack: [],
    targets: { fiberG: 35, proteinG: 150 },
  });
  assert.equal(report.buckets.deficits[0].nutrientKey, 'proteinG'); // 20% < 57%
});
```

- [ ] **Step 2: Verify the failing state**

Run:
```bash
cd "/Volumes/DATA/GRAVITY REPO/medremind-app" && npx tsc --ignoreConfig --target ES2020 --module Node16 --moduleResolution node16 --types node --strict --esModuleInterop --skipLibCheck --outDir .tmp/unit-probe --rootDir . --noEmit false tests/unit/nutrientBalanceEngine.test.ts; rm -rf .tmp/unit-probe
```
Expected: `error TS2307: Cannot find module '../../src/lib/nutrientBalance/engine'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/nutrientBalance/engine.ts
// Pure deterministic Nutrient Balance math (B1). No I/O, no clock, relative
// imports only (standalone test:unit harness). The LLM never runs here —
// facts arrive pre-extracted; ULs come exclusively from the curated
// limits.ts table, which is what makes the excess bucket trustworthy.
import {
  findNutrientDef,
  NUTRIENT_DEFS,
  NUTRIENT_LIMITS_VERSION,
  type NutrientDef,
} from './limits';

export type StackItemInput = {
  displayName: string;
  /** Canonical nutrient keys → amount PER SINGLE DOSE. */
  nutrients: Record<string, number>;
  dosesPerDay: number;
  validationStatus: string;
};

export type NutrientContributor = {
  displayName: string;
  amountPerDay: number;
  validationStatus: string;
};

export type NutrientFinding = {
  nutrientKey: string;
  label: string;
  unit: string;
  foodAvgPerDay: number;
  stackPerDay: number;
  totalPerDay: number;
  target: number | null;
  ul: number | null;
  ulScope: 'total' | 'supplemental';
  pctOfTarget: number | null;
  contributors: NutrientContributor[];
  unverified: boolean;
};

export type NutrientBalanceReport = {
  version: string;
  buckets: {
    deficits: NutrientFinding[];
    covered: NutrientFinding[];
    excess: NutrientFinding[];
  };
};

const DEFICIT_RATIO = 0.7;
const FOOD_COVERED_RATIO = 0.75;
const EXCESS_UL_RATIO = 0.8;

const TYPED_FOOD_COLUMNS: Array<[column: string, key: string]> = [
  ['protein_g', 'proteinG'],
  ['fiber_g', 'fiberG'],
];

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function dosesPerDay(frequencyType: string, times: string[] | null): number {
  switch (frequencyType) {
    case 'daily':
      return Math.max(Array.isArray(times) ? times.length : 0, 1);
    case 'twice_daily':
      return 2;
    case 'three_times_daily':
      return 3;
    case 'weekly':
      return 1 / 7;
    default:
      // every_n_hours / every_n_days / custom: interval is not stored on
      // medication_map_items — assume once daily (conservative).
      return 1;
  }
}

export function aggregateFoodDailyAverages(
  rows: Array<Record<string, unknown>>,
  loggedDays: number,
): Record<string, number> {
  const divisor = Math.max(loggedDays, 1);
  const sums = new Map<string, number>();

  for (const row of rows) {
    for (const [column, key] of TYPED_FOOD_COLUMNS) {
      const value = toFiniteNumber(row[column]);
      if (value !== null && value > 0) sums.set(key, (sums.get(key) ?? 0) + value);
    }
    const extended = row.extended_nutrients;
    if (extended && typeof extended === 'object' && !Array.isArray(extended)) {
      for (const [rawKey, rawValue] of Object.entries(extended as Record<string, unknown>)) {
        const def = findNutrientDef(rawKey);
        const value = toFiniteNumber(rawValue);
        if (def && value !== null && value > 0) {
          sums.set(def.key, (sums.get(def.key) ?? 0) + value);
        }
      }
    }
  }

  const averages: Record<string, number> = {};
  for (const [key, total] of sums) averages[key] = round2(total / divisor);
  return averages;
}

type Contribution = { contributors: NutrientContributor[]; total: number; unverified: boolean };

function stackContributionsByNutrient(stack: StackItemInput[]): Map<string, Contribution> {
  const byNutrient = new Map<string, Contribution>();
  for (const item of stack) {
    if (item.validationStatus === 'rejected') continue; // never let bad extracts shape buckets
    for (const [rawKey, perDose] of Object.entries(item.nutrients)) {
      const def = findNutrientDef(rawKey);
      const value = toFiniteNumber(perDose);
      if (!def || value === null || value <= 0) continue;
      const amountPerDay = round2(value * item.dosesPerDay);
      const existing = byNutrient.get(def.key) ?? { contributors: [], total: 0, unverified: false };
      existing.contributors.push({
        displayName: item.displayName,
        amountPerDay,
        validationStatus: item.validationStatus,
      });
      existing.total = round2(existing.total + amountPerDay);
      existing.unverified = existing.unverified || item.validationStatus !== 'verified';
      byNutrient.set(def.key, existing);
    }
  }
  return byNutrient;
}

export function buildNutrientBalanceReport(input: {
  foodDailyAvg: Record<string, number>;
  stack: StackItemInput[];
  targets: { proteinG?: number | null; fiberG?: number | null };
}): NutrientBalanceReport {
  const stackByNutrient = stackContributionsByNutrient(input.stack);
  const deficits: NutrientFinding[] = [];
  const covered: NutrientFinding[] = [];
  const excess: NutrientFinding[] = [];

  for (const def of NUTRIENT_DEFS) {
    const foodAvgPerDay = round2(input.foodDailyAvg[def.key] ?? 0);
    const contribution = stackByNutrient.get(def.key);
    const stackPerDay = contribution?.total ?? 0;
    if (foodAvgPerDay === 0 && stackPerDay === 0) continue; // no data ≠ deficit

    const totalPerDay = round2(foodAvgPerDay + stackPerDay);
    const target = resolveTarget(def, input.targets);
    const finding: NutrientFinding = {
      nutrientKey: def.key,
      label: def.label,
      unit: def.unit,
      foodAvgPerDay,
      stackPerDay,
      totalPerDay,
      target,
      ul: def.ul,
      ulScope: def.ulScope,
      pctOfTarget: target !== null && target > 0 ? Math.round((totalPerDay / target) * 100) : null,
      contributors: contribution?.contributors ?? [],
      unverified: contribution?.unverified ?? false,
    };

    if (def.ul !== null) {
      const basis = def.ulScope === 'supplemental' ? stackPerDay : totalPerDay;
      if (basis >= EXCESS_UL_RATIO * def.ul) {
        excess.push(finding);
        continue; // an excess finding never doubles as covered/deficit
      }
    }
    if (target !== null) {
      if (totalPerDay < DEFICIT_RATIO * target) {
        deficits.push(finding);
      } else if (
        totalPerDay >= target &&
        stackPerDay > 0 &&
        foodAvgPerDay >= FOOD_COVERED_RATIO * target
      ) {
        covered.push(finding);
      }
    }
  }

  deficits.sort((a, b) => (a.pctOfTarget ?? 0) - (b.pctOfTarget ?? 0));
  excess.sort((a, b) => excessSeverity(b) - excessSeverity(a));
  covered.sort((a, b) => b.stackPerDay - a.stackPerDay);

  return { version: NUTRIENT_LIMITS_VERSION, buckets: { deficits, covered, excess } };
}

function resolveTarget(
  def: NutrientDef,
  targets: { proteinG?: number | null; fiberG?: number | null },
): number | null {
  if (def.key === 'proteinG' && typeof targets.proteinG === 'number') return targets.proteinG;
  if (def.key === 'fiberG' && typeof targets.fiberG === 'number') return targets.fiberG;
  return def.rda;
}

function excessSeverity(finding: NutrientFinding): number {
  if (finding.ul === null || finding.ul === 0) return 0;
  const basis = finding.ulScope === 'supplemental' ? finding.stackPerDay : finding.totalPerDay;
  return basis / finding.ul;
}
```

- [ ] **Step 4: Register in `test:unit` and run**

In `package.json`'s `test:unit` script:
1. Append to the tsc file list: ` tests/unit/nutrientBalanceEngine.test.ts src/lib/nutrientBalance/engine.ts`
2. Append to the run chain: ` && node .tmp/unit/tests/unit/nutrientBalanceEngine.test.js`

Run: `cd "/Volumes/DATA/GRAVITY REPO/medremind-app" && npm run test:unit && npx tsc --noEmit`
Expected: all pass (9 new tests), tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/nutrientBalance/engine.ts tests/unit/nutrientBalanceEngine.test.ts package.json
git commit -m "feat: nutrient-balance engine — deterministic deficit/covered/excess buckets"
```

---

### Task 4: `factsSchema.ts` + `factsExtractor.ts` — one cached LLM call per unique supplement

**Files:**
- Create: `src/lib/nutrientBalance/factsSchema.ts`
- Create: `src/lib/nutrientBalance/factsExtractor.ts`
- Create: `tests/unit/factsExtractor.test.ts`
- Modify: `package.json` (`test:unit` script)

**Interfaces:**
- Consumes (ALL RELATIVE imports — these modules are compiled by the `test:unit` tsc
  harness, whose graph pulls `../medKnowledge/openRouter.ts` and
  `../medKnowledge/openRouterModels.ts`, both of which are value-leaf modules — verified:
  `openRouter.ts` has only type-imports, `openRouterModels.ts` has none):
  - `callOpenRouterStructuredJson` from `../medKnowledge/openRouter` (supports `fetchImpl`
    injection — that is the mock-provider seam the test uses)
  - `getMedicationKnowledgeModelConfig`, `type MedicationKnowledgeModelConfig` from
    `../medKnowledge/openRouterModels`
  - `type JsonSchema` from `../medKnowledge/aiSchemas`
  - `NUTRIENT_DEFS`, `findNutrientDef` from `./limits`
- Produces (consumed by Task 5):
  - `normalizeSupplementName(displayName: string): string`
  - `SUPPLEMENT_FACTS_SCHEMA: JsonSchema`
  - `validateSupplementFacts(value: unknown): Record<string, number>` (canonical keys only,
    finite non-negative; empty record allowed — some supplements track no listed nutrient)
  - `extractSupplementFacts(input: { normalizedName: string; doseAmount: number; doseUnit: string }, options?: { config?: MedicationKnowledgeModelConfig; fetchImpl?: typeof fetch }): Promise<{ nutrients: Record<string, number>; model: string }>`
    — tries `config.fastModel` then `config.fallbackModel`; throws
    `Error('nutrient_balance_provider_exhausted')` when both fail.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/factsExtractor.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  normalizeSupplementName,
  validateSupplementFacts,
} from '../../src/lib/nutrientBalance/factsSchema';
import { extractSupplementFacts } from '../../src/lib/nutrientBalance/factsExtractor';
import type { MedicationKnowledgeModelConfig } from '../../src/lib/medKnowledge/openRouterModels';

const config: MedicationKnowledgeModelConfig = {
  baseUrl: 'https://openrouter.test/api/v1',
  apiKey: 'test-key',
  appReferer: null,
  appTitle: 'MedRemind-Test',
  fastModel: 'model-fast',
  reasoningModel: 'model-reasoning',
  secondOpinionModel: 'model-second',
  nanoModel: 'model-nano',
  longContextModel: 'model-long',
  fallbackModel: 'model-fallback',
};

function openRouterResponse(content: unknown, model = 'model-fast'): Response {
  return new Response(
    JSON.stringify({ model, choices: [{ message: { content: JSON.stringify(content) } }] }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

test('normalizeSupplementName lowercases and strips punctuation', () => {
  assert.equal(normalizeSupplementName('  Magnesium Glycinate (Now Foods) '), 'magnesium glycinate now foods');
  assert.equal(normalizeSupplementName('Omega-3 1000mg'), 'omega 3 1000mg');
});

test('validateSupplementFacts keeps canonical keys, maps aliases, drops junk', () => {
  const nutrients = validateSupplementFacts({
    nutrients: { magnesium: 200, vitamin_d: 12.5, zincMg: -3, mystery: 9, epaDha: 'oops' },
    confidence: 0.9,
    notes: null,
  });
  assert.deepEqual(nutrients, { magnesiumMg: 200, vitaminDMcg: 12.5 });
});

test('validateSupplementFacts throws on a non-object payload', () => {
  assert.throws(() => validateSupplementFacts(null));
  assert.throws(() => validateSupplementFacts({ confidence: 1 }));
});

test('extractSupplementFacts returns validated nutrients from the first model', async () => {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    const body = JSON.parse(String(init?.body));
    calls.push(body.model);
    return openRouterResponse({ nutrients: { magnesiumMg: 200 }, confidence: 0.9, notes: null });
  };
  const result = await extractSupplementFacts(
    { normalizedName: 'magnesium glycinate', doseAmount: 200, doseUnit: 'mg' },
    { config, fetchImpl },
  );
  assert.deepEqual(result.nutrients, { magnesiumMg: 200 });
  assert.equal(result.model, 'model-fast');
  assert.deepEqual(calls, ['model-fast']);
});

test('extractSupplementFacts falls back to the second model and then exhausts', async () => {
  const calls: string[] = [];
  const failingThenOk: typeof fetch = async (url, init) => {
    const body = JSON.parse(String(init?.body));
    calls.push(body.model);
    if (body.model === 'model-fast') return new Response('{}', { status: 500 });
    return openRouterResponse({ nutrients: { zincMg: 15 }, confidence: 0.8, notes: null }, 'model-fallback');
  };
  const result = await extractSupplementFacts(
    { normalizedName: 'zinc picolinate', doseAmount: 15, doseUnit: 'mg' },
    { config, fetchImpl: failingThenOk },
  );
  assert.deepEqual(result.nutrients, { zincMg: 15 });
  assert.deepEqual(calls, ['model-fast', 'model-fallback']);

  const alwaysFailing: typeof fetch = async () => new Response('{}', { status: 500 });
  await assert.rejects(
    () =>
      extractSupplementFacts(
        { normalizedName: 'zinc picolinate', doseAmount: 15, doseUnit: 'mg' },
        { config, fetchImpl: alwaysFailing },
      ),
    /nutrient_balance_provider_exhausted/,
  );
});
```

- [ ] **Step 2: Verify the failing state**

Run:
```bash
cd "/Volumes/DATA/GRAVITY REPO/medremind-app" && npx tsc --ignoreConfig --target ES2020 --module Node16 --moduleResolution node16 --types node --strict --esModuleInterop --skipLibCheck --outDir .tmp/unit-probe --rootDir . --noEmit false tests/unit/factsExtractor.test.ts; rm -rf .tmp/unit-probe
```
Expected: `error TS2307: Cannot find module '../../src/lib/nutrientBalance/factsSchema'`.

- [ ] **Step 3: Write `factsSchema.ts`**

```ts
// src/lib/nutrientBalance/factsSchema.ts
// Structured-output schema + validator for supplement nutrient extraction.
// Relative imports only (test:unit harness). The schema whitelists exactly
// the curated nutrient keys — the model cannot invent nutrients, and it
// cannot supply ULs (those live in limits.ts by design).
import type { JsonSchema } from '../medKnowledge/aiSchemas';
import { findNutrientDef, NUTRIENT_DEFS } from './limits';

export function normalizeSupplementName(displayName: string): string {
  return displayName.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

const NUTRIENT_PROPERTIES = Object.fromEntries(
  NUTRIENT_DEFS.map(def => [def.key, { type: ['number', 'null'] }]),
);

export const SUPPLEMENT_FACTS_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['nutrients', 'confidence', 'notes'],
  properties: {
    nutrients: {
      type: 'object',
      additionalProperties: false,
      required: NUTRIENT_DEFS.map(def => def.key),
      properties: NUTRIENT_PROPERTIES,
    },
    confidence: { type: 'number' },
    notes: { type: ['string', 'null'] },
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validateSupplementFacts(value: unknown): Record<string, number> {
  if (!isRecord(value) || !isRecord(value.nutrients)) {
    throw new Error('Supplement facts response must contain a nutrients object.');
  }
  const nutrients: Record<string, number> = {};
  for (const [rawKey, rawValue] of Object.entries(value.nutrients)) {
    const def = findNutrientDef(rawKey);
    if (!def) continue;
    const parsed = typeof rawValue === 'number' ? rawValue : Number.NaN;
    if (!Number.isFinite(parsed) || parsed <= 0) continue;
    nutrients[def.key] = Math.round(parsed * 100) / 100;
  }
  return nutrients;
}
```

- [ ] **Step 4: Write `factsExtractor.ts`**

```ts
// src/lib/nutrientBalance/factsExtractor.ts
// ONE structured LLM call per unique normalized supplement — the caller
// (service.ts) checks the supplement_nutrient_facts cache first and inserts
// the result forever after. Model fallback chain + coded error, reusing the
// medKnowledge OpenRouter caller. Relative imports only (test:unit harness;
// the fetchImpl seam doubles as the unit-test mock provider).
import { callOpenRouterStructuredJson } from '../medKnowledge/openRouter';
import {
  getMedicationKnowledgeModelConfig,
  type MedicationKnowledgeModelConfig,
} from '../medKnowledge/openRouterModels';
import { NUTRIENT_DEFS } from './limits';
import { SUPPLEMENT_FACTS_SCHEMA, validateSupplementFacts } from './factsSchema';

const EXTRACTOR_PROMPT = [
  'You are a supplement label analyst. Given a supplement name and a single-dose',
  'amount, return the nutrient content of ONE dose using ONLY the allowed keys.',
  'Use elemental amounts (e.g. elemental magnesium, not compound weight). Set a',
  'key to null when the supplement does not meaningfully contain that nutrient',
  'or you are unsure. Do not guess brands. Return only JSON matching the schema.',
  'Allowed keys and units: ',
  NUTRIENT_DEFS.map(def => `${def.key} (${def.unit})`).join(', '),
].join(' ');

export type ExtractSupplementFactsInput = {
  normalizedName: string;
  doseAmount: number;
  doseUnit: string;
};

export type ExtractedSupplementFacts = {
  nutrients: Record<string, number>;
  model: string;
};

export async function extractSupplementFacts(
  input: ExtractSupplementFactsInput,
  options: { config?: MedicationKnowledgeModelConfig; fetchImpl?: typeof fetch } = {},
): Promise<ExtractedSupplementFacts> {
  const config = options.config ?? getMedicationKnowledgeModelConfig();
  const models = [config.fastModel, config.fallbackModel];

  for (const model of models) {
    try {
      const result = await callOpenRouterStructuredJson({
        config,
        model,
        schemaName: 'supplement_nutrient_facts',
        schema: SUPPLEMENT_FACTS_SCHEMA,
        messages: [
          { role: 'system', content: EXTRACTOR_PROMPT },
          {
            role: 'user',
            content: JSON.stringify({
              supplement: input.normalizedName,
              dose: `${input.doseAmount} ${input.doseUnit}`,
            }),
          },
        ],
        fetchImpl: options.fetchImpl,
      });
      return { nutrients: validateSupplementFacts(result.output), model: result.model };
    } catch {
      // fall through to the next model in the chain
    }
  }
  throw new Error('nutrient_balance_provider_exhausted');
}
```

- [ ] **Step 5: Register in `test:unit` and run**

In `package.json`'s `test:unit` script:
1. Append to the tsc file list: ` tests/unit/factsExtractor.test.ts src/lib/nutrientBalance/factsSchema.ts src/lib/nutrientBalance/factsExtractor.ts`
2. Append to the run chain: ` && node .tmp/unit/tests/unit/factsExtractor.test.js`

Run: `cd "/Volumes/DATA/GRAVITY REPO/medremind-app" && npm run test:unit && npx tsc --noEmit`
Expected: all pass (5 new tests — the tsc harness also compiles the imported
`medKnowledge/openRouter.ts` + `openRouterModels.ts` + `aiSchemas.ts` graph), tsc clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/nutrientBalance/factsSchema.ts src/lib/nutrientBalance/factsExtractor.ts tests/unit/factsExtractor.test.ts package.json
git commit -m "feat: supplement facts extractor — schema-validated, cached-per-unique-item LLM call"
```

---

### Task 5: `service.ts` — orchestration + per-user/day cache

**Files:**
- Create: `src/lib/nutrientBalance/service.ts`

**Interfaces:**
- Consumes: `createCorrelationServiceClient` from `@/lib/correlation/persistence`
  (service-role client factory — reused, not duplicated); engine/limits/factsSchema/
  factsExtractor from `./*`; `Sentry` from `@sentry/nextjs`.
- DB (service-role): reads `profiles.timezone`, `nutrition_target_profiles(protein_g, fiber_g)`,
  `food_entries(consumed_at, timezone, protein_g, fiber_g, extended_nutrients)` (14 days),
  `medication_map_items(display_name, dose_amount, dose_unit, frequency_type, times)`
  where `status='active'` (columns verified against `supabase/009`); reads/writes
  `supplement_nutrient_facts`; upserts `nutrient_balance_reports`.
- Produces (consumed by Task 6 route and mirrored by the card):

```ts
export type NutrientBalanceResponse = {
  report: NutrientBalanceReport;
  pendingItems: string[];       // display names with no usable facts yet
  loggedDays: number;           // distinct food days inside the 14-day window
  insufficientFoodData: boolean; // loggedDays < 3
  limitsVersion: string;
};
export async function getNutrientBalance(userId: string, options?: { refresh?: boolean }): Promise<NutrientBalanceResponse>;
```

- Stack source note (recorded decision): the stack comes from `medication_map_items`
  (`status='active'`) — the normalized inventory the medKnowledge refresh flow already
  maintains. If the user has never pressed "Refresh" in the Health & Medication Patterns
  panel the table is empty and the card shows an actionable empty state; the card sits in
  the same panel column on Progress, so the refresh button is on screen.
- Extraction cap (cost/latency bound): at most 5 new extractions per request
  (`MAX_EXTRACTIONS_PER_RUN`); uncovered items land in `pendingItems` and resolve on the
  next refresh.

- [ ] **Step 1: Write the module**

```ts
// src/lib/nutrientBalance/service.ts
// Server-only orchestration for Nutrient Balance: cache check → fetch stack
// + 14d food rows → ensure facts (LLM once per unique supplement, cached in
// supplement_nutrient_facts forever) → deterministic engine → cache row.
import * as Sentry from '@sentry/nextjs';
import { createCorrelationServiceClient } from '@/lib/correlation/persistence';
import {
  aggregateFoodDailyAverages,
  buildNutrientBalanceReport,
  dosesPerDay,
  type NutrientBalanceReport,
  type StackItemInput,
} from './engine';
import { extractSupplementFacts } from './factsExtractor';
import { normalizeSupplementName } from './factsSchema';
import { NUTRIENT_LIMITS_VERSION } from './limits';

type Row = Record<string, unknown>;

export type NutrientBalanceResponse = {
  report: NutrientBalanceReport;
  pendingItems: string[];
  loggedDays: number;
  insufficientFoodData: boolean;
  limitsVersion: string;
};

const FOOD_WINDOW_DAYS = 14;
const MIN_LOGGED_DAYS = 3;
const MAX_EXTRACTIONS_PER_RUN = 5;

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function localDateFor(iso: string, timezone: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const map = new Map(parts.map(part => [part.type, part.value]));
    const year = map.get('year');
    const month = map.get('month');
    const day = map.get('day');
    return year && month && day ? `${year}-${month}-${day}` : null;
  } catch {
    return null;
  }
}

function factKey(normalizedName: string, doseAmount: number, doseUnit: string): string {
  return `${normalizedName}|${doseAmount}|${doseUnit.toLowerCase()}`;
}

export async function getNutrientBalance(
  userId: string,
  options: { refresh?: boolean } = {},
): Promise<NutrientBalanceResponse> {
  const supabase = createCorrelationServiceClient();

  const { data: profileRow } = await supabase
    .from('profiles')
    .select('timezone')
    .eq('id', userId)
    .maybeSingle();
  const timezone =
    typeof (profileRow as Row | null)?.timezone === 'string'
      ? String((profileRow as Row).timezone)
      : 'UTC';
  const today = localDateFor(new Date().toISOString(), timezone) ?? new Date().toISOString().slice(0, 10);

  if (!options.refresh) {
    const { data: cached, error: cacheError } = await supabase
      .from('nutrient_balance_reports')
      .select('payload')
      .eq('user_id', userId)
      .eq('report_date', today)
      .eq('limits_version', NUTRIENT_LIMITS_VERSION)
      .maybeSingle();
    if (!cacheError && cached && (cached as Row).payload) {
      return (cached as Row).payload as NutrientBalanceResponse;
    }
  }

  const windowStart = new Date();
  windowStart.setUTCDate(windowStart.getUTCDate() - (FOOD_WINDOW_DAYS - 1));
  const fromIso = `${windowStart.toISOString().slice(0, 10)}T00:00:00.000Z`;

  const [targetsResult, foodResult, stackResult] = await Promise.all([
    supabase
      .from('nutrition_target_profiles')
      .select('protein_g, fiber_g')
      .eq('user_id', userId)
      .maybeSingle(),
    supabase
      .from('food_entries')
      .select('consumed_at, timezone, protein_g, fiber_g, extended_nutrients')
      .eq('user_id', userId)
      .gte('consumed_at', fromIso),
    supabase
      .from('medication_map_items')
      .select('display_name, dose_amount, dose_unit, frequency_type, times')
      .eq('user_id', userId)
      .eq('status', 'active'),
  ]);
  if (foodResult.error) throw foodResult.error;
  if (stackResult.error) throw stackResult.error;

  const foodRows = (foodResult.data as Row[] | null) ?? [];
  const loggedDayset = new Set<string>();
  for (const row of foodRows) {
    if (typeof row.consumed_at !== 'string') continue;
    const rowTz = typeof row.timezone === 'string' && row.timezone ? row.timezone : timezone;
    const localDate = localDateFor(row.consumed_at, rowTz);
    if (localDate) loggedDayset.add(localDate);
  }
  const loggedDays = loggedDayset.size;

  const mapRows = (stackResult.data as Row[] | null) ?? [];
  const pendingItems: string[] = [];
  type PreparedItem = {
    displayName: string;
    normalizedName: string;
    doseAmount: number;
    doseUnit: string;
    dosesPerDay: number;
  };
  const prepared: PreparedItem[] = [];
  for (const row of mapRows) {
    const displayName = typeof row.display_name === 'string' ? row.display_name : null;
    if (!displayName) continue;
    const doseAmount = toNumber(row.dose_amount);
    const doseUnit = typeof row.dose_unit === 'string' && row.dose_unit ? row.dose_unit : null;
    if (doseAmount === null || doseAmount <= 0 || !doseUnit) {
      pendingItems.push(displayName); // cannot key facts without a dose
      continue;
    }
    prepared.push({
      displayName,
      normalizedName: normalizeSupplementName(displayName),
      doseAmount,
      doseUnit,
      dosesPerDay: dosesPerDay(
        typeof row.frequency_type === 'string' ? row.frequency_type : 'daily',
        Array.isArray(row.times) ? (row.times as string[]) : null,
      ),
    });
  }

  const factsByKey = new Map<string, { nutrients: Record<string, number>; validationStatus: string }>();
  if (prepared.length > 0) {
    const { data: factRows, error: factsError } = await supabase
      .from('supplement_nutrient_facts')
      .select('normalized_name, dose_amount, dose_unit, nutrients, validation_status')
      .in('normalized_name', [...new Set(prepared.map(item => item.normalizedName))]);
    if (factsError) throw factsError;
    for (const row of (factRows as Row[] | null) ?? []) {
      const amount = toNumber(row.dose_amount);
      if (
        typeof row.normalized_name !== 'string' ||
        amount === null ||
        typeof row.dose_unit !== 'string'
      ) {
        continue;
      }
      factsByKey.set(factKey(row.normalized_name, amount, row.dose_unit), {
        nutrients: (row.nutrients as Record<string, number> | null) ?? {},
        validationStatus:
          typeof row.validation_status === 'string' ? row.validation_status : 'pending',
      });
    }
  }

  let extractions = 0;
  for (const item of prepared) {
    const key = factKey(item.normalizedName, item.doseAmount, item.doseUnit);
    if (factsByKey.has(key)) continue;
    if (extractions >= MAX_EXTRACTIONS_PER_RUN) {
      pendingItems.push(item.displayName);
      continue;
    }
    extractions += 1;
    try {
      const extracted = await extractSupplementFacts({
        normalizedName: item.normalizedName,
        doseAmount: item.doseAmount,
        doseUnit: item.doseUnit,
      });
      const { error: insertError } = await supabase.from('supplement_nutrient_facts').upsert(
        {
          normalized_name: item.normalizedName,
          dose_amount: item.doseAmount,
          dose_unit: item.doseUnit,
          nutrients: extracted.nutrients,
          model: extracted.model,
          validation_status: 'pending',
        },
        { onConflict: 'normalized_name,dose_amount,dose_unit', ignoreDuplicates: true },
      );
      if (insertError) throw insertError;
      factsByKey.set(key, { nutrients: extracted.nutrients, validationStatus: 'pending' });
    } catch (error) {
      Sentry.captureException(error);
      pendingItems.push(item.displayName);
    }
  }

  const stack: StackItemInput[] = [];
  for (const item of prepared) {
    const fact = factsByKey.get(factKey(item.normalizedName, item.doseAmount, item.doseUnit));
    if (!fact) continue;
    stack.push({
      displayName: item.displayName,
      nutrients: fact.nutrients,
      dosesPerDay: item.dosesPerDay,
      validationStatus: fact.validationStatus,
    });
  }

  const targetsRow = targetsResult.data as Row | null;
  const report = buildNutrientBalanceReport({
    foodDailyAvg: aggregateFoodDailyAverages(foodRows, loggedDays),
    stack,
    targets: {
      proteinG: toNumber(targetsRow?.protein_g),
      fiberG: toNumber(targetsRow?.fiber_g),
    },
  });

  const response: NutrientBalanceResponse = {
    report,
    pendingItems,
    loggedDays,
    insufficientFoodData: loggedDays < MIN_LOGGED_DAYS,
    limitsVersion: NUTRIENT_LIMITS_VERSION,
  };

  const { error: upsertError } = await supabase.from('nutrient_balance_reports').upsert(
    {
      user_id: userId,
      report_date: today,
      payload: response,
      limits_version: NUTRIENT_LIMITS_VERSION,
      computed_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,report_date' },
  );
  if (upsertError) Sentry.captureException(upsertError); // cache failure is non-fatal

  return response;
}
```

- [ ] **Step 2: Type-check**

Run: `cd "/Volumes/DATA/GRAVITY REPO/medremind-app" && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/lib/nutrientBalance/service.ts
git commit -m "feat: nutrient-balance service — stack facts, 14d food avg, per-day cache"
```

---

### Task 6: `/api/insights/nutrient-balance` route

**Files:**
- Create: `src/app/api/insights/nutrient-balance/route.ts`

**Interfaces:**
- Consumes: `createClient` from `@/lib/supabase/server` (auth check — the `requireUser`
  shape from `src/app/api/insights/correlations/route.ts:64-76`); `getNutrientBalance`
  from `@/lib/nutrientBalance/service`; `Sentry`.
- Produces: `GET /api/insights/nutrient-balance[?refresh=1]` →
  401 `{ error: 'Unauthorized' }` | 200 `NutrientBalanceResponse` |
  502 `{ error: 'Nutrient balance failed.', reason }` (reason is the coded
  `nutrient_balance_*` message when present).

- [ ] **Step 1: Write the route**

```ts
// src/app/api/insights/nutrient-balance/route.ts
import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { getNutrientBalance } from '@/lib/nutrientBalance/service';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const refresh = request.nextUrl.searchParams.get('refresh') === '1';
    const response = await getNutrientBalance(data.user.id, { refresh });
    return NextResponse.json(response);
  } catch (err) {
    Sentry.captureException(err);
    const reason =
      err instanceof Error && /^nutrient_balance_/.test(err.message) ? err.message : 'unknown';
    return NextResponse.json({ error: 'Nutrient balance failed.', reason }, { status: 502 });
  }
}
```

- [ ] **Step 2: Verify**

Run: `cd "/Volumes/DATA/GRAVITY REPO/medremind-app" && npx tsc --noEmit && npm run build`
Expected: clean; build lists `ƒ /api/insights/nutrient-balance`.

Auth smoke (dev server running):
```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/insights/nutrient-balance
```
Expected: `401`.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/insights/nutrient-balance/route.ts
git commit -m "feat: nutrient-balance API route with per-day cache and refresh bypass"
```

---

### Task 7: Progress page card — three expandable buckets

**Files:**
- Create: `src/components/app/nutrientBalance/NutrientBalanceCard.tsx`
- Modify: `src/app/app/progress/page.tsx` (one import + one JSX line)

**Interfaces:**
- Consumes: `GET /api/insights/nutrient-balance` (+ `?refresh=1`); the payload types are
  mirrored locally in the component (client components must not import the server-only
  `service.ts`, which pulls `@sentry/nextjs` server config — mirror the `NutrientFinding`
  shape instead, it is part of the route's public contract).
- Produces: `<NutrientBalanceCard />` inserted in the `correlations` tab of the Progress
  page, directly after the "Health & Medication Patterns" card (before the "Last 7 Days"
  section) — the single-insertion pattern that keeps the page diff minimal.

- [ ] **Step 1: Write the component**

```tsx
// src/components/app/nutrientBalance/NutrientBalanceCard.tsx
'use client';
import { useEffect, useState } from 'react';

type Contributor = { displayName: string; amountPerDay: number; validationStatus: string };
type Finding = {
  nutrientKey: string;
  label: string;
  unit: string;
  foodAvgPerDay: number;
  stackPerDay: number;
  totalPerDay: number;
  target: number | null;
  ul: number | null;
  ulScope: 'total' | 'supplemental';
  pctOfTarget: number | null;
  contributors: Contributor[];
  unverified: boolean;
};
type BalanceResponse = {
  report: { version: string; buckets: { deficits: Finding[]; covered: Finding[]; excess: Finding[] } };
  pendingItems: string[];
  loggedDays: number;
  insufficientFoodData: boolean;
  limitsVersion: string;
};

const BUCKETS = [
  { key: 'deficits', title: 'Deficits', color: '#EF4444', hint: 'Food + stack below target' },
  { key: 'covered', title: 'Covered / redundant', color: '#10B981', hint: 'Diet already supplies this' },
  { key: 'excess', title: 'Possible excess', color: '#FBBF24', hint: 'Approaching the curated upper limit' },
] as const;

const DISCLAIMER =
  'These patterns support clinician review and are not medical advice. Do not start, stop, or change any medication or supplement based on this card.';

function formatAmount(value: number, unit: string): string {
  const rounded = Math.round(value * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)} ${unit}`;
}

export function NutrientBalanceCard() {
  const [data, setData] = useState<BalanceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  async function load(refresh: boolean) {
    if (refresh) setRefreshing(true);
    setError(null);
    try {
      const response = await fetch(`/api/insights/nutrient-balance${refresh ? '?refresh=1' : ''}`);
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.report) {
        setError('Nutrient balance is unavailable right now.');
        return;
      }
      setData(payload as BalanceResponse);
    } catch {
      setError('Nutrient balance is unavailable right now.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only fetch
  }, []);

  const totalFindings = data
    ? data.report.buckets.deficits.length +
      data.report.buckets.covered.length +
      data.report.buckets.excess.length
    : 0;

  return (
    <div className="bg-[#161B22] border border-[rgba(255,255,255,0.08)] rounded-2xl p-4 mb-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <div className="text-xs font-bold text-[#8B949E] uppercase tracking-widest">Nutrient Balance</div>
          <div className="mt-1 text-xs leading-relaxed text-[#8B949E]">
            Food diary (14-day average) × active supplement stack.
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load(true)}
          disabled={refreshing}
          className="rounded-xl bg-[#30363D] px-3 py-1.5 text-xs font-bold text-[#F0F6FC] disabled:opacity-60"
        >
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {loading && <p className="text-sm text-[#8B949E]">Loading nutrient balance...</p>}
      {error && <p className="text-xs text-[#FCA5A5]">{error}</p>}

      {data && !loading && (
        <div className="flex flex-col gap-3">
          {data.insufficientFoodData && (
            <p className="rounded-xl bg-[#0D1117] px-3 py-2 text-xs text-[#8B949E]">
              Only {data.loggedDays} day(s) of food logged in the last 14 — log at least 3 days
              for reliable deficit math.
            </p>
          )}
          {totalFindings === 0 && !data.insufficientFoodData && (
            <p className="text-sm leading-relaxed text-[#8B949E]">
              No findings yet. Log meals and refresh medication context above so the stack is
              known, then refresh.
            </p>
          )}

          {BUCKETS.map(bucket => {
            const findings = data.report.buckets[bucket.key];
            if (findings.length === 0) return null;
            return (
              <div key={bucket.key}>
                <div className="mb-1.5 flex items-baseline gap-2">
                  <span className="text-sm font-bold" style={{ color: bucket.color }}>
                    {bucket.title}
                  </span>
                  <span className="text-[10px] text-[#8B949E]">{bucket.hint}</span>
                </div>
                <div className="space-y-1.5">
                  {findings.map(finding => {
                    const rowKey = `${bucket.key}:${finding.nutrientKey}`;
                    const expanded = expandedKey === rowKey;
                    return (
                      <div key={rowKey} className="rounded-xl bg-[#0D1117]">
                        <button
                          type="button"
                          onClick={() => setExpandedKey(expanded ? null : rowKey)}
                          className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
                        >
                          <span className="flex items-center gap-2 text-sm font-semibold text-[#F0F6FC]">
                            {finding.label}
                            {finding.unverified && (
                              <span className="rounded-full bg-[rgba(251,191,36,0.16)] px-2 py-0.5 text-[9px] font-bold text-[#FBBF24]">
                                unverified
                              </span>
                            )}
                          </span>
                          <span className="text-xs font-bold text-[#8B949E]">
                            {formatAmount(finding.totalPerDay, finding.unit)}
                            {finding.target !== null && ` / ${formatAmount(finding.target, finding.unit)}`}
                          </span>
                        </button>
                        {expanded && (
                          <div className="border-t border-[rgba(255,255,255,0.06)] px-3 py-2 text-xs text-[#8B949E]">
                            <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                              <span>Food avg/day</span>
                              <span className="text-right text-[#C9D1D9]">{formatAmount(finding.foodAvgPerDay, finding.unit)}</span>
                              <span>Stack/day</span>
                              <span className="text-right text-[#C9D1D9]">{formatAmount(finding.stackPerDay, finding.unit)}</span>
                              <span>Target</span>
                              <span className="text-right text-[#C9D1D9]">
                                {finding.target !== null ? formatAmount(finding.target, finding.unit) : '—'}
                              </span>
                              <span>Upper limit{finding.ulScope === 'supplemental' ? ' (supplemental)' : ''}</span>
                              <span className="text-right text-[#C9D1D9]">
                                {finding.ul !== null ? formatAmount(finding.ul, finding.unit) : '—'}
                              </span>
                            </div>
                            {finding.contributors.length > 0 && (
                              <div className="mt-2">
                                <div className="font-semibold text-[#C9D1D9]">Stack contribution</div>
                                {finding.contributors.map(contributor => (
                                  <div key={contributor.displayName} className="mt-0.5 flex justify-between gap-2">
                                    <span>
                                      {contributor.displayName}
                                      {contributor.validationStatus !== 'verified' && ' (unverified)'}
                                    </span>
                                    <span>{formatAmount(contributor.amountPerDay, finding.unit)}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {data.pendingItems.length > 0 && (
            <p className="rounded-xl bg-[#0D1117] px-3 py-2 text-[11px] text-[#8B949E]">
              Awaiting nutrient facts (unverified): {data.pendingItems.join(', ')} — refresh
              later to extract.
            </p>
          )}
          <p className="text-[10px] leading-relaxed text-[#8B949E]">{DISCLAIMER}</p>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Insert into the Progress page**

In `src/app/app/progress/page.tsx`:

Add the import (after `import { OuraTab } from '@/components/app/oura/OuraTab';`):

```tsx
import { NutrientBalanceCard } from '@/components/app/nutrientBalance/NutrientBalanceCard';
```

Insert the card in the `correlations` tab JSX, directly after the closing `</div>` of the
`{/* ── 4. HEALTH AND MEDICATION PATTERNS ── */}` card and BEFORE the
`{/* ── 5. LAST 7 DAYS … ── */}` comment:

```tsx
        <NutrientBalanceCard />
```

- [ ] **Step 3: Verify**

Run: `cd "/Volumes/DATA/GRAVITY REPO/medremind-app" && npx tsc --noEmit && npm run build`
Expected: both clean.

- [ ] **Step 4: Commit**

```bash
git add src/components/app/nutrientBalance/NutrientBalanceCard.tsx src/app/app/progress/page.tsx
git commit -m "feat: nutrient-balance card on Progress — three buckets, unverified chips, disclaimer"
```

---

### Task 8: Playwright E2E (seeded report), full gates, PR

**Files:**
- Create: `tests/e2e/nutrientBalance.spec.ts`

**Interfaces:**
- Consumes: env-gated login pattern; a SERVICE-ROLE Supabase client to seed
  `nutrient_balance_reports` (the table has a select-only owner policy — inserts require
  the service key, so the suite additionally self-skips when
  `SUPABASE_SERVICE_ROLE_KEY` is absent); `NUTRIENT_LIMITS_VERSION` imported relatively
  from `src/lib/nutrientBalance/limits.ts` (leaf module — Playwright's transform resolves
  the relative import) so the seeded row hits the cache path and the card renders through
  the REAL route end-to-end. Assumption (same as `food.spec.ts` makes implicitly): the E2E
  account's profile timezone matches the machine timezone, so `report_date` computed
  server-side equals the locally-formatted date.
- Cleanup: afterEach deletes the seeded row (hardened-harness rules, PR #63).

- [ ] **Step 1: Write the spec**

```ts
// tests/e2e/nutrientBalance.spec.ts
import { expect, test, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { NUTRIENT_LIMITS_VERSION } from '../../src/lib/nutrientBalance/limits';

const e2eEmail = process.env.E2E_EMAIL;
const e2ePassword = process.env.E2E_PASSWORD;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const hasE2eEnv = Boolean(e2eEmail && e2ePassword && supabaseUrl && supabaseAnonKey && serviceRoleKey);

function localToday(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const seededPayload = {
  report: {
    version: NUTRIENT_LIMITS_VERSION,
    buckets: {
      deficits: [
        {
          nutrientKey: 'fiberG', label: 'Fiber', unit: 'g',
          foodAvgPerDay: 12, stackPerDay: 0, totalPerDay: 12,
          target: 35, ul: null, ulScope: 'total', pctOfTarget: 34,
          contributors: [], unverified: false,
        },
      ],
      covered: [
        {
          nutrientKey: 'omega3EpaDhaMg', label: 'Omega-3 (EPA+DHA)', unit: 'mg',
          foodAvgPerDay: 220, stackPerDay: 600, totalPerDay: 820,
          target: 250, ul: 5000, ulScope: 'supplemental', pctOfTarget: 328,
          contributors: [{ displayName: 'Omega-3', amountPerDay: 600, validationStatus: 'verified' }],
          unverified: false,
        },
      ],
      excess: [
        {
          nutrientKey: 'magnesiumMg', label: 'Magnesium', unit: 'mg',
          foodAvgPerDay: 200, stackPerDay: 300, totalPerDay: 500,
          target: 420, ul: 350, ulScope: 'supplemental', pctOfTarget: 119,
          contributors: [{ displayName: 'Mg glycinate', amountPerDay: 300, validationStatus: 'pending' }],
          unverified: true,
        },
      ],
    },
  },
  pendingItems: ['Collagen'],
  loggedDays: 9,
  insufficientFoodData: false,
  limitsVersion: NUTRIENT_LIMITS_VERSION,
};

async function resolveUserId(): Promise<string> {
  const supabase = createClient(supabaseUrl!, supabaseAnonKey!);
  const { data, error } = await supabase.auth.signInWithPassword({
    email: e2eEmail!,
    password: e2ePassword!,
  });
  if (error || !data.user) throw error ?? new Error('no user');
  const userId = data.user.id;
  await supabase.auth.signOut();
  return userId;
}

function serviceClient() {
  return createClient(supabaseUrl!, serviceRoleKey!);
}

async function seedReport(userId: string) {
  const { error } = await serviceClient().from('nutrient_balance_reports').upsert(
    {
      user_id: userId,
      report_date: localToday(),
      payload: seededPayload,
      limits_version: NUTRIENT_LIMITS_VERSION,
    },
    { onConflict: 'user_id,report_date' },
  );
  if (error) throw error;
}

async function deleteReport(userId: string) {
  const { error } = await serviceClient()
    .from('nutrient_balance_reports')
    .delete()
    .eq('user_id', userId)
    .eq('report_date', localToday());
  if (error) throw error;
}

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(e2eEmail!);
  await page.getByLabel('Password').fill(e2ePassword!);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/(app|onboarding)(\/|$)/, { timeout: 30_000 });
}

test.describe('nutrient balance card', () => {
  test.skip(!hasE2eEnv, 'E2E credentials (incl. service role key) are not configured');
  let userId: string;

  test.beforeEach(async () => {
    userId = await resolveUserId();
    await seedReport(userId);
  });

  test.afterEach(async () => {
    await deleteReport(userId);
  });

  test('renders three buckets from a seeded report with chips and disclaimer', async ({
    page,
  }) => {
    await login(page);
    await page.goto('/app/progress');

    await expect(page.getByText('Nutrient Balance', { exact: true })).toBeVisible();
    await expect(page.getByText('Deficits', { exact: true })).toBeVisible();
    await expect(page.getByText('Covered / redundant', { exact: true })).toBeVisible();
    await expect(page.getByText('Possible excess', { exact: true })).toBeVisible();

    // Expand the excess row → contribution breakdown + supplemental UL label.
    await page.getByRole('button', { name: /Magnesium/ }).click();
    await expect(page.getByText('Stack contribution')).toBeVisible();
    await expect(page.getByText('Upper limit (supplemental)')).toBeVisible();
    await expect(page.getByText('unverified').first()).toBeVisible();

    // Pending extraction note + safety disclaimer.
    await expect(page.getByText(/Awaiting nutrient facts .*Collagen/)).toBeVisible();
    await expect(page.getByText(/not medical advice/)).toBeVisible();
  });
});
```

- [ ] **Step 2: Run it (creds- and service-key-gated)**

NOTE: this E2E requires migration 026 to be applied to the environment the app points at.
Locally that means it stays SKIPPED until the owner applies 026 to production (the E2E
account lives there) — that is expected and correct; the agent never applies migrations.
Record the skip in the PR body.

Run:
```bash
cd "/Volumes/DATA/GRAVITY REPO/medremind-app" && set -a && source .env.local && set +a && npx playwright test tests/e2e/nutrientBalance.spec.ts
```
Expected: 1 passed once 026 is applied; before that, a clean run against a DB without the
tables fails in `seedReport` — acceptable only in the owner's post-migration verification,
so until then run the rest of the gates and let this spec be part of post-merge
verification (state this in the PR).

- [ ] **Step 3: Full local gate**

Run:
```bash
cd "/Volumes/DATA/GRAVITY REPO/medremind-app" && npx tsc --noEmit && npm run test:unit && npm run build
```
Expected: all pass. Also: `rg -n "console\.log" src/lib/nutrientBalance src/app/api/insights/nutrient-balance src/components/app/nutrientBalance` — expected: no hits.

- [ ] **Step 4: Push and open PR (do NOT merge, do NOT apply 026)**

```bash
git push -u origin codex/w2c-nutrient-balance
gh pr create --base main --title "feat: nutrient balance (B1 flagship) — food diary × supplement stack, migration 026" --body "Implements docs/superpowers/plans/2026-07-18-nutrient-balance.md (W2-C). Migration 026 (supplement_nutrient_facts + nutrient_balance_reports cache) is WRITTEN ONLY — owner applies it via the Management API before merge-deploy. Deterministic engine (deficits / covered / possible-excess) over 14-day food averages + stack facts; ULs are curated in-repo (limits.ts, 30 cited entries) and never LLM-sourced; one cached LLM extraction per unique supplement with validation_status=pending and unverified chips. Test evidence: test:unit (17 new across limits/engine/extractor), E2E spec included (requires 026 applied — runs in post-migration verification)."
```

STOP after opening the PR. The owner: applies 026, merges, then the E2E can run.

## Self-review checklist (author-verified)

- Every B1 spec requirement maps to a task: migration/schema incl. unique fact key +
  validation_status (T1), curated versioned cited ULs (T2), pure deterministic engine with
  the three buckets + boundaries (T3), one-cached-LLM-call extractor with schema validation
  (T4), server route + per-user/day cache row — cache decision recorded per B1 preference,
  cache table shares 026 (T1/T5/T6), card with expandable buckets, contribution breakdown,
  unverified chip, disclaimer, excess-requires-curated-UL (T3 by construction + T7), tests
  (T2/T3/T4/T8). Food-page badge deferred and recorded as a non-goal (ownership matrix
  places W2-C UI on Progress only).
- Real-code discoveries honored: `medication_map_items` columns and statuses verified
  against `supabase/009`; `callOpenRouterStructuredJson`'s `fetchImpl` seam
  (openRouter.ts:27) is the mock-provider mechanism; `createCorrelationServiceClient`
  reused instead of a new factory; `FrequencyType` union verified at
  `src/types/index.ts:15-17`; `extended_nutrients` jsonb name verified in
  `foodSync.ts:77`; relative-import constraint of the test:unit harness verified against
  `package.json` and the `daySchedule.ts` precedent.
- Type/signature consistency: `StackItemInput`/`NutrientFinding` flow unchanged from
  engine → service → route → card (card mirrors, never imports server code);
  `NUTRIENT_LIMITS_VERSION` is the single cache-invalidation token.
- No placeholders; all commands runnable from repo root with the quoted path.
