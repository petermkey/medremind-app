# W4-A Smart Food-Timed Reminders — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or
> superpowers:subagent-driven-development when orchestrated) to implement this plan
> task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Read
> `docs/superpowers/plans/2026-07-18-feature-wave-master.md` FIRST — Global Constraints,
> migration ledger, file-ownership matrix and wave sequencing bind this plan.
> **Wave assumption (W4-A runs after Wave 3 merges):** W1-B's
> `src/lib/nutrition/eatingWindow.ts` and W3-B's Settings briefing toggle +
> migration 029 are already on `main`. Verify both exist before starting (Task 0 step).

**Goal:** make dose push reminders food-aware using data that already exists.
(1) `withFood='no'` (empty-stomach) items whose scheduled time falls INSIDE the user's
typical eating window (median first→last meal from the last 14 days of `food_entries`)
get their push nudged into the fasting window (≥30 min before the median first meal).
(2) `withFood='yes'` items scheduled far (>60 min) from any typical meal time get their
push aligned toward the nearest typical meal. **v1 scope decision: REMINDER-TIME
ADJUSTMENT ONLY** — `planned_occurrences` rows are never touched; only the push moment
shifts, capped at ±90 min, never landing inside quiet hours; the push body carries an
explanatory line («⏱ сдвинуто…»).

**Architecture:** a pure clock-free module `src/lib/push/foodTiming.ts`
(`computeAdjustedReminderTime(...)`, `deriveEatingPattern(...)`, fire-window helpers —
registered in `test:unit`, the `daySchedule.ts` precedent) consumed in TWO places with
the SAME math: (a) the notify cron route's Pass A — the occurrence query window is
widened by the ±90 min cap, then each candidate's *effective* (adjusted-or-original)
time is checked against the true ±1 min fire window in TS; (b) the Schedule page —
derives today's adjustments client-side from the food store and passes a
«⏱ … · смещено» hint to `MedCard`. **Nothing is persisted**: no adjusted-time table, no
occurrence mutation — deriving client-side with the same pure function guarantees the
hint matches the push logic by construction, at zero storage/sync cost (justification
recorded in Task 5). Eating-pattern derivation is a pure aggregation: per-day
`computeEatingWindow` outputs (**produced by W1-B**) → overall medians (v1 keeps it
simple — no weekday/weekend split). The default-off toggle «Умный тайминг напоминаний»
lives in Settings → Notifications, mirrored to a new `notification_settings.smart_food_timing`
column (migration 030 — justified below; 028 stays conditionally reserved for W3-A per
the ledger and 029 was taken by W3-B).

