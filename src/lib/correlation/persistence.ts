import { createClient } from '@supabase/supabase-js';

import { buildDailyLifestyleSnapshots } from './featureBuilder';
import { generateCorrelationInsightCards } from './engine';
import { assertSafeCorrelationInsightCardText } from './medicationSafety';
import type { CorrelationConsent, CorrelationInsightCard, DailyLifestyleSnapshot } from './types';

type Row = Record<string, unknown>;

export function createCorrelationServiceClient() {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Supabase service role environment is required for correlation insights');
  }

  return createClient(supabaseUrl, serviceRoleKey);
}

type SupabaseClient = ReturnType<typeof createCorrelationServiceClient>;

function toConsent(row: Row | null): CorrelationConsent {
  return {
    enabled: row?.enabled === true,
    includesMedicationPatterns: row?.includes_medication_patterns === true,
    includesHealthData: row?.includes_health_data === true,
    acknowledgedNoMedChanges: row?.acknowledged_no_med_changes === true,
  };
}

function toNullableNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function snapshotRow(snapshot: DailyLifestyleSnapshot) {
  return {
    user_id: snapshot.userId,
    local_date: snapshot.localDate,
    calories_kcal: snapshot.caloriesKcal ?? null,
    protein_g: snapshot.proteinG ?? null,
    fiber_g: snapshot.fiberG ?? null,
    water_ml: snapshot.waterMl ?? null,
    taken_count: snapshot.takenCount ?? 0,
    skipped_count: snapshot.skippedCount ?? 0,
    missed_count: snapshot.missedCount ?? 0,
    adherence_pct: snapshot.adherencePct ?? null,
    sleep_score: snapshot.sleepScore ?? null,
    readiness_score: snapshot.readinessScore ?? null,
    activity_score: snapshot.activityScore ?? null,
    stress_high_seconds: snapshot.stressHighSeconds ?? null,
    recovery_high_seconds: snapshot.recoveryHighSeconds ?? null,
    steps: snapshot.steps ?? null,
    average_spo2: snapshot.averageSpo2 ?? null,
    has_glp1_active: snapshot.hasGlp1Active ?? false,
    days_since_glp1_start: snapshot.daysSinceGlp1Start ?? null,
    glp1_dose_escalation_phase: snapshot.glp1DoseEscalationPhase ?? false,
    has_testosterone_active: snapshot.hasTestosteroneActive ?? false,
    testosterone_injection_day_offset: snapshot.testosteroneInjectionDayOffset ?? null,
    has_beta_blocker_active: snapshot.hasBetaBlockerActive ?? false,
    has_thyroid_med_active: snapshot.hasThyroidMedActive ?? false,
    has_ssri_active: snapshot.hasSsriActive ?? false,
    with_food_mismatch_count: snapshot.withFoodMismatchCount ?? 0,
    late_medication_count: snapshot.lateMedicationCount ?? 0,
    missed_medication_count: snapshot.missedMedicationCount ?? 0,
    medication_class_exposure_score: snapshot.medicationClassExposureScore ?? 0,
    medication_review_signal_count: snapshot.medicationReviewSignalCount ?? 0,
    source_payload: snapshot.sourcePayload ?? {},
    updated_at: new Date().toISOString(),
  };
}

