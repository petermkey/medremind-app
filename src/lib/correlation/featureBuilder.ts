import type { DailyLifestyleSnapshot } from './types';

type Row = Record<string, unknown>;

export type BuildDailyLifestyleSnapshotsInput = {
  userId: string;
  startDate: string;
  endDate: string;
  foodEntries?: Row[];
  waterEntries?: Row[];
  scheduledDoses?: Row[];
  doseRecords?: Row[];
  healthSnapshots?: Row[];
  medicationExposures?: Row[];
};

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toBoolean(value: unknown): boolean {
  return value === true;
}

function addDays(localDate: string, days: number): string {
  const date = new Date(`${localDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function enumerateDates(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  for (let date = startDate; date <= endDate; date = addDays(date, 1)) {
    dates.push(date);
  }
  return dates;
}

function localDateFromTimestamp(value: unknown): string | null {
  return typeof value === 'string' && value.length >= 10 ? value.slice(0, 10) : null;
}

function localDateInTimezone(value: unknown, timezone: unknown): string | null {
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const timeZone = typeof timezone === 'string' && timezone.length > 0 ? timezone : 'UTC';
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const year = parts.find(part => part.type === 'year')?.value;
    const month = parts.find(part => part.type === 'month')?.value;
    const day = parts.find(part => part.type === 'day')?.value;

    return year && month && day ? `${year}-${month}-${day}` : null;
  } catch {
    return localDateFromTimestamp(value);
  }
}

function rowLocalDate(row: Row, fallbackTimestampKey: string): string | null {
  if (typeof row.local_date === 'string') return row.local_date;
  if (typeof row.scheduled_date === 'string') return row.scheduled_date;
  if (fallbackTimestampKey === 'consumed_at') {
    return localDateInTimezone(row[fallbackTimestampKey], row.timezone);
  }
  return localDateFromTimestamp(row[fallbackTimestampKey]);
}

function userMatches(row: Row, userId: string): boolean {
  return row.user_id === undefined || row.user_id === userId;
}

function sum(rows: Row[], key: string): number | null {
  let total = 0;
  let hasValue = false;
  for (const row of rows) {
    const value = toNumber(row[key]);
    if (value !== null) {
      total += value;
      hasValue = true;
    }
  }
  return hasValue ? total : null;
}

function firstNumber(rows: Row[], key: string): number | null {
  for (const row of rows) {
    const value = toNumber(row[key]);
    if (value !== null) return value;
  }
  return null;
}

function indexByDate(rows: Row[] | undefined, userId: string, timestampKey: string): Map<string, Row[]> {
  const byDate = new Map<string, Row[]>();
  for (const row of rows ?? []) {
    if (!userMatches(row, userId)) continue;
    const localDate = rowLocalDate(row, timestampKey);
    if (!localDate) continue;

    const existing = byDate.get(localDate) ?? [];
    existing.push(row);
    byDate.set(localDate, existing);
  }
  return byDate;
}

function countStatus(rows: Row[], status: string): number {
  return rows.filter(row => row.status === status || row.action === status).length;
}

function recordScheduledDoseId(row: Row): string | null {
  if (typeof row.scheduled_dose_id === 'string') return row.scheduled_dose_id;
  if (typeof row.scheduledDoseId === 'string') return row.scheduledDoseId;
  return null;
}

function rowId(row: Row): string | null {
  return typeof row.id === 'string' ? row.id : null;
}

function canonicalDoseCounts(doseRows: Row[], recordRows: Row[]) {
  const scheduledIds = new Set(doseRows.map(rowId).filter((id): id is string => id !== null));
  const unlinkedRecords = recordRows.filter(row => {
    const scheduledDoseId = recordScheduledDoseId(row);
    return !scheduledDoseId || !scheduledIds.has(scheduledDoseId);
  });
  const takenCount = countStatus(doseRows, 'taken') + countStatus(unlinkedRecords, 'taken');
  const skippedCount = countStatus(doseRows, 'skipped') + countStatus(unlinkedRecords, 'skipped');
  const missedCount = countStatus(doseRows, 'missed') + countStatus(doseRows, 'pending');
  const denominator = doseRows.length + unlinkedRecords.length;

  return {
    takenCount,
    skippedCount,
    missedCount,
    adherencePct: denominator > 0 ? (takenCount / denominator) * 100 : null,
  };
}

export function buildDailyLifestyleSnapshots(input: BuildDailyLifestyleSnapshotsInput): DailyLifestyleSnapshot[] {
  const foodByDate = indexByDate(input.foodEntries, input.userId, 'consumed_at');
  const waterByDate = indexByDate(input.waterEntries, input.userId, 'consumed_at');
  const dosesByDate = indexByDate(input.scheduledDoses, input.userId, 'scheduled_date');
  const recordsByDate = indexByDate(input.doseRecords, input.userId, 'recorded_at');
  const healthByDate = indexByDate(input.healthSnapshots, input.userId, 'local_date');
  const exposureByDate = indexByDate(input.medicationExposures, input.userId, 'local_date');

  return enumerateDates(input.startDate, input.endDate).map(localDate => {
    const foodRows = foodByDate.get(localDate) ?? [];
    const waterRows = waterByDate.get(localDate) ?? [];
    const doseRows = dosesByDate.get(localDate) ?? [];
    const recordRows = recordsByDate.get(localDate) ?? [];
    const healthRows = healthByDate.get(localDate) ?? [];
    const exposureRows = exposureByDate.get(localDate) ?? [];
    const exposure = exposureRows[0] ?? {};
    const doseCounts = canonicalDoseCounts(doseRows, recordRows);

    return {
      userId: input.userId,
      localDate,
      caloriesKcal: sum(foodRows, 'calories_kcal'),
      proteinG: sum(foodRows, 'protein_g'),
      fiberG: sum(foodRows, 'fiber_g'),
      waterMl: sum(waterRows, 'amount_ml'),
      takenCount: doseCounts.takenCount,
      skippedCount: doseCounts.skippedCount,
      missedCount: doseCounts.missedCount,
      adherencePct: doseCounts.adherencePct,
      sleepScore: firstNumber(healthRows, 'sleep_score'),
      readinessScore: firstNumber(healthRows, 'readiness_score'),
      activityScore: firstNumber(healthRows, 'activity_score'),
      stressHighSeconds: firstNumber(healthRows, 'stress_high_seconds'),
      recoveryHighSeconds: firstNumber(healthRows, 'recovery_high_seconds'),
      steps: firstNumber(healthRows, 'steps'),
      averageSpo2: firstNumber(healthRows, 'average_spo2'),
      hasGlp1Active: toBoolean(exposure.has_glp1_active),
      daysSinceGlp1Start: toNumber(exposure.days_since_glp1_start),
      glp1DoseEscalationPhase: toBoolean(exposure.glp1_dose_escalation_phase),
      hasTestosteroneActive: toBoolean(exposure.has_testosterone_active),
      testosteroneInjectionDayOffset: toNumber(exposure.testosterone_injection_day_offset),
      hasBetaBlockerActive: toBoolean(exposure.has_beta_blocker_active),
      hasThyroidMedActive: toBoolean(exposure.has_thyroid_med_active),
      hasSsriActive: toBoolean(exposure.has_ssri_active),
      withFoodMismatchCount: toNumber(exposure.with_food_mismatch_count) ?? 0,
      lateMedicationCount: toNumber(exposure.late_medication_count) ?? 0,
      missedMedicationCount: toNumber(exposure.missed_medication_count) ?? 0,
      medicationClassExposureScore: toNumber(exposure.medication_class_exposure_score) ?? 0,
      medicationReviewSignalCount: toNumber(exposure.medication_review_signal_count) ?? 0,
      sourcePayload: {
        foodEntryCount: foodRows.length,
        waterEntryCount: waterRows.length,
        scheduledDoseCount: doseRows.length,
        doseRecordCount: recordRows.length,
        healthSnapshotCount: healthRows.length,
        medicationExposureCount: exposureRows.length,
      },
    };
  });
}
