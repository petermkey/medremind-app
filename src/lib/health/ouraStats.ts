export type OuraMetricKey =
  | 'sleepScore'
  | 'readinessScore'
  | 'activityScore'
  | 'sleepAvgHrv'
  | 'deepSleepMinutes'
  | 'remSleepMinutes'
  | 'sleepEfficiency'
  | 'hrvRecoveryDelta'
  | 'recoveryHighSeconds'
  | 'steps'
  | 'vo2Max'
  | 'averageSpo2'
  | 'restingHeartRate'
  | 'respiratoryRate'
  | 'breathingDisturbanceIndex'
  | 'stressHighSeconds'
  | 'sleepLatencySeconds'
  | 'minutesToFirstDeepSleep'
  | 'cardiovascularAge'
  | 'temperatureDeviation'
  | 'temperatureTrendDeviation'
  | 'deepSleepFirstThirdMinutes'
  | 'activeCalories'
  | 'totalCalories'
  | 'workoutCount';

export type OuraStatsDay = {
  localDate: string;
  sleepScore?: number | null;
  readinessScore?: number | null;
  activityScore?: number | null;
  sleepAvgHrv?: number | null;
  deepSleepMinutes?: number | null;
  remSleepMinutes?: number | null;
  sleepEfficiency?: number | null;
  sleepLatencySeconds?: number | null;
  minutesToFirstDeepSleep?: number | null;
  deepSleepFirstThirdMinutes?: number | null;
  hrvRecoveryDelta?: number | null;
  restingHeartRate?: number | null;
  respiratoryRate?: number | null;
  averageSpo2?: number | null;
  breathingDisturbanceIndex?: number | null;
  temperatureDeviation?: number | null;
  temperatureTrendDeviation?: number | null;
  steps?: number | null;
  activeCalories?: number | null;
  totalCalories?: number | null;
  stressHighSeconds?: number | null;
  recoveryHighSeconds?: number | null;
  vo2Max?: number | null;
  cardiovascularAge?: number | null;
  resilienceLevel?: string | null;
  hrvBalance?: string | null;
  workoutCount?: number | null;
  nonWearMinutes?: number | null;
};

export type DeltaTone = 'positive' | 'negative' | 'warning' | 'neutral';

const HIGHER_IS_BETTER = new Set<OuraMetricKey>([
  'sleepScore',
  'readinessScore',
  'activityScore',
  'sleepAvgHrv',
  'deepSleepMinutes',
  'deepSleepFirstThirdMinutes',
  'remSleepMinutes',
  'sleepEfficiency',
  'hrvRecoveryDelta',
  'recoveryHighSeconds',
  'steps',
  'vo2Max',
  'averageSpo2',
]);

const LOWER_IS_BETTER = new Set<OuraMetricKey>([
  'restingHeartRate',
  'respiratoryRate',
  'breathingDisturbanceIndex',
  'stressHighSeconds',
  'sleepLatencySeconds',
  'minutesToFirstDeepSleep',
  'cardiovascularAge',
]);

function numeric(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const midpoint = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[midpoint - 1] + sorted[midpoint]) / 2
    : sorted[midpoint];
}

export function medianOfPreviousDays(
  days: OuraStatsDay[],
  displayIndex: number,
  metric: OuraMetricKey,
  lookbackDays = 30,
): number | null {
  const start = Math.max(0, displayIndex - lookbackDays);
  const values = days
    .slice(start, displayIndex)
    .map(day => numeric(day[metric]))
    .filter((value): value is number => value !== null);
  return values.length >= 7 ? median(values) : null;
}

export function classifyDelta(metric: OuraMetricKey, value: number | null, norm: number | null): {
  delta: number | null;
  tone: DeltaTone;
} {
  if (value === null || norm === null) return { delta: null, tone: 'neutral' };

  if (metric === 'temperatureDeviation' || metric === 'temperatureTrendDeviation') {
    const absolute = Math.abs(value);
    if (absolute > 0.5) return { delta: value - norm, tone: 'negative' };
    if (absolute >= 0.3) return { delta: value - norm, tone: 'warning' };
    return { delta: value - norm, tone: 'neutral' };
  }

  const delta = value - norm;
  const floor = Math.max(Math.abs(norm) * 0.03, 1);
  if (Math.abs(delta) < floor) return { delta, tone: 'neutral' };

  if (HIGHER_IS_BETTER.has(metric)) {
    return { delta, tone: delta > 0 ? 'positive' : 'negative' };
  }
  if (LOWER_IS_BETTER.has(metric)) {
    return { delta, tone: delta < 0 ? 'positive' : 'negative' };
  }

  return { delta, tone: 'neutral' };
}

export function latencyMinutes(seconds: number | null | undefined): number | null {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return null;
  return Math.round((seconds / 60) * 10) / 10;
}

