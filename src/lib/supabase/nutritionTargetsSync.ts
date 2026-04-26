'use client';

import type { NutritionTargetProfile, WaterEntry } from '@/types/nutritionTargets';
import { getSupabaseClient } from './client';

export const WATER_PULL_PAGE_SIZE = 1000;

type NutritionTargetProfileRow = Record<string, unknown>;
type WaterEntryRow = Record<string, unknown>;

function toNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function targetProfileRow(profile: NutritionTargetProfile) {
  return {
    id: profile.id,
    user_id: profile.userId,
    age_years: profile.ageYears,
    sex: profile.sex,
    weight_kg: profile.weightKg,
    height_cm: profile.heightCm,
    activity_level: profile.activityLevel,
    body_fat_range: profile.bodyFatRange,
    goal_mode: profile.goalMode,
    calories_kcal: profile.caloriesKcal,
    protein_g: profile.proteinG,
    fat_g: profile.fatG,
    carbs_g: profile.carbsG,
    fiber_g: profile.fiberG,
    water_ml: profile.waterMl,
    algorithm_version: profile.algorithmVersion,
    created_at: profile.createdAt,
    updated_at: profile.updatedAt,
  };
}

function targetProfileFromRow(row: NutritionTargetProfileRow): NutritionTargetProfile {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    ageYears: toNumber(row.age_years),
    sex: String(row.sex) as NutritionTargetProfile['sex'],
    weightKg: toNumber(row.weight_kg),
    heightCm: toNumber(row.height_cm),
    activityLevel: String(row.activity_level) as NutritionTargetProfile['activityLevel'],
    bodyFatRange: String(row.body_fat_range ?? 'unknown') as NutritionTargetProfile['bodyFatRange'],
    goalMode: String(row.goal_mode) as NutritionTargetProfile['goalMode'],
    caloriesKcal: toNumber(row.calories_kcal),
    proteinG: toNumber(row.protein_g),
    fatG: toNumber(row.fat_g),
    carbsG: toNumber(row.carbs_g),
    fiberG: toNumber(row.fiber_g),
    waterMl: toNumber(row.water_ml),
    algorithmVersion: String(row.algorithm_version),
    createdAt: row.created_at ? String(row.created_at) : new Date().toISOString(),
    updatedAt: row.updated_at ? String(row.updated_at) : new Date().toISOString(),
  };
}

function waterEntryRow(entry: WaterEntry) {
  return {
    id: entry.id,
    user_id: entry.userId,
    consumed_at: entry.consumedAt,
    timezone: entry.timezone,
    amount_ml: entry.amountMl,
    source: entry.source,
    created_at: entry.createdAt,
  };
}

function waterEntryFromRow(row: WaterEntryRow): WaterEntry {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    consumedAt: String(row.consumed_at),
    timezone: String(row.timezone ?? 'UTC'),
    amountMl: toNumber(row.amount_ml),
    source: String(row.source ?? 'manual') as WaterEntry['source'],
    createdAt: row.created_at ? String(row.created_at) : new Date().toISOString(),
  };
}

export async function loadNutritionTargetProfile(userId: string): Promise<NutritionTargetProfile | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('nutrition_target_profiles')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw new Error(`Nutrition target profile load failed: ${error.message}`);
  return data ? targetProfileFromRow(data as NutritionTargetProfileRow) : null;
}

export async function syncNutritionTargetProfileSave(userId: string, profile: NutritionTargetProfile) {
  if (profile.userId !== userId) {
    throw new Error('Nutrition target profile sync failed: profile user does not match authenticated user.');
  }

  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('nutrition_target_profiles')
    .upsert(targetProfileRow(profile), { onConflict: 'user_id' });

  if (error) throw new Error(`Nutrition target profile sync failed: ${error.message}`);
}

export async function pullWaterEntriesForRange(
  userId: string,
  fromIso: string,
  toIso: string,
): Promise<WaterEntry[]> {
  const supabase = getSupabaseClient();
  const rows: WaterEntryRow[] = [];

  for (let from = 0; ; from += WATER_PULL_PAGE_SIZE) {
    const { data, error } = await supabase
      .from('water_entries')
      .select('*')
      .eq('user_id', userId)
      .gte('consumed_at', fromIso)
      .lte('consumed_at', toIso)
      .order('consumed_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, from + WATER_PULL_PAGE_SIZE - 1);

    if (error) throw new Error(`Water entries pull failed: ${error.message}`);
    const page = (data ?? []) as WaterEntryRow[];
    rows.push(...page);
    if (page.length < WATER_PULL_PAGE_SIZE) break;
  }

  return rows.map(waterEntryFromRow);
}

export async function syncWaterEntrySave(userId: string, entry: WaterEntry) {
  if (entry.userId !== userId) {
    throw new Error('Water entry sync failed: entry user does not match authenticated user.');
  }

  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('water_entries')
    .upsert(waterEntryRow(entry), { onConflict: 'id' });

  if (error) throw new Error(`Water entry sync failed: ${error.message}`);
}
