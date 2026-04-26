export type ExternalHealthSource = 'oura' | 'apple_health';

export type ExternalHealthDailySnapshot = {
  userId: string;
  source: ExternalHealthSource;
  localDate: string;
  timezone: string;
  sleepScore: number | null;
  readinessScore: number | null;
  activityScore: number | null;
  stressHighSeconds: number | null;
  recoveryHighSeconds: number | null;
  steps: number | null;
  activeCalories: number | null;
  totalCalories: number | null;
  averageSpo2: number | null;
  breathingDisturbanceIndex: number | null;
  vo2Max: number | null;
  restingHeartRate: number | null;
  resilienceLevel: string | null;
  workoutCount: number;
  rawPayload: Record<string, unknown>;
};