function hasSleepData(day: OuraStatsDay): boolean {
  return numeric(day.sleepScore) !== null || numeric(day.deepSleepMinutes) !== null;
}

export function pickDisplayNight(days: OuraStatsDay[]): {
  day: OuraStatsDay | null;
  index: number;
  isFallback: boolean;
} {
  for (let index = days.length - 1; index >= 0; index -= 1) {
    if (hasSleepData(days[index])) {
      return { day: days[index], index, isFallback: index !== days.length - 1 };
    }
  }
  return { day: null, index: -1, isFallback: false };
}

function hasDayData(day: OuraStatsDay): boolean {
  return (
    numeric(day.activityScore) !== null
    || numeric(day.activeCalories) !== null
    || numeric(day.steps) !== null
  );
}

export function pickDisplayDay(days: OuraStatsDay[]): {
  day: OuraStatsDay | null;
  index: number;
  isFallback: boolean;
} {
  for (let index = days.length - 1; index >= 0; index -= 1) {
    if (hasDayData(days[index])) {
      return { day: days[index], index, isFallback: index !== days.length - 1 };
    }
  }
  return { day: null, index: -1, isFallback: false };
}

function dateFromLocal(localDate: string): Date {
  return new Date(`${localDate}T00:00:00.000Z`);
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(localDate: string, days: number): string {
  const date = dateFromLocal(localDate);
  date.setUTCDate(date.getUTCDate() + days);
  return dateOnly(date);
}

function mondayStart(localDate: string): string {
  const date = dateFromLocal(localDate);
  const day = date.getUTCDay();
  const offset = day === 0 ? -6 : 1 - day;
  date.setUTCDate(date.getUTCDate() + offset);
  return dateOnly(date);
}

export function weeklyBuckets(days: OuraStatsDay[], metric: OuraMetricKey): Array<{
  startDate: string;
  endDate: string;
  average: number | null;
}> {
  const byWeek = new Map<string, number[]>();
  for (const day of days) {
    const value = numeric(day[metric]);
    if (value === null) continue;
    const startDate = mondayStart(day.localDate);
    byWeek.set(startDate, [...(byWeek.get(startDate) ?? []), value]);
  }

  return Array.from(byWeek.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([startDate, values]) => ({
      startDate,
      endDate: addDays(startDate, 6),
      average: values.reduce((sum, value) => sum + value, 0) / values.length,
    }));
}

export function isLowWearDay(day: OuraStatsDay): boolean {
  return (numeric(day.nonWearMinutes) ?? 0) > 480;
}

export function normalizeBars(input: {
  values: Array<number | null>;
  lowWearMask?: boolean[];
  fixedDomain?: [number, number];
}): Array<{ value: number | null; y: number; height: number; opacity: number }> {
  const finite = input.values.filter((value): value is number => value !== null && Number.isFinite(value));
  const domain = input.fixedDomain ?? (
    finite.length > 0
      ? [Math.min(...finite), Math.max(...finite)] as [number, number]
      : [0, 1]
  );
  const span = domain[1] - domain[0] || 1;

  return input.values.map((value, index) => {
    if (value === null || !Number.isFinite(value)) {
      return { value: null, y: 0, height: 0, opacity: 0 };
    }
    const height = Math.max(0, Math.min(1, (value - domain[0]) / span));
    return {
      value,
      y: 1 - height,
      height,
      opacity: input.lowWearMask?.[index] ? 0.3 : index === input.values.length - 1 ? 1 : 0.8,
    };
  });
}

export function resilienceScore(value: string | null | undefined): number | null {
  if (value === 'limited') return 1;
  if (value === 'adequate') return 2;
  if (value === 'solid') return 3;
  if (value === 'strong') return 4;
  if (value === 'exceptional') return 5;
  return null;
}

// One-line plain-language explainers for the Sleep Lab surfaces. Keyed by
// OuraMetricKey where one exists; hrvBalance is a text metric without a key.
export const OURA_METRIC_EXPLAINERS: Record<string, string> = {
  sleepEfficiency: 'Share of time in bed actually spent asleep — 85% or higher is a good night.',
  sleepLatencySeconds: 'How long it took to fall asleep — 10–20 minutes is typical; under 5 can mean sleep debt.',
  deepSleepFirstThirdMinutes: 'Deep sleep banked in the first third of the night, when restorative pressure should peak.',
  temperatureTrendDeviation: 'Multi-day drift of night skin temperature vs your baseline — a sustained rise can flag strain or oncoming illness.',
  activityScore: "Oura's 0–100 read on how well you balanced movement, exercise, and rest.",
  activeCalories: 'Calories burned through movement, on top of what your body burns at rest.',
  totalCalories: 'Everything burned across the day, including resting metabolism.',
  hrvBalance: 'Whether your recent HRV trend is in line with your longer-term baseline.',
  workoutCount: 'Workout sessions Oura detected or you logged for this day.',
};
