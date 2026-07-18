# W4-B AI Weekly Review — B2 «AI-нутрициолог: недельный разбор» Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or
> superpowers:subagent-driven-development when orchestrated) to implement this plan
> task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Read
> `docs/superpowers/plans/2026-07-18-feature-wave-master.md` FIRST — its Global
> Constraints, migration ledger (027 = `weekly_reviews`), file-ownership matrix and
> owner decisions bind this plan. This is the LAST feature of the wave (W4-B ships
> after W4-A merges — Wave 4 is sequential).

**Goal:** Every Monday morning an opted-in user gets a push «Ваш недельный разбор
готов» deep-linking to the Progress page, where a new top section shows an
LLM-synthesised review of the completed week — 3 highlights, eating patterns, stack
adherence, Oura linkage, and 2–3 concrete actions — plus a browsable archive. One
OpenRouter call per user per week over compact aggregates only. This plan also
executes the recorded owner decision: **remove the dead email-digest toggle and
digest-time field** from Settings (they persist to `notification_settings` but no
email path has ever existed) and put the weekly-review push toggle in that block.

**Architecture:**
```
cron-job.org (Mon 06:00 UTC, created by OWNER post-deploy) ─▶ GET /api/cron/weekly-review (Bearer CRON_SECRET)
  Sentry captureCheckIn + monitorConfig upsert ('0 6 * * 1', UTC — cron/oura-sync pattern, PR #93)
  for each user with weekly_review_enabled = true:
    completedWeekRange(now, tz)                     ── pure leaf src/lib/weeklyReview/weekRange.ts
    already reviewed? → skip (idempotent)           ── unique(user_id, week_start)
    fetch week rows (food, water, occurrences, oura ×2 weeks)
    eating-window stats via W1-B computeEatingWindow (hard dependency — shipped in Wave 1)
    buildWeeklyAggregate(...)                       ── pure leaf src/lib/weeklyReview/aggregate.ts
      → compact JSON aggregates ONLY, never raw rows (privacy + ~2–3k-token cap);
      skip user when loggedDaysCount < 3 (no review, no push)
    generateWeeklyReview(aggregate)                 ── src/lib/weeklyReview/provider.ts
      ONE OpenRouter structured json_schema call, model fallback chain,
      validator reject → next model (providers.ts discipline), coded
      weekly_review_provider_* errors, Sentry.captureException
    upsert weekly_reviews (onConflict user_id,week_start) → row id
    push via sendPushToUser, notification_log dedupe (scheduled_dose_id = review row uuid)
client: GET /api/insights/weekly-review (createServerClient auth, RLS-читаемая таблица)
  ─▶ WeeklyReviewSection on /app/progress (latest + archive, rendered by section)
```

**Tech Stack:** Next.js 15 App Router, TypeScript strict, Supabase (service-role in
cron, `@/lib/supabase/server` in the read route), OpenRouter structured outputs,
`web-push` via `sendPushToUser`, `@sentry/nextjs` check-ins, strip-types test runner
for leaf modules, Playwright E2E.

## Spec

### Requirements

