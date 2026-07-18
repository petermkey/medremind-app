# W3-B Morning Briefing — Readiness-Aware Daily Push + In-App Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or
> superpowers:subagent-driven-development when orchestrated) to implement this plan
> task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Read
> `docs/superpowers/plans/2026-07-18-feature-wave-master.md` FIRST — its Global
> Constraints, migration ledger, and owner decisions bind this plan.

**Goal:** Every morning the user gets one push notification with a readiness-aware
summary of last night (Oura readiness score, HRV vs their own 30-day baseline, sleep
score, skin-temperature deviation) plus today's dose count — and the same text renders
as a dismissible card at the top of the Schedule page. Deterministic rule-based copy
in Russian. **No LLM anywhere in this feature** (explicit non-goal; see Spec).

**Architecture:** One new pure leaf module `src/lib/briefing/briefing.ts` holds ALL
the logic: 30-day baseline math + the rule-based copy builder
`buildBriefing(snapshot, baseline, doseCount) → {title, body, severity}`. It is
clock-free and import-free, so the exact same function runs in two places:
(1) server-side in the new cron route `src/app/api/cron/morning-briefing/route.ts`
(CRON_SECRET-gated, Sentry check-in with monitorConfig upsert, `notification_log`
dedupe, quiet-hours guard, delivery via the existing `sendPushToUser` core), and
(2) client-side in a new `MorningBriefingCard` on the Schedule page, which derives
today's briefing on the fly from the existing `/api/health/oura/summary` endpoint.
Because the card recomputes identical copy from the same inputs, **nothing is stored
and no briefing table/migration is needed for the card** (decision + justification in
Task 7). One migration IS needed for the settings toggle: `notification_settings` has
fixed boolean columns and **no extensible jsonb** (verified: `user_id, push_enabled,
email_enabled, lead_time_min, digest_time, updated_at` — `supabase/001_initial.sql`
lines 22–29), so the default-off toggle takes a new column via migration **029**.

**Tech Stack:** Next.js 15 App Router, TypeScript strict, Supabase (service-role
client in cron route, `@/lib/supabase/server` elsewhere), `web-push` via
`src/lib/push/sendToUser.ts`, `@sentry/nextjs` check-ins, Node
`--experimental-strip-types` test runner for leaf modules, Playwright E2E.

## Spec

### Requirements

1. **Pure briefing module (P0).** `buildBriefing(snapshot, baseline, doseCount)`
   returns `{ title, body, severity }` with severity in
   `'good' | 'info' | 'caution' | 'warning'`. Rules (exact copy strings in Task 3):
   - `warning` when skin-temperature deviation ≥ **+0.5 °C**;
   - else `caution` when readiness < **60** OR HRV is ≥ **15 % below** the 30-day baseline;
   - else `good` when readiness ≥ **85**;
   - else `info` (including the no-Oura-data case, which still reports the dose count).
   Baseline math: 30-day averages of HRV and readiness, `null` unless ≥ 7 non-null
   samples; percentage delta of today vs baseline. All pure, clock-free, unit-tested.
