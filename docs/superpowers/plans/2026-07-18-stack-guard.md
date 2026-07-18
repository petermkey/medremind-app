# W3-A Stack Guard — Interaction & Timing Checks Across the Active Stack — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or
> superpowers:subagent-driven-development when orchestrated) to implement this plan
> task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Read
> `docs/superpowers/plans/2026-07-18-feature-wave-master.md` FIRST — its Global
> Constraints, migration ledger, file-ownership matrix, and owner decisions bind this plan.

**Goal:** deterministic, curated-rule checks across the user's ACTIVE supplement/medication
stack: (1) absorption competition between items taken in the same time slot (iron ↔
calcium/magnesium/zinc, etc.), (2) timing conflicts against `withFood` semantics
(empty-stomach items scheduled at typical meal slots), (3) same-nutrient duplication across
stack items. Findings are **suggestions only** — they NEVER modify schedules, occurrences,
or reminders.

**Architecture:** a versioned, in-repo curated rule set (`src/lib/stackGuard/rules.ts`,
every rule with a source citation — NIH ODS or peer-reviewed; NEVER LLM-generated at
runtime) + a pure deterministic engine (`src/lib/stackGuard/engine.ts`:
`evaluateStack(activeItems, facts, rules) → findings[]`). Computation is **on-demand**
in an auth-gated `GET /api/insights/stack-guard` route (owner decision #2 in the master
plan: **no migration 028, no persistence, no cache table** — the engine is O(items² ×
rules) over a stack of typically <20 items, sub-millisecond; caching cannot be justified).
The route reads active protocol items from Supabase and joins the
`supplement_nutrient_facts` cache (migration 026, **produced by W2-C** — merged before
this wave starts). When facts are missing or `validation_status='pending'`, the engine
**degrades gracefully to name-alias-based rules** and the UI flags unverified data. UI: a
findings card on the **Meds page** (`/app/meds`, "My Meds" tab) with severity chips and
expandable rows carrying the medKnowledge-style non-medical-advice disclaimer (Russian
copy included below, verbatim).

**Why the Meds page (not Progress):** the master file-ownership matrix already assigns
`src/app/app/progress/page.tsx` to W2-C (balance card) and W4-B (review section); Meds
(`src/app/app/meds/page.tsx`, 117 lines, no other wave touches it) is conflict-free AND
is the page that actually shows the active stack — the finding "iron and calcium compete"
sits next to the iron and calcium rows it talks about. Decision recorded here per the
master plan's instruction.