function snapshotFromRow(row: Row): DailyLifestyleSnapshot {
  return {
    userId: String(row.user_id),
    localDate: String(row.local_date),
    caloriesKcal: toNullableNumber(row.calories_kcal),
    proteinG: toNullableNumber(row.protein_g),
    fiberG: toNullableNumber(row.fiber_g),
    waterMl: toNullableNumber(row.water_ml),
    takenCount: toNullableNumber(row.taken_count),
    skippedCount: toNullableNumber(row.skipped_count),
    missedCount: toNullableNumber(row.missed_count),
    adherencePct: toNullableNumber(row.adherence_pct),
    sleepScore: toNullableNumber(row.sleep_score),
    readinessScore: toNullableNumber(row.readiness_score),
    activityScore: toNullableNumber(row.activity_score),
    stressHighSeconds: toNullableNumber(row.stress_high_seconds),
    recoveryHighSeconds: toNullableNumber(row.recovery_high_seconds),
    steps: toNullableNumber(row.steps),
    averageSpo2: toNullableNumber(row.average_spo2),
    hasGlp1Active: row.has_glp1_active === true,
    daysSinceGlp1Start: toNullableNumber(row.days_since_glp1_start),
    glp1DoseEscalationPhase: row.glp1_dose_escalation_phase === true,
    hasTestosteroneActive: row.has_testosterone_active === true,
    testosteroneInjectionDayOffset: toNullableNumber(row.testosterone_injection_day_offset),
    hasBetaBlockerActive: row.has_beta_blocker_active === true,
    hasThyroidMedActive: row.has_thyroid_med_active === true,
    hasSsriActive: row.has_ssri_active === true,
    withFoodMismatchCount: toNullableNumber(row.with_food_mismatch_count),
    lateMedicationCount: toNullableNumber(row.late_medication_count),
    missedMedicationCount: toNullableNumber(row.missed_medication_count),
    medicationClassExposureScore: toNullableNumber(row.medication_class_exposure_score),
    medicationReviewSignalCount: toNullableNumber(row.medication_review_signal_count),
    sourcePayload: {},
  };
}

function cardRow(card: CorrelationInsightCard) {
  assertSafeCorrelationInsightCardText(card.title, card.body);
  return {
    user_id: card.userId,
    window_days: card.windowDays,
    feature: card.feature,
    outcome: card.outcome,
    r: card.r,
    n: card.n,
    strength: card.strength,
    direction: card.direction,
    recommendation_kind: card.recommendationKind,
    title: card.title,
    body: card.body,
    evidence: card.evidence,
    generated_at: card.generatedAt,
  };
}

function cardFromRow(row: Row): CorrelationInsightCard {
  return {
    userId: String(row.user_id),
    windowDays: Number(row.window_days) as 30 | 60 | 90,
    feature: String(row.feature),
    outcome: String(row.outcome),
    r: Number(row.r),
    n: Number(row.n),
    strength: String(row.strength) as CorrelationInsightCard['strength'],
    direction: String(row.direction) as CorrelationInsightCard['direction'],
    recommendationKind: String(row.recommendation_kind) as CorrelationInsightCard['recommendationKind'],
    title: String(row.title),
    body: String(row.body),
    evidence: row.evidence as CorrelationInsightCard['evidence'],
    generatedAt: String(row.generated_at),
  };
}

