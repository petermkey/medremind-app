# Oura Stats Page — Design Spec

**Date:** 2026-07-14 · **Status:** approved by owner (chat), pending spec review
**Placement:** new "Oura" tab inside `/app/progress`
**Purpose:** (A) morning glance — how did I recover tonight vs my personal norm; (B) trends — where are my metrics heading over 7/30/90 days. All visualization is **histogram-style bars** (no lines, no chart libraries).

---

## 1. Navigation & placement

- `/app/progress` gets a segmented control at the top: **Correlations | Oura**.
- Active tab is persisted in the URL query param `?tab=oura` (deep-linkable, survives reload). Default (no param) = Correlations — existing behavior unchanged.
- The existing Progress content (consent gate, correlation cards, medication-knowledge status) moves under the Correlations tab **without modification**.
- No changes to `BottomNav`.

## 2. Data access

### New API route: `GET /api/health/oura/summary`

- Auth: user session via `createServerClient` (`@/lib/supabase/server`). **No service role** — both source tables already have owner-read RLS policies (`external_health_daily_snapshots`: "Owner read external health snapshots"; `external_health_connections`: "Owner read external health connections").
- Query param `days` (optional, default 90, clamped to [7, 90]).
- Response (camelCase, days ascending by date):

```jsonc
{
  "connected": true,                  // external_health_connections row with source='oura' and status in ('connected','error')
  "lastSyncAt": "2026-07-14T15:05:00Z" | null,
  "battery": { "level": 78, "charging": false, "at": "..." } | null,  // null until ring_configuration scope granted
  "days": [
    {
      "localDate": "2026-07-14",
      "sleepScore": 82, "readinessScore": 77, "activityScore": 61,
      "sleepAvgHrv": 46, "deepSleepMinutes": 92, "remSleepMinutes": 74,
      "sleepEfficiency": 91, "sleepLatencySeconds": 480,
      "minutesToFirstDeepSleep": 14, "deepSleepFirstThirdMinutes": 18, "hrvRecoveryDelta": 15.1,
      "restingHeartRate": 52, "respiratoryRate": 14.2,
      "averageSpo2": 96.4, "breathingDisturbanceIndex": 3,
      "temperatureDeviation": -0.32, "temperatureTrendDeviation": -0.1,
      "steps": 8123, "activeCalories": 410, "totalCalories": 2450,
      "stressHighSeconds": 1200, "recoveryHighSeconds": 5400,
      "vo2Max": 41, "cardiovascularAge": 34, "resilienceLevel": "solid",
      "nonWearMinutes": 232
      // any field may be null
    }
  ]
}
```

- The client fetches **once with days=90** on tab open; the 7/30/90 switch filters client-side (no refetch).
- 401 for unauthenticated; `{ connected: false, days: [] }` when no Oura connection row exists.

## 3. First screen — "Last night" (aspect A)

UI copy is **English** (matches the rest of the app UI).

1. **Freshness pill** (style of `SyncStatusPill`): `Synced 2h ago · 🔋 78%`. Battery segment hidden while `battery` is null. If `lastSyncAt` older than **12 h** → amber pill + hint "Data may be stale — sync runs every 6h".
2. **Hero card — 4 large tiles:** Sleep score · Readiness · Night HRV (`sleepAvgHrv`) · Temperature (`temperatureDeviation`, shown as `-0.32 °C`).
   - Each tile shows a **delta vs personal norm**. Norm = **median of the previous 30 days** (excluding the displayed night), computed per metric over non-null values; requires **≥ 7** non-null values, otherwise delta is hidden.
   - Delta coloring is direction-aware (see §5). Temperature is colored by absolute value, not by delta: |dev| < 0.3 °C neutral · 0.3–0.5 amber · > 0.5 red.
3. **Secondary rows** (dense list): Deep sleep (min) · REM (min) · Time to first deep (min) · Overnight HRV recovery (`hrvRecoveryDelta`, signed) · Resting HR · Respiratory rate · SpO2 · Breathing disturbance index. Each row: label — value — small delta chip (same norm/direction rules).
4. **Night fallback:** if the latest day has no sleep data (`sleepScore` and `deepSleepMinutes` both null), the card shows the most recent night that has data, with an explicit date badge ("Night of Jul 12"). Never an empty hero.

## 4. Trends section (aspect B)

One period switcher for the whole section: **7 / 30 / 90** (default 30). Four groups, each a titled card containing bar charts. A chart renders as a single `<svg>` with `<rect>` per day (90 rects max — cheaper than 90 divs, crisp on retina).