1. **Migration 027** (`supabase/027_weekly_reviews.sql`, per the master ledger):
   idempotent; `weekly_reviews` table with `unique (user_id, week_start)`, RLS
   owner-read (service-role writes); PLUS the settings column
   `notification_settings.weekly_review_enabled boolean not null default false`
   (verified: `notification_settings` has fixed columns and NO extensible jsonb —
   `supabase/001_initial.sql:22-29` — so the default-off toggle needs a column; it
   rides in this feature's migration file, no extra ledger number needed).
   **Written, never applied, by the implementer.**
2. **Cron route** `GET /api/cron/weekly-review`: fail-closed `Bearer CRON_SECRET`;
   Sentry check-in with `monitorConfig` (`'0 6 * * 1'`, timezone `UTC` — matches the
   master plan's "Mon 06:00 UTC"); Monday cadence is enforced by the external
   scheduler, the route itself just reviews "the last completed Mon–Sun week" so a
   late manual re-run still works; idempotent via the unique constraint (double-fire
   → second run reports `already-generated` and does nothing); **skip users with
   < 3 logged days** (logged day = ≥1 food entry OR ≥1 taken/skipped dose that day).
3. **Aggregator** (`aggregate.ts`, pure): food daily totals + week averages, water
   avg/day, adherence % (+ per-day), eating-window stats (avg window hours, late-meal
   days) from the W1-B module's per-day outputs, Oura review-week vs previous-week
   averages and deltas (readiness, sleep, HRV, steps). Compact by construction —
   ≤ 7 day-rows per block, rounded numbers, no raw entries, no free-text from user data.
4. **LLM contract** (`schema.ts`, `prompt.ts`, `provider.ts`): structured
   `json_schema` (strict) with sections — exactly 3 `highlights`, 1–4
   `eatingPatterns` `{title, detail}`, `stackAdherence {summary}`, 0–3 `ouraLinkage`
   strings, 2–3 `actions` `{title, detail}` — validated server-side
   (`validateWeeklyReviewPayload`); validation reject → retry the NEXT model in the
   fallback chain; Russian output; full prompt text lives in this plan (Task 5).
   Mock provider (env-gated, `FOOD_AI_PROVIDER` discipline) for local runs and tests.
5. **Push:** «Ваш недельный разбор готов», `url: '/app/progress'`,
   `notification_log` dedupe keyed by the review row's uuid (the column is
   `uuid not null` — `supabase/003_web_push.sql:41-49` — and the review row provides
   a natural one); requires `push_enabled` and respects the Oura quiet-hours window;
   a stored review without deliverable push is still success (`generated-no-push`).
6. **Progress page:** new top section in the Correlations tab — latest review
   rendered section-by-section + archive list (tap an older week to view it);
   medKnowledge-style non-medical-advice disclaimer under every review.
7. **Settings (owner decision 1):** REMOVE the «Email digest» toggle and the
   digest-time field (and the now-dead `emailEnabled`/`digestTime` code paths —
   project rule: dead code is deleted completely); ADD Toggle «Недельный AI-разбор»
   (default off) in the same block. DB columns `email_enabled`/`digest_time` remain
   in place (dropping prod columns is an owner-side irreversible act — non-goal).
8. **Opt-in gates generation, not just push (recorded decision):** the cron
   generates a review ONLY for `weekly_review_enabled = true` users. Rationale:
   the LLM call costs money per user-week and its only consumer surfaces (push +
   Progress section) are part of the same opt-in feature; running it for users who
   never opted in violates the aggregates-only-when-needed privacy stance and the
   cost-control line of B2 («1 LLM call per user per week» — for users who asked).
9. **Tests.** Unit: `weekRange` math, aggregator on a synthetic week (incl. the
   <3-logged-days skip signal), schema validator accept/reject, model-chain helper.
   Route idempotency: local double-fire with the mock provider (second run
   `already-generated`). E2E: stored review renders on Progress (stubbed read
   endpoint) + Settings shows the new toggle and no email-digest block.

### Acceptance criteria

- `npx tsc --noEmit` && `npm run build` && `npm run test:unit` &&
  `npm run test:correlation` all pass (new `.test.mjs` files register in
  `test:correlation` — see Import topology below).
- Local double-fire (mock provider): run 1 → `"status":"generated-no-push"` (or
  `generated-and-sent`), run 2 → `"status":"already-generated"`; exactly one
  `weekly_reviews` row per (user, week_start).
- A user with 2 logged days gets `"status":"skipped-sparse"`, no row, no push.
- `rg -n "emailEnabled|digestTime|email_enabled|digest_time" src/` returns NO hits
  outside `supabase/` migrations after Task 9.
- Progress page renders a stored review's five sections; archive switches weeks.

### Non-goals

- No email provider, ever, this wave (owner decision 1). No dropping of the
  `email_enabled`/`digest_time` DB columns.
- No check-in data anywhere in the aggregate or prompt — **B4 check-ins are DROPPED**
  (master scope decision); the B2 spec's "check-ins (B4 if present)" line is void.
- No review regeneration/backfill UI; no per-section feedback (👍/👎) in v1.
- No new sync-outbox entity — `weekly_reviews` is server-written, client-read-only.
- Applying migration 027 / creating the cron-job.org job — owner-only, post-merge.

## Global Constraints

- Branch: `codex/w4b-weekly-review` off fresh `origin/main` (which by Wave 4
  contains W1-B's `src/lib/nutrition/eatingWindow.ts` and W3-B's
  `morningBriefingEnabled` settings field — both are ASSUMED present; Task 0
  verifies). Never push to `main`; conventional commits;
  `bash scripts/git-state-check.sh` first.
- TypeScript strict; no `any` without comment; `npx tsc --noEmit` after every
  `.ts/.tsx` change; `npm run build` before the PR; no `console.log`
  (`console.error`/`warn` per existing route convention only).
- File ownership (master matrix): `src/app/api/cron/weekly-review/*`,
  `src/lib/weeklyReview/*`, migration 027, `src/app/app/progress/page.tsx`
  (section insertion), Settings page + the notification-settings type/store/sync
  files (wave-sequenced — W4-A has already merged), new
  `src/app/api/insights/weekly-review/*`, `src/components/app/WeeklyReviewSection.tsx`,
  `package.json` test list, new test files. Do NOT touch `cron/notify`,
  `scheduleWindow.ts`, `eatingWindow.ts` (read-only import), or Oura components.
- **Import topology (verified; same as the 2026-07-14 Oura sprint-1 plan Task 3):**
  `moduleResolution: "bundler"` without `allowImportingTsExtensions` → a `.ts` file
  may NOT import a sibling `.ts` by extension (tsc fails), and the strip-types
  runner cannot resolve extensionless TS-to-TS imports. Consequences used here:
  (a) `weekRange.ts`, `aggregate.ts`, `schema.ts`, `models.ts` are LEAF modules
  (zero value imports) tested directly by `.test.mjs` under `test:correlation`;
  (b) `aggregate.ts` does NOT import W1-B's `eatingWindow.ts` — the ROUTE computes
  per-day windows and passes plain data in (the `ouraSyncEngine → mapper` precedent);
  (c) `provider.ts`/`prompt.ts` import via `@/` aliases and are exercised through
  tsc/build + the validator's own tests, not the strip-types runner.
- LLM discipline (master constraint): clone `src/lib/food/analyze/providers.ts` —
  structured `json_schema` strict, fallback chain with a terminal code-default
  model, coded `weekly_review_provider_*` errors, `Sentry.captureException` at the
  route boundary, timeout, aggregates in / never raw rows.
- Push discipline: `sendPushToUser` `sent === 0` is a failure signal
  (docs/system-audit-2026-07-09.md §2) — log Sentry warning, release the claim.

## File Structure

- Create: `supabase/027_weekly_reviews.sql`
- Create: `src/lib/weeklyReview/weekRange.ts` + `weekRange.test.mjs`
- Create: `src/lib/weeklyReview/aggregate.ts` + `aggregate.test.mjs`
- Create: `src/lib/weeklyReview/schema.ts` + `schema.test.mjs`
- Create: `src/lib/weeklyReview/models.ts` + `models.test.mjs`
- Create: `src/lib/weeklyReview/prompt.ts`
- Create: `src/lib/weeklyReview/provider.ts`
- Create: `src/app/api/cron/weekly-review/route.ts`
- Create: `src/app/api/insights/weekly-review/route.ts`
- Create: `src/components/app/WeeklyReviewSection.tsx`
- Create: `tests/e2e/weeklyReview.spec.ts`
- Modify: `src/app/app/progress/page.tsx` (insert section)
- Modify: `src/types/index.ts`, `src/lib/store/store.ts`,
  `src/lib/supabase/cloudStore.ts`, `src/lib/supabase/importStore.ts`,
  `src/lib/push/subscription.ts`, `src/app/app/settings/page.tsx`
  (email-digest removal + weekly-review toggle)
- Modify: `package.json` (`test:correlation` list)

---

### Task 0: Preflight + dependency verification

- [ ] **Step 1: Git state + branch**

```bash
cd "/Volumes/DATA/GRAVITY REPO/medremind-app"
bash scripts/git-state-check.sh
git fetch origin && git checkout -b codex/w4b-weekly-review origin/main
```

- [ ] **Step 2: Verify hard dependencies on main**

```bash
ls src/lib/nutrition/eatingWindow.ts
rg -n "morningBriefingEnabled" src/types/index.ts
rg -n "export function computeEatingWindow" -A 6 src/lib/nutrition/eatingWindow.ts
```

Expected: file exists (W1-B merged); the W3-B field exists in `NotificationSettings`.
Record `computeEatingWindow`'s EXACT signature and return-field names — Task 6 maps
its output into this feature's own `WeeklyEatingWindowDay` shape at the route
boundary, and the mapping lines must be adapted to what you just read (the master
plan promised `computeEatingWindow(entries, date, tz) → {firstMeal, lastMeal,
windowH, lateFlag}`; trust the code, not the promise). **If `eatingWindow.ts` does
not exist, STOP and report — do not reimplement W1-B's module.**

- [ ] **Step 3: Read the binding docs/code**

`docs/superpowers/plans/2026-07-18-feature-wave-master.md`, `CLAUDE.md`,
`docs/backlog-wellbeing-features.md` §B2, `src/app/api/cron/notify/route.ts`,
`src/app/api/cron/oura-sync/route.ts`, `src/lib/food/analyze/providers.ts`,
`src/lib/correlation/persistence.ts` (the occurrence→derived-status query you will
clone), `src/app/app/settings/page.tsx`, `src/app/app/progress/page.tsx`.

---

### Task 1: Migration 027 — `weekly_reviews` + settings column

**Files:**
- Create: `supabase/027_weekly_reviews.sql`

**Interfaces:**
- Produces: table `weekly_reviews(id, user_id, week_start, payload, model,
  created_at)` with `unique (user_id, week_start)` (idempotency anchor for Task 6)
  and owner-read RLS (read path for Task 7); column
  `notification_settings.weekly_review_enabled` (Tasks 6 and 9).

- [ ] **Step 1: Write the migration (idempotent, `022_oura_tags.sql` style)**

```sql
-- 027: W4-B AI Weekly Review (B2) — stored weekly synthesis + push opt-in.
-- payload is the schema-validated review JSON (weekly-review-v1); one row per
-- user per ISO week (week_start = Monday, user timezone). Written only by the
-- service-role cron; users read their own rows (Progress page).
create table if not exists weekly_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  week_start date not null,
  payload jsonb not null,
  model text not null,
  created_at timestamptz not null default now(),
  unique (user_id, week_start)
);
alter table weekly_reviews enable row level security;
do $$ begin
  create policy "Owner read weekly reviews" on weekly_reviews
    for select using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
create index if not exists idx_weekly_reviews_user_week
  on weekly_reviews(user_id, week_start desc);

-- Weekly-review push opt-in (default off — master Global Constraint for new
-- push types). notification_settings has fixed columns, no jsonb (001).
alter table notification_settings
  add column if not exists weekly_review_enabled boolean not null default false;

comment on column notification_settings.weekly_review_enabled is
  'Opt-in for the Monday AI weekly-review generation + push (W4-B). Default off.';
```

- [ ] **Step 2: Commit**

```bash
git add supabase/027_weekly_reviews.sql
git commit -m "feat: migration 027 — weekly_reviews table + weekly_review_enabled toggle"
```

(The master ledger already lists 027 for this feature — no ledger edit needed.)

---

### Task 2: `weekRange.ts` — completed-week math (leaf module)

**Files:**
- Create: `src/lib/weeklyReview/weekRange.ts` + `src/lib/weeklyReview/weekRange.test.mjs`
- Modify: `package.json` (`test:correlation` list)

**Interfaces:**
- Produces: `completedWeekRange(now: Date, timeZone: string): { weekStart: string;
  weekEnd: string }` — the most recent fully completed Mon–Sun week in the user's
  timezone (run on any Monday → the week that ended yesterday). Consumed by Task 6.

- [ ] **Step 1: Failing tests**

```js
// src/lib/weeklyReview/weekRange.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';

import { completedWeekRange } from './weekRange.ts';

test('Monday 06:00 UTC → the week that ended yesterday (Mon..Sun)', () => {
  // 2026-07-13 is a Monday.
  const range = completedWeekRange(new Date('2026-07-13T06:00:00.000Z'), 'UTC');
  assert.deepEqual(range, { weekStart: '2026-07-06', weekEnd: '2026-07-12' });
});

test('mid-week run still reviews the last COMPLETED week', () => {
  // 2026-07-16 is a Thursday → completed week is still Jul 6–12.
  const range = completedWeekRange(new Date('2026-07-16T12:00:00.000Z'), 'UTC');
  assert.deepEqual(range, { weekStart: '2026-07-06', weekEnd: '2026-07-12' });
});

test('timezone shifts the local date across midnight', () => {
  // 06:00 UTC Monday is already Monday 18:00 in Pacific/Auckland (+12/+13);
  // but Sunday 20:00 UTC is MONDAY 09:00 in Auckland → completed week moves.
  const range = completedWeekRange(new Date('2026-07-12T20:00:00.000Z'), 'Pacific/Auckland');
  assert.deepEqual(range, { weekStart: '2026-07-06', weekEnd: '2026-07-12' });
  // Same instant in UTC is still Sunday → the week BEFORE is the completed one.
  const utcRange = completedWeekRange(new Date('2026-07-12T20:00:00.000Z'), 'UTC');
  assert.deepEqual(utcRange, { weekStart: '2026-06-29', weekEnd: '2026-07-05' });
});

test('invalid timezone falls back to UTC instead of throwing', () => {
  const range = completedWeekRange(new Date('2026-07-13T06:00:00.000Z'), 'Not/AZone');
  assert.deepEqual(range, { weekStart: '2026-07-06', weekEnd: '2026-07-12' });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --experimental-strip-types --test src/lib/weeklyReview/weekRange.test.mjs`
Expected: FAIL with `Cannot find module ... weekRange.ts`

- [ ] **Step 3: Implement**

```ts
// src/lib/weeklyReview/weekRange.ts
// The most recent fully completed Mon–Sun week in the user's timezone.
// Pure leaf module (zero imports) — strip-types test-runner constraint.

function localDateFor(now: Date, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);
    const map = new Map(parts.map((part) => [part.type, part.value]));
    const date = `${map.get('year')}-${map.get('month')}-${map.get('day')}`;
    if (date.length === 10) return date;
  } catch {
    // invalid timezone string — fall through to UTC
  }
  return now.toISOString().slice(0, 10);
}

function addDaysIso(localDate: string, days: number): string {
  const date = new Date(`${localDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function completedWeekRange(
  now: Date,
  timeZone: string,
): { weekStart: string; weekEnd: string } {
  const today = localDateFor(now, timeZone);
  const dayOfWeek = new Date(`${today}T00:00:00.000Z`).getUTCDay(); // 0=Sun..6=Sat
  const daysSinceMonday = (dayOfWeek + 6) % 7;
  const currentMonday = addDaysIso(today, -daysSinceMonday);
  const weekStart = addDaysIso(currentMonday, -7);
  return { weekStart, weekEnd: addDaysIso(weekStart, 6) };
}
```

- [ ] **Step 4: Register + verify + commit**

Append ` src/lib/weeklyReview/weekRange.test.mjs` to `test:correlation` in
`package.json`.

Run: `npm run test:correlation && npx tsc --noEmit` → all pass.

```bash
git add src/lib/weeklyReview/weekRange.ts src/lib/weeklyReview/weekRange.test.mjs package.json
git commit -m "feat: completed-week range math for weekly review"
```

---

### Task 3: `aggregate.ts` — compact weekly aggregates (leaf module)

**Files:**
- Create: `src/lib/weeklyReview/aggregate.ts` + `src/lib/weeklyReview/aggregate.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces (consumed by Tasks 5 and 6):

```ts
export type WeeklyFoodRow = { consumed_at: string; calories_kcal: number | null; protein_g: number | null; fiber_g: number | null; sugars_g: number | null };
export type WeeklyWaterRow = { consumed_at: string; amount_ml: number };
export type WeeklyOccurrenceRow = { occurrence_date: string; derived_status: string }; // 'taken' | 'skipped' | 'planned' | ...
export type WeeklyOuraRow = { local_date: string; readiness_score: number | null; sleep_score: number | null; sleep_avg_hrv: number | null; steps: number | null };
export type WeeklyEatingWindowDay = { localDate: string; windowHours: number | null; lateFlag: boolean };
export type WeeklyAggregate = { /* see implementation */ };
export function buildWeeklyAggregate(input: {
  weekStart: string; timezone: string;
  foodEntries: WeeklyFoodRow[]; waterEntries: WeeklyWaterRow[];
  occurrences: WeeklyOccurrenceRow[]; ouraDays: WeeklyOuraRow[];
  eatingWindows: WeeklyEatingWindowDay[];
}): WeeklyAggregate;
```

- Leaf module: the route (not this module) calls W1-B's `computeEatingWindow` and
  passes plain `WeeklyEatingWindowDay` data in (import-topology constraint).
- Aggregates ONLY — the output contains at most 7 per-day rows per block, rounded
  numbers, zero raw entries and zero user free-text (privacy + ~2–3k-token cap).

- [ ] **Step 1: Failing tests**

```js
// src/lib/weeklyReview/aggregate.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';

import { buildWeeklyAggregate } from './aggregate.ts';

const WEEK = { weekStart: '2026-07-06', timezone: 'UTC' }; // Mon Jul 6 – Sun Jul 12

function food(dateTime, kcal, protein, fiber, sugars) {
  return { consumed_at: dateTime, calories_kcal: kcal, protein_g: protein, fiber_g: fiber, sugars_g: sugars };
}

test('food totals group by LOCAL day and average over logged days only', () => {
  const aggregate = buildWeeklyAggregate({
    ...WEEK,
    foodEntries: [
      food('2026-07-06T09:00:00.000Z', 500, 30, 8, 10),
      food('2026-07-06T19:00:00.000Z', 700, 40, 6, 20),
      food('2026-07-07T12:00:00.000Z', 900, 50, 10, 15),
      // outside the week — must be ignored:
      food('2026-07-13T09:00:00.000Z', 999, 99, 99, 99),
    ],
    waterEntries: [
      { consumed_at: '2026-07-06T10:00:00.000Z', amount_ml: 500 },
      { consumed_at: '2026-07-07T10:00:00.000Z', amount_ml: 1500 },
    ],
    occurrences: [],
    ouraDays: [],
    eatingWindows: [],
  });
  assert.equal(aggregate.weekStart, '2026-07-06');
  assert.equal(aggregate.weekEnd, '2026-07-12');
  assert.equal(aggregate.food.days.length, 2);
  assert.deepEqual(aggregate.food.days[0], { date: '2026-07-06', kcal: 1200, proteinG: 70, fiberG: 14, sugarsG: 30, meals: 2 });
  assert.deepEqual(aggregate.food.weekAvg, { kcal: 1050, proteinG: 60, fiberG: 12, sugarsG: 23 });
  assert.equal(aggregate.waterAvgMlPerDay, 1000);
});

test('timezone assigns a late-UTC entry to the correct local day', () => {
  const aggregate = buildWeeklyAggregate({
    weekStart: '2026-07-06',
    timezone: 'Europe/Moscow', // UTC+3
    foodEntries: [food('2026-07-06T22:30:00.000Z', 300, 10, 2, 5)], // 01:30 Jul 7 local
    waterEntries: [], occurrences: [], ouraDays: [], eatingWindows: [],
  });
  assert.equal(aggregate.food.days[0].date, '2026-07-07');
});

test('adherence percent and per-day counts from derived statuses', () => {
  const aggregate = buildWeeklyAggregate({
    ...WEEK,
    foodEntries: [], waterEntries: [], ouraDays: [], eatingWindows: [],
    occurrences: [
      { occurrence_date: '2026-07-06', derived_status: 'taken' },
      { occurrence_date: '2026-07-06', derived_status: 'taken' },
      { occurrence_date: '2026-07-07', derived_status: 'skipped' },
      { occurrence_date: '2026-07-08', derived_status: 'planned' },
    ],
  });
  assert.equal(aggregate.adherence.plannedCount, 4);
  assert.equal(aggregate.adherence.takenCount, 2);
  assert.equal(aggregate.adherence.skippedCount, 1);
  assert.equal(aggregate.adherence.adherencePct, 50);
  assert.deepEqual(aggregate.adherence.byDay[0], { date: '2026-07-06', planned: 2, taken: 2 });
});

test('oura splits review week vs previous week and reports deltas', () => {
  const ouraDays = [];
  for (let day = 0; day < 7; day += 1) {
    ouraDays.push({ local_date: `2026-06-2${9 - 0}`.slice(0, 10), readiness_score: null, sleep_score: null, sleep_avg_hrv: null, steps: null });
  }
  const aggregate = buildWeeklyAggregate({
    ...WEEK,
    foodEntries: [], waterEntries: [], occurrences: [], eatingWindows: [],
    ouraDays: [
      { local_date: '2026-06-30', readiness_score: 70, sleep_score: 70, sleep_avg_hrv: 50, steps: 8000 },
      { local_date: '2026-07-01', readiness_score: 74, sleep_score: 72, sleep_avg_hrv: 54, steps: 10000 },
      { local_date: '2026-07-06', readiness_score: 80, sleep_score: 78, sleep_avg_hrv: 60, steps: 12000 },
      { local_date: '2026-07-07', readiness_score: 84, sleep_score: 80, sleep_avg_hrv: 64, steps: 14000 },
    ],
  });
  assert.deepEqual(aggregate.oura.reviewWeek, { readinessAvg: 82, sleepAvg: 79, hrvAvg: 62, stepsAvg: 13000 });
  assert.deepEqual(aggregate.oura.previousWeek, { readinessAvg: 72, sleepAvg: 71, hrvAvg: 52, stepsAvg: 9000 });
  assert.deepEqual(aggregate.oura.delta, { readiness: 10, sleep: 8, hrv: 10, steps: 4000 });
});

test('eating window stats: average hours and late-meal day count', () => {
  const aggregate = buildWeeklyAggregate({
    ...WEEK,
    foodEntries: [], waterEntries: [], occurrences: [], ouraDays: [],
    eatingWindows: [
      { localDate: '2026-07-06', windowHours: 10, lateFlag: false },
      { localDate: '2026-07-07', windowHours: 12, lateFlag: true },
      { localDate: '2026-07-08', windowHours: null, lateFlag: false },
    ],
  });
  assert.deepEqual(aggregate.eatingWindow, { avgWindowHours: 11, lateMealDays: 1 });
});

test('loggedDaysCount counts days with food OR an actioned dose; sparse weeks are flagged by the caller', () => {
  const aggregate = buildWeeklyAggregate({
    ...WEEK,
    foodEntries: [food('2026-07-06T09:00:00.000Z', 500, 30, 8, 10)],
    waterEntries: [],
    occurrences: [
      { occurrence_date: '2026-07-06', derived_status: 'taken' }, // same day as food — still 1 logged day
      { occurrence_date: '2026-07-09', derived_status: 'skipped' },
      { occurrence_date: '2026-07-10', derived_status: 'planned' }, // unactioned → not a logged day
    ],
    ouraDays: [], eatingWindows: [],
  });
  assert.equal(aggregate.loggedDaysCount, 2);
});

test('empty blocks come back null, not fabricated zeros', () => {
  const aggregate = buildWeeklyAggregate({
    ...WEEK, foodEntries: [], waterEntries: [], occurrences: [], ouraDays: [], eatingWindows: [],
  });
  assert.equal(aggregate.food, null);
  assert.equal(aggregate.waterAvgMlPerDay, null);
  assert.equal(aggregate.oura, null);
  assert.equal(aggregate.eatingWindow, null);
  assert.equal(aggregate.adherence.plannedCount, 0);
  assert.equal(aggregate.loggedDaysCount, 0);
});
```

NOTE: the fourth test's first loop is dead scaffolding — delete those 4 lines when
copying (keep only the `buildWeeklyAggregate` call and asserts).

- [ ] **Step 2: Run to verify failure**

Run: `node --experimental-strip-types --test src/lib/weeklyReview/aggregate.test.mjs`
Expected: FAIL with `Cannot find module ... aggregate.ts`

- [ ] **Step 3: Implement**

```ts
// src/lib/weeklyReview/aggregate.ts
// Weekly aggregates for the AI review. Pure LEAF module (zero imports —
// strip-types runner constraint; the cron route injects eating-window data
// instead of this module importing W1-B's eatingWindow.ts).
//
// PRIVACY + TOKEN BUDGET: output contains ONLY aggregates — at most 7 per-day
// rows per block, rounded numbers, no raw entries, no user free-text. This is
// the entire LLM context (~2–3k tokens), per B2 cost control.

export type WeeklyFoodRow = {
  consumed_at: string;
  calories_kcal: number | null;
  protein_g: number | null;
  fiber_g: number | null;
  sugars_g: number | null;
};
export type WeeklyWaterRow = { consumed_at: string; amount_ml: number };
export type WeeklyOccurrenceRow = { occurrence_date: string; derived_status: string };
export type WeeklyOuraRow = {
  local_date: string;
  readiness_score: number | null;
  sleep_score: number | null;
  sleep_avg_hrv: number | null;
  steps: number | null;
};
export type WeeklyEatingWindowDay = {
  localDate: string;
  windowHours: number | null;
  lateFlag: boolean;
};

export type WeeklyFoodDay = {
  date: string;
  kcal: number;
  proteinG: number;
  fiberG: number;
  sugarsG: number;
  meals: number;
};

export type WeeklyOuraAverages = {
  readinessAvg: number | null;
  sleepAvg: number | null;
  hrvAvg: number | null;
  stepsAvg: number | null;
};

export type WeeklyAggregate = {
  weekStart: string;
  weekEnd: string;
  timezone: string;
  loggedDaysCount: number;
  food: { days: WeeklyFoodDay[]; weekAvg: { kcal: number; proteinG: number; fiberG: number; sugarsG: number } } | null;
  waterAvgMlPerDay: number | null;
  adherence: {
    plannedCount: number;
    takenCount: number;
    skippedCount: number;
    adherencePct: number | null;
    byDay: Array<{ date: string; planned: number; taken: number }>;
  };
  eatingWindow: { avgWindowHours: number; lateMealDays: number } | null;
  oura: { reviewWeek: WeeklyOuraAverages; previousWeek: WeeklyOuraAverages; delta: { readiness: number | null; sleep: number | null; hrv: number | null; steps: number | null } } | null;
};

function addDaysIso(localDate: string, days: number): string {
  const date = new Date(`${localDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function localDayOf(isoTimestamp: string, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date(isoTimestamp));
    const map = new Map(parts.map((part) => [part.type, part.value]));
    const date = `${map.get('year')}-${map.get('month')}-${map.get('day')}`;
    if (date.length === 10) return date;
  } catch {
    // invalid tz — fall through
  }
  return isoTimestamp.slice(0, 10);
}

const round1 = (value: number) => Math.round(value * 10) / 10;

function meanOrNull(values: Array<number | null>): number | null {
  const numeric = values.filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value),
  );
  if (numeric.length === 0) return null;
  return Math.round(numeric.reduce((total, value) => total + value, 0) / numeric.length);
}

