# Wellbeing & Nutrition Feature Backlog

**Date:** 2026-07-05 · **Status:** approved backlog, not yet scheduled
**Scope:** five features extending the app's wellbeing / healthy-nutrition core. Refill forecasting and the doctor PDF report were considered and **explicitly dropped** by the owner — do not resurrect them from older chat context.

Each entry below is written to be handed to an implementation agent: product intent, UX surface, data model, pipeline architecture, which existing modules are reused, LLM usage & cost control, safety, testing, and effort. Cross-cutting conventions are at the end and apply to every feature.

**Existing platform being built upon (verified 2026-07-05):**
- Food AI pipeline: `food_entries` (typed nutrient columns + `extended_nutrients` jsonb), photo/text analyze routes with OpenRouter structured-output + model fallback (`src/lib/food/analyze/providers.ts`), `nutrition_target_profiles`, `water_entries`.
- Dose/protocol engine: `planned_occurrences` + `execution_events`, outbox sync (`src/lib/supabase/syncOutbox.ts`), boot pull (`cloudStore.ts`).
- Wearables: Oura OAuth → `external_health_daily_snapshots` (008).
- Correlation engine: `buildDailyLifestyleSnapshots` featureBuilder → `daily_lifestyle_snapshots`, stats engine, `correlation_insight_cards`, consent gating (`correlation_consents`) (010).
- Medication knowledge: LLM normalizer/rules/safety/evidence with validation-status machinery (`src/lib/medKnowledge/*`, 009).
- Push: cron-job.org → `/api/cron/notify` (CRON_SECRET), `notification_log` dedupe, web-push.

---

## B1. Nutrient Balance — «Дефициты и дубли: питание ↔ стек» ⭐ flagship

### Product
Cross the food diary with the active supplement stack — the two data halves no competitor holds together. Three output buckets:
1. **Deficits** — nutrients where food intake (rolling 14-day avg) + stack contribution < target (e.g. fiber 12g/35g, food-only).
2. **Covered / redundant** — diet already supplies what a supplement adds (fatty fish 3×/week **and** Omega-3 3000mg/day → flag possible redundancy).
3. **Possible excess** — food + stack combined approaches a curated upper limit (UL).

### UX surface
Insights page card with the three buckets; each row expandable → contribution breakdown (food avg/day, stack/day, target, UL) + evidence citation + standard non-medical-advice disclaimer. Entry point badge on the Food page when a new finding appears.

### Data model (migration 020)
```sql
-- LLM-extracted nutrient content per normalized supplement, cached forever.
create table supplement_nutrient_facts (
  id uuid primary key default gen_random_uuid(),
  normalized_name text not null,        -- from medKnowledge normalizer
  dose_amount numeric not null,
  dose_unit text not null,
  nutrients jsonb not null,             -- { "epaMg": 360, "dhaMg": 240, ... }
  model text not null,
  validation_status text not null default 'pending',  -- reuse medKnowledge status machinery
  created_at timestamptz not null default now(),
  unique (normalized_name, dose_amount, dose_unit)
);
-- Curated ULs ship as versioned JSON in-repo (src/lib/nutrientBalance/limits.ts),
-- top ~30 nutrients, each with source citation. NOT LLM-generated at runtime.
```

### Architecture / pipeline
```
protocol items ──▶ medKnowledge normalizer ──▶ supplement_nutrient_facts (LLM once per unique item, cached)
food_entries (14d) ─▶ aggregate (pure TS) ─┐
stack facts × daily frequency ─────────────┼─▶ nutrientBalance engine (pure TS, deterministic)
targets + curated ULs ─────────────────────┘         │
                                                     ▼
                              /api/insights/nutrient-balance (server route, 24h cache row)
                                                     ▼
                                          Insights card (client)
```
- **New module** `src/lib/nutrientBalance/` — `engine.ts` (pure math, unit-tested), `limits.ts` (curated ULs), `factsExtractor.ts` (LLM call, schema-validated like `analysisSchema.ts`).
- **LLM only at extraction time** (one structured call per unique supplement, cached in table); the analysis itself is deterministic TS — reruns are free and testable.
- Server route uses `createServerClient`; result cached per user/day in a small `nutrient_balance_reports` table (or recomputed on demand — decide at implementation; cache preferred to keep Insights instant).

### Safety
Unverified LLM facts (`validation_status='pending'`) render with a "unverified" chip; excess-bucket findings require a curated UL (never LLM-sourced). Same disclaimer copy as medKnowledge cards.

### Testing
Unit: engine buckets on synthetic data (deficit/covered/excess/boundary). E2E: seeded facts → card renders three buckets. Facts extractor: schema-validation test with mock provider.

**Effort:** M–L (the extraction+curation is the bulk). **Depends on:** nothing; B4 improves nothing here. **LLM cost:** ~1 call per unique supplement ever.

---

## B2. AI Weekly Review — «AI-нутрициолог: недельный разбор»