| Group | Charts |
|---|---|
| 😴 Sleep | sleep score · deep sleep minutes · night HRV |
| 🔄 Recovery | readiness score · **temperature deviation — diverging bars around a zero line** (above 0 warm/red-tinted, below 0 blue-tinted) · resting HR |
| 🏃 Activity | steps · high-stress vs recovery seconds (two series, paired bars per day) |
| 📈 Long-horizon | VO2max · cardiovascular age · resilience — **stat tiles**, not daily bars: latest non-null value, comparison defined as *mean over the selected window vs mean over the preceding window of the same length* (e.g. at 30d: "41 · was 39 in the prior 30d"; hidden when either window has no data), and a strip of **weekly averages** (calendar weeks, Mon-start; up to 13 buckets at 90d). Resilience maps `limited/adequate/solid/strong/exceptional` → 1–5 for bar height, label shown as text. |

Chart rules (all charts):
- **Missing day = empty slot** (gap), never a zero-height bar.
- **Low-wear day** (`nonWearMinutes > 480`) = bar at 30% opacity.
- Default bar fill: app accent (#3B82F6) at 80% opacity; the latest day at 100%.
- A dashed horizontal line at the personal 30-day median (when computable).
- Axis labels: first date, last date only. Y auto-scales to the window's min/max with a small padding; score charts (0–100 metrics) always use 0–100.
- **Tap a bar** → tooltip with date + value; one tooltip at a time; tap elsewhere dismisses.
- A chart whose values are all null in the selected window is hidden; a group with no visible charts is hidden entirely.

## 5. Metric direction table (for delta colors)

- **Higher is better:** sleepScore, readinessScore, activityScore, sleepAvgHrv, deepSleepMinutes, remSleepMinutes, sleepEfficiency, hrvRecoveryDelta, recoveryHighSeconds, steps, vo2Max, averageSpo2.
- **Lower is better:** restingHeartRate, respiratoryRate, breathingDisturbanceIndex, stressHighSeconds, sleepLatencySeconds, minutesToFirstDeepSleep, cardiovascularAge.
- **Near zero is better:** temperatureDeviation (absolute thresholds in §3).
- Green when the change is in the "better" direction beyond a per-metric noise floor (default: 3% of the norm, minimum 1 unit); red when worse beyond it; neutral grey inside the floor.

## 6. States

- **Not connected** (`connected: false`): single card — "Connect Oura in Settings to see your health stats" + link to `/app/settings`.
- **Connected, zero days:** card — "No data yet. Run a sync from Settings." + link.
- **Partial data:** hidden-chart/hidden-group rule from §4 (e.g. VO2max group absent until the heart_health-scoped data exists).
- **Fetch error:** inline retry card, no crash of the Correlations tab.

## 7. Module boundaries

| Unit | Responsibility | Depends on |
|---|---|---|
| `src/lib/health/ouraStats.ts` | **Pure leaf module, zero imports** (strip-types test-runner constraint): median norm, delta + direction classification, weekly bucketing, bar-height normalization, night-fallback pick, low-wear flag | — |
| `src/lib/health/ouraStats.test.mjs` | its tests (added to `test:correlation`) | ouraStats.ts |
| `src/app/api/health/oura/summary/route.ts` | auth, two RLS-scoped selects, snake→camel mapping, clamping | supabase server client |
| `src/components/app/oura/OuraTab.tsx` | fetch, period state, layout, state cards | ouraStats, children |
| `src/components/app/oura/NightCard.tsx` | hero + secondary rows | ouraStats |
| `src/components/app/oura/TrendChart.tsx` | one SVG bar chart; props: `values (Array<number|null>)`, `dates`, `mode: 'bars' | 'diverging' | 'paired'`, `lowWearMask`, `median`, `fixedDomain?` | ouraStats (normalization) |
| `src/components/app/oura/LongMetricTile.tsx` | stat tile with weekly strip | ouraStats |
| `src/app/app/progress/page.tsx` | adds the segmented control + `?tab=` handling; existing content untouched under Correlations | OuraTab |

## 8. Testing

- Unit (strip-types runner): median/norm edge cases (<7 values → null), direction classification incl. near-zero temperature, weekly bucketing across month boundaries, night-fallback selection, bar normalization (missing vs zero, fixed 0–100 domain).
- Type/build gates: `npx tsc --noEmit`, `npm run build`.
- E2E (existing Playwright setup): smoke — Progress opens, tab switch works, Oura tab renders the not-connected state for a user without a connection (mock-free path).
- Live verification: open `/app/progress?tab=oura` on the dev server against prod data (47+ days available) and visually confirm hero + trends.

## 9. Non-goals (v1)

- No intraday 5-minute heart-rate chart (data exists; page v1 stays daily-granularity).
- No changes to the correlation engine, sync engine, or Oura endpoints.
- No export/share, no per-metric settings, no i18n beyond existing app language (English).
- No dose-response visualizations here (postDoseHrDeltaBpm lives in correlation cards).
