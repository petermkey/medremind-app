import { createClient } from '@supabase/supabase-js';

import type { ExternalHealthDailySnapshot } from './types';

export function createHealthServiceClient() {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Supabase service role environment is required for external health snapshots');
  }

  return createClient(supabaseUrl, serviceRoleKey);
}

function toSnapshotRow(snapshot: ExternalHealthDailySnapshot) {
  return {
    user_id: snapshot.userId,
    source: snapshot.source,
    local_date: snapshot.localDate,
    timezone: snapshot.timezone,
    sleep_score: snapshot.sleepScore,
    readiness_score: snapshot.readinessScore,
    activity_score: snapshot.activityScore,
    stress_high_seconds: snapshot.stressHighSeconds,
    recovery_high_seconds: snapshot.recoveryHighSeconds,
    steps: snapshot.steps,
    active_calories: snapshot.activeCalories,
    total_calories: snapshot.totalCalories,
    average_spo2: snapshot.averageSpo2,
    breathing_disturbance_index: snapshot.breathingDisturbanceIndex,
    vo2_max: snapshot.vo2Max,
    resting_heart_rate: snapshot.restingHeartRate,
    hrv_balance: snapshot.hrvBalance,
    resilience_level: snapshot.resilienceLevel,
    workout_count: snapshot.workoutCount,
    raw_payload: snapshot.rawPayload,
    updated_at: new Date().toISOString(),
  };
}

export async function upsertExternalHealthDailySnapshots(
  snapshots: ExternalHealthDailySnapshot[],
): Promise<number> {
  if (snapshots.length === 0) return 0;

  const supabase = createHealthServiceClient();
  const { error } = await supabase
    .from('external_health_daily_snapshots')
    .upsert(snapshots.map(toSnapshotRow), { onConflict: 'user_id,source,local_date' });

  if (error) {
    throw error;
  }

  return snapshots.length;
}