**Tech Stack:** Next.js 15 App Router, TypeScript strict, Supabase (`createServerClient`
session auth + service-role reads, the `medication-knowledge/refresh` precedent),
standalone `test:unit` harness (tsc-compiled `tests/unit/*.test.ts`, the `daySchedule.ts`
precedent), Playwright E2E (hardened harness, `workers: 1`, PR #63 rules).

## Spec

### Requirements

1. **Curated rules (P0).** `src/lib/stackGuard/rules.ts` exports
   `STACK_GUARD_RULESET_VERSION` and `STACK_GUARD_RULES` — 13 rules, each with `id`,
   `kind`, `severity ('info' | 'caution')`, Russian `title`/`explanation`/`suggestion`,
   and a `source` citation string (NIH ODS URL or journal reference). Four rule kinds:
   - `pair` — two alias groups; fires when the stack contains an item from each group
     (optionally only when scheduled in the same time slot, ±60 min);
   - `empty_stomach_meal_slot` — any `withFood='no'` item scheduled inside a typical meal
     slot (fixed v1 slots 07:30–09:30 / 12:30–14:30 / 18:30–20:30; W4-A personalizes
     reminder timing separately — out of scope here);
   - `alias_meal_slot` — a named item (levothyroxine) scheduled inside a meal slot
     regardless of its `withFood` flag;
   - `single_dose_limit` — a per-dose amount ceiling for one nutrient (calcium ≤500 mg,
     magnesium ≤350 mg), amount sourced from facts when available, else from
     `dose_amount`+`dose_unit='mg'`.
2. **Pure engine (P0).** `evaluateStack(activeItems, facts, rules)` returns a
   `StackGuardReport` with `findings[]` — each `{ruleId, severity, itemsInvolved[],
   title, explanation, suggestion, source}` — plus `itemCount`, `factsMatchedCount`,
   `pendingFactsUsed`, `rulesetVersion`. Deterministic (sorted caution-first, then
   `ruleId`), clock-free, zero I/O. Same-nutrient duplication is engine-generic (not a
   curated rule): any nutrient token present in ≥2 items (facts-derived tokens with
   name-alias fallback) yields an `info` finding `duplicate_nutrient:<token>`.
3. **On-demand route (P0).** `GET /api/insights/stack-guard`: session auth via
   `createClient()` → active protocols → medication protocol items → facts join →
   `evaluateStack` → JSON report. No new table (owner decision). A missing
   `supplement_nutrient_facts` table (026 not yet applied) degrades to `facts=[]`, never
   500s.
4. **Meds page card (P1).** `StackGuardCard` renders on the "My Meds" tab: severity chips
   («⚠️ N предупреждений» / «ℹ️ M заметок»), expandable rows (explanation + suggestion +
   source), «неподтверждённые данные» chip when `pendingFactsUsed`, and the disclaimer
   (exact Russian copy in Task 4). Suggestions only — no action buttons that mutate
   schedules exist anywhere in this feature.
5. **Tests.** Unit: engine on synthetic stacks — conflict / no-conflict / duplication /
   boundary times / pending-facts degradation (Task 2, registered in `test:unit`). One
   Playwright E2E with a seeded stack (Task 5).

### Acceptance criteria

- `npx tsc --noEmit && npm run build && npm run test:unit` all pass (correlation files
  untouched → `test:correlation` not required by the master gate, but must not regress).
- With an active protocol containing "Iron bisglycinate 25mg" (08:00, empty stomach) and
  "Calcium citrate 500mg" (08:00), `/api/insights/stack-guard` returns ≥2 findings
  including `iron_calcium_same_slot` (caution), and the Meds page card renders them.
- With an empty stack the route returns `findings: []` and the card renders nothing.
- With no `supplement_nutrient_facts` rows the same name-based findings still appear
  (graceful degradation) and `factsMatchedCount` is 0.

### Non-goals

- No migration 028 / no `stack_guard_findings` table (owner decision #2 — recorded).
- No LLM calls anywhere in this feature.
- No schedule/reminder mutation, no "fix it for me" buttons (v2 candidate, explicitly out).
- No personalization of meal slots from food data (that is W4-A's reminder-side concern).
- No push notifications for findings.

## Global Constraints

- Branch: `codex/w3a-stack-guard` off fresh `origin/main` (after Wave-2 merges — 026 is
  merged; run `bash scripts/git-state-check.sh` first). Never push to `main`; PR at the
  end, then STOP (no merge, owner merges — production deploys on merge).
- TypeScript strict; no new `any`; no `console.log` in committed code; conventional
  commits; `npx tsc --noEmit` after every `.ts/.tsx` change.
- `src/lib/stackGuard/*` uses **relative imports only** and no runtime dependencies, so
  the `test:unit` tsc harness (`--module Node16`, compiled to `.tmp/unit`) can build it
  standalone (the `daySchedule.ts` precedent).
- Findings are health-interpretive → the card MUST carry the disclaimer copy (master
  Safety constraint) and unverified facts MUST be flagged (`validation_status` machinery).
- **Consumed cross-feature interface (produced by W2-C, migration
  `supabase/026_supplement_nutrient_facts.sql`, per `docs/backlog-wellbeing-features.md`
  B1):** table `supplement_nutrient_facts(normalized_name text, dose_amount numeric,
  dose_unit text, nutrients jsonb /* {"epaMg":360,...} */, model text, validation_status
  text default 'pending', unique(normalized_name, dose_amount, dose_unit))`. This plan
  only READS it. Before Task 3, verify the merged 026 file matches; adapt column names
  there if W2-C drifted (record any drift in the PR body).

## File Structure

- Create: `src/lib/stackGuard/rules.ts` — versioned curated rule set + nutrient alias
  tables (13 rules, cited).
- Create: `src/lib/stackGuard/engine.ts` — pure engine.
- Create: `tests/unit/stackGuardRules.test.ts`, `tests/unit/stackGuardEngine.test.ts`.
- Modify: `package.json` — register both tests + both modules in `test:unit`.
- Create: `src/app/api/insights/stack-guard/route.ts` — auth-gated GET.
- Create: `src/components/app/StackGuardCard.tsx` — findings card.
- Modify: `src/app/app/meds/page.tsx` — mount the card on the "My Meds" tab.
- Create: `tests/e2e/stackGuard.spec.ts` — seeded-stack E2E.

---

### Task 1: Curated rule set — `rules.ts` (TDD)

**Files:**
- Create: `src/lib/stackGuard/rules.ts`
- Create: `tests/unit/stackGuardRules.test.ts`
- Modify: `package.json` (`test:unit` registration)

**Interfaces:**
- Produces (consumed by Task 2 engine and Task 3 route): `STACK_GUARD_RULESET_VERSION`,
  `StackGuardSeverity`, `StackGuardRule` (union of `PairRule | AliasMealSlotRule |
  EmptyStomachMealSlotRule | SingleDoseLimitRule`), `STACK_GUARD_RULES`,
  `NUTRIENT_ALIASES`, `NUTRIENT_LABELS_RU`.
- Zero imports (leaf module).

- [ ] **Step 1: Write the failing rules-integrity test**

```ts
// tests/unit/stackGuardRules.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  NUTRIENT_ALIASES,
  NUTRIENT_LABELS_RU,
  STACK_GUARD_RULES,
  STACK_GUARD_RULESET_VERSION,
} from '../../src/lib/stackGuard/rules';

test('ruleset version is a positive integer', () => {
  assert.equal(STACK_GUARD_RULESET_VERSION, 1);
});

test('there are 13 curated rules with unique ids', () => {
  assert.equal(STACK_GUARD_RULES.length, 13);
  const ids = new Set(STACK_GUARD_RULES.map(r => r.id));
  assert.equal(ids.size, 13);
});

test('every rule carries a real citation and non-empty Russian copy', () => {
  for (const rule of STACK_GUARD_RULES) {
    assert.ok(/https?:\/\/|\d{4};/.test(rule.source), `rule ${rule.id} needs a URL or journal citation`);
    assert.ok(rule.title.length > 0 && rule.explanation.length > 10 && rule.suggestion.length > 10,
      `rule ${rule.id} copy incomplete`);
    assert.ok(rule.severity === 'info' || rule.severity === 'caution');
  }
});

test('pair rules have non-overlapping non-empty alias groups', () => {
  for (const rule of STACK_GUARD_RULES) {
    if (rule.kind !== 'pair') continue;
    assert.ok(rule.groupA.length > 0 && rule.groupB.length > 0, rule.id);
    for (const alias of rule.groupA) assert.ok(!rule.groupB.includes(alias), `${rule.id}: alias '${alias}' in both groups`);
  }
});

test('every duplication token has a Russian label', () => {
  for (const token of Object.keys(NUTRIENT_ALIASES)) {
    assert.ok(NUTRIENT_LABELS_RU[token], `token ${token} lacks RU label`);
  }
});
```

- [ ] **Step 2: Register in `test:unit` and verify the test FAILS**

In `package.json`, edit the `test:unit` script string:
1. In the tsc file list, after `tests/unit/streak.test.ts` insert
   ` tests/unit/stackGuardRules.test.ts tests/unit/stackGuardEngine.test.ts` and after
   `src/lib/store/streak.ts` insert ` src/lib/stackGuard/rules.ts src/lib/stackGuard/engine.ts`.
2. In the run chain, after `&& node .tmp/unit/tests/unit/streak.test.js` insert
   ` && node .tmp/unit/tests/unit/stackGuardRules.test.js && node .tmp/unit/tests/unit/stackGuardEngine.test.js`.

(The engine module + its test are created in Task 2 — create empty placeholders now so
the freshly-registered tsc file list compiles:
`echo "export {};" > tests/unit/stackGuardEngine.test.ts && echo "export {};" > src/lib/stackGuard/engine.ts`.
Task 2 replaces both with the real content.)

Run: `npm run test:unit`
Expected: FAIL — tsc cannot resolve `../../src/lib/stackGuard/rules`.

- [ ] **Step 3: Write `rules.ts` (the actual initial rule set — 13 rules)**

```ts
// src/lib/stackGuard/rules.ts
// W3-A Stack Guard — CURATED interaction/timing rules. Versioned, in-repo,
// every rule cites NIH ODS or a peer-reviewed source. NEVER LLM-generated at
// runtime (master-plan Safety constraint). Leaf module: zero imports, relative
// consumers only, registered in test:unit (daySchedule.ts precedent).

export const STACK_GUARD_RULESET_VERSION = 1;

export type StackGuardSeverity = 'info' | 'caution';

type RuleBase = {
  id: string;
  severity: StackGuardSeverity;
  title: string;        // ru
  explanation: string;  // ru
  suggestion: string;   // ru — suggestion ONLY; Stack Guard never edits schedules
  source: string;       // citation (URL or journal reference)
};

export type PairRule = RuleBase & {
  kind: 'pair';
  groupA: string[];     // lowercase name-substring aliases (en + ru)
  groupB: string[];
  sameSlotOnly: boolean; // true → fires only when items share a ±60 min slot
};

export type AliasMealSlotRule = RuleBase & {
  kind: 'alias_meal_slot';
  aliases: string[];
};

export type EmptyStomachMealSlotRule = RuleBase & {
  kind: 'empty_stomach_meal_slot';
};

export type SingleDoseLimitRule = RuleBase & {
  kind: 'single_dose_limit';
  aliases: string[];
  nutrientToken: string; // key into NUTRIENT_ALIASES
  maxAmount: number;
  unit: 'mg';
};

export type StackGuardRule =
  | PairRule
  | AliasMealSlotRule
  | EmptyStomachMealSlotRule
  | SingleDoseLimitRule;

// Canonical nutrient tokens for facts-key mapping and name-based duplication
// fallback. Aliases are matched as substrings of the normalized (lowercased,
// punctuation-stripped) item name, and against facts jsonb keys with their
// trailing unit suffix removed (engine.ts).
export const NUTRIENT_ALIASES: Record<string, string[]> = {
  iron: ['iron', 'ferrous', 'ferric', 'железо', 'железа'],
  calcium: ['calcium', 'кальций', 'кальция'],
  magnesium: ['magnesium', 'магний', 'магния'],
  zinc: ['zinc', 'цинк', 'цинка'],
  copper: ['copper', 'медь', 'меди'],
  vitamin_d: ['vitamin d', 'vitamind', 'витамин d', 'витамин д', 'cholecalciferol', 'колекальциферол', 'холекальциферол', 'd3', 'д3'],
  omega3: ['omega', 'омега', 'fish oil', 'рыбий жир', 'epa', 'dha', 'эпк', 'дгк'],
  vitamin_c: ['vitamin c', 'vitaminc', 'витамин c', 'витамин с', 'ascorb', 'аскорбин'],
  b12: ['b12', 'б12', 'cobalamin', 'кобаламин'],
  folate: ['folate', 'folic', 'фолиев', 'фолат'],
  melatonin: ['melatonin', 'мелатонин'],
  potassium: ['potassium', 'калий', 'калия'],
};

export const NUTRIENT_LABELS_RU: Record<string, string> = {
  iron: 'железо',
  calcium: 'кальций',
  magnesium: 'магний',
  zinc: 'цинк',
  copper: 'медь',
  vitamin_d: 'витамин D',
  omega3: 'омега-3',
  vitamin_c: 'витамин C',
  b12: 'витамин B12',
  folate: 'фолат',
  melatonin: 'мелатонин',
  potassium: 'калий',
};

const IRON = NUTRIENT_ALIASES.iron;
const CALCIUM = NUTRIENT_ALIASES.calcium;
const MAGNESIUM = NUTRIENT_ALIASES.magnesium;
const ZINC = NUTRIENT_ALIASES.zinc;
const COPPER = NUTRIENT_ALIASES.copper;
const OMEGA3 = NUTRIENT_ALIASES.omega3;
const VITAMIN_C = NUTRIENT_ALIASES.vitamin_c;
const LEVOTHYROXINE = ['levothyroxine', 'synthroid', 'levoxyl', 'левотироксин', 'эутирокс', 'l-тироксин', 'тироксин'];

export const STACK_GUARD_RULES: readonly StackGuardRule[] = [
  {
    id: 'iron_calcium_same_slot',
    kind: 'pair',
    severity: 'caution',
    groupA: IRON,
    groupB: CALCIUM,
    sameSlotOnly: true,
    title: 'Железо и кальций в один приём',
    explanation: 'Кальций снижает всасывание железа при одновременном приёме — часть дозы железа усваивается впустую.',
    suggestion: 'Разнесите приёмы минимум на 2 часа (например, железо утром натощак, кальций вечером).',
    source: 'NIH ODS — Iron, Fact Sheet for Health Professionals: https://ods.od.nih.gov/factsheets/Iron-HealthProfessional/',
  },
  {
    id: 'iron_zinc_same_slot',
    kind: 'pair',
    severity: 'info',
    groupA: IRON,
    groupB: ZINC,
    sameSlotOnly: true,
    title: 'Железо и цинк в один приём',
    explanation: 'Железо и цинк конкурируют за всасывание, особенно натощак в виде растворов/добавок.',
    suggestion: 'По возможности принимайте железо и цинк в разные приёмы или с интервалом ≥2 часа.',
    source: 'NIH ODS — Zinc, Fact Sheet for Health Professionals: https://ods.od.nih.gov/factsheets/Zinc-HealthProfessional/',
  },
  {
    id: 'iron_magnesium_same_slot',
    kind: 'pair',
    severity: 'info',
    groupA: IRON,
    groupB: MAGNESIUM,
    sameSlotOnly: true,
    title: 'Железо и магний в один приём',
    explanation: 'Магнийсодержащие препараты (в т.ч. оксид магния) снижают всасывание железа при совместном приёме.',
    suggestion: 'Разнесите железо и магний по разным приёмам (≥2 часа).',
    source: 'Campbell NR, Hasinoff BB. Iron supplements: a common cause of drug interactions. Br J Clin Pharmacol. 1991;31(3):251-255.',
  },
  {
    id: 'calcium_zinc_same_slot',
    kind: 'pair',
    severity: 'info',
    groupA: CALCIUM,
    groupB: ZINC,
    sameSlotOnly: true,
    title: 'Кальций и цинк в один приём',
    explanation: 'Высокие дозы кальция могут умеренно снижать всасывание цинка при одновременном приёме.',
    suggestion: 'Если оба нужны ежедневно — принимайте в разные слоты дня.',
    source: 'NIH ODS — Zinc, Fact Sheet for Health Professionals: https://ods.od.nih.gov/factsheets/Zinc-HealthProfessional/',
  },
  {
    id: 'zinc_copper_balance',
    kind: 'pair',
    severity: 'caution',
    groupA: ZINC,
    groupB: COPPER,
    sameSlotOnly: false,
    title: 'Цинк подавляет усвоение меди',
    explanation: 'Длительный приём цинка (особенно ≥50 мг/день) снижает всасывание меди и может привести к её дефициту.',
    suggestion: 'Принимайте цинк и медь в разное время; при длительном приёме высоких доз цинка обсудите баланс меди с врачом.',
    source: 'NIH ODS — Zinc: https://ods.od.nih.gov/factsheets/Zinc-HealthProfessional/ и NIH ODS — Copper: https://ods.od.nih.gov/factsheets/Copper-HealthProfessional/',
  },
  {
    id: 'levothyroxine_mineral_spacing',
    kind: 'pair',
    severity: 'caution',
    groupA: LEVOTHYROXINE,
    groupB: [...IRON, ...CALCIUM, ...MAGNESIUM],
    sameSlotOnly: false,
    title: 'Левотироксин и минералы (железо/кальций/магний)',
    explanation: 'Железо, кальций и магний связывают левотироксин в ЖКТ и заметно снижают его всасывание — даже при приёме в пределах нескольких часов.',
    suggestion: 'Принимайте левотироксин минимум за 4 часа до/после железа, кальция и магния.',
    source: 'FDA label — SYNTHROID (levothyroxine sodium), Drug Interactions; NIH ODS — Calcium: https://ods.od.nih.gov/factsheets/Calcium-HealthProfessional/',
  },
  {
    id: 'sjw_serotonergic',
    kind: 'pair',
    severity: 'caution',
    groupA: ['st john', 'st. john', 'зверобо', 'hypericum'],
    groupB: ['sertraline', 'золофт', 'fluoxetine', 'прозак', 'флуоксетин', 'escitalopram', 'эсциталопрам', 'citalopram', 'циталопрам', 'paroxetine', 'пароксетин', 'fluvoxamine', 'флувоксамин', '5-htp', '5htp', 'триптофан', 'tryptophan'],
    sameSlotOnly: false,
    title: 'Зверобой и серотонинергические препараты',
    explanation: 'Зверобой в сочетании с СИОЗС/предшественниками серотонина повышает риск серотонинового синдрома и меняет метаболизм многих лекарств.',
    suggestion: 'Не сочетайте без явного одобрения врача; сообщите врачу обо всех растительных добавках.',
    source: 'NCCIH — St. John’s Wort and Depression: https://www.nccih.nih.gov/health/st-johns-wort-and-depression-in-depth',
  },
  {
    id: 'omega3_anticoagulants',
    kind: 'pair',
    severity: 'caution',
    groupA: OMEGA3,
    groupB: ['warfarin', 'варфарин', 'apixaban', 'апиксабан', 'rivaroxaban', 'ривароксабан', 'ксарелто', 'clopidogrel', 'клопидогрел', 'aspirin', 'аспирин', 'ацетилсалицил'],
    sameSlotOnly: false,
    title: 'Омега-3 и антикоагулянты/антиагреганты',
    explanation: 'Высокие дозы омега-3 могут усиливать эффект препаратов, снижающих свёртываемость крови.',
    suggestion: 'Сообщите врачу о приёме омега-3 вместе с антикоагулянтами; не меняйте дозы самостоятельно.',
    source: 'NIH ODS — Omega-3 Fatty Acids, Fact Sheet for Health Professionals: https://ods.od.nih.gov/factsheets/Omega3FattyAcids-HealthProfessional/',
  },
  {
    id: 'iron_vitamin_c_synergy',
    kind: 'pair',
    severity: 'info',
    groupA: IRON,
    groupB: VITAMIN_C,
    sameSlotOnly: true,
    title: 'Железо + витамин C — удачное сочетание',
    explanation: 'Витамин C улучшает всасывание негемового железа при одновременном приёме.',
    suggestion: 'Это сочетание в одном слоте — осознанно хорошее; менять ничего не нужно.',
    source: 'NIH ODS — Iron, Fact Sheet for Health Professionals: https://ods.od.nih.gov/factsheets/Iron-HealthProfessional/',
  },
  {
    id: 'empty_stomach_in_meal_slot',
    kind: 'empty_stomach_meal_slot',
    severity: 'caution',
    title: 'Приём «натощак» попадает на типичное время еды',
    explanation: 'Элемент помечен «натощак», но запланирован на типичный слот приёма пищи (завтрак/обед/ужин) — еда может снизить его усвоение.',
    suggestion: 'Сдвиньте время приёма на ≥30 минут до еды или ≥2 часа после (правка расписания — вручную, по вашему решению).',
    source: 'NIH ODS — Iron (absorption is highest on an empty stomach): https://ods.od.nih.gov/factsheets/Iron-HealthProfessional/',
  },
  {
    id: 'levothyroxine_meal_slot',
    kind: 'alias_meal_slot',
    severity: 'caution',
    aliases: LEVOTHYROXINE,
    title: 'Левотироксин в слот приёма пищи',
    explanation: 'Левотироксин рекомендуется принимать натощак, за 30–60 минут до завтрака — приём во время еды снижает всасывание.',
    suggestion: 'Перенесите приём на 30–60 минут до первого приёма пищи (вручную, по согласованию с врачом).',
    source: 'FDA label — SYNTHROID (levothyroxine sodium), Dosage and Administration; via DailyMed: https://dailymed.nlm.nih.gov/dailymed/search.cfm?query=synthroid',
  },
  {
    id: 'calcium_single_dose_limit',
    kind: 'single_dose_limit',
    severity: 'info',
    aliases: CALCIUM,
    nutrientToken: 'calcium',
    maxAmount: 500,
    unit: 'mg',
    title: 'Разовая доза кальция выше 500 мг',
    explanation: 'Всасывание кальция наиболее эффективно при разовых дозах ≤500 мг элементарного кальция; большие дозы усваиваются хуже.',
    suggestion: 'Разбейте дневную дозу на несколько приёмов по ≤500 мг.',
    source: 'NIH ODS — Calcium, Fact Sheet for Health Professionals: https://ods.od.nih.gov/factsheets/Calcium-HealthProfessional/',
  },
  {
    id: 'magnesium_single_dose_limit',
    kind: 'single_dose_limit',
    severity: 'info',
    aliases: MAGNESIUM,
    nutrientToken: 'magnesium',
    maxAmount: 350,
    unit: 'mg',
    title: 'Доза магния выше 350 мг',
    explanation: '350 мг/день — верхний допустимый уровень (UL) для магния из добавок; превышение часто даёт ЖКТ-эффекты (диарея).',
    suggestion: 'Проверьте суммарную дозу магния из добавок; при превышении UL обсудите с врачом.',
    source: 'NIH ODS — Magnesium, Fact Sheet for Health Professionals: https://ods.od.nih.gov/factsheets/Magnesium-HealthProfessional/',
  },
];
```

- [ ] **Step 4: Run tests to verify they PASS**

Run: `npm run test:unit`
Expected: `stackGuardRules.test.js` — 5 tests PASS (engine placeholder compiles empty);
all pre-existing suites still pass. Then: `npx tsc --noEmit` — clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/stackGuard/rules.ts tests/unit/stackGuardRules.test.ts tests/unit/stackGuardEngine.test.ts package.json
git commit -m "feat: stack-guard curated rule set v1 (13 cited interaction/timing rules)"
```

---

### Task 2: Pure engine — `engine.ts` (TDD)

**Files:**
- Create: `src/lib/stackGuard/engine.ts`
- Modify: `tests/unit/stackGuardEngine.test.ts` (replace placeholder)

**Interfaces:**
- Consumes: Task 1 types/consts via relative `./rules` import.
- Produces (consumed by Task 3 route and Task 4 card via the route's JSON):
  - `StackItemInput = { protocolItemId: string; name: string; times: string[]; withFood: 'yes' | 'no' | 'any' | string | null; doseAmount: number | null; doseUnit: string | null }`
  - `SupplementFactsInput = { normalizedName: string; doseAmount: number; doseUnit: string; nutrients: Record<string, unknown>; validationStatus: string }`
  - `StackGuardFinding = { ruleId: string; severity: StackGuardSeverity; itemsInvolved: { protocolItemId: string; name: string }[]; title: string; explanation: string; suggestion: string; source: string }`
  - `StackGuardReport = { findings: StackGuardFinding[]; itemCount: number; factsMatchedCount: number; pendingFactsUsed: boolean; rulesetVersion: number }`
  - `evaluateStack(items, facts, rules): StackGuardReport`, plus exported helpers
    `matchFactsToItems`, `nutrientTokensForItem`, `TYPICAL_MEAL_SLOTS`.

- [ ] **Step 1: Write the failing engine tests (replace the placeholder file)**

```ts
// tests/unit/stackGuardEngine.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  evaluateStack,
  matchFactsToItems,
  nutrientTokensForItem,
  type StackItemInput,
  type SupplementFactsInput,
} from '../../src/lib/stackGuard/engine';
import { STACK_GUARD_RULES } from '../../src/lib/stackGuard/rules';

function item(partial: Partial<StackItemInput> & { protocolItemId: string; name: string }): StackItemInput {
  return { times: ['08:00'], withFood: 'any', doseAmount: null, doseUnit: null, ...partial };
}

const IRON = item({ protocolItemId: 'i1', name: 'Iron bisglycinate 25mg', times: ['08:00'], withFood: 'no', doseAmount: 25, doseUnit: 'mg' });
const CALCIUM_SAME = item({ protocolItemId: 'c1', name: 'Calcium citrate', times: ['08:30'], doseAmount: 600, doseUnit: 'mg' });
const CALCIUM_EVENING = item({ protocolItemId: 'c2', name: 'Calcium citrate', times: ['21:00'], doseAmount: 400, doseUnit: 'mg' });

test('iron + calcium in the same ±60min slot → caution finding', () => {
  const report = evaluateStack([IRON, CALCIUM_SAME], [], STACK_GUARD_RULES);
  const finding = report.findings.find(f => f.ruleId === 'iron_calcium_same_slot');
  assert.ok(finding, 'expected iron_calcium_same_slot');
  assert.equal(finding.severity, 'caution');
  assert.deepEqual(finding.itemsInvolved.map(i => i.protocolItemId).sort(), ['c1', 'i1']);
});

test('iron + calcium in different slots → same-slot rule does NOT fire', () => {
  const report = evaluateStack([{ ...IRON, times: ['06:30'], withFood: 'any' }, CALCIUM_EVENING], [], STACK_GUARD_RULES);
  assert.equal(report.findings.some(f => f.ruleId === 'iron_calcium_same_slot'), false);
});

test('slot boundary: exactly 60 minutes apart still counts as the same slot', () => {
  const report = evaluateStack(
    [{ ...IRON, times: ['07:00'], withFood: 'any' }, { ...CALCIUM_EVENING, times: ['08:00'] }],
    [], STACK_GUARD_RULES,
  );
  assert.equal(report.findings.some(f => f.ruleId === 'iron_calcium_same_slot'), true);
});

test('any-time pair (levothyroxine + iron) fires even in different slots', () => {
  const levo = item({ protocolItemId: 'l1', name: 'Левотироксин 50мкг', times: ['06:30'] });
  const report = evaluateStack([levo, { ...IRON, times: ['20:00'], withFood: 'any' }], [], STACK_GUARD_RULES);
  assert.equal(report.findings.some(f => f.ruleId === 'levothyroxine_mineral_spacing'), true);
});

test('empty-stomach item at a typical meal slot → caution; outside slots → nothing', () => {
  const inSlot = evaluateStack([IRON], [], STACK_GUARD_RULES); // 08:00 is inside 07:30–09:30
  assert.equal(inSlot.findings.some(f => f.ruleId === 'empty_stomach_in_meal_slot'), true);
  const outSlot = evaluateStack([{ ...IRON, times: ['06:00'] }], [], STACK_GUARD_RULES);
  assert.equal(outSlot.findings.some(f => f.ruleId === 'empty_stomach_in_meal_slot'), false);
});

test('meal-slot boundary 09:30 is inclusive', () => {
  const report = evaluateStack([{ ...IRON, times: ['09:30'] }], [], STACK_GUARD_RULES);
  assert.equal(report.findings.some(f => f.ruleId === 'empty_stomach_in_meal_slot'), true);
});

test('single-dose limit: calcium 600mg fires, 400mg does not', () => {
  const over = evaluateStack([CALCIUM_SAME], [], STACK_GUARD_RULES);
  assert.equal(over.findings.some(f => f.ruleId === 'calcium_single_dose_limit'), true);
  const under = evaluateStack([CALCIUM_EVENING], [], STACK_GUARD_RULES);
  assert.equal(under.findings.some(f => f.ruleId === 'calcium_single_dose_limit'), false);
});

test('facts-based duplication: two items sharing magnesiumMg → duplicate_nutrient:magnesium', () => {
  const a = item({ protocolItemId: 'a1', name: 'ZMA Complex', times: ['22:00'] });
  const b = item({ protocolItemId: 'b1', name: 'Sleep Formula', times: ['22:00'] });
  const facts: SupplementFactsInput[] = [
    { normalizedName: 'zma complex', doseAmount: 3, doseUnit: 'capsule', nutrients: { magnesiumMg: 450, zincMg: 30 }, validationStatus: 'accepted' },
    { normalizedName: 'sleep formula', doseAmount: 1, doseUnit: 'capsule', nutrients: { magnesiumMg: 200, melatoninMg: 1 }, validationStatus: 'accepted' },
  ];
  const report = evaluateStack([a, b], facts, STACK_GUARD_RULES);
  const dup = report.findings.find(f => f.ruleId === 'duplicate_nutrient:magnesium');
  assert.ok(dup);
  assert.equal(dup.severity, 'info');
  assert.equal(report.factsMatchedCount, 2);
  assert.equal(report.pendingFactsUsed, false);
});

test('degradation: with NO facts, name-based duplication still works', () => {
  const a = item({ protocolItemId: 'a1', name: 'Magnesium glycinate 200mg', times: ['22:00'] });
  const b = item({ protocolItemId: 'b1', name: 'Магний цитрат', times: ['09:00'] });
  const report = evaluateStack([a, b], [], STACK_GUARD_RULES);
  assert.ok(report.findings.find(f => f.ruleId === 'duplicate_nutrient:magnesium'));
  assert.equal(report.factsMatchedCount, 0);
});

test('pending facts are used but flagged', () => {
  const a = item({ protocolItemId: 'a1', name: 'Complex One', times: ['09:00'] });
  const b = item({ protocolItemId: 'b1', name: 'Complex Two', times: ['09:00'] });
  const facts: SupplementFactsInput[] = [
    { normalizedName: 'complex one', doseAmount: 1, doseUnit: 'tablet', nutrients: { ironMg: 10 }, validationStatus: 'pending' },
    { normalizedName: 'complex two', doseAmount: 1, doseUnit: 'tablet', nutrients: { ironMg: 14 }, validationStatus: 'pending' },
  ];
  const report = evaluateStack([a, b], facts, STACK_GUARD_RULES);
  assert.ok(report.findings.find(f => f.ruleId === 'duplicate_nutrient:iron'));
  assert.equal(report.pendingFactsUsed, true);
});

test('deterministic ordering: caution findings come before info', () => {
  const report = evaluateStack([IRON, CALCIUM_SAME], [], STACK_GUARD_RULES);
  const severities = report.findings.map(f => f.severity);
  const firstInfo = severities.indexOf('info');
  const lastCaution = severities.lastIndexOf('caution');
  assert.ok(firstInfo === -1 || lastCaution < firstInfo);
});

test('empty stack → empty report', () => {
  const report = evaluateStack([], [], STACK_GUARD_RULES);
  assert.deepEqual(report.findings, []);
  assert.equal(report.itemCount, 0);
});

test('matchFactsToItems matches by normalized-name containment either way', () => {
  const facts: SupplementFactsInput[] = [
    { normalizedName: 'iron bisglycinate', doseAmount: 25, doseUnit: 'mg', nutrients: { ironMg: 25 }, validationStatus: 'accepted' },
  ];
  const map = matchFactsToItems([IRON], facts);
  assert.equal(map.get('i1')?.normalizedName, 'iron bisglycinate');
});

test('nutrientTokensForItem maps facts keys (epaMg → omega3) and name aliases', () => {
  const fishOil = item({ protocolItemId: 'f1', name: 'Fish Oil Ultra', times: ['13:00'] });
  const fact: SupplementFactsInput = { normalizedName: 'fish oil ultra', doseAmount: 2, doseUnit: 'softgel', nutrients: { epaMg: 360, dhaMg: 240 }, validationStatus: 'accepted' };
  const tokens = nutrientTokensForItem(fishOil, fact);
  assert.ok(tokens.includes('omega3'));
});
```

- [ ] **Step 2: Run to verify FAIL**

Run: `npm run test:unit`
Expected: FAIL — `../../src/lib/stackGuard/engine` unresolved.

- [ ] **Step 3: Write the engine**

```ts
// src/lib/stackGuard/engine.ts
// W3-A Stack Guard — pure, deterministic evaluation of the active stack
// against the curated rule set. Clock-free, zero I/O, relative imports only
// (test:unit harness constraint — daySchedule.ts precedent). Findings are
// SUGGESTIONS: nothing in this module (or its consumers) mutates schedules.
import {
  NUTRIENT_ALIASES,
  NUTRIENT_LABELS_RU,
  STACK_GUARD_RULESET_VERSION,
  type PairRule,
  type SingleDoseLimitRule,
  type StackGuardRule,
  type StackGuardSeverity,
} from './rules';

export type StackItemInput = {
  protocolItemId: string;
  name: string;
  times: string[]; // 'HH:MM'
  withFood: 'yes' | 'no' | 'any' | string | null;
  doseAmount: number | null;
  doseUnit: string | null;
};

export type SupplementFactsInput = {
  normalizedName: string;
  doseAmount: number;
  doseUnit: string;
  nutrients: Record<string, unknown>; // supplement_nutrient_facts.nutrients (026, W2-C)
  validationStatus: string;           // 'pending' until reviewed (B1 status machinery)
};

export type StackGuardFinding = {
  ruleId: string;
  severity: StackGuardSeverity;
  itemsInvolved: { protocolItemId: string; name: string }[];
  title: string;
  explanation: string;
  suggestion: string;
  source: string;
};

export type StackGuardReport = {
  findings: StackGuardFinding[];
  itemCount: number;
  factsMatchedCount: number;
  pendingFactsUsed: boolean;
  rulesetVersion: number;
};

const SAME_SLOT_TOLERANCE_MINUTES = 60;

// Fixed v1 meal slots (breakfast/lunch/dinner). Personalizing from real food
// data is W4-A's reminder-side concern — Stack Guard stays deterministic.
export const TYPICAL_MEAL_SLOTS: ReadonlyArray<{ startMinutes: number; endMinutes: number }> = [
  { startMinutes: 7 * 60 + 30, endMinutes: 9 * 60 + 30 },
  { startMinutes: 12 * 60 + 30, endMinutes: 14 * 60 + 30 },
  { startMinutes: 18 * 60 + 30, endMinutes: 20 * 60 + 30 },
];

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-zа-яё0-9]+/giu, ' ').trim();
}