function addDays(localDate: string, days: number): string {
  const date = new Date(`${localDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export async function getCorrelationConsent(userId: string, supabase: SupabaseClient = createCorrelationServiceClient()) {
  const { data, error } = await supabase
    .from('correlation_consents')
    .select('enabled, includes_medication_patterns, includes_health_data, acknowledged_no_med_changes')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw error;
  return toConsent(data as unknown as Row | null);
}

export function hasActiveCorrelationConsent(consent: CorrelationConsent): boolean {
  return consent.enabled
    && consent.includesMedicationPatterns
    && consent.includesHealthData
    && consent.acknowledgedNoMedChanges;
}

export async function getLatestCorrelationInsightCards(
  userId: string,
  limit = 20,
  supabase: SupabaseClient = createCorrelationServiceClient(),
): Promise<CorrelationInsightCard[]> {
  const { data, error } = await supabase
    .from('correlation_insight_cards')
    .select('user_id, window_days, feature, outcome, r, n, strength, direction, recommendation_kind, title, body, evidence, generated_at')
    .eq('user_id', userId)
    .order('generated_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return ((data as unknown as Row[] | null) ?? []).map(cardFromRow);
}

export async function getDailyLifestyleSnapshots(
  userId: string,
  startDate: string,
  endDate: string,
  supabase: SupabaseClient = createCorrelationServiceClient(),
): Promise<DailyLifestyleSnapshot[]> {
  const { data, error } = await supabase
    .from('daily_lifestyle_snapshots')
    .select('*')
    .eq('user_id', userId)
    .gte('local_date', startDate)
    .lte('local_date', endDate)
    .order('local_date', { ascending: true });

  if (error) throw error;
  return ((data as unknown as Row[] | null) ?? []).map(snapshotFromRow);
}

export async function upsertDailyLifestyleSnapshots(
  snapshots: DailyLifestyleSnapshot[],
  supabase: SupabaseClient = createCorrelationServiceClient(),
): Promise<number> {
  if (snapshots.length === 0) return 0;

  const { error } = await supabase
    .from('daily_lifestyle_snapshots')
    .upsert(snapshots.map(snapshotRow), { onConflict: 'user_id,local_date' });

  if (error) throw error;
  return snapshots.length;
}

async function fetchSourceRows(
  supabase: SupabaseClient,
  table: string,
  userId: string,
  dateColumn: string,
  startDate: string,
  endDate: string,
  select = '*',
): Promise<Row[]> {
  const { data, error } = await supabase
    .from(table)
    .select(select)
    .eq('user_id', userId)
    .gte(dateColumn, startDate)
    .lte(dateColumn, endDate);

  if (error) throw error;
  return (data as unknown as Row[] | null) ?? [];
}

export async function buildAndPersistDailyLifestyleSnapshots(
  userId: string,
  startDate: string,
  endDate: string,
  supabase: SupabaseClient = createCorrelationServiceClient(),
): Promise<DailyLifestyleSnapshot[]> {
  const [foodEntries, waterEntries, scheduledDoses, doseRecords, healthSnapshots, medicationExposures] = await Promise.all([
    fetchSourceRows(supabase, 'food_entries', userId, 'consumed_at', `${startDate}T00:00:00.000Z`, `${endDate}T23:59:59.999Z`),
    fetchSourceRows(supabase, 'water_entries', userId, 'consumed_at', `${startDate}T00:00:00.000Z`, `${endDate}T23:59:59.999Z`),
    fetchSourceRows(supabase, 'scheduled_doses', userId, 'scheduled_date', startDate, endDate),
    fetchSourceRows(supabase, 'dose_records', userId, 'recorded_at', `${startDate}T00:00:00.000Z`, `${endDate}T23:59:59.999Z`),
    fetchSourceRows(supabase, 'external_health_daily_snapshots', userId, 'local_date', startDate, endDate),
    fetchSourceRows(supabase, 'daily_medication_exposures', userId, 'local_date', startDate, endDate),
  ]);

  const snapshots = buildDailyLifestyleSnapshots({
    userId,
    startDate,
    endDate,
    foodEntries,
    waterEntries,
    scheduledDoses,
    doseRecords,
    healthSnapshots,
    medicationExposures,
  });

  await upsertDailyLifestyleSnapshots(snapshots, supabase);
  return snapshots;
}

export async function replaceCorrelationInsightCards(
  userId: string,
  cards: CorrelationInsightCard[],
  supabase: SupabaseClient = createCorrelationServiceClient(),
): Promise<number> {
  const { error: deleteError } = await supabase
    .from('correlation_insight_cards')
    .delete()
    .eq('user_id', userId);

  if (deleteError) throw deleteError;
  if (cards.length === 0) return 0;

  const { error: insertError } = await supabase
    .from('correlation_insight_cards')
    .insert(cards.map(cardRow));

  if (insertError) throw insertError;
  return cards.length;
}

export async function generateAndPersistCorrelationInsights(userId: string): Promise<CorrelationInsightCard[]> {
  const supabase = createCorrelationServiceClient();
  const endDate = new Date().toISOString().slice(0, 10);
  const startDate = addDays(endDate, -89);
  const existingSnapshots = await getDailyLifestyleSnapshots(userId, startDate, endDate, supabase);
  const snapshots = existingSnapshots.length > 0
    ? existingSnapshots
    : await buildAndPersistDailyLifestyleSnapshots(userId, startDate, endDate, supabase);
  const cards = generateCorrelationInsightCards({ userId, snapshots, now: new Date() });

  await replaceCorrelationInsightCards(userId, cards, supabase);
  return cards;
}