export function buildWeeklyAggregate(input: {
  weekStart: string;
  timezone: string;
  foodEntries: WeeklyFoodRow[];
  waterEntries: WeeklyWaterRow[];
  occurrences: WeeklyOccurrenceRow[];
  ouraDays: WeeklyOuraRow[];
  eatingWindows: WeeklyEatingWindowDay[];
}): WeeklyAggregate {
  const { weekStart, timezone } = input;
  const weekEnd = addDaysIso(weekStart, 6);
  const previousWeekStart = addDaysIso(weekStart, -7);
  const inWeek = (date: string) => date >= weekStart && date <= weekEnd;

  // ── food per local day ──
  const foodByDay = new Map<string, { kcal: number; proteinG: number; fiberG: number; sugarsG: number; meals: number }>();
  for (const entry of input.foodEntries) {
    const day = localDayOf(entry.consumed_at, timezone);
    if (!inWeek(day)) continue;
    const bucket = foodByDay.get(day) ?? { kcal: 0, proteinG: 0, fiberG: 0, sugarsG: 0, meals: 0 };
    bucket.kcal += entry.calories_kcal ?? 0;
    bucket.proteinG += entry.protein_g ?? 0;
    bucket.fiberG += entry.fiber_g ?? 0;
    bucket.sugarsG += entry.sugars_g ?? 0;
    bucket.meals += 1;
    foodByDay.set(day, bucket);
  }
  const foodDays: WeeklyFoodDay[] = [...foodByDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, bucket]) => ({
      date,
      kcal: Math.round(bucket.kcal),
      proteinG: round1(bucket.proteinG),
      fiberG: round1(bucket.fiberG),
      sugarsG: round1(bucket.sugarsG),
      meals: bucket.meals,
    }));
  const food =
    foodDays.length === 0
      ? null
      : {
          days: foodDays,
          weekAvg: {
            kcal: Math.round(foodDays.reduce((total, day) => total + day.kcal, 0) / foodDays.length),
            proteinG: round1(foodDays.reduce((total, day) => total + day.proteinG, 0) / foodDays.length),
            fiberG: round1(foodDays.reduce((total, day) => total + day.fiberG, 0) / foodDays.length),
            sugarsG: round1(foodDays.reduce((total, day) => total + day.sugarsG, 0) / foodDays.length),
          },
        };

  // ── water per local day ──
  const waterByDay = new Map<string, number>();
  for (const entry of input.waterEntries) {
    const day = localDayOf(entry.consumed_at, timezone);
    if (!inWeek(day)) continue;
    waterByDay.set(day, (waterByDay.get(day) ?? 0) + entry.amount_ml);
  }
  const waterAvgMlPerDay =
    waterByDay.size === 0
      ? null
      : Math.round([...waterByDay.values()].reduce((total, ml) => total + ml, 0) / waterByDay.size);

  // ── adherence ──
  const adherenceByDay = new Map<string, { planned: number; taken: number }>();
  let plannedCount = 0;
  let takenCount = 0;
  let skippedCount = 0;
  const actionedDays = new Set<string>();
  for (const occurrence of input.occurrences) {
    if (!inWeek(occurrence.occurrence_date)) continue;
    plannedCount += 1;
    const bucket = adherenceByDay.get(occurrence.occurrence_date) ?? { planned: 0, taken: 0 };
    bucket.planned += 1;
    if (occurrence.derived_status === 'taken') {
      takenCount += 1;
      bucket.taken += 1;
      actionedDays.add(occurrence.occurrence_date);
    } else if (occurrence.derived_status === 'skipped') {
      skippedCount += 1;
      actionedDays.add(occurrence.occurrence_date);
    }
    adherenceByDay.set(occurrence.occurrence_date, bucket);
  }
  const adherence = {
    plannedCount,
    takenCount,
    skippedCount,
    adherencePct: plannedCount === 0 ? null : Math.round((takenCount / plannedCount) * 100),
    byDay: [...adherenceByDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, bucket]) => ({ date, planned: bucket.planned, taken: bucket.taken })),
  };

  // ── eating window ──
  const windowDays = input.eatingWindows.filter((day) => inWeek(day.localDate));
  const windowHours = windowDays
    .map((day) => day.windowHours)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const eatingWindow =
    windowHours.length === 0
      ? null
      : {
          avgWindowHours: round1(windowHours.reduce((total, hours) => total + hours, 0) / windowHours.length),
          lateMealDays: windowDays.filter((day) => day.lateFlag).length,
        };

  // ── oura: review week vs previous week ──
  const reviewRows = input.ouraDays.filter((row) => inWeek(row.local_date));
  const previousRows = input.ouraDays.filter(
    (row) => row.local_date >= previousWeekStart && row.local_date < weekStart,
  );
  const averagesOf = (rows: WeeklyOuraRow[]): WeeklyOuraAverages => ({
    readinessAvg: meanOrNull(rows.map((row) => row.readiness_score)),
    sleepAvg: meanOrNull(rows.map((row) => row.sleep_score)),
    hrvAvg: meanOrNull(rows.map((row) => row.sleep_avg_hrv)),
    stepsAvg: meanOrNull(rows.map((row) => row.steps)),
  });
  const deltaOf = (current: number | null, previous: number | null): number | null =>
    current === null || previous === null ? null : current - previous;
  let oura: WeeklyAggregate['oura'] = null;
  if (reviewRows.length > 0) {
    const reviewWeek = averagesOf(reviewRows);
    const previousWeek = averagesOf(previousRows);
    oura = {
      reviewWeek,
      previousWeek,
      delta: {
        readiness: deltaOf(reviewWeek.readinessAvg, previousWeek.readinessAvg),
        sleep: deltaOf(reviewWeek.sleepAvg, previousWeek.sleepAvg),
        hrv: deltaOf(reviewWeek.hrvAvg, previousWeek.hrvAvg),
        steps: deltaOf(reviewWeek.stepsAvg, previousWeek.stepsAvg),
      },
    };
  }

  // ── logged days: food OR an actioned (taken/skipped) dose ──
  const loggedDays = new Set<string>([...foodByDay.keys(), ...actionedDays]);

  return {
    weekStart,
    weekEnd,
    timezone,
    loggedDaysCount: loggedDays.size,
    food,
    waterAvgMlPerDay,
    adherence,
    eatingWindow,
    oura,
  };
}
```

- [ ] **Step 4: Register + verify + commit**

Append ` src/lib/weeklyReview/aggregate.test.mjs` to `test:correlation`.

Run: `npm run test:correlation && npx tsc --noEmit` → all pass.

```bash
git add src/lib/weeklyReview/aggregate.ts src/lib/weeklyReview/aggregate.test.mjs package.json
git commit -m "feat: weekly aggregate builder (compact, aggregates-only LLM context)"
```

---

### Task 4: `schema.ts` — json_schema + payload validator (leaf module)

**Files:**
- Create: `src/lib/weeklyReview/schema.ts` + `src/lib/weeklyReview/schema.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces (consumed by Tasks 5–8):
  - `WEEKLY_REVIEW_JSON_SCHEMA` (strict OpenRouter `json_schema`),
  - `type WeeklyReviewPayload`,
  - `validateWeeklyReviewPayload(value: unknown): WeeklyReviewPayload` — throws
    `Error('weekly_review_invalid_payload')` on any violation (the
    `validateFoodAnalysisDraft` role).