**Safety rails (hard):** never adjust snooze-replacement occurrences
(`supersedes_occurrence_id IS NOT NULL` server-side / `predecessorDoseId` client-side —
a snoozed time is the user's explicit choice); never shift more than ±90 min; never
shift into the quiet-hours window; feature entirely inert when the user has <7 days of
food data or the toggle is off; Pass B reminders and `notification_log` dedupe are
untouched (reminders re-fire relative to the log row regardless of the shift).

**Tech Stack:** Next.js 15 App Router, TypeScript strict, Supabase service-role reads in
the CRON_SECRET-gated `/api/cron/notify` route (cron-job.org job #7402449, every
minute), Zustand + `foodStore`, standalone `test:unit` harness, Playwright E2E.

## Spec

### Requirements

1. **Migration 030 (P0).** `notification_settings.smart_food_timing boolean not null
   default false`. Justification (master rule "no migrations unless justified"): the
   cron route can only see server-side state, `notification_settings` has fixed columns
   and NO extensible jsonb (`supabase/001_initial.sql:22-29`), and the master constraint
   "new push behaviors are user-toggleable, default off" therefore requires a column.
   Ledger updated in this PR (next free number after W3-B's 029; 028 remains W3-A's
   conditional reservation — W3-A shipped on-demand without it, but this plan does not
   repurpose a number another plan's ledger row reserves).
2. **Pure module (P0).** `src/lib/push/foodTiming.ts` — leaf module (zero imports),
   clock-free, registered in `test:unit`. Exports `deriveEatingPattern`,
   `computeAdjustedReminderTime` (returns adjusted minutes-since-local-midnight or
   `null` = no adjustment), `resolveSmartTimingActive`, quiet-window and fire-window
   helpers, and the caps as named constants.
3. **Notify route integration (P0).** Pass A only: per user with the setting on, load
   14 d of `food_entries`, build the eating pattern via `computeEatingWindow`
   (**produced by W1-B** — interface below), widen the occurrence query by the cap,
   compute each candidate's effective time, fire only when it enters the true ±1 min
   window; adjusted pushes show the shifted time in the title and append the Russian
   explanatory line. The `smart_food_timing` read is a separate guarded query so the
   route stays fully functional if 030 is not applied yet (error → feature inert).
4. **Settings toggle (P0).** «Умный тайминг напоминаний», default off, in Settings →
   Notifications (after W3-B's «Утренний брифинг» toggle), flowing through
   `NotificationSettings` → store defaults → `saveNotificationSettingsToSupabase` →
   `cloudStore`/`importStore` mappings — exactly the W3-B `morningBriefingEnabled`
   pattern.
5. **MedCard transparency (P1).** When today's reminder for a pending dose was
   adjusted, `MedCard` shows a small «⏱ HH:MM · смещено» tag. Derived client-side with
   the same pure function (no persistence — see Architecture).
6. **Tests.** Unit: adjustment math across window/no-window/cap/quiet-collision/snooze/
   inert cases + the setting-gate function + fire-window filter (Task 2). One E2E:
   settings toggle round-trip + hint rendering with seeded food data (Task 6).

### Consumed cross-feature interface (produced by W1-B — authoritative per `docs/superpowers/plans/2026-07-18-eating-window.md`)

```ts
// src/lib/nutrition/eatingWindow.ts  (W1-B; merged in Wave 1 — read-only here)
export type EatingWindowEntry = { consumedAt: string; timezone?: string };
export type EatingWindowResult = {
  firstMeal: string | null;      // 'HH:MM' local
  lastMeal: string | null;       // 'HH:MM' local
  firstMealHour: number | null;
  lastMealHour: number | null;
  windowHours: number | null;
  lateFlag: boolean;
  mealCount: number;
};
export function computeEatingWindow(entries: EatingWindowEntry[], date: string, timezone: string): EatingWindowResult;
```

This plan consumes ONLY `firstMeal`/`lastMeal`. Task 0 verifies the merged file matches.

### Acceptance criteria

- `npx tsc --noEmit && npm run build && npm run test:unit` all pass
  (`test:correlation` untouched — must not regress).
- Toggle off (default) or <7 days of food data → notify route behavior is byte-identical
  to today (same query width, same times, no note in the body).
- With the toggle on, ≥7 days of food data with median first meal 09:00, an
  empty-stomach dose at 09:45 fires at 08:30 with «⏱ сдвинуто…» in the body; a
  snooze-replacement occurrence at the same time fires unshifted.
- Schedule page shows the «смещено» tag for the same dose; `planned_occurrences` rows
  and store `scheduledDoses` are unchanged (adjustment is presentation + push only).
- Migration ledger in the master plan contains row 030.

### Non-goals

- No `planned_occurrences` mutation, no schedule rewriting, no new tables beyond the
  one settings column.
- No weekday/weekend or per-meal-slot pattern splitting (v1 = overall medians).
- No Pass B changes; no changes to `scheduleWindow.ts` (consumed as-is).
- No adjustment of in-app dose times anywhere — only the push moment and the hint.

## Global Constraints

- Branch: `codex/w4a-smart-food-reminders` off fresh `origin/main` AFTER Wave 3 merges
  (`bash scripts/git-state-check.sh` first). W4-B starts only after this merges
  (Wave 4 is sequential on the Settings surface). PR at the end, then STOP.
- TypeScript strict; no new `any`; no `console.log`; conventional commits;
  `npx tsc --noEmit` after every `.ts/.tsx` change.
- Migration file is idempotent SQL; **applied to production by the owner only, before
  merge** (same ordering W3-B used for 029 — the client settings upsert writes the new
  column, so 030 must be live before the deploy that writes it).
- The cron route must remain fail-safe: any smart-timing data problem degrades to
  the existing behavior, never blocks dose reminders.

## File Structure

- Create: `supabase/030_notification_settings_smart_food_timing.sql`
- Modify: `docs/superpowers/plans/2026-07-18-feature-wave-master.md` (ledger row 030)
- Create: `src/lib/push/foodTiming.ts` + `tests/unit/foodTiming.test.ts`
- Modify: `package.json` (`test:unit` registration)
- Modify: `src/types/index.ts` (`NotificationSettings.smartFoodTiming`)
- Modify: `src/lib/store/store.ts` (3 settings literals)
- Modify: `src/lib/supabase/cloudStore.ts`, `src/lib/supabase/importStore.ts` (mappings)
- Modify: `src/lib/push/subscription.ts` (`saveNotificationSettingsToSupabase`)
- Modify: `src/app/app/settings/page.tsx` (toggle + a11y attrs on `Toggle`)
- Modify: `src/app/api/cron/notify/route.ts` (Pass A)
- Modify: `src/components/app/MedCard.tsx` (hint prop)
- Modify: `src/app/app/page.tsx` (client-side derivation)
- Modify: `src/components/app/E2ETestHelpers.tsx` (expose food store)
- Create: `tests/e2e/smartReminders.spec.ts`

---

### Task 0: Preflight

- [ ] **Step 1:** `bash scripts/git-state-check.sh` → branch `codex/w4a-smart-food-reminders`
  off fresh `origin/main`.
- [ ] **Step 2:** Verify wave prerequisites on `main`:

Run: `ls supabase/ | tail -5 && grep -n "export function computeEatingWindow" src/lib/nutrition/eatingWindow.ts && grep -n "morningBriefingEnabled" src/types/index.ts`
Expected: `029_notification_settings_morning_briefing.sql` present; `computeEatingWindow`
exported with the W1-B signature above (`firstMeal`/`lastMeal` fields); `NotificationSettings`
already has `morningBriefingEnabled`. If `computeEatingWindow`'s result field names drifted
from the interface block above, adapt ONLY the two call sites in Tasks 4/5 and record the
drift in the PR body. If 030 is unexpectedly taken, use the next free number everywhere
below and in the ledger.

---

### Task 1: Migration 030 + ledger update

**Files:**
- Create: `supabase/030_notification_settings_smart_food_timing.sql`
- Modify: `docs/superpowers/plans/2026-07-18-feature-wave-master.md`

**Interfaces:**
- Produces: column `notification_settings.smart_food_timing boolean not null default false`
  — consumed by Tasks 3 (client save/pull) and 4 (cron gate).
- Ledger discipline: 026 (W2-C), 027 (W4-B), 028 (conditionally reserved W3-A — shipped
  unused), 029 (W3-B) → this plan takes **030**.

- [ ] **Step 1: Write the migration (idempotent, `022_oura_tags.sql` style)**

```sql
-- 030: W4-A Smart Food-Timed Reminders — per-user opt-in for food-aware
-- reminder-time adjustment. notification_settings has fixed columns and no
-- extensible jsonb (001), and the cron route needs server-visible state, so
-- the default-off toggle (master constraint: new push behaviors default off)
-- takes a dedicated column. Reminder times only — planned_occurrences untouched.
alter table notification_settings
  add column if not exists smart_food_timing boolean not null default false;

comment on column notification_settings.smart_food_timing is
  'W4-A: opt-in for food-aware push-time adjustment (±90 min, quiet-hours safe).';
```

- [ ] **Step 2: Update the master-plan Migration Ledger**

In `docs/superpowers/plans/2026-07-18-feature-wave-master.md`, append to the ledger table
(after the 028 row; keep the 029 row W3-B added):

```markdown
| 030 | `supabase/030_notification_settings_smart_food_timing.sql` | W4-A Smart Reminders | W4-A agent | owner/orchestrator |
```

- [ ] **Step 3: Commit**

```bash
git add supabase/030_notification_settings_smart_food_timing.sql docs/superpowers/plans/2026-07-18-feature-wave-master.md
git commit -m "feat: migration 030 — smart_food_timing settings column (+ ledger)"
```

*(Applying 030 to production is an owner/orchestrator step via the Supabase Management
API — `docs/agent-handoff-current-main.md` §0b, project `hagypgvfkjkncznoctoq` — BEFORE
merging this PR. The implementing agent never applies migrations.)*

---

### Task 2: Pure module `foodTiming.ts` (TDD)

**Files:**
- Create: `src/lib/push/foodTiming.ts`
- Create: `tests/unit/foodTiming.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces (consumed by Task 4 route and Task 5 client):
  - `EatingPattern = { daysWithData: number; medianFirstMealMinutes: number | null; medianLastMealMinutes: number | null }`
  - `deriveEatingPattern(days: { firstMeal: string | null; lastMeal: string | null }[]): EatingPattern`
    — input days are per-day `computeEatingWindow` outputs (**produced by W1-B**).
  - `computeAdjustedReminderTime(input): number | null` — pure; `null` = leave the
    reminder at the scheduled time.
  - `resolveSmartTimingActive(settingValue: unknown, pattern: EatingPattern | null): boolean`
    — the setting gate (also the unapplied-migration guard: non-`true` → inert).
  - `firesInSegments(occurrenceDate, effectiveMinutes, segments)` — minute-granular
    match against `computeWindowSegments` output (same semantics as the SQL filter).
  - `minutesFromHHMM`, `hhmmFromMinutes`, `SMART_SHIFT_CAP_MINUTES = 90`,
    `MIN_FOOD_DAYS = 7`, `FASTING_LEAD_MINUTES = 30`, `MEAL_ALIGN_THRESHOLD_MINUTES = 60`.
- Leaf module: zero imports (quiet-window offsets are re-validated locally in the same
  `{start_offset, end_offset}` shape `quietHours.ts` uses — seconds relative to local
  midnight, negative = evening before).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/foodTiming.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MIN_FOOD_DAYS,
  SMART_SHIFT_CAP_MINUTES,
  computeAdjustedReminderTime,
  deriveEatingPattern,
  firesInSegments,
  hhmmFromMinutes,
  minutesFromHHMM,
  resolveSmartTimingActive,
  type EatingPattern,
} from '../../src/lib/push/foodTiming';

const PATTERN: EatingPattern = { daysWithData: 10, medianFirstMealMinutes: 540, medianLastMealMinutes: 1200 }; // 09:00–20:00

function adjust(overrides: Partial<Parameters<typeof computeAdjustedReminderTime>[0]>) {
  return computeAdjustedReminderTime({
    occurrenceMinutes: 585, withFood: 'no', pattern: PATTERN,
    isSnoozeReplacement: false, quietWindow: null, ...overrides,
  });
}

test('constants match the spec caps', () => {
  assert.equal(SMART_SHIFT_CAP_MINUTES, 90);
  assert.equal(MIN_FOOD_DAYS, 7);
});

test('deriveEatingPattern: medians over days, skipping empty days', () => {
  const days = [
    { firstMeal: '09:00', lastMeal: '20:00' },
    { firstMeal: '08:30', lastMeal: '19:00' },
    { firstMeal: null, lastMeal: null },
    { firstMeal: '09:30', lastMeal: '21:00' },
  ];
  const pattern = deriveEatingPattern(days);
  assert.equal(pattern.daysWithData, 3);
  assert.equal(pattern.medianFirstMealMinutes, 540);  // 09:00
  assert.equal(pattern.medianLastMealMinutes, 1200);  // 20:00
});

test('deriveEatingPattern: even count averages the middle pair', () => {
  const pattern = deriveEatingPattern([
    { firstMeal: '08:00', lastMeal: '19:00' },
    { firstMeal: '10:00', lastMeal: '21:00' },
  ]);
  assert.equal(pattern.medianFirstMealMinutes, 540);
  assert.equal(pattern.medianLastMealMinutes, 1200);
});

test('empty-stomach dose inside the eating window shifts to 30min before first meal', () => {
  // 09:45 inside [09:00, 20:00] → target 08:30 (510), delta -75 within cap
  assert.equal(adjust({ occurrenceMinutes: 585 }), 510);
});

test('empty-stomach dose already in the fasting window → no adjustment', () => {
  assert.equal(adjust({ occurrenceMinutes: 500 }), null);  // 08:20 < first meal
  assert.equal(adjust({ occurrenceMinutes: 1260 }), null); // 21:00 > last meal
});

test('cap: if ±90min cannot escape the eating window, do not adjust', () => {
  // 13:00 → target 08:30 needs -270; clamped -90 lands at 11:30, still inside → null
  assert.equal(adjust({ occurrenceMinutes: 780 }), null);
});

test('with-food dose far from any typical meal aligns toward the nearest meal, capped', () => {
  // 11:00, nearest meal 09:00 (dist 120 > 60) → shift by cap −90 → 09:30 (570)
  assert.equal(adjust({ occurrenceMinutes: 660, withFood: 'yes' }), 570);
});

test('with-food dose near a typical meal → no adjustment', () => {
  assert.equal(adjust({ occurrenceMinutes: 570, withFood: 'yes' }), null); // 30min from 09:00
});

test("withFood 'any'/null/unknown → never adjusted", () => {
  assert.equal(adjust({ withFood: 'any' }), null);
  assert.equal(adjust({ withFood: null }), null);
  assert.equal(adjust({ withFood: 'sometimes' }), null);
});

test('quiet-hours collision rejects the adjustment', () => {
  // pattern first meal 07:00; dose 07:30 → target 06:30 (390 min = 23400s),
  // quiet window 22:00→07:00 = [-7200, 25200] contains it → null
  const early: EatingPattern = { daysWithData: 10, medianFirstMealMinutes: 420, medianLastMealMinutes: 1200 };
  const result = computeAdjustedReminderTime({
    occurrenceMinutes: 450, withFood: 'no', pattern: early,
    isSnoozeReplacement: false, quietWindow: { start_offset: -7200, end_offset: 25200 },
  });
  assert.equal(result, null);
});

test('snooze replacements are never adjusted', () => {
  assert.equal(adjust({ isSnoozeReplacement: true }), null);
});

test('inert under 7 days of food data', () => {
  const thin: EatingPattern = { ...PATTERN, daysWithData: 6 };
  assert.equal(adjust({ pattern: thin }), null);
});

test('degenerate patterns are inert', () => {
  assert.equal(adjust({ pattern: { daysWithData: 10, medianFirstMealMinutes: null, medianLastMealMinutes: 1200 } }), null);
  assert.equal(adjust({ pattern: { daysWithData: 10, medianFirstMealMinutes: 600, medianLastMealMinutes: 600 } }), null);
});

test('resolveSmartTimingActive: strict-true setting AND enough data', () => {
  assert.equal(resolveSmartTimingActive(true, PATTERN), true);
  assert.equal(resolveSmartTimingActive(true, { ...PATTERN, daysWithData: 6 }), false);
  assert.equal(resolveSmartTimingActive(true, null), false);
  assert.equal(resolveSmartTimingActive(false, PATTERN), false);
  assert.equal(resolveSmartTimingActive(undefined, PATTERN), false); // 030 not applied → inert
});

test('firesInSegments: minute-granular inclusive match on the right date', () => {
  const segments = [{ date: '2026-07-18', startTime: '08:29:00', endTime: '08:31:59' }];
  assert.equal(firesInSegments('2026-07-18', 510, segments), true);   // 08:30
  assert.equal(firesInSegments('2026-07-18', 512, segments), false);  // 08:32
  assert.equal(firesInSegments('2026-07-17', 510, segments), false);  // wrong date
});

test('hhmm round-trip', () => {
  assert.equal(minutesFromHHMM('08:30'), 510);
  assert.equal(minutesFromHHMM('08:30:15'), 510);
  assert.equal(minutesFromHHMM('25:00'), null);
  assert.equal(minutesFromHHMM(undefined), null);
  assert.equal(hhmmFromMinutes(510), '08:30');
});
```

- [ ] **Step 2: Register in `test:unit`, run to verify FAIL**

In `package.json` `test:unit`: add ` tests/unit/foodTiming.test.ts` after
`tests/unit/stackGuardEngine.test.ts` (or after `tests/unit/streak.test.ts` if W3-A's
entries are absent), add ` src/lib/push/foodTiming.ts` after `src/lib/push/scheduleWindow.ts`,
and append ` && node .tmp/unit/tests/unit/foodTiming.test.js` to the run chain.

Run: `npm run test:unit`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/push/foodTiming.ts
// W4-A Smart Food-Timed Reminders — pure math. Clock-free, zero imports
// (daySchedule.ts precedent), registered in test:unit. Consumed by BOTH the
// notify cron (server) and the Schedule page hint (client) so push and UI
// agree by construction. Adjusts the PUSH MOMENT only — planned_occurrences
// and store schedules are never modified.

export const SMART_SHIFT_CAP_MINUTES = 90;
export const MIN_FOOD_DAYS = 7;
export const FASTING_LEAD_MINUTES = 30;
export const MEAL_ALIGN_THRESHOLD_MINUTES = 60;

export type EatingPattern = {
  daysWithData: number;
  medianFirstMealMinutes: number | null; // minutes since local midnight
  medianLastMealMinutes: number | null;
};

export type DayMealTimes = { firstMeal: string | null; lastMeal: string | null };

export function minutesFromHHMM(time: unknown): number | null {
  if (typeof time !== 'string') return null;
  const match = /^(\d{1,2}):(\d{2})/.exec(time.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export function hhmmFromMinutes(minutes: number): string {
  const clamped = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

// days = per-day computeEatingWindow outputs (src/lib/nutrition/eatingWindow.ts, W1-B).
export function deriveEatingPattern(days: DayMealTimes[]): EatingPattern {
  const firsts: number[] = [];
  const lasts: number[] = [];
  for (const day of days) {
    const first = minutesFromHHMM(day.firstMeal);
    const last = minutesFromHHMM(day.lastMeal);
    if (first === null || last === null) continue;
    firsts.push(first);
    lasts.push(last);
  }
  return {
    daysWithData: firsts.length,
    medianFirstMealMinutes: median(firsts),
    medianLastMealMinutes: median(lasts),
  };
}

// Setting gate. settingValue comes straight from the DB row — anything that is
// not literally `true` (including undefined when migration 030 is not applied
// yet) leaves the feature inert.
export function resolveSmartTimingActive(settingValue: unknown, pattern: EatingPattern | null): boolean {
  return settingValue === true && pattern !== null && pattern.daysWithData >= MIN_FOOD_DAYS;
}

// Quiet window shape = external_health_connections.sleep_window.optimal_bedtime
// (seconds relative to local midnight, negative = evening before) — the same
// contract quietHours.ts validates. Re-validated locally to stay a leaf module.
export type QuietWindowOffsets = { start_offset: number; end_offset: number };

export function sanitizeQuietWindow(value: unknown): QuietWindowOffsets | null {
  if (!value || typeof value !== 'object') return null;
  const { start_offset, end_offset } = value as { start_offset?: unknown; end_offset?: unknown };
  if (typeof start_offset !== 'number' || typeof end_offset !== 'number') return null;
  if (!Number.isFinite(start_offset) || !Number.isFinite(end_offset)) return null;
  const length = end_offset - start_offset;
  if (length <= 0 || length > 12 * 3600) return null;
  return { start_offset, end_offset };
}

export function minutesInQuietWindow(minutes: number, window: QuietWindowOffsets | null): boolean {
  if (!window) return false;
  const t = minutes * 60;
  const day = 86400;
  return (
    (t >= window.start_offset && t <= window.end_offset) ||
    (t - day >= window.start_offset && t - day <= window.end_offset)
  );
}

export type AdjustReminderInput = {
  occurrenceMinutes: number;        // scheduled HH:MM as minutes since midnight
  withFood: unknown;                // protocol_items.with_food ('yes'|'no'|'any'|null)
  pattern: EatingPattern;
  isSnoozeReplacement: boolean;     // snoozed times are the user's explicit choice
  quietWindow: unknown;             // raw optimal_bedtime value (or null)
  capMinutes?: number;
  minDaysOfData?: number;
  fastingLeadMinutes?: number;
  mealAlignThresholdMinutes?: number;
};

// Returns the adjusted reminder time (minutes since local midnight, same day)
// or null = keep the scheduled time. Never crosses the quiet window, never
// shifts more than the cap, inert on thin data.
export function computeAdjustedReminderTime(input: AdjustReminderInput): number | null {
  const cap = input.capMinutes ?? SMART_SHIFT_CAP_MINUTES;
  const minDays = input.minDaysOfData ?? MIN_FOOD_DAYS;
  const lead = input.fastingLeadMinutes ?? FASTING_LEAD_MINUTES;
  const threshold = input.mealAlignThresholdMinutes ?? MEAL_ALIGN_THRESHOLD_MINUTES;

  if (input.isSnoozeReplacement) return null;
  if (input.pattern.daysWithData < minDays) return null;
  const first = input.pattern.medianFirstMealMinutes;
  const last = input.pattern.medianLastMealMinutes;
  if (first === null || last === null || last <= first) return null;

  const t = input.occurrenceMinutes;
  if (!Number.isFinite(t) || t < 0 || t > 1439) return null;

  let target: number;
  if (input.withFood === 'no') {
    // Empty stomach: act only when the scheduled time sits inside the typical
    // eating window; aim ≥30 min before the median first meal.
    if (t < first || t > last) return null;
    target = first - lead;
  } else if (input.withFood === 'yes') {
    const nearestMeal = Math.abs(t - first) <= Math.abs(t - last) ? first : last;
    if (Math.abs(t - nearestMeal) <= threshold) return null;
    target = nearestMeal;
  } else {
    return null;
  }

  const delta = Math.max(-cap, Math.min(cap, target - t));
  const adjusted = t + delta;
  if (adjusted === t || adjusted < 0 || adjusted > 1439) return null;
  if (input.withFood === 'no' && adjusted >= first && adjusted <= last) return null; // cap could not escape the window
  if (minutesInQuietWindow(adjusted, sanitizeQuietWindow(input.quietWindow))) return null;
  return adjusted;
}

// Minute-granular re-check of a candidate's EFFECTIVE time against the true
// ±1 min fire window (computeWindowSegments output shape) — mirrors the SQL
// filter semantics of cron/notify Pass A.
export type FireSegment = { date: string; startTime: string; endTime: string };

export function firesInSegments(occurrenceDate: string, effectiveMinutes: number, segments: FireSegment[]): boolean {
  return segments.some((segment) => {
    if (segment.date !== occurrenceDate) return false;
    const start = minutesFromHHMM(segment.startTime);
    const end = minutesFromHHMM(segment.endTime);
    if (start === null || end === null) return false;
    return effectiveMinutes >= start && effectiveMinutes <= end;
  });
}
```

- [ ] **Step 4: Run to verify PASS**

Run: `npm run test:unit && npx tsc --noEmit`
Expected: 16 new tests PASS; tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/push/foodTiming.ts tests/unit/foodTiming.test.ts package.json
git commit -m "feat: pure food-timing module (eating pattern medians, capped reminder adjustment)"
```

---

### Task 3: Settings plumbing — type, store, save/pull, toggle

**Files:**
- Modify: `src/types/index.ts`, `src/lib/store/store.ts`, `src/lib/supabase/cloudStore.ts`,
  `src/lib/supabase/importStore.ts`, `src/lib/push/subscription.ts`,
  `src/app/app/settings/page.tsx`

**Interfaces:**
- Produces: `NotificationSettings.smartFoodTiming: boolean` end-to-end (store ↔
  `notification_settings.smart_food_timing`). Mirrors W3-B's `morningBriefingEnabled`
  plumbing exactly — every file below was already touched by W3-B, so each edit is
  "add one sibling line/field next to the briefing one".
- W4-B (next in this sequential wave) edits the same Settings section afterwards.

- [ ] **Step 1: Type**

In `src/types/index.ts`, inside `interface NotificationSettings` add after the
`morningBriefingEnabled` line:

```ts
  smartFoodTiming: boolean;  // W4-A food-aware reminder timing (default off)
```

- [ ] **Step 2: Store defaults (3 literals)**

In `src/lib/store/store.ts` there are THREE `notificationSettings` object literals
(initial state, `resetUserData`, `signOut`) — each already gained
`morningBriefingEnabled: false` from W3-B. Add to ALL THREE, after that line:

```ts
        smartFoodTiming: false,
```

- [ ] **Step 3: Cloud pull + import mappings**

In `src/lib/supabase/cloudStore.ts`: `defaultNotificationSettings()` gains
`smartFoodTiming: false,` and the notification-settings pull mapping gains (next to the
`morningBriefingEnabled: Boolean(nRow.morning_briefing_enabled),` line):

```ts
        smartFoodTiming: Boolean(nRow.smart_food_timing),
```

In `src/lib/supabase/importStore.ts`, the notification-settings upsert payload gains
(next to `morning_briefing_enabled`):

```ts
      smart_food_timing: Boolean(notifPatch.smartFoodTiming),
```

- [ ] **Step 4: Supabase save helper**

In `src/lib/push/subscription.ts` `saveNotificationSettingsToSupabase`: add
`smartFoodTiming: boolean;` to the `settings` parameter type and
`smart_food_timing: settings.smartFoodTiming,` to the upsert payload (next to the
`morning_briefing_enabled` line W3-B added).

- [ ] **Step 5: Settings page — state, rehydration, save, toggle, a11y**

In `src/app/app/settings/page.tsx`:

(a) after the `morningBriefingEnabled` state line add:

```ts
  const [smartFoodTiming, setSmartFoodTiming] = useState(notificationSettings.smartFoodTiming);
```

(b) in the rehydration `useEffect` (the one syncing from `notificationSettings`) add:

```ts
    setSmartFoodTiming(notificationSettings.smartFoodTiming);
```

(c) in `saveNotifications()`, add `smartFoodTiming` to BOTH calls — the
`updateNotificationSettings({...})` patch and the `saveNotificationSettingsToSupabase({...})`
payload (alongside `morningBriefingEnabled`).

(d) in the Notifications `<Section>`, directly after W3-B's
`<Toggle label="Утренний брифинг" ... />` line add:

```tsx
          <Toggle label="Умный тайминг напоминаний" sub="Сдвигает пуш-напоминание с учётом вашего обычного времени еды (не более ±90 мин)" checked={smartFoodTiming} onChange={setSmartFoodTiming} />
```

(e) a11y (needed by the E2E and correct regardless): in the local `Toggle` component at
the bottom of the file, add two attributes to its `<button>`:

```tsx
        aria-label={label}
        aria-pressed={checked}
```

- [ ] **Step 6: Verify + commit**

Run: `npx tsc --noEmit && npm run build`
Expected: clean.

```bash
git add src/types/index.ts src/lib/store/store.ts src/lib/supabase/cloudStore.ts src/lib/supabase/importStore.ts src/lib/push/subscription.ts src/app/app/settings/page.tsx
git commit -m "feat: default-off smart-food-timing toggle wired through settings/store/cloud"
```

---

### Task 4: Notify route — Pass A adjustment

**Files:**
- Modify: `src/app/api/cron/notify/route.ts`

**Interfaces:**
- Consumes: Task 2 module; `computeEatingWindow` (**produced by W1-B**);
  `computeWindowSegments` (existing, unchanged); `planned_occurrences.supersedes_occurrence_id`
  (existing column — non-null marks a snooze replacement); `notification_settings.smart_food_timing`
  (Task 1, guarded read).
- Produces: adjusted Pass A fire times + «⏱ сдвинуто…» body note. Pass B, quiet-hours
  handling, stale-claim recovery, and `notification_log` dedupe semantics unchanged.

- [ ] **Step 1: Imports**

After the existing imports add:

```ts
import { computeEatingWindow } from '@/lib/nutrition/eatingWindow';
import {
  SMART_SHIFT_CAP_MINUTES,
  computeAdjustedReminderTime,
  deriveEatingPattern,
  firesInSegments,
  hhmmFromMinutes,
  minutesFromHHMM,
  resolveSmartTimingActive,
  type EatingPattern,
} from '@/lib/push/foodTiming';
```

and change the supabase import line to also bring the client type:

```ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
```

- [ ] **Step 2: Eating-pattern loader (module-level helpers, above `GET`)**

```ts
// ── W4-A smart food timing ──────────────────────────────────────────────
// Eating pattern = medians over per-day computeEatingWindow outputs from the
// last 14 days of food_entries. Any failure returns null → feature inert for
// this user on this tick (reminders must never be blocked by food data).
const FOOD_LOOKBACK_DAYS = 14;

function localDateFor(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

async function loadEatingPattern(
  supabase: SupabaseClient,
  userId: string,
  tz: string,
  now: Date,
): Promise<EatingPattern | null> {
  try {
    const since = new Date(now.getTime() - FOOD_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const { data: rows, error } = await supabase
      .from('food_entries')
      .select('consumed_at, timezone')
      .eq('user_id', userId)
      .gte('consumed_at', since);
    if (error || !rows || rows.length === 0) return null;
    const entries = rows.map((row) => ({
      consumedAt: String(row.consumed_at),
      timezone: typeof row.timezone === 'string' ? row.timezone : tz,
    }));
    const dates = [...new Set(entries.map((entry) => localDateFor(entry.consumedAt, tz)))];
    const days = dates.map((date) => {
      const window = computeEatingWindow(entries, date, tz);
      return { firstMeal: window.firstMeal, lastMeal: window.lastMeal };
    });
    return deriveEatingPattern(days);
  } catch {
    return null;
  }
}
```

- [ ] **Step 3: Guarded setting read (survives an unapplied migration 030)**

Directly after the existing `if (!notifRows || notifRows.length === 0) { ... }` block,
add:

```ts
  // W4-A: separate guarded query so the route keeps working when migration 030
  // is not applied yet (undefined-column error → smart timing globally inert).
  const { data: smartRows, error: smartErr } = await supabase
    .from('notification_settings')
    .select('user_id')
    .eq('push_enabled', true)
    .eq('smart_food_timing', true);
  const smartUserIds = smartErr
    ? new Set<string>()
    : new Set((smartRows ?? []).map((row) => String(row.user_id)));
```

- [ ] **Step 4: Per-user pattern (inside the `notifRows.map` callback)**

After the `const quietNow = isInQuietHours(now, tz, optimalBedtime);` line add:

```ts
      // W4-A smart food timing — pattern only when the user opted in.
      const smartToggleOn = smartUserIds.has(userId);
      const eatingPattern = smartToggleOn ? await loadEatingPattern(supabase, userId, tz, now) : null;
      const smartActive = resolveSmartTimingActive(smartToggleOn, eatingPattern);
```

- [ ] **Step 5: Pass A — widened query + effective-time filter + note**

(a) Replace the segments line

```ts
        const segments = computeWindowSegments(now, leadTimeMin ?? 0, tz, WINDOW_MINUTES);
```

with:

```ts
        // Smart timing widens the DB query by the shift cap; each candidate is
        // then re-checked in TS against the true ±1 min window at its
        // EFFECTIVE (adjusted-or-original) time. With smart timing off the two
        // segment sets are identical and behavior is unchanged.
        const segments = computeWindowSegments(
          now, leadTimeMin ?? 0, tz, WINDOW_MINUTES + (smartActive ? SMART_SHIFT_CAP_MINUTES : 0),
        );
        const narrowSegments = smartActive
          ? computeWindowSegments(now, leadTimeMin ?? 0, tz, WINDOW_MINUTES)
          : segments;
```

(b) In the Pass A occurrences select, add `supersedes_occurrence_id,` on its own line
directly after `protocol_item_id,` (snooze replacements carry a non-null value there —
the store's snooze command creates the replacement occurrence with
`supersedes_occurrence_id` pointing at the origin row).

(c) Replace the items lookup

```ts
            const { data: items } = await supabase
              .from('protocol_items')
              .select('id, name')
              .in('id', itemIds);
            const itemNameMap = new Map((items ?? []).map(i => [i.id, i.name]));
```

with:

```ts
            const { data: items } = await supabase
              .from('protocol_items')
              .select('id, name, with_food')
              .in('id', itemIds);
            const itemNameMap = new Map((items ?? []).map(i => [i.id, i.name]));
            const itemWithFoodMap = new Map((items ?? []).map(i => [i.id, i.with_food]));
```

(d) Replace the whole `for (const occ of eligibleOccurrences) { ... }` loop body's HEAD —
i.e. replace:

```ts
            for (const occ of eligibleOccurrences) {
              const logKey = occ.id;
```

with:

```ts
            for (const occ of eligibleOccurrences) {
              const logKey = occ.id;

              // W4-A: effective fire time = adjusted (when smart timing applies)
              // or the scheduled time. Only occurrences whose effective time is
              // inside the true ±1 min window fire on this tick — everything
              // else in the widened query is a future/past candidate.
              const scheduledMinutes = minutesFromHHMM(String(occ.occurrence_time).slice(0, 5));
              if (scheduledMinutes === null) continue;
              let adjustedMinutes: number | null = null;
              if (smartActive && eatingPattern) {
                adjustedMinutes = computeAdjustedReminderTime({
                  occurrenceMinutes: scheduledMinutes,
                  withFood: itemWithFoodMap.get(occ.protocol_item_id) ?? null,
                  pattern: eatingPattern,
                  isSnoozeReplacement: occ.supersedes_occurrence_id !== null,
                  quietWindow: optimalBedtime,
                });
              }
              const effectiveMinutes = adjustedMinutes ?? scheduledMinutes;
              if (!firesInSegments(String(occ.occurrence_date), effectiveMinutes, narrowSegments)) {
                continue;
              }
```

(e) Replace the title/body assembly inside the same loop —

```ts
              const time = String(occ.occurrence_time).slice(0, 5);

              const title = `MedRemind — ${time}`;
              const body = `${itemName} (${protocolName})`;
```

with:

```ts
              const time = String(occ.occurrence_time).slice(0, 5);
              const displayTime = adjustedMinutes !== null ? hhmmFromMinutes(adjustedMinutes) : time;
              const smartNote = adjustedMinutes === null
                ? ''
                : itemWithFoodMap.get(occ.protocol_item_id) === 'no'
                  ? ' · ⏱ сдвинуто до вашего обычного первого приёма пищи'
                  : ' · ⏱ сдвинуто к вашему обычному приёму пищи';

              const title = `MedRemind — ${displayTime}`;
              const body = `${itemName} (${protocolName})${smartNote}`;
```

Pass B is deliberately untouched: reminders key off `notification_log.sent_at`
(interval since last send), so a shifted initial push simply re-reminds relative to the
shifted moment — no further changes needed.

- [ ] **Step 6: Verify + commit**

Run: `npx tsc --noEmit && npm run build && npm run test:unit`
Expected: all pass.

```bash
git add src/app/api/cron/notify/route.ts
git commit -m "feat: food-aware Pass A reminder-time adjustment in cron/notify (capped, quiet-safe, opt-in)"
```

---

### Task 5: MedCard hint + Schedule-page derivation

**Files:**
- Modify: `src/components/app/MedCard.tsx`
- Modify: `src/app/app/page.tsx`

**Interfaces:**
- Consumes: Task 2 module + `computeEatingWindow` (**produced by W1-B**) + `useFoodStore`
  entries + `PlannedOccurrence.predecessorDoseId` (client-side snooze-replacement marker,
  the mirror of the server's `supersedes_occurrence_id`).
- Produces: `MedCard` prop `smartAdjustedTime?: string | null`.
- **Recorded decision (cheapest surfacing):** the hint is DERIVED client-side with the
  same pure function instead of persisted — the schedule page already holds today's
  doses, `foodStore` already caches entries, and identical inputs through identical pure
  math means the hint can't drift from the push. Persisting adjusted times would need a
  table + sync + invalidation for a value that changes whenever the meal pattern does.
  Known v1 limitation (documented): the client passes `quietWindow: null` (Oura bedtime
  offsets aren't exposed client-side), so in the rare case the server rejected an
  adjustment purely for quiet-hours the hint may still show — acceptable for a
  presentation hint; noted in the PR body.

- [ ] **Step 1: MedCard prop + tag**

In `src/components/app/MedCard.tsx`:

(a) extend `Props`:

```ts
  smartAdjustedTime?: string | null; // W4-A: today's push was shifted to this HH:MM
```

(b) include it in the destructuring:

```ts
export function MedCard({ dose, onTake, onSkip, onSnooze, onDelete, actionsDisabled = false, takenAt, smartAdjustedTime }: Props) {
```

(c) in the tags block, after `if (item.itemType === 'analysis') tags.push('Lab test');`
add:

```ts
  if (smartAdjustedTime) tags.push(`⏱ ${fmt(smartAdjustedTime)} · смещено`);
```

- [ ] **Step 2: Schedule page derivation**

In `src/app/app/page.tsx`:

(a) add imports:

```ts
import { useFoodStore } from '@/lib/store/foodStore';
import { computeEatingWindow } from '@/lib/nutrition/eatingWindow';
import { computeAdjustedReminderTime, deriveEatingPattern, hhmmFromMinutes, minutesFromHHMM } from '@/lib/push/foodTiming';
```

(b) add `notificationSettings,` to the `useStore()` destructuring list.

(c) after the `const pausedProtocolActionMessage = 'Protocol is paused. Resume it to change this dose.';`
line (i.e. AFTER `todayStr`/`selectedDate`/`isHistoryDate` are initialized — the memo
below reads `todayStr`, so inserting earlier would hit the temporal dead zone) add:

```ts
  const { entries: foodEntries, loadEntriesForRange } = useFoodStore();
  const smartTimingOn = notificationSettings.smartFoodTiming;

  // W4-A: the hint needs 14d of food entries; load once when the toggle is on.
  useEffect(() => {
    if (!profile?.id || !smartTimingOn) return;
    const to = new Date();
    const from = new Date(to.getTime() - 14 * 24 * 60 * 60 * 1000);
    void loadEntriesForRange(profile.id, from.toISOString(), to.toISOString());
  }, [profile?.id, smartTimingOn, loadEntriesForRange]);

  const eatingPattern = useMemo(() => {
    if (!smartTimingOn) return null;
    const tz = profile?.timezone && profile.timezone.trim().length > 0
      ? profile.timezone
      : Intl.DateTimeFormat().resolvedOptions().timeZone;
    const days: { firstMeal: string | null; lastMeal: string | null }[] = [];
    for (let i = 1; i <= 14; i += 1) {
      const date = format(addDays(parseISO(todayStr), -i), 'yyyy-MM-dd');
      const window = computeEatingWindow(foodEntries, date, tz);
      days.push({ firstMeal: window.firstMeal, lastMeal: window.lastMeal });
    }
    return deriveEatingPattern(days);
  }, [smartTimingOn, foodEntries, profile?.timezone, todayStr]);

  // Same pure function as the cron route → hint and push agree by construction.
  function smartHintFor(dose: PlannedOccurrence): string | null {
    if (!eatingPattern || isHistoryDate || dose.status !== 'pending') return null;
    const minutes = minutesFromHHMM(dose.scheduledTime);
    if (minutes === null) return null;
    const adjusted = computeAdjustedReminderTime({
      occurrenceMinutes: minutes,
      withFood: dose.protocolItem.withFood ?? null,
      pattern: eatingPattern,
      isSnoozeReplacement: Boolean(dose.predecessorDoseId),
      quietWindow: null, // v1 limitation — see Task 5 Interfaces note
    });
    return adjusted === null ? null : hhmmFromMinutes(adjusted);
  }
```

(`useEffect` is already imported on line 2; `format`/`addDays`/`parseISO` on line 3.)

(d) in the `<MedCard` JSX call, add one prop after `takenAt={takenAtMap.get(dose.id)}`:

```tsx
                    smartAdjustedTime={smartHintFor(dose)}
```

- [ ] **Step 3: Verify + commit**

Run: `npx tsc --noEmit && npm run build`
Expected: clean.

```bash
git add src/components/app/MedCard.tsx src/app/app/page.tsx
git commit -m "feat: client-derived '⏱ смещено' hint on MedCard for smart-timed reminders"
```

---

### Task 6: E2E — toggle round-trip + hint with seeded food data

**Files:**
- Modify: `src/components/app/E2ETestHelpers.tsx`
- Create: `tests/e2e/smartReminders.spec.ts`

**Interfaces:**
- Adds `window.__medremindFoodStore` (dev/test-only exposure, mirroring the existing
  `__medremindStore`) so the spec can seed 8 days of food entries deterministically.

- [ ] **Step 1: Expose the food store to E2E**

In `src/components/app/E2ETestHelpers.tsx`, add the import:

```ts
import { useFoodStore } from '@/lib/store/foodStore';
```

and inside the existing `useEffect`, after the `__medremindStore` assignment add:

```ts
    (window as unknown as { __medremindFoodStore?: unknown }).__medremindFoodStore = useFoodStore;
```

- [ ] **Step 2: Write the spec**

```ts
// tests/e2e/smartReminders.spec.ts
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

async function cleanupSeed(page: Page) {
  try {
    await page.evaluate(() => {
      const med = (window as unknown as {
        __medremindStore?: { getState(): {
          protocols: { id: string; name: string; isTemplate?: boolean }[];
          deleteProtocol(id: string): unknown;
        } };
      }).__medremindStore;
      if (med) {
        const state = med.getState();
        state.protocols
          .filter(p => !p.isTemplate && /^SmartTest /.test(p.name))
          .forEach(p => { try { state.deleteProtocol(p.id); } catch { /* keep going */ } });
      }
      const food = (window as unknown as {
        __medremindFoodStore?: { getState(): {
          entries: { id: string; title: string }[];
          deleteFoodEntry(id: string): void;
        } };
      }).__medremindFoodStore;
      if (food) {
        const state = food.getState();
        state.entries
          .filter(entry => entry.title === 'SmartTest meal')
          .forEach(entry => { try { state.deleteFoodEntry(entry.id); } catch { /* keep going */ } });
      }
    });
    await page.waitForTimeout(1_500);
  } catch {
    // Teardown must never fail a passing test.
  }
}

test.describe('smart food-timed reminders (requires E2E_EMAIL and E2E_PASSWORD)', () => {
  test.skip(!hasAuthCreds, 'Set E2E_EMAIL and E2E_PASSWORD to run smart-reminder E2E.');
  test.describe.configure({ mode: 'serial' });

  test.afterEach(async ({ page }) => {
    await cleanupSeed(page);
  });

  test('settings toggle persists and the schedule hint renders with seeded data', async ({ page }) => {
    await login(page);

    // 1. Turn the toggle on via Settings UI and save.
    await page.goto('/app/settings');
    const toggle = page.getByRole('button', { name: 'Умный тайминг напоминаний' });
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await toggle.click();
    await page.getByRole('button', { name: 'Save Notifications' }).click();

    // 2. Seed 8 days of meals (09:00 + 20:00) and an empty-stomach 09:30 dose.
    await page.evaluate(() => {
      const medStore = (window as unknown as {
        __medremindStore: { getState(): {
          profile: { id: string; timezone: string } | null;
          createCustomProtocol(p: Record<string, unknown>): { id: string };
          addProtocolItem(protocolId: string, item: Record<string, unknown>): void;
          activateProtocol(protocolId: string, startDate: string): unknown;
        } };
      }).__medremindStore;
      const foodStore = (window as unknown as {
        __medremindFoodStore: { getState(): {
          saveDraftAsEntry(params: Record<string, unknown>): unknown;
        } };
      }).__medremindFoodStore;

      const med = medStore.getState();
      const food = foodStore.getState();
      const profile = med.profile;
      if (!profile) throw new Error('no profile');

      const draft = (label: string) => ({
        title: 'SmartTest meal', summary: 'e2e seed', mealLabel: label,
        components: [], nutrients: { caloriesKcal: 400 }, uncertainties: [],
        estimationConfidence: 0.9, model: 'e2e-seed', schemaVersion: 'food-analysis-v1',
      });
      for (let dayOffset = 1; dayOffset <= 8; dayOffset += 1) {
        const base = new Date();
        base.setDate(base.getDate() - dayOffset);
        const breakfast = new Date(base); breakfast.setHours(9, 0, 0, 0);
        const dinner = new Date(base); dinner.setHours(20, 0, 0, 0);
        food.saveDraftAsEntry({ userId: profile.id, timezone: profile.timezone, draft: draft('breakfast'), consumedAt: breakfast.toISOString(), source: 'text_ai' });
        food.saveDraftAsEntry({ userId: profile.id, timezone: profile.timezone, draft: draft('dinner'), consumedAt: dinner.toISOString(), source: 'text_ai' });
      }

      const protocol = med.createCustomProtocol({
        name: `SmartTest ${Date.now()}`, description: 'e2e seed', category: 'custom',
        durationDays: 3, isArchived: false, items: [],
      });
      med.addProtocolItem(protocol.id, {
        itemType: 'medication', name: 'SmartTest EmptyStomach', doseAmount: 1, doseUnit: 'mg',
        frequencyType: 'daily', times: ['09:30'], withFood: 'no', startDay: 1, sortOrder: 0,
      });
      med.activateProtocol(protocol.id, new Date().toLocaleDateString('en-CA'));
    });

    await waitForSyncFlushed(page);

    // 3. Toggle survives a reload (store persist + cloud round-trip).
    await page.reload();
    await expect(page.getByRole('button', { name: 'Умный тайминг напоминаний' }))
      .toHaveAttribute('aria-pressed', 'true', { timeout: 20_000 });

    // 4. Schedule page: 09:30 empty-stomach dose inside the 09:00–20:00 eating
    // window → hint «⏱ 8:30 AM · смещено» (median first meal 09:00 − 30 min − no
    // cap issues). The dose row itself still shows the ORIGINAL 09:30 slot —
    // planned occurrences are never modified.
    await page.goto('/app');
    const doseCard = page.locator('[data-dose-id]', { hasText: 'SmartTest EmptyStomach' }).first();
    await expect(doseCard).toBeVisible({ timeout: 30_000 });
    await expect(doseCard.getByText(/· смещено/)).toBeVisible();
    await expect(doseCard.getByText(/9:30 AM/)).toBeVisible();
  });
});
```

- [ ] **Step 3: Run**

Run: `npm run test:e2e -- tests/e2e/smartReminders.spec.ts`
Expected: 1 passed (skipped without creds — run locally with `E2E_EMAIL`/`E2E_PASSWORD`
set and confirm PASS before the PR). Note: the seeded account starts with the toggle
off; if a previous run left it on, the first assertion fails — flip it off in Settings
and re-run (shared-account discipline).

- [ ] **Step 4: Commit**

```bash
git add src/components/app/E2ETestHelpers.tsx tests/e2e/smartReminders.spec.ts
git commit -m "test: smart-reminders E2E (settings toggle round-trip + seeded hint rendering)"
```

---

### Task 7: Full verification + PR (then STOP)

- [ ] **Step 1: Full local gate**

Run: `npx tsc --noEmit && npm run build && npm run test:unit && npm run test:correlation`
Expected: all pass (correlation suite untouched — must not regress).

- [ ] **Step 2: Push + PR**

```bash
git push -u origin codex/w4a-smart-food-reminders
gh pr create --base main --title "feat: smart food-timed reminders — push-time adjustment from real eating pattern (W4-A)" --body "Implements docs/superpowers/plans/2026-07-18-smart-food-reminders.md. Pure src/lib/push/foodTiming.ts (±90min cap, quiet-hours safe, inert <7d data, snoozed doses untouched) consumed by cron/notify Pass A AND the Schedule-page '⏱ смещено' hint (client-derived, nothing persisted; planned_occurrences unchanged). Default-off toggle «Умный тайминг напоминаний» + migration 030 (ledger updated). ⚠️ Owner: apply supabase/030_notification_settings_smart_food_timing.sql BEFORE merging (client settings upsert writes the column). Known v1 limitation: client hint ignores the Oura quiet window (server still enforces it). Test evidence: 16 foodTiming unit tests, smartReminders.spec.ts E2E.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

- [ ] **Step 3: STOP.** Do not merge (owner-only), do not apply migration 030, do not
touch cron-job.org (job #7402449 already invokes this route every minute — no scheduler
change needed). Report back: PR URL, gate output, deviations.