2. **Cron route (P0).** `GET /api/cron/morning-briefing`: fail-closed
   `Bearer CRON_SECRET` auth; Sentry `captureCheckIn` with `monitorConfig` upsert
   (crontab `'30 6 * * *'`, the `cron/oura-sync` pattern from PR #93); iterates users
   with `push_enabled = true AND morning_briefing_enabled = true`; per user: quiet-hours
   guard (Oura optimal-bedtime window, same as `cron/notify`), **one briefing per local
   day** enforced through `notification_log` (deterministic per-day UUID key — the
   column is `uuid not null`, so a text key like `briefing-2026-07-18` is impossible;
   see Task 4), claim-before-send / promote-after-send discipline cloned from
   `cron/notify` Pass A.
3. **Settings toggle (P0).** New Toggle «Утренний брифинг» in the Settings
   Notifications section, **default off**, persisted to a new
   `notification_settings.morning_briefing_enabled boolean not null default false`
   column (migration 029) and mirrored through the Zustand store like the existing
   notification fields.
4. **In-app card (P1).** When the toggle is on and today's Oura snapshot exists, the
   Schedule page (`src/app/app/page.tsx`) shows a dismissible card with the identical
   briefing text, derived client-side from `/api/health/oura/summary?days=31`.
   Dismissal is per-day, stored in `localStorage`.
5. **Tests.** Unit: baseline math + every severity/copy rule + deterministic-UUID
   helper. Route idempotency: local double-fire check (second call reports
   `already-sent`). E2E: card renders with stubbed summary data and dismisses.

### Acceptance criteria

- `npx tsc --noEmit` && `npm run build` && `npm run test:unit` &&
  `npm run test:correlation` all pass (new `.test.mjs` files register in
  `test:correlation` — see Import-topology note in Global Constraints).
- Calling the route twice in a row (valid CRON_SECRET, local dev): first response
  contains `"status":"sent"` (or `"no-subscriptions"`), second contains
  `"status":"already-sent"` for the same user — proving one-per-day dedupe.
- With the toggle off, the route skips the user and the Schedule page shows no card.
- Migration ledger in the master plan updated with row **029** (Task 1).

### Non-goals

- **NO LLM call.** v1 copy is deterministic template text — testable, free, and
  latency-proof. An LLM-personalised briefing is an explicit possible v2, not here.
- No briefing history table, no archive UI (the card only exists for "today").
- No email delivery. No changes to `cron/notify` or `scheduleWindow.ts` (owned by W4-A).
- Creating the cron-job.org job — **owner-only, after deploy** (master plan decision 3).
- Applying migration 029 to production — **owner/orchestrator only**.

## Global Constraints

- Branch: `codex/w3b-morning-briefing` off fresh `origin/main`. Never push to `main`.
  Conventional commits. Before starting: `bash scripts/git-state-check.sh`.
- TypeScript strict; no `any` without comment; run `npx tsc --noEmit` after every
  `.ts/.tsx` change; `npm run build` must pass before the PR.
- No `console.log` in committed code (`console.error`/`console.warn` are the existing
  route convention and allowed).
- File ownership (master matrix): this plan may ONLY create/modify
  `src/app/api/cron/morning-briefing/*`, `src/lib/briefing/*`,
  `src/lib/push/notificationKey.*`, `src/components/app/MorningBriefingCard.tsx`,
  the Settings page (briefing toggle only), `src/app/app/page.tsx` (card insertion
  only), `src/types/index.ts` (one field), `src/lib/store/store.ts` (one default),
  `src/lib/supabase/cloudStore.ts` + `importStore.ts` + `src/lib/push/subscription.ts`
  (one field each), `supabase/029_*.sql`, `package.json` (test list), the master-plan
  ledger row, and new test files. Do NOT touch `cron/notify`, `scheduleWindow.ts`,
  or anything in the W4 surface.
- **Import topology (verified against this repo's tsconfig + the 2026-07-14 Oura
  sprint-1 plan Task 3):** `moduleResolution: "bundler"` without
  `allowImportingTsExtensions` means a `.ts` file cannot import a sibling `.ts` by
  explicit extension (tsc fails), while the strip-types test runner cannot resolve
  extensionless TS-to-TS imports. Therefore every module under direct `.test.mjs`
  test MUST be a **leaf module** (zero value imports; `node:` builtins are fine —
  precedent: `quietHours.ts` and its test live in `test:correlation`). That is why
  baseline math and copy builder share ONE file, and why new tests register in
  `test:correlation` (the strip-types list) rather than the `test:unit` tsc pipeline.
- Push discipline (master constraint): `sendPushToUser` result `sent === 0` is a
  FAILURE, not success (docs/system-audit-2026-07-09.md §2) — roll the claim back.
- Sentry monitor timezone: `Europe/London` with `checkinMargin: 60` — must match the
  cron-job.org job the owner will create (06:30 London daily).

## File Structure

- Create: `supabase/029_notification_settings_morning_briefing.sql`
- Create: `src/lib/briefing/briefing.ts` (leaf: baseline math + copy builder)
- Create: `src/lib/briefing/briefing.test.mjs`
- Create: `src/lib/push/notificationKey.ts` (leaf + `node:crypto`)
- Create: `src/lib/push/notificationKey.test.mjs`
- Create: `src/app/api/cron/morning-briefing/route.ts`
- Create: `src/components/app/MorningBriefingCard.tsx`
- Create: `tests/e2e/morningBriefing.spec.ts`
- Modify: `src/types/index.ts` (NotificationSettings + `morningBriefingEnabled`)
- Modify: `src/lib/store/store.ts` (store default)
- Modify: `src/lib/supabase/cloudStore.ts` (pull mapping + default)
- Modify: `src/lib/supabase/importStore.ts` (import mapping)
- Modify: `src/lib/push/subscription.ts` (`saveNotificationSettingsToSupabase`)
- Modify: `src/app/app/settings/page.tsx` (toggle)
- Modify: `src/app/app/page.tsx` (card insertion)
- Modify: `package.json` (`test:correlation` list)
- Modify: `docs/superpowers/plans/2026-07-18-feature-wave-master.md` (ledger row 029)

---

### Task 0: Preflight

- [ ] **Step 1: Git state + branch**

```bash
cd "/Volumes/DATA/GRAVITY REPO/medremind-app"
bash scripts/git-state-check.sh
git fetch origin && git checkout -b codex/w3b-morning-briefing origin/main
```

Expected: clean state; new branch tracking fresh `origin/main`.

- [ ] **Step 2: Read the binding docs**

Read end-to-end: `docs/superpowers/plans/2026-07-18-feature-wave-master.md`,
`CLAUDE.md`, `docs/project-rules-and-current-operating-model.md`,
`src/app/api/cron/notify/route.ts` (claim discipline you will clone),
`src/app/api/cron/oura-sync/route.ts` (Sentry monitorConfig pattern).

---

### Task 1: Migration 029 — briefing toggle column (+ ledger update)

**Files:**
- Create: `supabase/029_notification_settings_morning_briefing.sql`
- Modify: `docs/superpowers/plans/2026-07-18-feature-wave-master.md` (Migration Ledger)

**Interfaces:**
- Produces: column `notification_settings.morning_briefing_enabled boolean not null
  default false` — consumed by Tasks 5 and 6.
- Numbering rationale (record it in the commit message too): the master ledger takes
  026 (W2-C), 027 (W4-B), and **conditionally reserves 028 for W3-A Stack Guard**,
  which runs in the SAME wave as this plan. Taking 028 here could collide with a
  parallel agent, so this plan takes the next unreserved number: **029**.

- [ ] **Step 1: Write the migration (idempotent, `022_oura_tags.sql` style)**

```sql
-- 029: W3-B Morning Briefing — per-user opt-in for the daily readiness push.
-- notification_settings has fixed columns and no extensible jsonb (001), so the
-- default-off toggle (master Global Constraint: new push types default off)
-- becomes a dedicated boolean column.
alter table notification_settings
  add column if not exists morning_briefing_enabled boolean not null default false;

comment on column notification_settings.morning_briefing_enabled is
  'Opt-in for the daily morning readiness briefing push (W3-B). Default off.';
```

- [ ] **Step 2: Update the master Migration Ledger**

In `docs/superpowers/plans/2026-07-18-feature-wave-master.md`, append to the
Migration Ledger table (after the 028 row):

```markdown
| 029 | `supabase/029_notification_settings_morning_briefing.sql` | W3-B Morning Briefing (settings toggle column — notification_settings has no jsonb) | W3-B agent | owner/orchestrator |
```

- [ ] **Step 3: Commit**

```bash
git add supabase/029_notification_settings_morning_briefing.sql docs/superpowers/plans/2026-07-18-feature-wave-master.md
git commit -m "feat: migration 029 — morning_briefing_enabled toggle column (028 reserved by W3-A)"
```

---

### Task 2: `briefing.ts` — 30-day baseline math (leaf module)

**Files:**
- Create: `src/lib/briefing/briefing.ts`
- Create: `src/lib/briefing/briefing.test.mjs`
- Modify: `package.json` (`test:correlation` list)

**Interfaces:**
- Produces (consumed by Task 3 in the same file, Task 6 route, Task 7 card):
  - `baselineAverage(values: Array<number | null | undefined>): number | null` —
    mean rounded to 1 decimal; `null` when fewer than 7 finite samples.
  - `pctDelta(current, baseline): number | null` — integer percent of
    `(current - baseline) / baseline`; `null` on missing/zero baseline.
  - `MIN_BASELINE_SAMPLES = 7`.
- MUST stay a leaf module: zero imports (Global Constraints, import topology).

- [ ] **Step 1: Write the failing tests**

```js
// src/lib/briefing/briefing.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';

import { baselineAverage, pctDelta } from './briefing.ts';

test('baselineAverage is the mean of finite samples, 1-decimal rounded', () => {
  assert.equal(baselineAverage([50, 60, 70, 55, 65, 60, 60]), 60);
  assert.equal(baselineAverage([50, 60, 70, 55, 65, 60, 61]), 60.1);
});

test('baselineAverage ignores null/undefined/NaN samples', () => {
  assert.equal(baselineAverage([50, null, 60, undefined, 70, NaN, 55, 65, 60, 60]), 60);
});

test('baselineAverage needs at least 7 finite samples', () => {
  assert.equal(baselineAverage([50, 60, 70, 55, 65, 60]), null);
  assert.equal(baselineAverage([]), null);
});

test('pctDelta is the integer percent change vs baseline', () => {
  assert.equal(pctDelta(51, 60), -15);
  assert.equal(pctDelta(66, 60), 10);
  assert.equal(pctDelta(60, 60), 0);
});

test('pctDelta is null on missing current or missing/zero baseline', () => {
  assert.equal(pctDelta(null, 60), null);
  assert.equal(pctDelta(60, null), null);
  assert.equal(pctDelta(60, 0), null);
  assert.equal(pctDelta(Number.NaN, 60), null);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --experimental-strip-types --test src/lib/briefing/briefing.test.mjs`
Expected: FAIL with `Cannot find module ... briefing.ts`

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/briefing/briefing.ts
// Morning-briefing logic: personal 30-day baseline math + the rule-based copy
// builder. Pure LEAF module (zero imports) so the --experimental-strip-types
// test runner loads it directly (quietHours.ts precedent), and so the SAME
// code runs server-side (cron push, Task 6) and client-side (Schedule card,
// Task 7) — the two surfaces can never show different text for the same day.
//
// Deliberately NO LLM: deterministic template copy is testable, free, and has
// zero morning latency. An LLM-personalised briefing is an explicit non-goal
// of v1 (see the plan's Spec).

export const MIN_BASELINE_SAMPLES = 7;

function finiteOnly(values: Array<number | null | undefined>): number[] {
  return values.filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value),
  );
}