- [ ] **Step 1: Failing tests**

```js
// src/lib/weeklyReview/schema.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';

import { validateWeeklyReviewPayload } from './schema.ts';

const VALID = {
  schemaVersion: 'weekly-review-v1',
  highlights: ['Белок в среднем 92 г/день', 'Адхиренс 86%', 'HRV +6 мс к прошлой неделе'],
  eatingPatterns: [{ title: 'Поздние ужины', detail: '3 дня приём пищи после 21:00.' }],
  stackAdherence: { summary: 'Принято 36 из 42 доз (86%). Слабый день — суббота.' },
  ouraLinkage: ['Средний сон вырос на 4 балла на фоне более коротких пищевых окон.'],
  actions: [
    { title: 'Ужин до 21:00', detail: 'В будни закрывать пищевое окно до 21:00.' },
    { title: 'Вода в выходные', detail: 'Держать не меньше 1.5 л в сб и вс.' },
  ],
};

test('accepts a valid payload and returns it typed', () => {
  const payload = validateWeeklyReviewPayload(VALID);
  assert.equal(payload.schemaVersion, 'weekly-review-v1');
  assert.equal(payload.highlights.length, 3);
  assert.equal(payload.actions.length, 2);
});

test('rejects wrong highlight count', () => {
  assert.throws(
    () => validateWeeklyReviewPayload({ ...VALID, highlights: ['a', 'b'] }),
    /weekly_review_invalid_payload/,
  );
});

test('rejects empty strings, wrong action count, and missing sections', () => {
  assert.throws(() => validateWeeklyReviewPayload({ ...VALID, highlights: ['a', 'b', ''] }), /weekly_review_invalid_payload/);
  assert.throws(() => validateWeeklyReviewPayload({ ...VALID, actions: [VALID.actions[0]] }), /weekly_review_invalid_payload/);
  assert.throws(() => validateWeeklyReviewPayload({ ...VALID, actions: [...VALID.actions, ...VALID.actions] }), /weekly_review_invalid_payload/);
  assert.throws(() => validateWeeklyReviewPayload({ ...VALID, stackAdherence: undefined }), /weekly_review_invalid_payload/);
  assert.throws(() => validateWeeklyReviewPayload({ ...VALID, eatingPatterns: [] }), /weekly_review_invalid_payload/);
  assert.throws(() => validateWeeklyReviewPayload(null), /weekly_review_invalid_payload/);
  assert.throws(() => validateWeeklyReviewPayload({ ...VALID, schemaVersion: 'v2' }), /weekly_review_invalid_payload/);
});

test('ouraLinkage may be empty but not overlong', () => {
  assert.doesNotThrow(() => validateWeeklyReviewPayload({ ...VALID, ouraLinkage: [] }));
  assert.throws(
    () => validateWeeklyReviewPayload({ ...VALID, ouraLinkage: ['a', 'b', 'c', 'd'] }),
    /weekly_review_invalid_payload/,
  );
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --experimental-strip-types --test src/lib/weeklyReview/schema.test.mjs`
Expected: FAIL with `Cannot find module ... schema.ts`

- [ ] **Step 3: Implement**

```ts
// src/lib/weeklyReview/schema.ts
// The weekly-review LLM output contract: OpenRouter strict json_schema plus a
// server-side validator (validateFoodAnalysisDraft role). Leaf module.

export type WeeklyReviewPayload = {
  schemaVersion: 'weekly-review-v1';
  highlights: string[]; // exactly 3
  eatingPatterns: Array<{ title: string; detail: string }>; // 1..4
  stackAdherence: { summary: string };
  ouraLinkage: string[]; // 0..3
  actions: Array<{ title: string; detail: string }>; // 2..3
};

export const WEEKLY_REVIEW_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'highlights', 'eatingPatterns', 'stackAdherence', 'ouraLinkage', 'actions'],
  properties: {
    schemaVersion: { type: 'string', enum: ['weekly-review-v1'] },
    highlights: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'string' } },
    eatingPatterns: {
      type: 'array',
      minItems: 1,
      maxItems: 4,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'detail'],
        properties: { title: { type: 'string' }, detail: { type: 'string' } },
      },
    },
    stackAdherence: {
      type: 'object',
      additionalProperties: false,
      required: ['summary'],
      properties: { summary: { type: 'string' } },
    },
    ouraLinkage: { type: 'array', minItems: 0, maxItems: 3, items: { type: 'string' } },
    actions: {
      type: 'array',
      minItems: 2,
      maxItems: 3,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'detail'],
        properties: { title: { type: 'string' }, detail: { type: 'string' } },
      },
    },
  },
} as const;

function fail(reason: string): never {
  throw new Error(`weekly_review_invalid_payload: ${reason}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown, where: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) fail(where);
  return value.trim();
}

function titleDetailList(
  value: unknown,
  min: number,
  max: number,
  where: string,
): Array<{ title: string; detail: string }> {
  if (!Array.isArray(value) || value.length < min || value.length > max) fail(where);
  return value.map((item, index) => {
    if (!isRecord(item)) fail(`${where}[${index}]`);
    return {
      title: nonEmptyString(item.title, `${where}[${index}].title`),
      detail: nonEmptyString(item.detail, `${where}[${index}].detail`),
    };
  });
}

