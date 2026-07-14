import type { ExternalHealthDailySnapshot } from './types';

type OuraDailyPayload = {
  userId: string;
  localDate: string;
  timezone?: string;
  dailySleep?: { score?: number | null } | null;
  dailyReadiness?: {
    score?: number | null;
    temperature_deviation?: number | null;
    temperature_trend_deviation?: number | null;
  } | null;
  dailyActivity?: {
    score?: number | null;
    steps?: number | null;
    active_calories?: number | null;
    total_calories?: number | null;
    non_wear_time?: number | null;
  } | null;
  dailyStress?: { stress_high?: number | null; recovery_high?: number | null } | null;
  dailySpO2?: {
    spo2_percentage?: { average?: number | null } | null;
    breathing_disturbance_index?: number | null;
  } | null;
  heartHealth?: {
    vo2_max?: number | null;
    resting_heart_rate?: number | null;
    hrv_balance?: string | null;
    resilience_level?: string | null;
    cardiovascular_age?: number | null;
  } | null;
  sleepDetail?: {
    average_hrv?: number | null;
    efficiency?: number | null;
    latency?: number | null;
    deep_sleep_duration?: number | null;
    rem_sleep_duration?: number | null;
    average_breath?: number | null;
    lowest_heart_rate?: number | null;
  } | null;
  // Precomputed by ouraSyncEngine from the main sleep doc; this mapper stays
  // value-import-free so its .test.mjs loads under --experimental-strip-types.
  nightDetail?: {
    deep_sleep_first_third_minutes?: number | null;
    minutes_to_first_deep_sleep?: number | null;
    hrv_recovery_delta?: number | null;
  } | null;
  workouts?: unknown[] | null;
};

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function minutesOrNull(value: unknown): number | null {
  const n = numberOrNull(value);
  return n === null ? null : Math.round(n / 60); // Oura durations are seconds
}

export function mapOuraDailyPayloadToHealthSnapshot(
  input: OuraDailyPayload,
): ExternalHealthDailySnapshot {
  return {
    userId: input.userId,
    source: 'oura',
    localDate: input.localDate,
    timezone: input.timezone ?? 'UTC',
    sleepScore: numberOrNull(input.dailySleep?.score),
    readinessScore: numberOrNull(input.dailyReadiness?.score),
    activityScore: numberOrNull(input.dailyActivity?.score),
    stressHighSeconds: numberOrNull(input.dailyStress?.stress_high),
    recoveryHighSeconds: numberOrNull(input.dailyStress?.recovery_high),
    steps: numberOrNull(input.dailyActivity?.steps),
    activeCalories: numberOrNull(input.dailyActivity?.active_calories),
    totalCalories: numberOrNull(input.dailyActivity?.total_calories),
    averageSpo2: numberOrNull(input.dailySpO2?.spo2_percentage?.average),
    breathingDisturbanceIndex: numberOrNull(input.dailySpO2?.breathing_disturbance_index),
    vo2Max: numberOrNull(input.heartHealth?.vo2_max),
    restingHeartRate: numberOrNull(input.sleepDetail?.lowest_heart_rate)
      ?? numberOrNull(input.heartHealth?.resting_heart_rate),
    hrvBalance: stringOrNull(input.heartHealth?.hrv_balance),
    resilienceLevel: stringOrNull(input.heartHealth?.resilience_level),
    cardiovascularAge: numberOrNull(input.heartHealth?.cardiovascular_age),
    sleepAvgHrv: numberOrNull(input.sleepDetail?.average_hrv),
    sleepEfficiency: numberOrNull(input.sleepDetail?.efficiency),
    sleepLatencySeconds: numberOrNull(input.sleepDetail?.latency),
    deepSleepMinutes: minutesOrNull(input.sleepDetail?.deep_sleep_duration),
    remSleepMinutes: minutesOrNull(input.sleepDetail?.rem_sleep_duration),
    respiratoryRate: numberOrNull(input.sleepDetail?.average_breath),
    temperatureDeviation: numberOrNull(input.dailyReadiness?.temperature_deviation),
    temperatureTrendDeviation: numberOrNull(input.dailyReadiness?.temperature_trend_deviation),
    nonWearMinutes: minutesOrNull(input.dailyActivity?.non_wear_time),
    deepSleepFirstThirdMinutes: numberOrNull(input.nightDetail?.deep_sleep_first_third_minutes),
    minutesToFirstDeepSleep: numberOrNull(input.nightDetail?.minutes_to_first_deep_sleep),
    hrvRecoveryDelta: numberOrNull(input.nightDetail?.hrv_recovery_delta),
    workoutCount: Array.isArray(input.workouts) ? input.workouts.length : 0,
    rawPayload: input as unknown as Record<string, unknown>,
  };
}