export function baselineAverage(values: Array<number | null | undefined>): number | null {
  const numeric = finiteOnly(values);
  if (numeric.length < MIN_BASELINE_SAMPLES) return null;
  const sum = numeric.reduce((total, value) => total + value, 0);
  return Math.round((sum / numeric.length) * 10) / 10;
}

export function pctDelta(
  current: number | null | undefined,
  baseline: number | null | undefined,
): number | null {
  if (typeof current !== 'number' || !Number.isFinite(current)) return null;
  if (typeof baseline !== 'number' || !Number.isFinite(baseline) || baseline === 0) return null;
  return Math.round(((current - baseline) / baseline) * 100);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --experimental-strip-types --test src/lib/briefing/briefing.test.mjs`
Expected: 5 tests PASS.

- [ ] **Step 5: Register in `test:correlation` and type-check**

In `package.json`, append ` src/lib/briefing/briefing.test.mjs` to the end of the
`test:correlation` file list (after `src/lib/health/ouraStats.test.mjs`).

Run: `npm run test:correlation && npx tsc --noEmit`
Expected: full suite passes; tsc clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/briefing/briefing.ts src/lib/briefing/briefing.test.mjs package.json
git commit -m "feat: briefing baseline math (30-day averages, pct delta)"
```

---

### Task 3: `buildBriefing` — rule-based Russian copy

**Files:**
- Modify: `src/lib/briefing/briefing.ts`
- Modify: `src/lib/briefing/briefing.test.mjs`

**Interfaces:**
- Produces (consumed by Tasks 6 and 7):
  - `type BriefingSnapshot = { readinessScore: number | null; sleepScore: number | null; sleepAvgHrv: number | null; temperatureDeviation: number | null }`
  - `type BriefingBaseline = { readinessAvg30: number | null; hrvAvg30: number | null }`
  - `type BriefingSeverity = 'good' | 'info' | 'caution' | 'warning'`
  - `type Briefing = { title: string; body: string; severity: BriefingSeverity }`
  - `buildBriefing(snapshot: BriefingSnapshot | null, baseline: BriefingBaseline, doseCount: number): Briefing`
  - `ruPlural(count, one, few, many): string`
- **Discovery recorded:** `external_health_daily_snapshots` has NO total-sleep-duration
  column (verified in `src/lib/health/persistence.ts` `toSnapshotRow` — only score,
  efficiency, latency, deep/REM minutes exist). The briefing therefore reports the
  sleep **score** and omits duration. This is a deliberate deviation from the
  original "sleep score/duration" wording; adding a duration column is out of scope.

- [ ] **Step 1: Add failing copy tests**

Append to `src/lib/briefing/briefing.test.mjs`:

```js
import { buildBriefing, ruPlural } from './briefing.ts';

test('ruPlural picks the correct Russian plural form', () => {
  assert.equal(ruPlural(1, 'приём', 'приёма', 'приёмов'), 'приём');
  assert.equal(ruPlural(2, 'приём', 'приёма', 'приёмов'), 'приёма');
  assert.equal(ruPlural(5, 'приём', 'приёма', 'приёмов'), 'приёмов');
  assert.equal(ruPlural(11, 'приём', 'приёма', 'приёмов'), 'приёмов');
  assert.equal(ruPlural(21, 'приём', 'приёма', 'приёмов'), 'приём');
});

const BASELINE = { readinessAvg30: 75, hrvAvg30: 60 };

test('good day: readiness ≥ 85 → severity good with full copy', () => {
  const briefing = buildBriefing(
    { readinessScore: 88, sleepScore: 82, sleepAvgHrv: 66, temperatureDeviation: 0.1 },
    BASELINE,
    3,
  );
  assert.equal(briefing.severity, 'good');
  assert.equal(briefing.title, 'Утренний брифинг: отличная готовность');
  assert.equal(
    briefing.body,
    'Готовность 88 · сон 82. HRV 66 мс — +10% к 30-дневной норме. Сегодня по расписанию: 3 приёма.',
  );
});

test('HRV ≥ 15% below baseline → severity caution', () => {
  const briefing = buildBriefing(
    { readinessScore: 78, sleepScore: 70, sleepAvgHrv: 51, temperatureDeviation: null },
    BASELINE,
    1,
  );
  assert.equal(briefing.severity, 'caution');
  assert.equal(briefing.title, 'Утренний брифинг: день восстановления');
  assert.equal(
    briefing.body,
    'Готовность 78 · сон 70. HRV 51 мс — -15% к 30-дневной норме. Сегодня по расписанию: 1 приём.',
  );
});

test('low readiness < 60 → severity caution even with normal HRV', () => {
  const briefing = buildBriefing(
    { readinessScore: 55, sleepScore: 60, sleepAvgHrv: 60, temperatureDeviation: null },
    BASELINE,
    0,
  );
  assert.equal(briefing.severity, 'caution');
  assert.equal(
    briefing.body,
    'Готовность 55 · сон 60. HRV 60 мс — 0% к 30-дневной норме. На сегодня приёмов не запланировано.',
  );
});

test('temperature deviation ≥ +0.5°C → severity warning and wins over good readiness', () => {
  const briefing = buildBriefing(
    { readinessScore: 90, sleepScore: 85, sleepAvgHrv: 70, temperatureDeviation: 0.6 },
    BASELINE,
    2,
  );
  assert.equal(briefing.severity, 'warning');
  assert.equal(briefing.title, 'Утренний брифинг: поберегите себя');
  assert.equal(
    briefing.body,
    'Готовность 90 · сон 85. HRV 70 мс — +17% к 30-дневной норме. Температура тела выше обычной на 0.6 °C — прислушайтесь к самочувствию. Сегодня по расписанию: 2 приёма.',
  );
});

test('middling day → severity info', () => {
  const briefing = buildBriefing(
    { readinessScore: 72, sleepScore: 68, sleepAvgHrv: 58, temperatureDeviation: 0.2 },
    BASELINE,
    4,
  );
  assert.equal(briefing.severity, 'info');
  assert.equal(briefing.title, 'Утренний брифинг');
  assert.equal(
    briefing.body,
    'Готовность 72 · сон 68. HRV 58 мс — -3% к 30-дневной норме. Сегодня по расписанию: 4 приёма.',
  );
});

test('no snapshot → info briefing that still reports the dose count', () => {
  const briefing = buildBriefing(null, { readinessAvg30: null, hrvAvg30: null }, 5);
  assert.equal(briefing.severity, 'info');
  assert.equal(briefing.title, 'Утренний брифинг');
  assert.equal(
    briefing.body,
    'Данных Oura за эту ночь пока нет. Сегодня по расписанию: 5 приёмов.',
  );
});

test('missing HRV baseline omits the HRV line; missing sleep omits the sleep half', () => {
  const briefing = buildBriefing(
    { readinessScore: 80, sleepScore: null, sleepAvgHrv: 62, temperatureDeviation: null },
    { readinessAvg30: 75, hrvAvg30: null },
    1,
  );
  assert.equal(briefing.severity, 'info');
  assert.equal(briefing.body, 'Готовность 80. Сегодня по расписанию: 1 приём.');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --experimental-strip-types --test src/lib/briefing/briefing.test.mjs`
Expected: FAIL — `buildBriefing` is not exported.

- [ ] **Step 3: Implement (append to `src/lib/briefing/briefing.ts`)**

```ts
export type BriefingSnapshot = {
  readinessScore: number | null;
  sleepScore: number | null;
  sleepAvgHrv: number | null;
  temperatureDeviation: number | null;
};

export type BriefingBaseline = {
  readinessAvg30: number | null;
  hrvAvg30: number | null;
};

export type BriefingSeverity = 'good' | 'info' | 'caution' | 'warning';

export type Briefing = {
  title: string;
  body: string;
  severity: BriefingSeverity;
};

// Rule thresholds (see plan Spec, requirement 1).
const TEMPERATURE_WARNING_DEVIATION = 0.5; // °C above personal baseline
const HRV_CAUTION_DROP_PCT = -15;
const READINESS_GOOD = 85;
const READINESS_LOW = 60;

const TITLES: Record<BriefingSeverity, string> = {
  good: 'Утренний брифинг: отличная готовность',
  info: 'Утренний брифинг',
  caution: 'Утренний брифинг: день восстановления',
  warning: 'Утренний брифинг: поберегите себя',
};

export function ruPlural(count: number, one: string, few: string, many: string): string {
  const mod10 = Math.abs(count) % 10;
  const mod100 = Math.abs(count) % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function doseLine(doseCount: number): string {
  if (doseCount <= 0) return 'На сегодня приёмов не запланировано.';
  return `Сегодня по расписанию: ${doseCount} ${ruPlural(doseCount, 'приём', 'приёма', 'приёмов')}.`;
}

export function buildBriefing(
  snapshot: BriefingSnapshot | null,
  baseline: BriefingBaseline,
  doseCount: number,
): Briefing {
  const hasScores =
    snapshot !== null && (snapshot.readinessScore !== null || snapshot.sleepScore !== null);

  if (!hasScores) {
    return {
      title: TITLES.info,
      body: `Данных Oura за эту ночь пока нет. ${doseLine(doseCount)}`,
      severity: 'info',
    };
  }

  const lines: string[] = [];

  const scoreParts: string[] = [];
  if (snapshot.readinessScore !== null) scoreParts.push(`Готовность ${snapshot.readinessScore}`);
  if (snapshot.sleepScore !== null) scoreParts.push(`сон ${snapshot.sleepScore}`);
  if (scoreParts.length > 0) lines.push(`${scoreParts.join(' · ')}.`);

  const hrvDelta = pctDelta(snapshot.sleepAvgHrv, baseline.hrvAvg30);
  if (snapshot.sleepAvgHrv !== null && hrvDelta !== null) {
    const sign = hrvDelta > 0 ? '+' : '';
    lines.push(`HRV ${snapshot.sleepAvgHrv} мс — ${sign}${hrvDelta}% к 30-дневной норме.`);
  }

  const temperatureHigh =
    snapshot.temperatureDeviation !== null &&
    snapshot.temperatureDeviation >= TEMPERATURE_WARNING_DEVIATION;
  if (temperatureHigh && snapshot.temperatureDeviation !== null) {
    lines.push(
      `Температура тела выше обычной на ${snapshot.temperatureDeviation.toFixed(1)} °C — прислушайтесь к самочувствию.`,
    );
  }

  lines.push(doseLine(doseCount));

  let severity: BriefingSeverity = 'info';
  if (temperatureHigh) {
    severity = 'warning';
  } else if (
    (snapshot.readinessScore !== null && snapshot.readinessScore < READINESS_LOW) ||
    (hrvDelta !== null && hrvDelta <= HRV_CAUTION_DROP_PCT)
  ) {
    severity = 'caution';
  } else if (snapshot.readinessScore !== null && snapshot.readinessScore >= READINESS_GOOD) {
    severity = 'good';
  }

  return { title: TITLES[severity], body: lines.join(' '), severity };
}
```

- [ ] **Step 4: Run to verify pass + gates**

Run: `npm run test:correlation && npx tsc --noEmit`
Expected: all tests pass (5 baseline + 8 copy tests), tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/briefing/briefing.ts src/lib/briefing/briefing.test.mjs
git commit -m "feat: rule-based Russian morning-briefing copy builder"
```

---

### Task 4: Deterministic notification UUID (dedupe key)

**Files:**
- Create: `src/lib/push/notificationKey.ts`
- Create: `src/lib/push/notificationKey.test.mjs`
- Modify: `package.json` (`test:correlation` list)

**Interfaces:**
- Produces: `deterministicNotificationUuid(kind: string, discriminator: string): string`
  — consumed by Task 6 (and by W4-B if it chooses; it currently uses real row UUIDs).
- **Why this exists (discovery):** `notification_log.scheduled_dose_id` is
  `UUID NOT NULL` with `unique (user_id, scheduled_dose_id)`
  (`supabase/003_web_push.sql:41-49`). The briefing has no natural row UUID, and a
  text key would be rejected by Postgres — so the per-day dedupe key is a
  **deterministic RFC-4122-shaped UUID** derived from `kind + local date`. Same
  (user, day) always maps to the same UUID → the existing unique constraint gives
  one-briefing-per-day for free, with zero schema changes.

- [ ] **Step 1: Write the failing tests**

```js
// src/lib/push/notificationKey.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';

import { deterministicNotificationUuid } from './notificationKey.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test('produces a valid RFC-4122-shaped uuid', () => {
  assert.match(deterministicNotificationUuid('morning-briefing', '2026-07-18'), UUID_RE);
});

