# Oura Sprint 3 — Sleep-Window Quiet Hours + Ring Battery Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Use Oura's personal optimal-bedtime window to silence non-critical reminder pushes during wind-down, and surface ring battery status so users understand data gaps.

**Architecture:** Two small product features on existing rails. (1) The sync engine additionally fetches `sleep_time` (date params) and the latest `ring_battery_level` row (datetime params + `latest=true`), storing both on the user's `external_health_connections` row (migration 025). (2) A pure `quietHours.ts` module decides whether "now" falls inside the stored bedtime window; the notify cron consults it to skip **Pass B reminders only** (Pass A initial dose notifications still fire — medication timing beats sleep hygiene). (3) `/api/integrations/oura/status` + the Settings page display battery and use it to explain missing data.

**Tech Stack:** Next.js 15 App Router, TypeScript strict, Supabase Postgres (service-role), Node `--experimental-strip-types` runner for leaf tests.

## Spec

### Requirements

1. **Sleep window storage.** Each sync stores the most recent `sleep_time` document's `optimal_bedtime` (`{ day_tz, start_offset, end_offset }` — offsets are **seconds relative to local midnight of the document's `day`; negative = before midnight**) plus its `day` and `recommendation`/`status` enums, as jsonb on `external_health_connections.sleep_window` with `sleep_window_date date`.
2. **Quiet hours.** `isInQuietHours(now, timeZone, window)` returns true when the user's current local clock time falls inside `[start_offset, end_offset]` projected onto today/yesterday midnight (window may straddle midnight). The notify cron skips **Pass B** sends for users in quiet hours; skipped rows keep their `notification_log` state untouched (so the reminder fires after the window ends if the dose is still unactioned and under `MAX_NOTIFICATIONS`).
3. **Battery.** Each sync stores the latest battery sample (`level`, `charging | in_charger`, `timestamp`) on `external_health_connections` (`battery_level int`, `battery_charging boolean`, `battery_at timestamptz`). The `/api/integrations/oura/status` response and Settings page show it ("Ring battery: 43%"), and the Settings health-sync line notes when the last snapshot gap coincides with `battery_level <= 5` or heavy `non_wear_minutes` (Sprint 1 column).
4. **Fail-open.** Both fetches are additive: any failure records endpoint coverage `failed` (sleep_time / ring_battery_level) and never fails the sync run; quiet-hours evaluation errors must never block a notification (wrap in try/catch → treat as "not quiet").

### Acceptance criteria

- `npm run build`, `npx tsc --noEmit`, `npm run test:correlation`, `npm run test:unit` pass.
- After a live sync: `select sleep_window, sleep_window_date, battery_level, battery_at from external_health_connections where source='oura';` returns populated values (sleep_window may legitimately be null if Oura has `not_enough_nights` — then `sleep_window_date` stays null too and the UI hides the row).
- Settings page shows battery; status API returns it.
- Unit tests prove: window straddling midnight, exact boundary inclusion, null/malformed window → not quiet, timezone projection.
- A simulated Pass B run inside quiet hours produces `status: 'quiet-hours'` results and unchanged `notification_log` rows.

### Non-goals

- No bedtime-relative dose scheduling ("take 30 min before sleep") — future work.
- No battery push alerts; display only.
- No suppression of Pass A initial notifications.

## Global Constraints