export function validateWeeklyReviewPayload(value: unknown): WeeklyReviewPayload {
  if (!isRecord(value)) fail('root');
  if (value.schemaVersion !== 'weekly-review-v1') fail('schemaVersion');

  const highlights = value.highlights;
  if (!Array.isArray(highlights) || highlights.length !== 3) fail('highlights');

  const ouraLinkage = value.ouraLinkage;
  if (!Array.isArray(ouraLinkage) || ouraLinkage.length > 3) fail('ouraLinkage');

  if (!isRecord(value.stackAdherence)) fail('stackAdherence');

  return {
    schemaVersion: 'weekly-review-v1',
    highlights: highlights.map((item, index) => nonEmptyString(item, `highlights[${index}]`)),
    eatingPatterns: titleDetailList(value.eatingPatterns, 1, 4, 'eatingPatterns'),
    stackAdherence: { summary: nonEmptyString(value.stackAdherence.summary, 'stackAdherence.summary') },
    ouraLinkage: ouraLinkage.map((item, index) => nonEmptyString(item, `ouraLinkage[${index}]`)),
    actions: titleDetailList(value.actions, 2, 3, 'actions'),
  };
}
```

- [ ] **Step 4: Register + verify + commit**

Append ` src/lib/weeklyReview/schema.test.mjs` to `test:correlation`.

Run: `npm run test:correlation && npx tsc --noEmit` → all pass.

```bash
git add src/lib/weeklyReview/schema.ts src/lib/weeklyReview/schema.test.mjs package.json
git commit -m "feat: weekly-review json schema + strict payload validator"
```

---

### Task 5: Models chain, prompt, provider (OpenRouter + mock)

**Files:**
- Create: `src/lib/weeklyReview/models.ts` + `src/lib/weeklyReview/models.test.mjs`
- Create: `src/lib/weeklyReview/prompt.ts`
- Create: `src/lib/weeklyReview/provider.ts`
- Modify: `package.json`

**Interfaces:**
- `models.ts` (leaf; the `food/analyze/openRouterModels.ts` clone):
  `getWeeklyReviewModels(env?)` → chain
  `[OPENROUTER_WEEKLY_REVIEW_MODEL ?? default, OPENROUTER_WEEKLY_REVIEW_FALLBACK_MODEL?, DEFAULT]`
  deduplicated, `DEFAULT_WEEKLY_REVIEW_MODEL = 'google/gemini-2.5-flash'` (text-only
  synthesis — cheap, large context); `shouldFallbackWeeklyReviewModel(status, current, next)`
  with the proven status set `{404, 408, 409, 429, 500, 502, 503, 504}`.
- `prompt.ts`: `WEEKLY_REVIEW_SYSTEM_PROMPT` (full Russian text below) and
  `buildWeeklyReviewUserPrompt(aggregate: WeeklyAggregate): string`.
- `provider.ts`: `getWeeklyReviewProvider(): 'mock' | 'openrouter'` from
  `WEEKLY_REVIEW_AI_PROVIDER` (unset → `'mock'`, the `FOOD_AI_PROVIDER` discipline —
  production sets `openrouter` in Vercel env);
  `generateWeeklyReview(aggregate): Promise<{ payload: WeeklyReviewPayload; model: string }>`
  — ONE call per user per week; on schema-validation reject, retries the NEXT model
  in the chain (B2: «reject → retry fallback model»); coded errors
  `weekly_review_provider_timeout | weekly_review_provider_openrouter_<status> |
  weekly_review_provider_exhausted | weekly_review_provider_invalid_output`.

- [ ] **Step 1: Failing models tests**

```js
// src/lib/weeklyReview/models.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';

import { getWeeklyReviewModels, shouldFallbackWeeklyReviewModel } from './models.ts';

test('default chain is just the code default', () => {
  assert.deepEqual(getWeeklyReviewModels({}), ['google/gemini-2.5-flash']);
});

test('env primary + fallback, code default always terminal, deduplicated', () => {
  assert.deepEqual(
    getWeeklyReviewModels({
      OPENROUTER_WEEKLY_REVIEW_MODEL: 'anthropic/claude-sonnet-4.5',
      OPENROUTER_WEEKLY_REVIEW_FALLBACK_MODEL: 'openrouter/auto',
    }),
    ['anthropic/claude-sonnet-4.5', 'openrouter/auto', 'google/gemini-2.5-flash'],
  );
  assert.deepEqual(
    getWeeklyReviewModels({ OPENROUTER_WEEKLY_REVIEW_MODEL: 'google/gemini-2.5-flash' }),
    ['google/gemini-2.5-flash'],
  );
});

test('fallback only on retryable statuses and when a next model exists', () => {
  assert.equal(shouldFallbackWeeklyReviewModel(429, 'a', 'b'), true);
  assert.equal(shouldFallbackWeeklyReviewModel(404, 'a', 'b'), true);
  assert.equal(shouldFallbackWeeklyReviewModel(400, 'a', 'b'), false);
  assert.equal(shouldFallbackWeeklyReviewModel(429, 'a', undefined), false);
  assert.equal(shouldFallbackWeeklyReviewModel(429, 'a', 'a'), false);
});
```

- [ ] **Step 2: Run to verify failure, then implement `models.ts`**

Run: `node --experimental-strip-types --test src/lib/weeklyReview/models.test.mjs` → FAIL.

```ts
// src/lib/weeklyReview/models.ts
// Model chain for the weekly review (clone of food/analyze/openRouterModels.ts).
// Leaf module. The code-default model is always the terminal fallback so a
// stale env-pinned model can never sink the whole chain.

export const DEFAULT_WEEKLY_REVIEW_MODEL = 'google/gemini-2.5-flash';

const FALLBACKABLE_STATUSES = new Set([404, 408, 409, 429, 500, 502, 503, 504]);

type ModelEnv = Record<string, string | undefined>;

function cleanModelId(value: string | undefined): string | undefined {
  const cleaned = value?.trim();
  return cleaned ? cleaned : undefined;
}

export function getWeeklyReviewModels(env: ModelEnv = process.env): string[] {
  const primaryModel =
    cleanModelId(env.OPENROUTER_WEEKLY_REVIEW_MODEL) ?? DEFAULT_WEEKLY_REVIEW_MODEL;
  const fallbackModel = cleanModelId(env.OPENROUTER_WEEKLY_REVIEW_FALLBACK_MODEL);
  return Array.from(
    new Set(
      [primaryModel, fallbackModel, DEFAULT_WEEKLY_REVIEW_MODEL].filter(
        (model): model is string => Boolean(model),
      ),
    ),
  );
}

export function shouldFallbackWeeklyReviewModel(
  status: number,
  currentModel: string,
  nextModel: string | undefined,
): boolean {
  return Boolean(nextModel && nextModel !== currentModel && FALLBACKABLE_STATUSES.has(status));
}
```

Run the test again → 3 PASS. Append ` src/lib/weeklyReview/models.test.mjs` to
`test:correlation`.

- [ ] **Step 3: Write `prompt.ts` (full text — do not paraphrase)**

```ts
// src/lib/weeklyReview/prompt.ts
// The complete weekly-review prompt. The user message is ONLY the compact
// aggregate JSON (see aggregate.ts) — never raw entries.
import type { WeeklyAggregate } from './aggregate';

export const WEEKLY_REVIEW_SYSTEM_PROMPT = `Ты — ассистент-нутрициолог приложения MedRemind. Тебе передают ТОЛЬКО агрегированные показатели одной завершённой недели пользователя (никаких сырых записей). Составь недельный разбор на русском языке строго в формате JSON по заданной схеме.

Правила:
1. Используй только переданные числа. Ничего не выдумывай; если по разделу данных нет (null), напиши об этом нейтрально или пропусти наблюдение.
2. Никаких медицинских советов, диагнозов и рекомендаций менять дозировки, начинать или отменять препараты. Разрешены только наблюдения о питании, воде, регулярности приёма и сне.
3. highlights — ровно 3 коротких пункта: самое важное за неделю, каждый с конкретным числом из данных.
4. eatingPatterns — от 1 до 4 паттернов питания (например: «белок проседает в выходные», «поздние приёмы пищи», «мало клетчатки»), каждый с конкретикой из данных. Если данных о еде нет — один паттерн о том, что дневник питания не вёлся.
5. stackAdherence.summary — 1–2 предложения о регулярности приёма добавок/препаратов: процент, слабые дни.
6. ouraLinkage — от 0 до 3 осторожных наблюдений, связывающих поведение недели с трендами сна и восстановления (дельты к прошлой неделе). Только корреляционные формулировки («совпало с», «на фоне»), никакой причинности. Если данных Oura нет — пустой массив.
7. actions — 2–3 конкретных выполнимых действия на следующую неделю, каждое привязано к цифре из данных.
8. Тон: дружелюбный и деловой, без морализаторства и без эмодзи. Числа пиши как в данных, единицы измерения указывай (г, мл, ккал, мс).`;

export function buildWeeklyReviewUserPrompt(aggregate: WeeklyAggregate): string {
  return [
    `Неделя: ${aggregate.weekStart} — ${aggregate.weekEnd} (таймзона ${aggregate.timezone}).`,
    `Дней с записями: ${aggregate.loggedDaysCount} из 7.`,
    'Агрегированные данные недели (JSON):',
    JSON.stringify(aggregate),
  ].join('\n');
}
```

- [ ] **Step 4: Write `provider.ts`**

```ts
// src/lib/weeklyReview/provider.ts
// ONE OpenRouter structured call per user per week, with the
// food/analyze/providers.ts fallback discipline: model chain, coded
// weekly_review_provider_* errors, timeout, schema-validation reject → retry
// the next model. A mock provider (env-gated like FOOD_AI_PROVIDER) keeps
// local runs and the double-fire idempotency check LLM-free.
import { buildWeeklyReviewUserPrompt, WEEKLY_REVIEW_SYSTEM_PROMPT } from './prompt';
import type { WeeklyAggregate } from '@/lib/weeklyReview/aggregate';
import {
  getWeeklyReviewModels,
  shouldFallbackWeeklyReviewModel,
} from '@/lib/weeklyReview/models';
import {
  validateWeeklyReviewPayload,
  WEEKLY_REVIEW_JSON_SCHEMA,
  type WeeklyReviewPayload,
} from '@/lib/weeklyReview/schema';

const PROVIDER_TIMEOUT_MS = 60_000;

export type WeeklyReviewResult = { payload: WeeklyReviewPayload; model: string };

export function getWeeklyReviewProvider(): 'mock' | 'openrouter' {
  const provider = process.env.WEEKLY_REVIEW_AI_PROVIDER;
  if (!provider || provider === 'mock') return 'mock';
  if (provider === 'openrouter') return 'openrouter';
  throw new Error('Unsupported WEEKLY_REVIEW_AI_PROVIDER.');
}

export async function generateWeeklyReview(aggregate: WeeklyAggregate): Promise<WeeklyReviewResult> {
  if (getWeeklyReviewProvider() === 'mock') return mockWeeklyReview(aggregate);

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is required for WEEKLY_REVIEW_AI_PROVIDER=openrouter.');

  const models = getWeeklyReviewModels();
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
          { role: 'system', content: WEEKLY_REVIEW_SYSTEM_PROMPT },
          { role: 'user', content: buildWeeklyReviewUserPrompt(aggregate) },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'weekly_review', strict: true, schema: WEEKLY_REVIEW_JSON_SCHEMA },
        },
      }),
    });

    if (!response.ok) {
      if (shouldFallbackWeeklyReviewModel(response.status, model, models[index + 1])) continue;
      throw new Error(`weekly_review_provider_openrouter_${response.status}`);
    }

    const body = await response.json();
    const outputText = body?.choices?.[0]?.message?.content;
    if (typeof outputText !== 'string' || outputText.trim().length === 0) {
      if (models[index + 1]) continue;
      throw new Error('weekly_review_provider_invalid_output');
    }

    try {
      return { payload: validateWeeklyReviewPayload(parseStructuredOutput(outputText)), model };
    } catch (validationError) {
      // B2: schema reject → retry the fallback model; exhausted → surface.
      if (models[index + 1]) continue;
      throw validationError instanceof Error && validationError.message.startsWith('weekly_review_invalid_payload')
        ? new Error('weekly_review_provider_invalid_output')
        : validationError;
    }
  }
  throw new Error('weekly_review_provider_exhausted');
}