### Product
Every Monday morning the user gets a push: "Ваш недельный разбор готов". The review: 3 highlights, eating patterns (protein dips on weekends, late sugar), stack adherence, Oura linkage worth noting, and 2–3 concrete actions for next week. History browsable.

### UX surface
Insights page top section "Weekly review" (latest + archive list); push notification deep-links there.

### Data model (migration 021)
```sql
create table weekly_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  week_start date not null,             -- Monday, user timezone
  payload jsonb not null,               -- schema-validated review sections
  model text not null,
  created_at timestamptz not null default now(),
  unique (user_id, week_start)
);
```

### Architecture / pipeline
```
cron-job.org (weekly, Mon 06:00 UTC) ─▶ /api/cron/weekly-review  (Bearer CRON_SECRET)
   for each user with data this week:
     aggregate server-side (SQL): food daily totals, water, adherence %,
       eating-window stats (B3 if present), check-ins (B4 if present),
       Oura weekly deltas from external_health_daily_snapshots
     ─▶ ONE OpenRouter call, structured json_schema (sections typed, validated
        like validateFoodAnalysisDraft; reject → retry fallback model)
     ─▶ upsert weekly_reviews (idempotent on user_id+week_start)
     ─▶ web-push via existing sendToUser (dedupe via notification_log pattern)
```
- **New route** `src/app/api/cron/weekly-review/route.ts` — clone the auth/idempotency discipline of `cron/notify`; separate route, not a new pass inside notify.
- **New module** `src/lib/weeklyReview/` — `aggregate.ts` (SQL→compact JSON context, *aggregates only, never raw entries* — privacy + token budget), `schema.ts`, `prompt.ts`.
- Reuse the provider-fallback + coded-error (`food_provider_*`-style) + Sentry pattern from `food/analyze/providers.ts`.

### Cost control
1 LLM call per user per week; context capped (~2–3k tokens of aggregates); skip users with <3 logged days (no review, no push).

### Testing
Unit: aggregator on synthetic week; schema validator. Route test: idempotent double-fire (unique constraint). E2E optional (render stored review).

**Effort:** M. **Depends on:** richer with B3/B4 shipped first, but works standalone. **Sequencing note:** ship LAST of the five — it is the synthesis layer.

---

## B3. Eating Window — «Пищевое окно и циркадное питание»

### Product
Derive fasting/eating-window metrics from data that already exists (`food_entries.consumed_at` + timezone): daily window length (e.g. 16:8), last-meal time, late-meal flag. Feed them into the correlation engine so cards like "ужин после 21:00 → глубокий сон −18%" emerge. Bonus: suggest taking `withFood:'no'` (empty-stomach) items inside the fasting window.

### UX surface
Food page mini-card: today's window so far ("11:20 → 19:05 · 7h45m"), current streak of ≤10h windows. Insights: correlation cards (existing card component). Dose card hint for empty-stomach items (v2 of this feature).

### Data model
**None.** All metrics are derived. Correlation features persist via the existing `daily_lifestyle_snapshots` flow.

### Architecture / pipeline
```
food_entries ─▶ src/lib/nutrition/eatingWindow.ts (pure, clock-free like daySchedule.ts)
                  computeEatingWindow(entries, date, tz) → {firstMeal, lastMeal, windowH, lateFlag}
     ├─▶ Food page card (client, from foodStore)
     └─▶ correlation featureBuilder: extend BuildDailyLifestyleSnapshotsInput
         with eating_window_hours / last_meal_hour / late_meal_flag
         → existing stats engine picks them up as features vs Oura outcomes
```
- Pure-function module in the standalone-testable style (relative imports, injected "today" — see `daySchedule.ts` precedent; register in `test:unit`).
- Water entries excluded from window math; ≥50 kcal threshold optional later.

### Testing
Unit: window math across midnight-crossing meals, single-meal days, empty days, timezones. Correlation featureBuilder test extension.

**Effort:** S. No LLM, no cron, no migration. **Best first ship together with B4.**

---

## B4. Wellbeing Check-ins — «Дневник самочувствия в 1 тап»

### Product
A 5-second evening check-in: energy / mood / digestion / focus, each 1–5 (four taps), optional note. This gives the correlation engine **subjective outcomes** alongside Oura — unlocking "креатин → энергия +1.2", "поздний кофеин → фокус утром хуже".

### UX surface
Card on the Schedule page after ~19:00 local (and on Progress); editable until midnight. Optional evening push reminder (respect quiet hours), off by default, toggle in Settings.

### Data model (migration 022)
```sql
create table wellbeing_checkins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  checkin_date date not null,
  energy smallint check (energy between 1 and 5),
  mood smallint check (mood between 1 and 5),
  digestion smallint check (digestion between 1 and 5),
  focus smallint check (focus between 1 and 5),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, checkin_date)
);
```

