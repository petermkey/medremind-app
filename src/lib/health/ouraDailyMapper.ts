import type { ExternalHealthDailySnapshot } from './types';

type OuraDailyPayload = {
  userId: string;
  localDate: string;
  timezone?: string;
  dailySleep?: { score?: number | null } | null;
  dailyReadiness?: { score?: number | null } | null;
  dailyActivity?: {
    score?: number | null;
    steps?: number | null;
    active_calories?: number | null;
    total_calories?: number | null;
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
  } | null;
  workouts?: unknown[] | null;
};

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
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
    restingHeartRate: numberOrNull(input.heartHealth?.resting_heart_rate),
    hrvBalance: stringOrNull(input.heartHealth?.hrv_balance),
    resilienceLevel: stringOrNull(input.heartHealth?.resilience_level),
    workoutCount: Array.isArray(input.workouts) ? input.workouts.length : 0,
    rawPayload: input as unknown as Record<string, unknown>,
  };
}