function matchesAliases(name: string, aliases: string[]): boolean {
  const normalized = normalizeName(name);
  return aliases.some((alias) => normalized.includes(alias));
}

function timeToMinutes(time: string): number | null {
  const match = /^(\d{1,2}):(\d{2})/.exec(time.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function shareSlot(a: StackItemInput, b: StackItemInput): boolean {
  for (const ta of a.times) {
    const ma = timeToMinutes(ta);
    if (ma === null) continue;
    for (const tb of b.times) {
      const mb = timeToMinutes(tb);
      if (mb === null) continue;
      if (Math.abs(ma - mb) <= SAME_SLOT_TOLERANCE_MINUTES) return true;
    }
  }
  return false;
}

function inMealSlot(minutes: number): boolean {
  return TYPICAL_MEAL_SLOTS.some((slot) => minutes >= slot.startMinutes && minutes <= slot.endMinutes);
}

function anyTimeInMealSlot(item: StackItemInput): boolean {
  return item.times.some((time) => {
    const minutes = timeToMinutes(time);
    return minutes !== null && inMealSlot(minutes);
  });
}

function nutrientTokenFromKey(key: string): string | null {
  const base = key.toLowerCase().replace(/(mcg|mg|iu|g)$/u, '');
  if (base.length === 0) return null;
  for (const [token, aliases] of Object.entries(NUTRIENT_ALIASES)) {
    if (token === base) return token;
    if (aliases.some((alias) => base === alias || (alias.length > 2 && base.includes(alias)))) return token;
  }
  return base;
}

export function matchFactsToItems(
  items: StackItemInput[],
  facts: SupplementFactsInput[],
): Map<string, SupplementFactsInput | null> {
  const map = new Map<string, SupplementFactsInput | null>();
  for (const item of items) {
    const itemName = normalizeName(item.name);
    const fact = facts.find((candidate) => {
      const factName = normalizeName(candidate.normalizedName);
      return factName.length > 0 && (itemName.includes(factName) || factName.includes(itemName));
    });
    map.set(item.protocolItemId, fact ?? null);
  }
  return map;
}

export function nutrientTokensForItem(item: StackItemInput, fact: SupplementFactsInput | null): string[] {
  const tokens = new Set<string>();
  if (fact) {
    for (const [key, value] of Object.entries(fact.nutrients)) {
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        const token = nutrientTokenFromKey(key);
        if (token) tokens.add(token);
      }
    }
  }
  const normalized = normalizeName(item.name);
  for (const [token, aliases] of Object.entries(NUTRIENT_ALIASES)) {
    if (aliases.some((alias) => normalized.includes(alias))) tokens.add(token);
  }
  return [...tokens].sort();
}

function amountForToken(item: StackItemInput, fact: SupplementFactsInput | null, rule: SingleDoseLimitRule): number | null {
  if (fact) {
    for (const [key, value] of Object.entries(fact.nutrients)) {
      if (
        typeof value === 'number' && Number.isFinite(value) && value > 0 &&
        key.toLowerCase().endsWith(rule.unit) && nutrientTokenFromKey(key) === rule.nutrientToken
      ) {
        return value;
      }
    }
  }
  if (item.doseAmount !== null && (item.doseUnit ?? '').toLowerCase() === rule.unit) return item.doseAmount;
  return null;
}

function toFinding(rule: StackGuardRule, items: StackItemInput[]): StackGuardFinding {
  const sorted = [...items].sort((a, b) => a.protocolItemId.localeCompare(b.protocolItemId));
  return {
    ruleId: rule.id,
    severity: rule.severity,
    itemsInvolved: sorted.map((item) => ({ protocolItemId: item.protocolItemId, name: item.name })),
    title: rule.title,
    explanation: rule.explanation,
    suggestion: rule.suggestion,
    source: rule.source,
  };
}

function evaluatePairRule(rule: PairRule, items: StackItemInput[]): StackGuardFinding | null {
  const itemsA = items.filter((item) => matchesAliases(item.name, rule.groupA));
  const itemsB = items.filter((item) => matchesAliases(item.name, rule.groupB));
  const involved = new Map<string, StackItemInput>();
  for (const a of itemsA) {
    for (const b of itemsB) {
      if (a.protocolItemId === b.protocolItemId) continue; // one combo product is not a pair conflict
      if (rule.sameSlotOnly && !shareSlot(a, b)) continue;
      involved.set(a.protocolItemId, a);
      involved.set(b.protocolItemId, b);
    }
  }
  return involved.size >= 2 ? toFinding(rule, [...involved.values()]) : null;
}

export function evaluateStack(
  items: StackItemInput[],
  facts: SupplementFactsInput[],
  rules: readonly StackGuardRule[],
): StackGuardReport {
  const factsByItem = matchFactsToItems(items, facts);
  const findings: StackGuardFinding[] = [];

  for (const rule of rules) {
    if (rule.kind === 'pair') {
      const finding = evaluatePairRule(rule, items);
      if (finding) findings.push(finding);
    } else if (rule.kind === 'empty_stomach_meal_slot') {
      const hits = items.filter((item) => item.withFood === 'no' && anyTimeInMealSlot(item));
      if (hits.length > 0) findings.push(toFinding(rule, hits));
    } else if (rule.kind === 'alias_meal_slot') {
      const hits = items.filter((item) => matchesAliases(item.name, rule.aliases) && anyTimeInMealSlot(item));
      if (hits.length > 0) findings.push(toFinding(rule, hits));
    } else {
      const hits = items.filter((item) => {
        if (!matchesAliases(item.name, rule.aliases)) return false;
        const amount = amountForToken(item, factsByItem.get(item.protocolItemId) ?? null, rule);
        return amount !== null && amount > rule.maxAmount;
      });
      if (hits.length > 0) findings.push(toFinding(rule, hits));
    }
  }

  // Same-nutrient duplication across ≥2 items — facts-derived tokens with
  // name-alias fallback, so this degrades gracefully while facts are pending.
  const itemsByToken = new Map<string, StackItemInput[]>();
  for (const item of items) {
    for (const token of nutrientTokensForItem(item, factsByItem.get(item.protocolItemId) ?? null)) {
      itemsByToken.set(token, [...(itemsByToken.get(token) ?? []), item]);
    }
  }
  for (const [token, dupItems] of [...itemsByToken.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (dupItems.length < 2) continue;
    const label = NUTRIENT_LABELS_RU[token] ?? token;
    findings.push({
      ruleId: `duplicate_nutrient:${token}`,
      severity: 'info',
      itemsInvolved: dupItems
        .map((item) => ({ protocolItemId: item.protocolItemId, name: item.name }))
        .sort((a, b) => a.protocolItemId.localeCompare(b.protocolItemId)),
      title: `Дублирование нутриента: ${label}`,
      explanation: `«${label}» встречается сразу в нескольких позициях стека — суммарная дневная доза может оказаться выше, чем вы планировали.`,
      suggestion: 'Проверьте составы позиций и суммарную дневную дозу; при необходимости обсудите с врачом, нужен ли дубль.',
      source: 'NIH Office of Dietary Supplements — fact sheets: https://ods.od.nih.gov/factsheets/',
    });
  }

  const matchedFacts = [...factsByItem.values()].filter((fact): fact is SupplementFactsInput => fact !== null);
  findings.sort((a, b) =>
    a.severity === b.severity ? a.ruleId.localeCompare(b.ruleId) : a.severity === 'caution' ? -1 : 1,
  );

  return {
    findings,
    itemCount: items.length,
    factsMatchedCount: matchedFacts.length,
    pendingFactsUsed: matchedFacts.some((fact) => fact.validationStatus !== 'accepted'),
    rulesetVersion: STACK_GUARD_RULESET_VERSION,
  };
}
```

- [ ] **Step 4: Run to verify PASS**

Run: `npm run test:unit && npx tsc --noEmit`
Expected: 14 new engine tests + 5 rules tests PASS; tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/stackGuard/engine.ts tests/unit/stackGuardEngine.test.ts
git commit -m "feat: stack-guard pure engine (pair/meal-slot/dose-limit rules + nutrient duplication)"
```

---

### Task 3: On-demand route — `GET /api/insights/stack-guard`

**Files:**
- Create: `src/app/api/insights/stack-guard/route.ts`

**Interfaces:**
- Consumes: engine + rules (Tasks 1–2); Supabase tables `active_protocols`,
  `protocol_items` (existing, RLS-owned), and `supplement_nutrient_facts`
  (**produced by W2-C, migration 026** — global cache, read via service role; degrade to
  `[]` on any read error, incl. table-missing `42P01`).
- Produces: JSON `StackGuardReport` (engine shape) — consumed by Task 4 card.
- Auth pattern: session `createClient()` for the user check + service client for reads —
  the `src/app/api/medication-knowledge/refresh/route.ts` precedent.

- [ ] **Step 1: Write the route**

```ts
// src/app/api/insights/stack-guard/route.ts
// W3-A Stack Guard — on-demand evaluation (owner decision: no persistence, no
// migration 028). Auth-gated GET; computes from active protocols + cached
// supplement_nutrient_facts (026, W2-C); degrades to name-based rules when
// facts are missing or the table is not applied yet.
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

import { evaluateStack, type StackItemInput, type SupplementFactsInput } from '@/lib/stackGuard/engine';
import { STACK_GUARD_RULES } from '@/lib/stackGuard/rules';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

type Row = Record<string, unknown>;

function serviceClient() {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Supabase service role environment is required.');
  }
  return createServiceClient(supabaseUrl, serviceRoleKey);
}

function toStackItem(row: Row): StackItemInput {
  return {
    protocolItemId: String(row.id),
    name: typeof row.name === 'string' ? row.name : '',
    times: Array.isArray(row.times) ? row.times.map(String) : [],
    withFood: typeof row.with_food === 'string' ? row.with_food : null,
    doseAmount: typeof row.dose_amount === 'number' ? row.dose_amount : null,
    doseUnit: typeof row.dose_unit === 'string' ? row.dose_unit : null,
  };
}

function toFacts(row: Row): SupplementFactsInput | null {
  if (typeof row.normalized_name !== 'string') return null;
  return {
    normalizedName: row.normalized_name,
    doseAmount: typeof row.dose_amount === 'number' ? row.dose_amount : 0,
    doseUnit: typeof row.dose_unit === 'string' ? row.dose_unit : '',
    nutrients: (row.nutrients && typeof row.nutrients === 'object' ? row.nutrients : {}) as Record<string, unknown>,
    validationStatus: typeof row.validation_status === 'string' ? row.validation_status : 'pending',
  };
}

export async function GET() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const service = serviceClient();
  const userId = data.user.id;

  const activeResult = await service
    .from('active_protocols')
    .select('id, protocol_id')
    .eq('user_id', userId)
    .eq('status', 'active');
  if (activeResult.error) {
    return NextResponse.json({ error: 'Failed to load active protocols.' }, { status: 500 });
  }

  const protocolIds = [...new Set((activeResult.data ?? []).map((row) => row.protocol_id))];
  if (protocolIds.length === 0) {
    return NextResponse.json(evaluateStack([], [], STACK_GUARD_RULES));
  }

  const itemsResult = await service
    .from('protocol_items')
    .select('id, protocol_id, item_type, name, times, with_food, dose_amount, dose_unit')
    .in('protocol_id', protocolIds);
  if (itemsResult.error) {
    return NextResponse.json({ error: 'Failed to load protocol items.' }, { status: 500 });
  }

  const stackItems = ((itemsResult.data as Row[] | null) ?? [])
    .filter((row) => row.item_type === 'medication')
    .map(toStackItem);

  // supplement_nutrient_facts is W2-C's global cache (026). Any read failure
  // (incl. table not yet applied) degrades to name-based rules — never a 500.
  const factsResult = await service
    .from('supplement_nutrient_facts')
    .select('normalized_name, dose_amount, dose_unit, nutrients, validation_status')
    .limit(500);
  const facts = factsResult.error
    ? []
    : ((factsResult.data as Row[] | null) ?? []).map(toFacts).filter((fact): fact is SupplementFactsInput => fact !== null);

  return NextResponse.json(evaluateStack(stackItems, facts, STACK_GUARD_RULES));
}
```

- [ ] **Step 2: Type-check and build**

Run: `npx tsc --noEmit && npm run build`
Expected: clean; build lists `/api/insights/stack-guard` as a dynamic route.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/insights/stack-guard/route.ts
git commit -m "feat: on-demand auth-gated stack-guard insights route"
```

---

### Task 4: Meds page card — `StackGuardCard`

**Files:**
- Create: `src/components/app/StackGuardCard.tsx`
- Modify: `src/app/app/meds/page.tsx`

**Interfaces:**
- Consumes: `GET /api/insights/stack-guard` JSON (Task 3).
- Produces: `<StackGuardCard />` client component, mounted on the "My Meds" tab.

- [ ] **Step 1: Write the card component**

```tsx
// src/components/app/StackGuardCard.tsx
'use client';
import { useEffect, useState } from 'react';

type Finding = {
  ruleId: string;
  severity: 'info' | 'caution';
  itemsInvolved: { protocolItemId: string; name: string }[];
  title: string;
  explanation: string;
  suggestion: string;
  source: string;
};

type Report = {
  findings: Finding[];
  itemCount: number;
  factsMatchedCount: number;
  pendingFactsUsed: boolean;
  rulesetVersion: number;
};

// Non-medical-advice disclaimer — mandatory on every health-interpretive
// surface (master-plan Safety constraint, medKnowledge wording family).
const DISCLAIMER =
  'Это не медицинская рекомендация. Stack Guard сравнивает ваш стек со справочными правилами (NIH ODS и др.) и только подсказывает — расписание он никогда не меняет. Перед изменением схемы приёма проконсультируйтесь с врачом.';

export function StackGuardCard() {
  const [report, setReport] = useState<Report | null>(null);
  const [failed, setFailed] = useState(false);
  const [openRuleId, setOpenRuleId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/insights/stack-guard')
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((json: Report) => { if (!cancelled) setReport(json); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, []);

  if (failed || !report || report.findings.length === 0) return null;

  const cautions = report.findings.filter((finding) => finding.severity === 'caution').length;
  const infos = report.findings.length - cautions;

  return (
    <div data-testid="stack-guard-card" className="bg-[#161B22] border border-[rgba(255,255,255,0.08)] rounded-2xl p-4 mb-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="text-sm font-bold text-[#F0F6FC]">🛡️ Stack Guard</div>
        <div className="flex gap-1.5">
          {cautions > 0 && (
            <span className="text-[10px] font-semibold px-2 py-1 rounded-full bg-[rgba(251,191,36,0.12)] text-[#FBB924]">
              ⚠️ {cautions}
            </span>
          )}
          {infos > 0 && (
            <span className="text-[10px] font-semibold px-2 py-1 rounded-full bg-[rgba(59,130,246,0.12)] text-[#3B82F6]">
              ℹ️ {infos}
            </span>
          )}
        </div>
      </div>

      {report.pendingFactsUsed && (
        <div className="text-[10px] font-semibold text-[#FBB924] mb-2">
          Часть данных о составах ещё не подтверждена — выводы могут уточниться.
        </div>
      )}

      {report.findings.map((finding) => {
        const open = openRuleId === finding.ruleId;
        return (
          <div key={finding.ruleId} className="border-t border-[rgba(255,255,255,0.05)] py-2.5">
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setOpenRuleId(open ? null : finding.ruleId)}
              className="w-full flex items-center gap-2 text-left"
            >
              <span className="text-sm">{finding.severity === 'caution' ? '⚠️' : 'ℹ️'}</span>
              <span className="flex-1 text-xs font-semibold text-[#F0F6FC]">{finding.title}</span>
              <span className="text-[#8B949E] text-xs">{open ? '▴' : '▾'}</span>
            </button>
            {open && (
              <div className="mt-2 pl-6 flex flex-col gap-1.5">
                <div className="text-xs text-[#8B949E] leading-relaxed">{finding.explanation}</div>
                <div className="text-xs text-[#F0F6FC] leading-relaxed">💡 {finding.suggestion}</div>
                <div className="text-[10px] text-[#8B949E]">
                  Затронуто: {finding.itemsInvolved.map((item) => item.name).join(' · ')}
                </div>
                <div className="text-[10px] text-[#8B949E] break-words">Источник: {finding.source}</div>
              </div>
            )}
          </div>
        );
      })}

      <p className="mt-3 text-[10px] text-[#8B949E] leading-relaxed border-t border-[rgba(255,255,255,0.05)] pt-2.5">
        {DISCLAIMER}
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Mount on the Meds page**

In `src/app/app/meds/page.tsx`, add the import after the existing imports:

```ts
import { StackGuardCard } from '@/components/app/StackGuardCard';
```

and inside the `{tab === 'mine' && (` fragment, insert `<StackGuardCard />` as the FIRST
child — i.e. replace:

```tsx
        {tab === 'mine' && (
          <>
            {myMeds.length === 0 ? (
```

with:

```tsx
        {tab === 'mine' && (
          <>
            <StackGuardCard />
            {myMeds.length === 0 ? (
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm run build`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/components/app/StackGuardCard.tsx src/app/app/meds/page.tsx
git commit -m "feat: stack-guard findings card on the Meds page (chips, expandable rows, disclaimer)"
```

---

### Task 5: Playwright E2E — seeded stack

**Files:**
- Create: `tests/e2e/stackGuard.spec.ts`

**Interfaces:**
- Uses the hardened-harness patterns from `tests/e2e/doseStatusPersistence.spec.ts`:
  `ensureAuthenticated`, `waitForSyncFlushed`, `window.__medremindStore` seeding,
  `afterEach` cleanup of `/^StackGuardTest /` protocols (shared-account rules, PR #63).

- [ ] **Step 1: Write the spec**

```ts
// tests/e2e/stackGuard.spec.ts
import { expect, test, type Page } from '@playwright/test';

const e2eEmail = process.env.E2E_EMAIL;
const e2ePassword = process.env.E2E_PASSWORD;
const hasAuthCreds = Boolean(e2eEmail && e2ePassword);

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(e2eEmail!);
  await page.getByLabel('Password').fill(e2ePassword!);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/(app|onboarding)(\/|$)/, { timeout: 30_000 });
}

async function waitForSyncFlushed(page: Page) {
  await page.waitForFunction(() => {
    const raw = localStorage.getItem('medremind-sync-outbox-v1');
    if (!raw) return true;
    try {
      const queue = JSON.parse(raw) as Array<{ dead?: boolean }>;
      return Array.isArray(queue) && queue.filter(item => !item.dead).length === 0;
    } catch {
      return true;
    }
  }, { timeout: 20_000 });
}

async function cleanupTestProtocols(page: Page) {
  try {
    await page.evaluate(() => {
      const store = (window as unknown as {
        __medremindStore?: {
          getState(): {
            protocols: { id: string; name: string; isTemplate?: boolean }[];
            deleteProtocol(id: string): unknown;
          };
        };
      }).__medremindStore;
      if (!store) return;
      const state = store.getState();
      state.protocols
        .filter(p => !p.isTemplate && /^StackGuardTest /.test(p.name))
        .forEach(p => { try { state.deleteProtocol(p.id); } catch { /* keep going */ } });
    });
    await page.waitForTimeout(1_500);
  } catch {
    // Teardown must never fail a passing test.
  }
}

test.describe('stack guard (requires E2E_EMAIL and E2E_PASSWORD)', () => {
  test.skip(!hasAuthCreds, 'Set E2E_EMAIL and E2E_PASSWORD to run stack-guard E2E.');
  test.describe.configure({ mode: 'serial' });

  test.afterEach(async ({ page }) => {
    await cleanupTestProtocols(page);
  });

  test('seeded iron+calcium stack renders caution findings on the Meds page', async ({ page }) => {
    await login(page);

    // Seed via the store (E2ETestHelpers exposes it) — two conflicting items
    // in one 08:00 slot: iron (empty stomach, inside breakfast slot) + calcium.
    await page.evaluate(() => {
      const store = (window as unknown as {
        __medremindStore: {
          getState(): {
            createCustomProtocol(p: Record<string, unknown>): { id: string };
            addProtocolItem(protocolId: string, item: Record<string, unknown>): void;
            activateProtocol(protocolId: string, startDate: string): unknown;
          };
        };
      }).__medremindStore;
      const state = store.getState();
      const protocol = state.createCustomProtocol({
        name: `StackGuardTest ${Date.now()}`,
        description: 'e2e seed',
        category: 'custom',
        durationDays: 3,
        isArchived: false,
        items: [],
      });
      state.addProtocolItem(protocol.id, {
        itemType: 'medication', name: 'Iron bisglycinate 25mg', doseAmount: 25, doseUnit: 'mg',
        frequencyType: 'daily', times: ['08:00'], withFood: 'no', startDay: 1, sortOrder: 0,
      });
      state.addProtocolItem(protocol.id, {
        itemType: 'medication', name: 'Calcium citrate 600mg', doseAmount: 600, doseUnit: 'mg',
        frequencyType: 'daily', times: ['08:00'], withFood: 'any', startDay: 1, sortOrder: 1,
      });
      state.activateProtocol(protocol.id, new Date().toLocaleDateString('en-CA'));
    });

    // The route reads from Supabase — the seed must land in the cloud first.
    await waitForSyncFlushed(page);

    await page.goto('/app/meds');
    const card = page.getByTestId('stack-guard-card');
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card.getByText('Железо и кальций в один приём')).toBeVisible();

    // Expand the finding → explanation + disclaimer visible; no mutation controls.
    await card.getByText('Железо и кальций в один приём').click();
    await expect(card.getByText(/Кальций снижает всасывание железа/)).toBeVisible();
    await expect(card.getByText(/Это не медицинская рекомендация/)).toBeVisible();
  });
});
```

- [ ] **Step 2: Run the spec**

Run: `npm run test:e2e -- tests/e2e/stackGuard.spec.ts`
Expected: 1 passed (or `1 skipped` without creds — locally export `E2E_EMAIL`/`E2E_PASSWORD`
per the repo's E2E docs and confirm it PASSES before the PR).

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/stackGuard.spec.ts
git commit -m "test: stack-guard E2E with seeded iron+calcium stack"
```

---

### Task 6: Full verification + PR (then STOP)

- [ ] **Step 1: Full local gate (master-plan verification gates)**

Run: `npx tsc --noEmit && npm run build && npm run test:unit && npm run test:correlation`
Expected: all pass (`test:correlation` untouched by this feature — must not regress).

- [ ] **Step 2: Push + PR**

```bash
git push -u origin codex/w3a-stack-guard
gh pr create --base main --title "feat: Stack Guard — curated interaction/timing checks across the active stack (W3-A)" --body "Implements docs/superpowers/plans/2026-07-18-stack-guard.md. Curated 13-rule cited ruleset + pure engine + on-demand /api/insights/stack-guard (owner decision: no migration 028, computed on demand) + Meds-page findings card with disclaimer. Degrades gracefully while supplement_nutrient_facts (026, W2-C) are pending. Test evidence: test:unit (rules integrity + 14 engine tests), stackGuard.spec.ts E2E.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

- [ ] **Step 3: STOP.** Do not merge (owner-only — merge deploys production). No
migrations were written (ledger row 028 stays unused — note this in the PR body if the
template asks). Report back: PR URL, gate output, deviations.