### Architecture / pipeline
```
UI card ─▶ checkinStore (Zustand) ─▶ outbox kind 'checkinSave' (upsert, last-write-wins,
            idempotent on user_id+checkin_date) ─▶ Supabase
boot pull: range fetch like pullFoodEntriesForRange (last 90d)
correlations: featureBuilder outcomes side — check-in metrics join Oura metrics
              as outcome variables in daily_lifestyle_snapshots
push reminder: new pass in /api/cron/notify gated by user setting + local-time
               window + notification_log dedupe (skip if already checked in today)
```
- **Clone the food-entry sync pattern** (`foodStore` + `foodSync` + outbox kind) — it is the simplest proven shape; no ledger needed (last-write-wins is safe for a 4-field daily row).
- Correlation consent (`correlation_consents`) already gates snapshot building — check-ins ride the same consent.

### Testing
Unit: store reducer + outbox payload. E2E: check-in → reload → persists (dose-persistence spec pattern, incl. offline case for free via outbox). featureBuilder outcome test.

**Effort:** S–M. **Ship first** — every week of data collected makes B2/B3 correlations stronger.

---

## B5. Close the Gap — «Чем закрыть день»

### Product
When daily targets have meaningful gaps after ~15:00 (protein −40g, fiber −15g, water −800ml), a button on the Food page asks the LLM for 2–3 concrete meal/snack suggestions that close them. Tapping a suggestion pre-fills the existing text-analyze flow → draft card → save. Turns passive progress bars into an action loop.

### UX surface
Food page: "Чем закрыть день?" button under target cards (visible only when gaps ≥ thresholds); result bottom-sheet with suggestion cards → tap = prefill `analyze-text` input.

### Data model
None persisted (suggestions are ephemeral). Optional later: `suggestion_feedback` for 👍/👎.

### Architecture / pipeline
```
client: remaining = targets − totalsForDate (already computed on Food page)
  ─▶ POST /api/food/suggest { date }        (auth-gated; server RE-COMPUTES gaps
        from DB — never trust client numbers)
  ─▶ OpenRouter structured call: schema { suggestions: [{title, description,
        approxNutrients (FoodNutrients shape), rationale}] }
        — same provider module family as analyzeFoodText: fallback chain,
        food_provider_* coded errors, Sentry capture, 30s timeout
  ─▶ client renders; tap → setMealText(suggestion.title + brief) → existing
        analyze-text → draft → saveDraftAsEntry  (reuses the whole logging loop)
```
- **New route** `src/app/api/food/suggest/route.ts` + `suggestSchema.ts` (clone `analysisSchema` validation discipline).
- Debounce client-side; cache last response per (date, gaps-bucket) in component state — no server cache needed at current scale.

### Testing
Unit: gap computation + schema validator. E2E with route stub (like `mockFoodAnalysis`): button → suggestions → tap → draft appears.

**Effort:** S–M. **Depends on:** nothing (text-analyze already shipped).

---

## Cross-cutting conventions (apply to all five)

1. **Migrations** are numbered sequentially from **020**, idempotent, applied manually via Management API by the orchestrator (no tracking table — see `docs/health-check-2026-06-14.md` history for why this discipline matters).
2. **LLM calls** always: OpenRouter structured `json_schema` output → server-side validator module (the `validateFoodAnalysisDraft` pattern) → model fallback chain → coded `food_provider_*`-style errors → `Sentry.captureException`. Aggregates in, never raw user rows.
3. **Sync** of any new user-writable entity follows the food-entry shape: Zustand store + outbox kind + boot-range pull + idempotent upsert. No new sync patterns.
4. **Pure logic modules** (window math, balance engine) are clock-free with injected dates, live on relative imports, and register in the standalone `test:unit` harness (the `daySchedule.ts` precedent).
5. **Push** additions go through `/api/cron/notify`-style routes with `CRON_SECRET`, `notification_log` dedupe, and user-toggleable settings (default off for new notification types).
6. **Safety**: anything health-interpretive carries the medKnowledge disclaimer; LLM-derived facts carry validation status; correlation surfaces respect `correlation_consents`.
7. **E2E**: every feature lands with at least one Playwright test in the hardened harness (serial workers, cleanup — see PR #63) and follows the shared-account cleanup rules.

## Suggested sequencing

| Wave | Features | Why |
|---|---|---|
| 1 | **B4 check-ins + B3 eating window** | Cheapest; both start accumulating data/features that every later wave consumes |
| 2 | **B1 nutrient balance** | Flagship differentiator; independent of wave 1 but benefits from stable food logging |
| 3 | **B5 close-the-gap** | Daily-habit loop on top of targets; trivially parallel with wave 2 |
| 4 | **B2 weekly review** | Synthesis layer — richest when B1/B3/B4 signals already exist |

Related but separate: Stack Guard (interaction/timing checks across the active stack) and Correlation Insights v2 (surfacing) were approved earlier and are complementary — Stack Guard shares the medKnowledge extraction machinery with B1 and should reuse `supplement_nutrient_facts` groundwork where possible.
