import { NextRequest, NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

type Row = Record<string, unknown>;

function clampDays(value: string | null): number {
  const parsed = value ? Number(value) : 90;
  if (!Number.isFinite(parsed)) return 90;
  return Math.max(7, Math.min(90, Math.trunc(parsed)));
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function dayFromRow(row: Row) {
  return {
    localDate: stringOrNull(row.local_date) ?? '',
    sleepScore: numberOrNull(row.sleep_score),
    readinessScore: numberOrNull(row.readiness_score),
    activityScore: numberOrNull(row.activity_score),
    sleepAvgHrv: numberOrNull(row.sleep_avg_hrv),
    deepSleepMinutes: numberOrNull(row.deep_sleep_minutes),
    remSleepMinutes: numberOrNull(row.rem_sleep_minutes),
    sleepEfficiency: numberOrNull(row.sleep_efficiency),
    sleepLatencySeconds: numberOrNull(row.sleep_latency_seconds),
    minutesToFirstDeepSleep: numberOrNull(row.minutes_to_first_deep_sleep),
    deepSleepFirstThirdMinutes: numberOrNull(row.deep_sleep_first_third_minutes),
    hrvRecoveryDelta: numberOrNull(row.hrv_recovery_delta),
    restingHeartRate: numberOrNull(row.resting_heart_rate),
    respiratoryRate: numberOrNull(row.respiratory_rate),
    averageSpo2: numberOrNull(row.average_spo2),
    breathingDisturbanceIndex: numberOrNull(row.breathing_disturbance_index),
    temperatureDeviation: numberOrNull(row.temperature_deviation),
    temperatureTrendDeviation: numberOrNull(row.temperature_trend_deviation),
    steps: numberOrNull(row.steps),
    activeCalories: numberOrNull(row.active_calories),
    totalCalories: numberOrNull(row.total_calories),
    stressHighSeconds: numberOrNull(row.stress_high_seconds),
    recoveryHighSeconds: numberOrNull(row.recovery_high_seconds),
    vo2Max: numberOrNull(row.vo2_max),
    cardiovascularAge: numberOrNull(row.cardiovascular_age),
    resilienceLevel: stringOrNull(row.resilience_level),
    nonWearMinutes: numberOrNull(row.non_wear_minutes),
  };
}

function startDateForDays(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - (days - 1));
  return date.toISOString().slice(0, 10);
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();

  if (authError || !authData.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const days = clampDays(request.nextUrl.searchParams.get('days'));
  const startDate = startDateForDays(days);

  const { data: connection, error: connectionError } = await supabase
    .from('external_health_connections')
    .select('status, last_sync_at, battery_level, battery_charging, battery_at')
    .eq('source', 'oura')
    .in('status', ['connected', 'error'])
    .maybeSingle();

  if (connectionError) {
    console.error('[health/oura/summary] connection query failed', connectionError);
    return NextResponse.json({ error: 'Oura summary unavailable.' }, { status: 500 });
  }

  if (!connection) {
    return NextResponse.json({
      connected: false,
      lastSyncAt: null,
      battery: null,
      days: [],
    });
  }
  const connectionRow = connection as unknown as Row;

  const { data: snapshotRows, error: snapshotError } = await supabase
    .from('external_health_daily_snapshots')
    .select([
      'local_date',
      'sleep_score',
      'readiness_score',
      'activity_score',
      'sleep_avg_hrv',
      'deep_sleep_minutes',
      'rem_sleep_minutes',
      'sleep_efficiency',
      'sleep_latency_seconds',
      'minutes_to_first_deep_sleep',
      'deep_sleep_first_third_minutes',
      'hrv_recovery_delta',
      'resting_heart_rate',
      'respiratory_rate',
      'average_spo2',
      'breathing_disturbance_index',
      'temperature_deviation',
      'temperature_trend_deviation',
      'steps',
      'active_calories',
      'total_calories',
      'stress_high_seconds',
      'recovery_high_seconds',
      'vo2_max',
      'cardiovascular_age',
      'resilience_level',
      'non_wear_minutes',
    ].join(', '))
    .eq('source', 'oura')
    .gte('local_date', startDate)
    .order('local_date', { ascending: true });

  if (snapshotError) {
    console.error('[health/oura/summary] snapshot query failed', snapshotError);
    return NextResponse.json({ error: 'Oura summary unavailable.' }, { status: 500 });
  }

  return NextResponse.json({
    connected: true,
    lastSyncAt: stringOrNull(connectionRow.last_sync_at),
    battery: numberOrNull(connectionRow.battery_level) !== null
      ? {
          level: numberOrNull(connectionRow.battery_level),
          charging: connectionRow.battery_charging === true,
          at: stringOrNull(connectionRow.battery_at),
        }
      : null,
    days: (snapshotRows ?? []).map(row => dayFromRow(row as unknown as Row)),
  });
}