function mockWeeklyReview(aggregate: WeeklyAggregate): WeeklyReviewResult {
  return {
    model: 'mock-weekly-review',
    payload: validateWeeklyReviewPayload({
      schemaVersion: 'weekly-review-v1',
      highlights: [
        `Дней с записями: ${aggregate.loggedDaysCount} из 7`,
        `Приёмы по плану: ${aggregate.adherence.adherencePct ?? 0}%`,
        `Средние калории: ${aggregate.food?.weekAvg.kcal ?? 0} ккал/день`,
      ],
      eatingPatterns: [{ title: 'Мок-паттерн', detail: 'Сгенерировано мок-провайдером для локальной проверки.' }],
      stackAdherence: { summary: `Принято ${aggregate.adherence.takenCount} из ${aggregate.adherence.plannedCount} доз.` },
      ouraLinkage: [],
      actions: [
        { title: 'Мок-действие 1', detail: 'Проверить рендер разбора на странице Progress.' },
        { title: 'Мок-действие 2', detail: 'Проверить дедупликацию повторного запуска крона.' },
      ],
    }),
  };
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
      throw new Error('weekly_review_provider_timeout');
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

- [ ] **Step 5: Verify + commit**

Run: `npm run test:correlation && npx tsc --noEmit`
Expected: all pass, tsc clean.

```bash
git add src/lib/weeklyReview/models.ts src/lib/weeklyReview/models.test.mjs src/lib/weeklyReview/prompt.ts src/lib/weeklyReview/provider.ts package.json
git commit -m "feat: weekly-review prompt, model chain, provider with mock + fallback retry"
```

---

### Task 6: Cron route `GET /api/cron/weekly-review`

**Files:**
- Create: `src/app/api/cron/weekly-review/route.ts`

**Interfaces:**
- Consumes: Tasks 1–5 exports; `computeEatingWindow` from
  `@/lib/nutrition/eatingWindow` (W1-B — adapt the marked mapping block to the real
  signature recorded in Task 0); `isInQuietHours`, `sendPushToUser`,
  `isVapidConfigured`.
- Produces: JSON `{ processed, results: [{ userId, status }] }`, statuses
  `generated-and-sent | generated-no-push | already-generated | skipped-sparse | error`.
- Sentry monitor slug `cron-weekly-review`, crontab `'0 6 * * 1'`, timezone `UTC`.

- [ ] **Step 1: Write the route**

```ts
// GET /api/cron/weekly-review
// W4-B (B2): Monday synthesis of the completed week. Triggered weekly
// (Mon 06:00 UTC) by a cron-job.org job the OWNER creates after deploy —
// never by an implementing agent (master plan, decision 3).
//
// Discipline: fail-closed CRON_SECRET; Sentry check-in + monitorConfig upsert
// (cron/oura-sync pattern, PR #93); idempotent via unique(user_id, week_start)
// — a double fire finds the row and does nothing; generation is gated on the
// weekly_review_enabled opt-in (LLM cost control — plan Spec, req. 8); skip
// users with <3 logged days; ONE OpenRouter call per user per week over
// aggregates only; push dedupe via notification_log keyed by the review row's
// uuid; sent===0 is a failure signal (system-audit 2026-07-09 §2) but the
// stored review still counts as success (generated-no-push).
import * as Sentry from '@sentry/nextjs';
import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

import { computeEatingWindow } from '@/lib/nutrition/eatingWindow';
import { isInQuietHours } from '@/lib/push/quietHours';
import { isVapidConfigured, sendPushToUser } from '@/lib/push/sendToUser';
import {
  buildWeeklyAggregate,
  type WeeklyEatingWindowDay,
  type WeeklyFoodRow,
  type WeeklyOccurrenceRow,
  type WeeklyOuraRow,
  type WeeklyWaterRow,
} from '@/lib/weeklyReview/aggregate';
import { generateWeeklyReview } from '@/lib/weeklyReview/provider';
import { completedWeekRange } from '@/lib/weeklyReview/weekRange';

export const runtime = 'nodejs';
export const maxDuration = 300;

const MONITOR_SLUG = 'cron-weekly-review';
const MIN_LOGGED_DAYS = 3;

type Row = Record<string, unknown>;

function addDaysIso(localDate: string, days: number): string {
  const date = new Date(`${localDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const checkInId = Sentry.captureCheckIn(
    { monitorSlug: MONITOR_SLUG, status: 'in_progress' },
    {
      schedule: { type: 'crontab', value: '0 6 * * 1' },
      checkinMargin: 60,
      maxRuntime: 10,
      timezone: 'UTC',
    },
  );

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const now = new Date();
  const results: Array<{ userId: string; status: string }> = [];

  const { data: settingRows, error: settingsError } = await supabase
    .from('notification_settings')
    .select('user_id, push_enabled')
    .eq('weekly_review_enabled', true);

  if (settingsError) {
    Sentry.captureException(settingsError, {
      tags: { route: 'cron/weekly-review', stage: 'notification_settings' },
    });
    Sentry.captureCheckIn({ checkInId, monitorSlug: MONITOR_SLUG, status: 'error' });
    return NextResponse.json({ error: 'DB error' }, { status: 500 });
  }

  for (const { user_id: userId, push_enabled: pushEnabled } of settingRows ?? []) {
    try {
      const { data: profileRow } = await supabase
        .from('profiles')
        .select('timezone')
        .eq('id', userId)
        .maybeSingle();
      const tz = profileRow?.timezone ?? 'UTC';
      const { weekStart, weekEnd } = completedWeekRange(now, tz);

      // Idempotency: unique(user_id, week_start). Double fire → nothing to do.
      const { data: existing } = await supabase
        .from('weekly_reviews')
        .select('id')
        .eq('user_id', userId)
        .eq('week_start', weekStart)
        .maybeSingle();
      if (existing) {
        results.push({ userId, status: 'already-generated' });
        continue;
      }

      // Week rows. Timestamp ranges are widened ±1 day so timezone-local
      // bucketing inside the aggregator never loses edge entries
      // (correlation/persistence.ts precedent).
      const widenedStartTs = `${addDaysIso(weekStart, -1)}T00:00:00.000Z`;
      const widenedEndTs = `${addDaysIso(weekEnd, 1)}T23:59:59.999Z`;

      const [foodRes, waterRes, occRes, ouraRes] = await Promise.all([
        supabase
          .from('food_entries')
          .select('consumed_at, calories_kcal, protein_g, fiber_g, sugars_g')
          .eq('user_id', userId)
          .gte('consumed_at', widenedStartTs)
          .lte('consumed_at', widenedEndTs),
        supabase
          .from('water_entries')
          .select('consumed_at, amount_ml')
          .eq('user_id', userId)
          .gte('consumed_at', widenedStartTs)
          .lte('consumed_at', widenedEndTs),
        supabase
          .from('planned_occurrences')
          .select('occurrence_date, status, execution_events(event_type, event_at)')
          .eq('user_id', userId)
          .gte('occurrence_date', weekStart)
          .lte('occurrence_date', weekEnd)
          .is('superseded_by_occurrence_id', null),
        supabase
          .from('external_health_daily_snapshots')
          .select('local_date, readiness_score, sleep_score, sleep_avg_hrv, steps')
          .eq('user_id', userId)
          .eq('source', 'oura')
          .gte('local_date', addDaysIso(weekStart, -7))
          .lte('local_date', weekEnd),
      ]);
      const firstError = foodRes.error ?? waterRes.error ?? occRes.error ?? ouraRes.error;
      if (firstError) throw firstError;

      const foodEntries = (foodRes.data ?? []) as unknown as Array<Row & WeeklyFoodRow>;
      const waterEntries = (waterRes.data ?? []) as unknown as WeeklyWaterRow[];

      // planned_occurrences.status is structural; derive the action status from
      // the latest execution event (correlation/persistence.ts precedent).
      const occurrences: WeeklyOccurrenceRow[] = ((occRes.data ?? []) as unknown as Row[]).map((row) => {
        const events = (row.execution_events as Row[] | null) ?? [];
        const latestEvent = [...events].sort((a, b) =>
          String(b.event_at ?? '').localeCompare(String(a.event_at ?? '')),
        )[0];
        return {
          occurrence_date: String(row.occurrence_date),
          derived_status: latestEvent ? String(latestEvent.event_type) : String(row.status),
        };
      });

      const ouraDays: WeeklyOuraRow[] = ((ouraRes.data ?? []) as unknown as Row[]).map((row) => ({
        local_date: String(row.local_date),
        readiness_score: numberOrNull(row.readiness_score),
        sleep_score: numberOrNull(row.sleep_score),
        sleep_avg_hrv: numberOrNull(row.sleep_avg_hrv),
        steps: numberOrNull(row.steps),
      }));

      // Eating-window stats via W1-B's pure module, one call per week day.
      // >>> ADAPTATION POINT (Task 0, Step 2): match the REAL computeEatingWindow
      // signature/field names recorded during preflight. The shape below assumes
      // computeEatingWindow(entries, date, tz) → { windowH, lateFlag, ... }.
      const eatingWindows: WeeklyEatingWindowDay[] = [];
      for (let offset = 0; offset < 7; offset += 1) {
        const day = addDaysIso(weekStart, offset);
        const window = computeEatingWindow(foodEntries, day, tz);
        eatingWindows.push({
          localDate: day,
          windowHours: numberOrNull(window?.windowH),
          lateFlag: window?.lateFlag === true,
        });
      }

      const aggregate = buildWeeklyAggregate({
        weekStart,
        timezone: tz,
        foodEntries,
        waterEntries,
        occurrences,
        ouraDays,
        eatingWindows,
      });

      if (aggregate.loggedDaysCount < MIN_LOGGED_DAYS) {
        results.push({ userId, status: 'skipped-sparse' });
        continue;
      }

      const review = await generateWeeklyReview(aggregate);

      const { data: upserted, error: upsertError } = await supabase
        .from('weekly_reviews')
        .upsert(
          {
            user_id: userId,
            week_start: weekStart,
            payload: review.payload,
            model: review.model,
          },
          { onConflict: 'user_id,week_start' },
        )
        .select('id')
        .single();
      if (upsertError) throw upsertError;
      const reviewId = String(upserted.id);

      // ── push (optional layer on top of the stored review) ──
      if (!pushEnabled || !isVapidConfigured()) {
        results.push({ userId, status: 'generated-no-push' });
        continue;
      }
      const { data: connRow } = await supabase
        .from('external_health_connections')
        .select('sleep_window')
        .eq('user_id', userId)
        .eq('source', 'oura')
        .maybeSingle();
      const optimalBedtime = (
        connRow?.sleep_window as { optimal_bedtime?: unknown } | null
      )?.optimal_bedtime;
      if (isInQuietHours(now, tz, optimalBedtime)) {
        results.push({ userId, status: 'generated-no-push' });
        continue;
      }

      // Dedupe: the review row's uuid is the notification_log key
      // (scheduled_dose_id is `uuid not null`, 003_web_push.sql).
      const { data: lockRows, error: lockError } = await supabase
        .from('notification_log')
        .upsert(
          {
            user_id: userId,
            scheduled_dose_id: reviewId,
            sent_at: now.toISOString(),
            notification_count: 0,
          },
          { onConflict: 'user_id,scheduled_dose_id', ignoreDuplicates: true },
        )
        .select('scheduled_dose_id');
      if (lockError) throw lockError;
      if (!lockRows || lockRows.length === 0) {
        results.push({ userId, status: 'generated-no-push' });
        continue;
      }

      const sendResult = await sendPushToUser(supabase, userId, {
        title: 'MedRemind',
        body: 'Ваш недельный разбор готов',
        url: '/app/progress',
        tag: `weekly-review-${weekStart}`,
      });
      if (sendResult.sent === 0) {
        Sentry.captureMessage(
          '[cron/weekly-review] review user has zero deliverable subscriptions',
          { level: 'warning', tags: { route: 'cron/weekly-review', userId } },
        );
        await supabase
          .from('notification_log')
          .delete()
          .eq('user_id', userId)
          .eq('scheduled_dose_id', reviewId)
          .eq('notification_count', 0);
        results.push({ userId, status: 'generated-no-push' });
        continue;
      }
      await supabase
        .from('notification_log')
        .update({ notification_count: 1 })
        .eq('user_id', userId)
        .eq('scheduled_dose_id', reviewId)
        .eq('notification_count', 0);
      results.push({ userId, status: 'generated-and-sent' });
    } catch (err) {
      console.error('[cron/weekly-review] user failed', userId, err);
      Sentry.captureException(err, { tags: { route: 'cron/weekly-review', userId } });
      results.push({ userId, status: 'error' });
    }
  }

  Sentry.captureCheckIn({ checkInId, monitorSlug: MONITOR_SLUG, status: 'ok' });
  return NextResponse.json({ processed: results.length, results });
}
```

- [ ] **Step 2: Type-check + build**

Run: `npx tsc --noEmit && npm run build`
Expected: clean. Two known adaptation points if tsc complains: (a) the
`computeEatingWindow` call — fix per the real W1-B signature (never with `any`);
(b) the `foodEntries` cast — `computeEatingWindow` may expect its own entry shape;
map fields explicitly if so.

- [ ] **Step 3: Local double-fire idempotency check (mock provider)**

Prereq: `.env.local` with `CRON_SECRET` + Supabase env pointing at a DB where
migration 027 is applied (local/staging only; production is owner-only),
`WEEKLY_REVIEW_AI_PROVIDER` unset (→ mock), a test user with
`weekly_review_enabled = true` and ≥3 logged days last week. Then:

```bash
set -a && source .env.local && set +a
curl -s -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/weekly-review
curl -s -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/weekly-review
```

Expected: run 1 → `"status":"generated-no-push"` (or `generated-and-sent`);
run 2 → `"status":"already-generated"`; and exactly ONE `weekly_reviews` row for the
(user, week). Also `curl -s http://localhost:3000/api/cron/weekly-review` → 401.
If no such DB is reachable, record the step as deferred-to-owner in the PR body.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/cron/weekly-review/route.ts
git commit -m "feat: weekly-review cron route (idempotent upsert, sparse skip, push dedupe)"
```

---

### Task 7: Read route `GET /api/insights/weekly-review`

**Files:**
- Create: `src/app/api/insights/weekly-review/route.ts`

**Interfaces:**
- Produces: `{ reviews: [{ id, weekStart, payload, model, createdAt }] }` (newest
  first, limit 12) — consumed by Task 8 and the E2E stub. Auth via the SSR client;
  RLS owner-read policy from Task 1 scopes rows server-side either way.

- [ ] **Step 1: Write the route**

```ts
// GET /api/insights/weekly-review — the user's stored weekly reviews,
// newest first (latest + archive for the Progress page).
import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

const ARCHIVE_LIMIT = 12;

export async function GET() {
  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data, error } = await supabase
    .from('weekly_reviews')
    .select('id, week_start, payload, model, created_at')
    .eq('user_id', authData.user.id)
    .order('week_start', { ascending: false })
    .limit(ARCHIVE_LIMIT);

  if (error) {
    console.error('[insights/weekly-review] query failed', error);
    return NextResponse.json({ error: 'Weekly reviews unavailable.' }, { status: 500 });
  }

  return NextResponse.json({
    reviews: (data ?? []).map((row) => ({
      id: String(row.id),
      weekStart: String(row.week_start),
      payload: row.payload,
      model: String(row.model),
      createdAt: String(row.created_at),
    })),
  });
}
```

- [ ] **Step 2: Verify + commit**

Run: `npx tsc --noEmit && npm run build` → clean.

```bash
git add src/app/api/insights/weekly-review/route.ts
git commit -m "feat: weekly-review read endpoint (latest + archive)"
```

---

### Task 8: Progress page — «Недельный разбор» section

**Files:**
- Create: `src/components/app/WeeklyReviewSection.tsx`
- Modify: `src/app/app/progress/page.tsx`

**Interfaces:**
- Consumes: Task 7 endpoint; `WeeklyReviewPayload` type from
  `@/lib/weeklyReview/schema`.
- Placement: TOP of the Correlations tab (before the adherence-status card) —
  per the master ownership matrix this plan owns the "review section" edit of
  `progress/page.tsx`; do not touch the Oura tab.

- [ ] **Step 1: Write the section component**

```tsx
'use client';
// «Недельный разбор» (W4-B): latest stored review + archive, rendered
// section-by-section from the schema-validated payload. Renders nothing when
// the user has no reviews (feature is opt-in via Settings).
import { useEffect, useState } from 'react';