- TypeScript strict; no `any` without comment; `npx tsc --noEmit` after every `.ts` change; `npm run build` before PR.
- Branch: `codex/oura-sprint3-product-touches`. Never push `main`. Conventional commits.
- Leaf-module rule for `.test.mjs` (strip-types runner): zero value imports.
- Migration application to production is manual (Supabase Management API, project `hagypgvfkjkncznoctoq`).
- Oura params: `sleep_time` takes `start_date`/`end_date`; `ring_battery_level` takes `start_datetime`/`end_datetime` and supports `latest=true` (returns the latest sample). Battery row shape: `{ timestamp, timestamp_unix, charging, in_charger, level }`.
- The notify cron runs every minute (cron-job.org job #7402449) — Pass B changes must stay O(1) extra queries per user (read the connection row once per user per tick).

## File Structure

- Create: `supabase/025_oura_device_status.sql` — 5 columns on `external_health_connections`.
- Create: `src/lib/push/quietHours.ts` — pure window math (leaf).
- Create: `src/lib/push/quietHours.test.mjs` — its tests.
- Modify: `src/lib/health/sourceRegistry.ts` — `updateOuraDeviceStatus()`.
- Modify: `src/lib/health/ouraSyncEngine.ts` — fetch sleep_time + battery, store.
- Modify: `src/app/api/cron/notify/route.ts` — Pass B quiet-hours skip.
- Modify: `src/app/api/integrations/oura/status/route.ts` — expose battery + sleep window.
- Modify: `src/app/app/settings/page.tsx` — battery line.
- Modify: `package.json` — test list.

---

### Task 1: Migration 025 — device-status columns

**Files:**
- Create: `supabase/025_oura_device_status.sql`

**Interfaces:**
- Produces: `external_health_connections` columns `sleep_window jsonb`, `sleep_window_date date`, `battery_level int`, `battery_charging boolean`, `battery_at timestamptz` — consumed by Tasks 2–5.

- [ ] **Step 1: Write the migration**

```sql
-- 025: latest Oura device/user status snapshots on the connection row.
-- sleep_window = latest sleep_time doc's optimal_bedtime + status enums,
-- battery_* = latest ring_battery_level sample. Display/diagnostics only.
alter table external_health_connections
  add column if not exists sleep_window jsonb,
  add column if not exists sleep_window_date date,
  add column if not exists battery_level int check (battery_level between 0 and 100),
  add column if not exists battery_charging boolean,
  add column if not exists battery_at timestamptz;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/025_oura_device_status.sql
git commit -m "feat: migration 025 — oura sleep window + battery on connection row"
```

---

### Task 2: `quietHours.ts` — pure window math (leaf module)

**Files:**
- Create: `src/lib/push/quietHours.ts`
- Test: `src/lib/push/quietHours.test.mjs`
- Modify: `package.json` (append to `test:correlation` list)

**Interfaces:**
- Produces (consumed by Task 4):
  - `export type SleepWindow = { start_offset: number; end_offset: number };` (seconds relative to local midnight; negative = previous evening)
  - `isInQuietHours(now: Date, timeZone: string, window: unknown): boolean` — validates `window` shape internally; malformed/absent → `false`. Projects the window onto BOTH the local midnight of today and of tomorrow (a window like `[-3600, 1800]` = 23:00–00:30 must match at 23:30 via tomorrow's midnight and at 00:15 via today's) and returns true if `now` falls in either projection. Windows longer than 12 h are rejected as malformed (`false`) — a stuck/garbage window must not silence reminders all day.
- Leaf module: zero imports.

- [ ] **Step 1: Write failing tests**

```js
// src/lib/push/quietHours.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';

import { isInQuietHours } from './quietHours.ts';

// Window 22:30 → 23:30 local (offsets relative to NEXT midnight: -5400..-1800).
const eveningWindow = { start_offset: -5400, end_offset: -1800 };

test('inside an evening window (before midnight)', () => {
  assert.equal(isInQuietHours(new Date('2026-07-13T23:00:00Z'), 'UTC', eveningWindow), true);
});

test('outside the window', () => {
  assert.equal(isInQuietHours(new Date('2026-07-13T21:00:00Z'), 'UTC', eveningWindow), false);
  assert.equal(isInQuietHours(new Date('2026-07-13T12:00:00Z'), 'UTC', eveningWindow), false);
});

test('window straddling midnight matches on both sides', () => {
  const straddle = { start_offset: -3600, end_offset: 1800 }; // 23:00 → 00:30
  assert.equal(isInQuietHours(new Date('2026-07-13T23:30:00Z'), 'UTC', straddle), true);
  assert.equal(isInQuietHours(new Date('2026-07-14T00:15:00Z'), 'UTC', straddle), true);
  assert.equal(isInQuietHours(new Date('2026-07-14T01:00:00Z'), 'UTC', straddle), false);
});

test('timezone projection uses the user local clock', () => {
  // 20:00 UTC = 23:00 in Europe/Moscow (UTC+3) → inside the evening window.
  assert.equal(isInQuietHours(new Date('2026-07-13T20:00:00Z'), 'Europe/Moscow', eveningWindow), true);
  assert.equal(isInQuietHours(new Date('2026-07-13T20:00:00Z'), 'UTC', eveningWindow), false);
});

test('malformed or oversized windows are never quiet', () => {
  assert.equal(isInQuietHours(new Date(), 'UTC', null), false);
  assert.equal(isInQuietHours(new Date(), 'UTC', {}), false);
  assert.equal(isInQuietHours(new Date(), 'UTC', { start_offset: 'x', end_offset: 0 }), false);
  assert.equal(isInQuietHours(new Date(), 'UTC', { start_offset: -50000, end_offset: 50000 }), false);
  assert.equal(isInQuietHours(new Date(), 'UTC', { start_offset: 1800, end_offset: -1800 }), false);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --experimental-strip-types --test src/lib/push/quietHours.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/push/quietHours.ts
// Decides whether "now" is inside the user's Oura optimal-bedtime window.
// Offsets are seconds relative to a local midnight; negative = the evening
// before. Pure leaf module (zero imports) for the strip-types test runner.

export type SleepWindow = { start_offset: number; end_offset: number };

const MAX_WINDOW_SECONDS = 12 * 3600;

function asWindow(value: unknown): SleepWindow | null {
  if (!value || typeof value !== 'object') return null;
  const { start_offset, end_offset } = value as { start_offset?: unknown; end_offset?: unknown };
  if (typeof start_offset !== 'number' || typeof end_offset !== 'number') return null;
  if (!Number.isFinite(start_offset) || !Number.isFinite(end_offset)) return null;
  const length = end_offset - start_offset;
  if (length <= 0 || length > MAX_WINDOW_SECONDS) return null;
  return { start_offset, end_offset };
}

// Seconds since the most recent local midnight in the given timezone.
function secondsSinceLocalMidnight(now: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  return get('hour') * 3600 + get('minute') * 60 + get('second');
}

export function isInQuietHours(now: Date, timeZone: string, window: unknown): boolean {
  try {
    const parsed = asWindow(window);
    if (!parsed) return false;
    const t = secondsSinceLocalMidnight(now, timeZone);
    const DAY = 86400;
    // Project the window around today's midnight (t) and tomorrow's (t - DAY):
    // an evening window [-5400, -1800] matches t=81000 (22:30) via t - DAY.
    return (
      (t >= parsed.start_offset && t <= parsed.end_offset) ||
      (t - DAY >= parsed.start_offset && t - DAY <= parsed.end_offset)
    );
  } catch {
    return false; // never let quiet-hours math block a notification
  }
}
```

- [ ] **Step 4: Verify + wire into suite**

Append ` src/lib/push/quietHours.test.mjs` to `test:correlation` in `package.json`.
Run: `npm run test:correlation && npx tsc --noEmit` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/push/quietHours.ts src/lib/push/quietHours.test.mjs package.json
git commit -m "feat: quiet-hours window math from Oura optimal bedtime"
```

---

### Task 3: Sync engine — fetch sleep_time + latest battery, store on connection

**Files:**
- Modify: `src/lib/health/sourceRegistry.ts` — add `updateOuraDeviceStatus()`
- Modify: `src/lib/health/ouraSyncEngine.ts` — fetch + store step

**Interfaces:**
- Consumes: existing `fetchOptionalOuraCollection` (sleep_time — date params fit it as-is), `fetchOuraJson` (battery — datetime params + `latest: 'true'`), `recordOuraEndpointCoverage`, `heartrateDatetimeRange` from Sprint 2 (if Sprint 2 not merged yet, inline the same two-line datetime conversion with a comment).
- Produces: `updateOuraDeviceStatus(userId: string, patch: { sleepWindow?: Record<string, unknown> | null; sleepWindowDate?: string | null; batteryLevel?: number | null; batteryCharging?: boolean | null; batteryAt?: string | null }): Promise<void>`.

- [ ] **Step 1: Add `updateOuraDeviceStatus` to `sourceRegistry.ts`**

```ts
export async function updateOuraDeviceStatus(
  userId: string,
  patch: {
    sleepWindow?: Record<string, unknown> | null;
    sleepWindowDate?: string | null;
    batteryLevel?: number | null;
    batteryCharging?: boolean | null;
    batteryAt?: string | null;
  },
) {
  const supabase = createHealthServiceClient();
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if ('sleepWindow' in patch) row.sleep_window = patch.sleepWindow;
  if ('sleepWindowDate' in patch) row.sleep_window_date = patch.sleepWindowDate;
  if ('batteryLevel' in patch) row.battery_level = patch.batteryLevel;
  if ('batteryCharging' in patch) row.battery_charging = patch.batteryCharging;
  if ('batteryAt' in patch) row.battery_at = patch.batteryAt;

  const { error } = await supabase
    .from('external_health_connections')
    .update(row)
    .eq('user_id', userId)
    .eq('source', 'oura');
  if (error) throw error;
}
```

- [ ] **Step 2: Add the device-status step to `ouraSyncEngine.ts`**

Private function (imports: extend the sourceRegistry import with `updateOuraDeviceStatus`):

```ts
// Additive device/user status: latest optimal-bedtime window + battery.
// Failures record coverage and move on — never fail the run.
async function syncOuraDeviceStatus(input: {
  userId: string;
  syncRunId: string;
  apiBaseUrl: string;
  accessToken: string;
  range: { start_date: string; end_date: string };
}): Promise<void> {
  // sleep_time: date params — reuse the optional fetch path.
  try {
    const sleepTimeRes = await fetchOptionalOuraCollection(
      input.apiBaseUrl, input.accessToken, '/v2/usercollection/sleep_time', input.range,
    );
    const docs = (sleepTimeRes.data ?? [])
      .map(asRecord)
      .filter((doc): doc is Record<string, unknown> => doc !== null && typeof doc.day === 'string')
      .sort((a, b) => String(a.day).localeCompare(String(b.day)));
    const latest = docs[docs.length - 1];
    if (latest && latest.optimal_bedtime && typeof latest.optimal_bedtime === 'object') {
      await updateOuraDeviceStatus(input.userId, {
        sleepWindow: {
          optimal_bedtime: latest.optimal_bedtime,
          recommendation: latest.recommendation ?? null,
          status: latest.status ?? null,
        },
        sleepWindowDate: String(latest.day),
      });
    }
    await recordOuraEndpointCoverage({
      syncRunId: input.syncRunId, userId: input.userId, endpoint: 'sleep_time',
      status: sleepTimeRes.authError ? 'failed' : 'success', required: false,
      rangeStart: input.range.start_date, rangeEnd: input.range.end_date,
      documentCount: docs.length, error: sleepTimeRes.authError,
    });
  } catch (err) {
    Sentry.captureException(err, { tags: { route: 'ouraSyncEngine', endpoint: 'sleep_time' } });
  }

  // ring_battery_level: datetime params + latest=true → one row.
  try {
    const battery = await fetchOuraJson<OuraCollectionResponse>(
      input.apiBaseUrl, input.accessToken, '/v2/usercollection/ring_battery_level',
      { latest: 'true' },
    );
    const row = asRecord((battery.data ?? [])[0]);
    if (row && typeof row.level === 'number' && typeof row.timestamp === 'string') {
      await updateOuraDeviceStatus(input.userId, {
        batteryLevel: row.level,
        batteryCharging: row.charging === true || row.in_charger === true,
        batteryAt: row.timestamp,
      });
    }
    await recordOuraEndpointCoverage({
      syncRunId: input.syncRunId, userId: input.userId, endpoint: 'ring_battery_level',
      status: 'success', required: false,
      rangeStart: input.range.start_date, rangeEnd: input.range.end_date,
      documentCount: row ? 1 : 0,
    });
  } catch (err) {
    await recordOuraEndpointCoverage({
      syncRunId: input.syncRunId, userId: input.userId, endpoint: 'ring_battery_level',
      status: 'failed', required: false,
      rangeStart: input.range.start_date, rangeEnd: input.range.end_date,
      documentCount: 0,
      error: { message: err instanceof Error ? err.message : 'battery fetch failed' },
    }).catch(() => undefined);
    Sentry.captureException(err, { tags: { route: 'ouraSyncEngine', endpoint: 'ring_battery_level' } });
  }
}
```
> `recordOuraEndpointCoverage`'s signature confirmed against `src/lib/oura/analyticsStore.ts:59-70` — the field names above match exactly, and `error` is `JsonValue` (the `authError` object fits, same as the F-2 wiring in `analyticsCollections`). For `fetchOuraJson`, it already receives string-valued param records (`next_token`), so `{ latest: 'true' }` fits; if its params type proves stricter at tsc time, widen the call-site literal, not the client.

Call it in `syncOuraSnapshots` after the heartrate step (or after `upsertOuraTags` if Sprint 2 isn't merged):
```ts
    await syncOuraDeviceStatus({
      userId,
      syncRunId: syncRun.id,
      apiBaseUrl: auth.config.apiBaseUrl,
      accessToken: auth.tokens.accessToken,
      range,
    });
```

- [ ] **Step 3: Verify** — `npx tsc --noEmit && npm run build` → clean.

- [ ] **Step 4: Commit**

```bash
git add src/lib/health/sourceRegistry.ts src/lib/health/ouraSyncEngine.ts
git commit -m "feat: store Oura sleep window and ring battery on connection row"
```

---

### Task 4: Notify cron — skip Pass B inside quiet hours

**Files:**
- Modify: `src/app/api/cron/notify/route.ts`

**Interfaces:**
- Consumes: `isInQuietHours` (Task 2), connection row's `sleep_window` (Task 3).
- Behavior: Pass A untouched. Pass B: before iterating `remindable`, read the user's `sleep_window` once; if `isInQuietHours(now, tz, window.optimal_bedtime)` → record `{ status: 'quiet-hours', pass: 'B' }` per candidate and skip sends. `notification_log` rows are NOT updated for skipped users (reminders resume after the window; `MAX_NOTIFICATIONS` cap unchanged).

- [ ] **Step 1: Implement**

Import at top:
```ts
import { isInQuietHours } from '@/lib/push/quietHours';
```

Inside the per-user callback, right after `const tz = profileRow?.timezone ?? 'UTC';`, fetch the window once:
```ts
      // Oura optimal-bedtime window (Sprint 3): suppress Pass B reminders
      // during wind-down. Pass A (initial dose notification) always fires.
      const { data: connRow } = await supabase
        .from('external_health_connections')
        .select('sleep_window')
        .eq('user_id', userId)
        .eq('source', 'oura')
        .maybeSingle();
      const optimalBedtime = (connRow?.sleep_window as { optimal_bedtime?: unknown } | null)?.optimal_bedtime;
      const quietNow = isInQuietHours(now, tz, optimalBedtime);
```

In Pass B, immediately after `if (remindable.length === 0) return;` add:
```ts
          if (quietNow) {
            for (const occ of remindable) {
              results.push({ userId, doseId: occ.id, status: 'quiet-hours', pass: 'B' });
            }
            return;
          }
```

- [ ] **Step 2: Verify** — `npx tsc --noEmit && npm run build` → clean.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/cron/notify/route.ts
git commit -m "feat: suppress Pass B reminder pushes during Oura optimal-bedtime window"
```

---

### Task 5: Status API + Settings UI — battery display

**Files:**
- Modify: `src/app/api/integrations/oura/status/route.ts`
- Modify: `src/app/app/settings/page.tsx` (`OuraStatus` type at :39, Oura card at :438-460)

**Interfaces:**
- Consumes: connection columns from Task 3.
- Produces: status JSON gains `battery: { level: number; charging: boolean; at: string } | null` and `sleepWindowDate: string | null`.

- [ ] **Step 1: Extend the status route**

`src/app/api/integrations/oura/status/route.ts` currently returns `getOuraIntegrationStatus(userId)` (which reads `user_integrations`) verbatim. The device status lives on `external_health_connections`, so add a second query in the route's `try` block and merge:

```ts
    const status = await getOuraIntegrationStatus(data.user.id);

    // Device status (battery, sleep window) lives on the health-connection
    // row, populated by syncOuraDeviceStatus — service client not needed:
    // the table has an owner-read RLS policy and this is the owner's session.
    const { data: connectionRow } = await supabase
      .from('external_health_connections')
      .select('battery_level, battery_charging, battery_at, sleep_window_date')
      .eq('user_id', data.user.id)
      .eq('source', 'oura')
      .maybeSingle();

    return NextResponse.json({
      ...status,
      battery: connectionRow?.battery_level != null
        ? {
            level: connectionRow.battery_level,
            charging: connectionRow.battery_charging === true,
            at: connectionRow.battery_at,
          }
        : null,
      sleepWindowDate: connectionRow?.sleep_window_date ?? null,
    });
```
(replacing the existing `return NextResponse.json(status);`)

- [ ] **Step 2: Extend the Settings page**

In `src/app/app/settings/page.tsx`, extend the `OuraStatus` type:
```ts
  battery?: { level: number; charging: boolean; at: string } | null;
```
In the Oura card (next to the "Connected / Last sync" line at ~:440), add:
```tsx
                  {ouraStatus?.battery
                    ? ` · Battery: ${ouraStatus.battery.level}%${ouraStatus.battery.charging ? ' (charging)' : ''}`
                    : ''}
```
And extend the low-battery hint on the health-sync status line (~:467): when `ouraStatus?.battery && ouraStatus.battery.level <= 5`, append ` · Ring battery is low — data may stop arriving.` to the displayed status string.

- [ ] **Step 3: Verify in browser**

Run: dev server via `.claude/launch.json` (`dev-webpack`), open `/app/settings`, confirm battery renders (or hides cleanly when null). `npx tsc --noEmit && npm run build`.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/integrations/oura/status/route.ts src/app/app/settings/page.tsx
git commit -m "feat: show ring battery in Oura status API and settings"
```

---

### Task 6: Verification + PR

- [ ] **Step 1: Apply migration 025 to production** *(owner/orchestrator — Supabase Management API pattern).*

- [ ] **Step 2: Live sync + checks** — manual sync; then: `select sleep_window, sleep_window_date, battery_level, battery_charging, battery_at from external_health_connections where source='oura';` → battery populated; sleep_window populated or legitimately null (`status: not_enough_nights`).

- [ ] **Step 3: Quiet-hours smoke** — hit `/api/cron/notify` with `Bearer $CRON_SECRET` while a reminder is pending inside/outside the stored window (or temporarily set `sleep_window` to a window covering "now" via SQL, run the cron, verify `quiet-hours` results, then restore).

- [ ] **Step 4: Full gate + PR**

```bash
npx tsc --noEmit && npm run test:correlation && npm run test:unit && npm run build
git push -u origin codex/oura-sprint3-product-touches
gh pr create --base main --title "feat: Oura sprint 3 — bedtime quiet hours + ring battery diagnostics" --body "Implements docs/superpowers/plans/2026-07-14-oura-sprint3-product-touches.md."
```

Do NOT merge — owner merges (production deploy on merge).