test('same inputs always produce the same uuid (dedupe key stability)', () => {
  assert.equal(
    deterministicNotificationUuid('morning-briefing', '2026-07-18'),
    deterministicNotificationUuid('morning-briefing', '2026-07-18'),
  );
});

test('different date or kind produces a different uuid', () => {
  const a = deterministicNotificationUuid('morning-briefing', '2026-07-18');
  const b = deterministicNotificationUuid('morning-briefing', '2026-07-19');
  const c = deterministicNotificationUuid('weekly-review', '2026-07-18');
  assert.notEqual(a, b);
  assert.notEqual(a, c);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --experimental-strip-types --test src/lib/push/notificationKey.test.mjs`
Expected: FAIL with `Cannot find module ... notificationKey.ts`

- [ ] **Step 3: Implement**

```ts
// src/lib/push/notificationKey.ts
// Deterministic dedupe keys for notifications that have no natural row UUID.
// notification_log.scheduled_dose_id is `uuid not null` (003_web_push.sql), so
// non-dose notifications (morning briefing, …) map (kind, discriminator) to a
// stable RFC-4122-shaped UUID: the existing unique(user_id, scheduled_dose_id)
// constraint then enforces once-per-discriminator delivery per user.
// Leaf module + node builtin only (strip-types test runner constraint).
import { createHash } from 'node:crypto';

export function deterministicNotificationUuid(kind: string, discriminator: string): string {
  const hash = createHash('sha256').update(`${kind}:${discriminator}`).digest('hex');
  const variantNibble = ((parseInt(hash[16], 16) & 0x3) | 0x8).toString(16);
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    `4${hash.slice(13, 16)}`,
    `${variantNibble}${hash.slice(17, 20)}`,
    hash.slice(20, 32),
  ].join('-');
}
```

- [ ] **Step 4: Register + verify**

In `package.json`, append ` src/lib/push/notificationKey.test.mjs` to the
`test:correlation` list.

Run: `npm run test:correlation && npx tsc --noEmit`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/push/notificationKey.ts src/lib/push/notificationKey.test.mjs package.json
git commit -m "feat: deterministic uuid dedupe keys for non-dose notifications"
```

---

### Task 5: Settings toggle «Утренний брифинг» (type → store → sync → UI)

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/lib/store/store.ts`
- Modify: `src/lib/supabase/cloudStore.ts`
- Modify: `src/lib/supabase/importStore.ts`
- Modify: `src/lib/push/subscription.ts`
- Modify: `src/app/app/settings/page.tsx`

**Interfaces:**
- Produces: `NotificationSettings.morningBriefingEnabled: boolean` flowing
  localStorage-store ⇄ Supabase `morning_briefing_enabled` — consumed by Task 6
  (route filter) and Task 7 (card gate).
- NOTE for W4-B (sequencing): W4-B later removes `emailEnabled`/`digestTime` from
  this same type. This plan does NOT touch those fields — waves are merge-separated.

- [ ] **Step 1: Extend the type**

In `src/types/index.ts`, change the `NotificationSettings` interface (currently at
lines 141–146) to:

```ts
export interface NotificationSettings {
  pushEnabled: boolean;
  emailEnabled: boolean;
  leadTimeMin: number;       // notify N min before dose
  digestTime: string;        // HH:MM
  morningBriefingEnabled: boolean; // W3-B daily readiness briefing push (default off)
}
```

- [ ] **Step 2: Store default**

In `src/lib/store/store.ts`, the initial `notificationSettings` object (near line
140) becomes:

```ts
      notificationSettings: {
        pushEnabled: false,
        emailEnabled: false,
        leadTimeMin: 0,
        digestTime: '07:00',
        morningBriefingEnabled: false,
      },
```

- [ ] **Step 3: Cloud pull mapping + default**

In `src/lib/supabase/cloudStore.ts`:

`defaultNotificationSettings()` (line ~93) becomes:

```ts
function defaultNotificationSettings(): NotificationSettings {
  return {
    pushEnabled: false,
    emailEnabled: false,
    leadTimeMin: 0,
    digestTime: '07:00',
    morningBriefingEnabled: false,
  };
}
```

The pull mapping (line ~601) gains one line after `digestTime: ...`:

```ts
        morningBriefingEnabled: Boolean(nRow.morning_briefing_enabled),
```

- [ ] **Step 4: Import mapping**

In `src/lib/supabase/importStore.ts`, the notification-settings upsert payload
(near line 117, where `email_enabled`/`digest_time` are written) gains:

```ts
      morning_briefing_enabled: Boolean(notifPatch.morningBriefingEnabled),
```

- [ ] **Step 5: Supabase save helper**

In `src/lib/push/subscription.ts`, `saveNotificationSettingsToSupabase` (line ~187)
becomes:

```ts
export async function saveNotificationSettingsToSupabase(settings: {
  pushEnabled: boolean;
  emailEnabled: boolean;
  leadTimeMin: number;
  digestTime: string;
  morningBriefingEnabled: boolean;
}): Promise<void> {
  const supabase = getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  await supabase.from('notification_settings').upsert(
    {
      user_id: user.id,
      push_enabled: settings.pushEnabled,
      email_enabled: settings.emailEnabled,
      lead_time_min: settings.leadTimeMin,
      digest_time: settings.digestTime,
      morning_briefing_enabled: settings.morningBriefingEnabled,
    },
    { onConflict: 'user_id' },
  );
}
```

- [ ] **Step 6: Settings page state + toggle**

In `src/app/app/settings/page.tsx`:

(a) after the `digestTime` state (line ~59) add:

```ts
  const [morningBriefingEnabled, setMorningBriefingEnabled] = useState(notificationSettings.morningBriefingEnabled);
```

(b) in the rehydration `useEffect` (line ~112) add:

```ts
    setMorningBriefingEnabled(notificationSettings.morningBriefingEnabled);
```

(c) in `saveNotifications()` extend BOTH calls:

```ts
      updateNotificationSettings({ pushEnabled, emailEnabled, leadTimeMin: parseInt(leadTime), digestTime, morningBriefingEnabled });
```

```ts
    saveNotificationSettingsToSupabase({
      pushEnabled,
      emailEnabled,
      leadTimeMin: parseInt(leadTime),
      digestTime,
      morningBriefingEnabled,
    }).catch(err => console.error('[settings] notification_settings sync failed', err));
```

(d) in the `🔔 Notifications` Section JSX, directly after the
`<Toggle label="Push notifications" ... />` line add:

```tsx
          <Toggle label="Утренний брифинг" sub="Ежедневная сводка готовности, сна и приёмов (~06:30)" checked={morningBriefingEnabled} onChange={setMorningBriefingEnabled} />
```

- [ ] **Step 7: Verify + commit**

Run: `npx tsc --noEmit && npm run build`
Expected: clean. (tsc will surface every place the widened type must flow — fix ONLY
by adding the new field, never by casting.)

```bash
git add src/types/index.ts src/lib/store/store.ts src/lib/supabase/cloudStore.ts src/lib/supabase/importStore.ts src/lib/push/subscription.ts src/app/app/settings/page.tsx
git commit -m "feat: morning-briefing settings toggle wired through store and supabase"
```

---

### Task 6: Cron route `GET /api/cron/morning-briefing`

**Files:**
- Create: `src/app/api/cron/morning-briefing/route.ts`

**Interfaces:**
- Consumes: `buildBriefing`/`baselineAverage` (Task 3), `deterministicNotificationUuid`
  (Task 4), `isInQuietHours` (`@/lib/push/quietHours`), `sendPushToUser`/
  `isVapidConfigured` (`@/lib/push/sendToUser`), column from Task 1.
- Produces: JSON `{ processed, results: [{ userId, status }] }` with statuses
  `sent | already-sent | quiet-hours | no-subscriptions | send-failed | error`.
- Sentry monitor slug: `cron-morning-briefing`, crontab `'30 6 * * *'`,
  timezone `Europe/London` (must equal the cron-job.org job the OWNER creates
  after deploy — master plan decision 3; the implementer never creates cron jobs).

- [ ] **Step 1: Write the route**

```ts
// GET /api/cron/morning-briefing
// Daily readiness-aware briefing push (W3-B). Triggered once per day (06:30
// Europe/London) by an external cron-job.org job that the OWNER creates after
// deploy — never by an implementing agent (master plan, decision 3).
//
// Discipline cloned from cron/notify + cron/oura-sync (PR #93):
//   - fail-closed Bearer CRON_SECRET;
//   - Sentry captureCheckIn with monitorConfig upsert (schedule stays in
//     lockstep with the external job without touching the Sentry UI);
//   - notification_log claim-before-send (count=0) → promote-after-send (=1),
//     delete on failure; sent===0 is a FAILURE (system-audit 2026-07-09 §2);
//   - one briefing per user per LOCAL day via a deterministic per-day UUID
//     (scheduled_dose_id column is uuid — see notificationKey.ts);
//   - quiet-hours guard from the Oura optimal-bedtime window.
import * as Sentry from '@sentry/nextjs';
import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

import {
  baselineAverage,
  buildBriefing,
  type BriefingSnapshot,
} from '@/lib/briefing/briefing';
import { deterministicNotificationUuid } from '@/lib/push/notificationKey';
import { isInQuietHours } from '@/lib/push/quietHours';
import { isVapidConfigured, sendPushToUser } from '@/lib/push/sendToUser';

export const runtime = 'nodejs';
export const maxDuration = 300;

const BASELINE_DAYS = 30;
const MONITOR_SLUG = 'cron-morning-briefing';

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
    // invalid tz string in profile — fall through to UTC
  }
  return now.toISOString().slice(0, 10);
}

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
      schedule: { type: 'crontab', value: '30 6 * * *' },
      checkinMargin: 60,
      maxRuntime: 10,
      timezone: 'Europe/London',
    },
  );

  if (!isVapidConfigured()) {
    Sentry.captureCheckIn({ checkInId, monitorSlug: MONITOR_SLUG, status: 'error' });
    return NextResponse.json({ error: 'VAPID not configured' }, { status: 500 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const now = new Date();
  const results: Array<{ userId: string; status: string }> = [];

  const { data: settingRows, error: settingsError } = await supabase
    .from('notification_settings')
    .select('user_id')
    .eq('push_enabled', true)
    .eq('morning_briefing_enabled', true);

  if (settingsError) {
    Sentry.captureException(settingsError, {
      tags: { route: 'cron/morning-briefing', stage: 'notification_settings' },
    });
    Sentry.captureCheckIn({ checkInId, monitorSlug: MONITOR_SLUG, status: 'error' });
    return NextResponse.json({ error: 'DB error' }, { status: 500 });
  }

  for (const { user_id: userId } of settingRows ?? []) {
    try {
      const { data: profileRow } = await supabase
        .from('profiles')
        .select('timezone')
        .eq('id', userId)
        .maybeSingle();
      const tz = profileRow?.timezone ?? 'UTC';

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
        results.push({ userId, status: 'quiet-hours' });
        continue;
      }

      const localDate = localDateFor(now, tz);
      const dedupeKey = deterministicNotificationUuid('morning-briefing', localDate);

      // Claim (count=0). ignoreDuplicates → empty result means today's briefing
      // was already claimed/sent by an earlier invocation.
      const { data: lockRows, error: lockError } = await supabase
        .from('notification_log')
        .upsert(
          {
            user_id: userId,
            scheduled_dose_id: dedupeKey,
            sent_at: now.toISOString(),
            notification_count: 0,
          },
          { onConflict: 'user_id,scheduled_dose_id', ignoreDuplicates: true },
        )
        .select('scheduled_dose_id');
      if (lockError) {
        console.error('[cron/morning-briefing] lock failed', userId, lockError);
        results.push({ userId, status: 'error' });
        continue;
      }
      if (!lockRows || lockRows.length === 0) {
        results.push({ userId, status: 'already-sent' });
        continue;
      }

      const releaseClaim = () =>
        supabase
          .from('notification_log')
          .delete()
          .eq('user_id', userId)
          .eq('scheduled_dose_id', dedupeKey)
          .eq('notification_count', 0);

      // Last night's snapshot + 30 prior days for the personal baseline.
      const { data: snapshotRows, error: snapshotError } = await supabase
        .from('external_health_daily_snapshots')
        .select('local_date, readiness_score, sleep_score, sleep_avg_hrv, temperature_deviation')
        .eq('user_id', userId)
        .eq('source', 'oura')
        .gte('local_date', addDaysIso(localDate, -BASELINE_DAYS))
        .lte('local_date', localDate)
        .order('local_date', { ascending: true });
      if (snapshotError) {
        console.error('[cron/morning-briefing] snapshots fetch failed', userId, snapshotError);
        await releaseClaim();
        results.push({ userId, status: 'error' });
        continue;
      }

      const rows = snapshotRows ?? [];
      const todayRow = rows.find((row) => row.local_date === localDate) ?? null;
      const baselineRows = rows.filter((row) => row.local_date !== localDate);
      const snapshot: BriefingSnapshot | null = todayRow
        ? {
            readinessScore: numberOrNull(todayRow.readiness_score),
            sleepScore: numberOrNull(todayRow.sleep_score),
            sleepAvgHrv: numberOrNull(todayRow.sleep_avg_hrv),
            temperatureDeviation: numberOrNull(todayRow.temperature_deviation),
          }
        : null;
      const baseline = {
        readinessAvg30: baselineAverage(baselineRows.map((row) => numberOrNull(row.readiness_score))),
        hrvAvg30: baselineAverage(baselineRows.map((row) => numberOrNull(row.sleep_avg_hrv))),
      };

      // Today's dose count: planned occurrences under active protocols.
      const { data: occRows, error: occError } = await supabase
        .from('planned_occurrences')
        .select('id, active_protocols!inner ( status )')
        .eq('user_id', userId)
        .eq('occurrence_date', localDate)
        .eq('status', 'planned')
        .eq('active_protocols.status', 'active');
      if (occError) {
        console.error('[cron/morning-briefing] occurrences fetch failed', userId, occError);
        await releaseClaim();
        results.push({ userId, status: 'error' });
        continue;
      }

      const briefing = buildBriefing(snapshot, baseline, (occRows ?? []).length);

      const sendResult = await sendPushToUser(supabase, userId, {
        title: briefing.title,
        body: briefing.body,
        url: '/app',
        tag: `briefing-${localDate}`,
      });
      if (sendResult.sent === 0) {
        // No deliverable subscriptions — a failure, not a success (audit §2).
        Sentry.captureMessage(
          '[cron/morning-briefing] briefing user has zero deliverable subscriptions',
          { level: 'warning', tags: { route: 'cron/morning-briefing', userId } },
        );
        await releaseClaim();
        results.push({ userId, status: 'no-subscriptions' });
        continue;
      }

      await supabase
        .from('notification_log')
        .update({ notification_count: 1 })
        .eq('user_id', userId)
        .eq('scheduled_dose_id', dedupeKey)
        .eq('notification_count', 0);
      results.push({ userId, status: 'sent' });
    } catch (err) {
      console.error('[cron/morning-briefing] user failed', userId, err);
      Sentry.captureException(err, { tags: { route: 'cron/morning-briefing', userId } });
      results.push({ userId, status: 'error' });
    }
  }

  Sentry.captureCheckIn({ checkInId, monitorSlug: MONITOR_SLUG, status: 'ok' });
  return NextResponse.json({ processed: results.length, results });
}
```

- [ ] **Step 2: Type-check + build**

Run: `npx tsc --noEmit && npm run build`
Expected: clean. (If the `active_protocols!inner ( status )` embed typing complains,
mirror the array/object narrowing used in `cron/notify` — do NOT add `any`.)

- [ ] **Step 3: Local idempotency double-fire check**

Prereq: `.env.local` present with `CRON_SECRET`, Supabase env, VAPID keys, and
migration 029 applied to the DB you point at (local/staging; production application
is owner-only). Start dev server, then:

```bash
set -a && source .env.local && set +a
curl -s -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/morning-briefing
curl -s -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/morning-briefing
```

Expected: first call → each enabled user `"status":"sent"` (or
`"no-subscriptions"`/`"quiet-hours"`); second call → `"status":"already-sent"` for
every user that got `"sent"`. Also: `curl -s http://localhost:3000/api/cron/morning-briefing`
(no header) → `{"error":"Unauthorized"}` 401. If no DB with 029 is reachable, record
this step as deferred-to-owner in the PR body — do NOT apply the migration yourself.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/cron/morning-briefing/route.ts
git commit -m "feat: morning-briefing cron route (CRON_SECRET, Sentry monitor, per-day dedupe)"
```

---

### Task 7: In-app dismissible card on the Schedule page

**Files:**
- Create: `src/components/app/MorningBriefingCard.tsx`
- Modify: `src/app/app/page.tsx`

**Interfaces:**
- Consumes: `/api/health/oura/summary?days=31` (existing route; response
  `{ connected, days: [{ localDate, readinessScore, sleepScore, sleepAvgHrv,
  temperatureDeviation, ... }] }` in camelCase), `buildBriefing`/`baselineAverage`
  from Task 3, `notificationSettings.morningBriefingEnabled` from Task 5.
- **Storage decision (recorded): derive on-the-fly, store nothing.** Justification:
  (1) the briefing is a pure function of data that already has an authenticated read
  endpoint (`/api/health/oura/summary`) plus store-local dose counts — persisting it
  would duplicate state that can never disagree with its inputs; (2) the same leaf
  module produces the push text server-side, so copy parity is guaranteed by code
  identity, not by a stored row; (3) zero migration, zero new API surface, and the
  card works even for days when the push was skipped (quiet hours). Cost: one extra
  summary fetch on Schedule mount — acceptable (OuraTab already fetches the same
  endpoint at `days=90` on the Progress page).

- [ ] **Step 1: Write the card component**

```tsx
'use client';
// Dismissible in-app copy of today's morning briefing (W3-B). Derives the text
// on the fly from /api/health/oura/summary with the SAME pure buildBriefing()
// the cron push uses — nothing is stored (decision recorded in the plan).
import { useEffect, useState } from 'react';

import {
  baselineAverage,
  buildBriefing,
  type Briefing,
  type BriefingSnapshot,
} from '@/lib/briefing/briefing';

type SummaryDay = {
  localDate: string;
  readinessScore: number | null;
  sleepScore: number | null;
  sleepAvgHrv: number | null;
  temperatureDeviation: number | null;
};

const DISMISS_KEY = 'medremind-briefing-dismissed-v1';

const SEVERITY_STYLE: Record<Briefing['severity'], { border: string; bg: string; icon: string }> = {
  good: { border: 'rgba(16,185,129,0.35)', bg: 'rgba(16,185,129,0.08)', icon: '🌤' },
  info: { border: 'rgba(59,130,246,0.3)', bg: 'rgba(59,130,246,0.08)', icon: '☀️' },
  caution: { border: 'rgba(251,191,36,0.35)', bg: 'rgba(251,191,36,0.08)', icon: '🌥' },
  warning: { border: 'rgba(248,81,73,0.35)', bg: 'rgba(248,81,73,0.08)', icon: '🌡' },
};

export function MorningBriefingCard({ todayStr, doseCount }: { todayStr: string; doseCount: number }) {
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    setDismissed(localStorage.getItem(DISMISS_KEY) === todayStr);
  }, [todayStr]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/health/oura/summary?days=31')
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { connected?: boolean; days?: SummaryDay[] } | null) => {
        if (cancelled || !payload?.connected || !Array.isArray(payload.days)) return;
        const todayRow = payload.days.find((day) => day.localDate === todayStr) ?? null;
        if (!todayRow) return; // no Oura data for today → no card (push may still have fired the generic copy)
        const baselineDays = payload.days.filter((day) => day.localDate !== todayStr);
        const snapshot: BriefingSnapshot = {
          readinessScore: todayRow.readinessScore,
          sleepScore: todayRow.sleepScore,
          sleepAvgHrv: todayRow.sleepAvgHrv,
          temperatureDeviation: todayRow.temperatureDeviation,
        };
        setBriefing(
          buildBriefing(
            snapshot,
            {
              readinessAvg30: baselineAverage(baselineDays.map((day) => day.readinessScore)),
              hrvAvg30: baselineAverage(baselineDays.map((day) => day.sleepAvgHrv)),
            },
            doseCount,
          ),
        );
      })
      .catch(() => {
        // Summary unavailable — the card simply doesn't render.
      });
    return () => {
      cancelled = true;
    };
  }, [todayStr, doseCount]);

  if (dismissed || !briefing) return null;
  const style = SEVERITY_STYLE[briefing.severity];

  return (
    <div
      data-testid="morning-briefing-card"
      className="rounded-2xl border p-4 mb-5"
      style={{ borderColor: style.border, background: style.bg }}
    >
      <div className="flex items-start gap-3">
        <span className="text-2xl">{style.icon}</span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold text-[#F0F6FC]">{briefing.title}</div>
          <div className="text-xs text-[#8B949E] mt-1 leading-relaxed">{briefing.body}</div>
        </div>
        <button
          type="button"
          aria-label="Скрыть брифинг"
          onClick={() => {
            localStorage.setItem(DISMISS_KEY, todayStr);
            setDismissed(true);
          }}
          className="text-[#8B949E] hover:text-[#F0F6FC] text-lg leading-none px-1"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Insert into the Schedule page**

In `src/app/app/page.tsx`:

(a) add the import after the `AddDoseSheet` import:

```ts
import { MorningBriefingCard } from '@/components/app/MorningBriefingCard';
```

(b) pull `notificationSettings` out of the store — extend the existing
`useStore()` destructuring (line ~45) with `notificationSettings,`.

(c) in the scroll area, directly ABOVE the `{/* Next dose banner */}` block
(line ~243), add:

```tsx
        {/* Morning briefing (W3-B) — today only, opt-in via Settings */}
        {selectedDate === todayStr && notificationSettings.morningBriefingEnabled && (
          <MorningBriefingCard todayStr={todayStr} doseCount={total} />
        )}
```

(`total` is already computed by `selectAppSummaryMetrics` above — it is the day's
scheduled dose count, matching what the push reports.)

- [ ] **Step 3: Verify + commit**

Run: `npx tsc --noEmit && npm run build`
Expected: clean.

```bash
git add src/components/app/MorningBriefingCard.tsx src/app/app/page.tsx
git commit -m "feat: dismissible morning-briefing card on the schedule page"
```

---

### Task 8: E2E — card renders with stubbed summary and dismisses

**Files:**
- Create: `tests/e2e/morningBriefing.spec.ts`

**Interfaces:**
- Follows the hardened-harness rules (workers: 1, cleanup in the test itself —
  PR #63): the test enables the toggle through the real Settings UI, stubs the
  summary endpoint, asserts the card, dismisses it, and toggles back off at the end.

- [ ] **Step 1: Write the spec**

```ts
import { expect, test, type Page } from '@playwright/test';
import { format } from 'date-fns';

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

function summaryStub(todayStr: string) {
  const days = [];
  for (let offset = 10; offset >= 1; offset -= 1) {
    const date = new Date();
    date.setDate(date.getDate() - offset);
    days.push({
      localDate: format(date, 'yyyy-MM-dd'),
      readinessScore: 75,
      sleepScore: 70,
      sleepAvgHrv: 60,
      temperatureDeviation: 0,
    });
  }
  days.push({
    localDate: todayStr,
    readinessScore: 88,
    sleepScore: 82,
    sleepAvgHrv: 66,
    temperatureDeviation: 0.1,
  });
  return { connected: true, lastSyncAt: new Date().toISOString(), battery: null, days };
}

async function setBriefingToggle(page: Page, enabled: boolean) {
  await page.goto('/app/settings');
  const toggleRow = page.locator('div', { hasText: 'Утренний брифинг' }).last();
  const toggle = toggleRow.locator('button').first();
  const isOn = (await toggle.getAttribute('class'))?.includes('bg-[#3B82F6]') ?? false;
  if (isOn !== enabled) await toggle.click();
  await page.getByRole('button', { name: 'Save Notifications' }).click();
}

test('morning briefing card renders from stubbed summary and dismisses for the day', async ({ page }) => {
  const todayStr = format(new Date(), 'yyyy-MM-dd');
  await page.route('**/api/health/oura/summary*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(summaryStub(todayStr)) }),
  );

  await login(page);
  await setBriefingToggle(page, true);
  try {
    await page.goto('/app');

    const card = page.getByTestId('morning-briefing-card');
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card).toContainText('Утренний брифинг: отличная готовность');
    await expect(card).toContainText('Готовность 88 · сон 82.');
    await expect(card).toContainText('HRV 66 мс — +10% к 30-дневной норме.');

    await card.getByRole('button', { name: 'Скрыть брифинг' }).click();
    await expect(card).toBeHidden();

    // Dismissal is per-day persistent.
    await page.reload();
    await expect(page.getByTestId('morning-briefing-card')).toBeHidden();
  } finally {
    // Shared-account cleanup (PR #63 rules): leave the toggle off.
    await setBriefingToggle(page, false);
  }
});
```

- [ ] **Step 2: Run it**

Run: `npm run test:e2e -- morningBriefing.spec.ts`
Expected: 1 passed (or `skipped` without creds — then run locally with
`E2E_EMAIL`/`E2E_PASSWORD` from `.env.local` before the PR and paste the output
into the PR body).

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/morningBriefing.spec.ts
git commit -m "test: e2e morning-briefing card render + per-day dismissal"
```

---

### Task 9: Full verification, PR, owner hand-off

- [ ] **Step 1: Full local gate**

Run: `npx tsc --noEmit && npm run test:unit && npm run test:correlation && npm run build`
Expected: all pass. (`test:correlation` includes the 3 new `.test.mjs` files.)

- [ ] **Step 2: grep hygiene**

Run: `git diff origin/main --name-only | xargs grep -n "console\.log" || true`
Expected: no output (only pre-existing `console.error`/`warn` in touched files).

- [ ] **Step 3: Push + PR — then STOP**

```bash
git push -u origin codex/w3b-morning-briefing
gh pr create --base main --title "feat: W3-B morning briefing — readiness-aware daily push + in-app card" --body "Implements docs/superpowers/plans/2026-07-18-morning-briefing.md.

- Pure leaf module src/lib/briefing/briefing.ts (baseline math + rule-based RU copy, NO LLM by design) shared by cron push and Schedule card
- New cron route /api/cron/morning-briefing: CRON_SECRET, Sentry monitor cron-morning-briefing ('30 6 * * *', Europe/London), quiet-hours guard, one-per-local-day dedupe via deterministic UUID in notification_log
- Migration 029: notification_settings.morning_briefing_enabled (default off) — 028 is reserved by W3-A; ledger updated. NOT applied — owner applies.
- Settings toggle «Утренний брифинг»; dismissible Schedule-page card derives copy on the fly from /api/health/oura/summary (no storage — see plan Task 7 justification)

Test evidence: <paste tsc/test:unit/test:correlation/build/E2E output>

Owner post-merge steps (NOT done by this PR): apply migration 029; create cron-job.org job GET /api/cron/morning-briefing daily 06:30 Europe/London with Authorization: Bearer CRON_SECRET."
```

STOP. Do not merge (production deploy on merge — owner-only). Do not apply
migration 029. Do not create the cron-job.org job. Report PR URL, verification
output, and any deviations with reasons.
