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
          // NOTE: weekAvg rounds to whole numbers for all four fields (deviation
          // from the plan's draft, which used round1 for proteinG/fiberG/sugarsG —
          // that produced 22.5 for the sugarsG weekAvg test fixture, but the
          // plan's own test asserts 23; Math.round matches kcal's existing
          // whole-number convention and satisfies the test as written).
          weekAvg: {
            kcal: Math.round(foodDays.reduce((total, day) => total + day.kcal, 0) / foodDays.length),
            proteinG: Math.round(foodDays.reduce((total, day) => total + day.proteinG, 0) / foodDays.length),
            fiberG: Math.round(foodDays.reduce((total, day) => total + day.fiberG, 0) / foodDays.length),
            sugarsG: Math.round(foodDays.reduce((total, day) => total + day.sugarsG, 0) / foodDays.length),
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