import type { WeeklyReviewPayload } from '@/lib/weeklyReview/schema';

type StoredReview = {
  id: string;
  weekStart: string;
  payload: WeeklyReviewPayload;
  model: string;
  createdAt: string;
};

function formatWeek(weekStart: string): string {
  const start = new Date(`${weekStart}T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  const format = (date: Date) =>
    `${String(date.getUTCDate()).padStart(2, '0')}.${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  return `${format(start)} – ${format(end)}`;
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-3">
      <div className="text-[10px] font-bold text-[#8B949E] uppercase tracking-widest mb-1.5">{title}</div>
      {children}
    </div>
  );
}

export function WeeklyReviewSection() {
  const [reviews, setReviews] = useState<StoredReview[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/insights/weekly-review')
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { reviews?: StoredReview[] } | null) => {
        if (cancelled || !data?.reviews?.length) return;
        setReviews(data.reviews);
        setSelectedId(data.reviews[0].id);
      })
      .catch(() => {
        // endpoint unavailable — section simply doesn't render
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selected = reviews.find((review) => review.id === selectedId) ?? reviews[0];
  if (!selected) return null;
  const payload = selected.payload;

  return (
    <div
      data-testid="weekly-review-section"
      className="rounded-2xl border border-[rgba(139,92,246,0.3)] bg-[rgba(139,92,246,0.06)] p-4 mt-3 mb-3"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-bold text-[#F0F6FC]">🧠 Недельный разбор</div>
        <div className="text-[11px] text-[#8B949E]">{formatWeek(selected.weekStart)}</div>
      </div>

      <Block title="Итоги недели">
        <ul className="flex flex-col gap-1">
          {payload.highlights.map((highlight) => (
            <li key={highlight} className="text-xs text-[#F0F6FC] leading-relaxed">• {highlight}</li>
          ))}
        </ul>
      </Block>

      <Block title="Питание">
        {payload.eatingPatterns.map((pattern) => (
          <div key={pattern.title} className="mb-1.5">
            <span className="text-xs font-semibold text-[#F0F6FC]">{pattern.title}: </span>
            <span className="text-xs text-[#8B949E]">{pattern.detail}</span>
          </div>
        ))}
      </Block>

      <Block title="Приём стека">
        <p className="text-xs text-[#8B949E] leading-relaxed">{payload.stackAdherence.summary}</p>
      </Block>

      {payload.ouraLinkage.length > 0 && (
        <Block title="Сон и восстановление">
          <ul className="flex flex-col gap-1">
            {payload.ouraLinkage.map((linkage) => (
              <li key={linkage} className="text-xs text-[#8B949E] leading-relaxed">• {linkage}</li>
            ))}
          </ul>
        </Block>
      )}

      <Block title="На следующую неделю">
        {payload.actions.map((action) => (
          <div key={action.title} className="mb-1.5">
            <span className="text-xs font-semibold text-[#10B981]">{action.title}: </span>
            <span className="text-xs text-[#8B949E]">{action.detail}</span>
          </div>
        ))}
      </Block>

      {reviews.length > 1 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {reviews.map((review) => (
            <button
              key={review.id}
              type="button"
              onClick={() => setSelectedId(review.id)}
              className={[
                'rounded-lg px-2 py-1 text-[11px] font-semibold transition-colors',
                review.id === selected.id
                  ? 'bg-[#8B5CF6] text-white'
                  : 'bg-[#1C2333] text-[#8B949E] hover:text-[#F0F6FC]',
              ].join(' ')}
            >
              {formatWeek(review.weekStart)}
            </button>
          ))}
        </div>
      )}

      <p className="mt-3 text-[10px] text-[#8B949E] leading-relaxed">
        ⚠️ Это не медицинская рекомендация. Не меняйте приём препаратов и добавок без
        консультации с врачом.
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Insert into the Progress page**

In `src/app/app/progress/page.tsx`:

(a) add the import next to the `OuraTab` import:

```ts
import { WeeklyReviewSection } from '@/components/app/WeeklyReviewSection';
```

(b) inside the Correlations-tab fragment (the `{activeTab === 'oura' ? <OuraTab /> : ( <> ... ` block, line ~466), directly after the opening `<>` and BEFORE the
`{/* ── 1. PRIMARY ADHERENCE STATUS + TREND ── */}` comment, add:

```tsx
        {/* ── 0. WEEKLY AI REVIEW (W4-B) ── */}
        <WeeklyReviewSection />
```

- [ ] **Step 3: Verify + commit**

Run: `npx tsc --noEmit && npm run build` → clean.

```bash
git add src/components/app/WeeklyReviewSection.tsx src/app/app/progress/page.tsx
git commit -m "feat: weekly-review section on progress page (latest + archive)"
```

---

### Task 9: Settings — remove dead email digest, add the review toggle

**Files:**
- Modify: `src/types/index.ts`, `src/lib/store/store.ts`,
  `src/lib/supabase/cloudStore.ts`, `src/lib/supabase/importStore.ts`,
  `src/lib/push/subscription.ts`, `src/app/app/settings/page.tsx`

**Interfaces:**
- Executes owner decision 1 (master plan): the email toggle and digest-time field
  are dead ends (no email path exists) — REMOVE them and their code paths entirely
  (project rule: no dead code, no backward-compat stubs). DB columns stay.
- Produces: `NotificationSettings.weeklyReviewEnabled` ⇄
  `notification_settings.weekly_review_enabled`, consumed by Task 6's user filter.
- ASSUMPTION (verified in Task 0): W3-B's `morningBriefingEnabled` is already in
  these files — keep it; the snippets below show the post-W3-B shape.

- [ ] **Step 1: Type**

`src/types/index.ts` — `NotificationSettings` becomes:

```ts
export interface NotificationSettings {
  pushEnabled: boolean;
  leadTimeMin: number;       // notify N min before dose
  morningBriefingEnabled: boolean; // W3-B daily readiness briefing push (default off)
  weeklyReviewEnabled: boolean;    // W4-B Monday AI review push (default off)
}
```

(`emailEnabled` and `digestTime` are deleted.)

- [ ] **Step 2: Store default**

`src/lib/store/store.ts` initial value becomes:

```ts
      notificationSettings: {
        pushEnabled: false,
        leadTimeMin: 0,
        morningBriefingEnabled: false,
        weeklyReviewEnabled: false,
      },
```

- [ ] **Step 3: Cloud pull**

`src/lib/supabase/cloudStore.ts`:

```ts
function defaultNotificationSettings(): NotificationSettings {
  return {
    pushEnabled: false,
    leadTimeMin: 0,
    morningBriefingEnabled: false,
    weeklyReviewEnabled: false,
  };
}
```

and the pull mapping becomes:

```ts
  const notificationSettings: NotificationSettings = nRow
    ? {
        pushEnabled: Boolean(nRow.push_enabled),
        leadTimeMin: Number(nRow.lead_time_min ?? 0),
        morningBriefingEnabled: Boolean(nRow.morning_briefing_enabled),
        weeklyReviewEnabled: Boolean(nRow.weekly_review_enabled),
      }
    : defaultNotificationSettings();
```

- [ ] **Step 4: Import + save helpers**

`src/lib/supabase/importStore.ts` — in the notification-settings upsert payload,
DELETE the `email_enabled: ...` and `digest_time: ...` lines and add:

```ts
      weekly_review_enabled: Boolean(notifPatch.weeklyReviewEnabled),
```

`src/lib/push/subscription.ts` — `saveNotificationSettingsToSupabase` becomes:

```ts
export async function saveNotificationSettingsToSupabase(settings: {
  pushEnabled: boolean;
  leadTimeMin: number;
  morningBriefingEnabled: boolean;
  weeklyReviewEnabled: boolean;
}): Promise<void> {
  const supabase = getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  await supabase.from('notification_settings').upsert(
    {
      user_id: user.id,
      push_enabled: settings.pushEnabled,
      lead_time_min: settings.leadTimeMin,
      morning_briefing_enabled: settings.morningBriefingEnabled,
      weekly_review_enabled: settings.weeklyReviewEnabled,
    },
    { onConflict: 'user_id' },
  );
}
```

(The upsert simply stops writing `email_enabled`/`digest_time`; the columns keep
their existing values — harmless, unread.)

- [ ] **Step 5: Settings page**

In `src/app/app/settings/page.tsx`:

(a) DELETE the `emailEnabled` and `digestTime` `useState` lines; ADD:

```ts
  const [weeklyReviewEnabled, setWeeklyReviewEnabled] = useState(notificationSettings.weeklyReviewEnabled);
```

(b) in the rehydration `useEffect`, DELETE the `setEmailEnabled`/`setDigestTime`
lines; ADD:

```ts
    setWeeklyReviewEnabled(notificationSettings.weeklyReviewEnabled);
```

(c) `saveNotifications()` — both persistence calls become:

```ts
      updateNotificationSettings({ pushEnabled, leadTimeMin: parseInt(leadTime), morningBriefingEnabled, weeklyReviewEnabled });
```

```ts
    saveNotificationSettingsToSupabase({
      pushEnabled,
      leadTimeMin: parseInt(leadTime),
      morningBriefingEnabled,
      weeklyReviewEnabled,
    }).catch(err => console.error('[settings] notification_settings sync failed', err));
```

(d) in the `🔔 Notifications` Section JSX: DELETE the
`<Toggle label="Email digest" ... />` line AND the whole
`{emailEnabled && ( ... Daily digest time ... )}` block; in their place (after the
«Утренний брифинг» toggle) ADD:

```tsx
          <Toggle label="Недельный AI-разбор" sub="Пуш в понедельник утром, когда готов разбор недели" checked={weeklyReviewEnabled} onChange={setWeeklyReviewEnabled} />
```

- [ ] **Step 6: Sweep for leftovers + verify**

```bash
rg -n "emailEnabled|digestTime" src/ || echo CLEAN
npx tsc --noEmit && npm run build
```

Expected: `CLEAN` (tsc is the backstop — it will flag any missed consumer; fix by
deleting the dead usage, never by re-adding the fields).

- [ ] **Step 7: Commit**

```bash
git add src/types/index.ts src/lib/store/store.ts src/lib/supabase/cloudStore.ts src/lib/supabase/importStore.ts src/lib/push/subscription.ts src/app/app/settings/page.tsx
git commit -m "feat: weekly-review toggle replaces dead email-digest settings block"
```

---

### Task 10: E2E — stored review renders; settings block replaced

**Files:**
- Create: `tests/e2e/weeklyReview.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import { expect, test, type Page } from '@playwright/test';

const e2eEmail = process.env.E2E_EMAIL;
const e2ePassword = process.env.E2E_PASSWORD;
const hasAuthCreds = Boolean(e2eEmail && e2ePassword);

test.skip(!hasAuthCreds, 'E2E credentials not configured');

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(e2eEmail!);
  await page.getByLabel('Password').fill(e2ePassword!);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/(app|onboarding)(\/|$)/, { timeout: 30_000 });
}

const REVIEW_STUB = {
  reviews: [
    {
      id: '9df9f6a2-0000-4000-8000-000000000001',
      weekStart: '2026-07-06',
      model: 'mock-weekly-review',
      createdAt: '2026-07-13T06:00:00.000Z',
      payload: {
        schemaVersion: 'weekly-review-v1',
        highlights: ['Белок в среднем 92 г/день', 'Адхиренс 86%', 'HRV +6 мс к прошлой неделе'],
        eatingPatterns: [{ title: 'Поздние ужины', detail: '3 дня приём пищи после 21:00.' }],
        stackAdherence: { summary: 'Принято 36 из 42 доз (86%). Слабый день — суббота.' },
        ouraLinkage: ['Средний сон вырос на 4 балла на фоне более коротких пищевых окон.'],
        actions: [
          { title: 'Ужин до 21:00', detail: 'В будни закрывать пищевое окно до 21:00.' },
          { title: 'Вода в выходные', detail: 'Держать не меньше 1.5 л в сб и вс.' },
        ],
      },
    },
  ],
};

test('stored weekly review renders section-by-section on Progress', async ({ page }) => {
  await page.route('**/api/insights/weekly-review', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(REVIEW_STUB) }),
  );
  await login(page);
  await page.goto('/app/progress');

  const section = page.getByTestId('weekly-review-section');
  await expect(section).toBeVisible({ timeout: 15_000 });
  await expect(section).toContainText('Недельный разбор');
  await expect(section).toContainText('Белок в среднем 92 г/день');
  await expect(section).toContainText('Поздние ужины');
  await expect(section).toContainText('Принято 36 из 42 доз (86%)');
  await expect(section).toContainText('Ужин до 21:00');
  await expect(section).toContainText('Это не медицинская рекомендация');
});

test('settings: weekly-review toggle replaced the email-digest block', async ({ page }) => {
  await login(page);
  await page.goto('/app/settings');
  await expect(page.getByText('Недельный AI-разбор')).toBeVisible();
  await expect(page.getByText('Email digest')).toHaveCount(0);
  await expect(page.getByText('Daily digest time')).toHaveCount(0);
});
```

- [ ] **Step 2: Run**

Run: `npm run test:e2e -- weeklyReview.spec.ts`
Expected: 2 passed (or skipped without creds — run locally with
`E2E_EMAIL`/`E2E_PASSWORD` before the PR and paste output into the PR body).

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/weeklyReview.spec.ts
git commit -m "test: e2e weekly-review render + settings block replacement"
```

---

### Task 11: Full verification, PR, owner hand-off

- [ ] **Step 1: Full local gate**

Run: `npx tsc --noEmit && npm run test:unit && npm run test:correlation && npm run build`
Expected: all pass (`test:correlation` now includes weekRange, aggregate, schema,
models test files).

- [ ] **Step 2: Hygiene sweeps**

```bash
git diff origin/main --name-only | xargs grep -n "console\.log" || true
rg -n "emailEnabled|digestTime" src/ || echo CLEAN
```

Expected: no `console.log`; `CLEAN`.

- [ ] **Step 3: Push + PR — then STOP**

```bash
git push -u origin codex/w4b-weekly-review
gh pr create --base main --title "feat: W4-B AI weekly review — Monday synthesis push + Progress section (B2)" --body "Implements docs/superpowers/plans/2026-07-18-weekly-review.md.

- Migration 027: weekly_reviews (unique user_id+week_start, owner-read RLS) + notification_settings.weekly_review_enabled. NOT applied — owner applies.
- Cron route /api/cron/weekly-review: CRON_SECRET, Sentry monitor cron-weekly-review ('0 6 * * 1', UTC), idempotent upsert (double-fire → already-generated), skip <3 logged days, opt-in gates generation (LLM cost)
- src/lib/weeklyReview/*: pure aggregator (aggregates only, ~2–3k-token cap, NO check-in data — B4 dropped), strict json_schema + validator, RU prompt, provider with model-fallback + validation-reject retry + mock mode
- Push «Ваш недельный разбор готов» → /app/progress; notification_log dedupe keyed by the review row uuid; quiet-hours respected
- Progress page: Недельный разбор section (latest + archive, per-section render, non-medical disclaimer)
- Settings: dead email-digest toggle + digest-time REMOVED (owner decision 1), «Недельный AI-разбор» toggle added (default off); emailEnabled/digestTime code paths deleted (DB columns retained)

Test evidence: <paste tsc/test:unit/test:correlation/build/E2E + double-fire curl output>

Owner post-merge steps (NOT done by this PR): apply migration 027; set WEEKLY_REVIEW_AI_PROVIDER=openrouter (+ optional OPENROUTER_WEEKLY_REVIEW_MODEL / OPENROUTER_WEEKLY_REVIEW_FALLBACK_MODEL) in Vercel env; create cron-job.org job GET /api/cron/weekly-review Mon 06:00 UTC with Authorization: Bearer CRON_SECRET."
```

STOP. Do not merge (production deploy on merge — owner-only). Do not apply
migration 027. Do not create the cron-job.org job. Report PR URL, verification
output, and any deviations with reasons.
