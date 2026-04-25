'use client';

import type { FoodEntry, FoodEntryComponent, FoodNutrients } from '@/types/food';
import { getSupabaseClient } from './client';

export const FOOD_PULL_PAGE_SIZE = 1000;

const COMPONENT_PULL_CHUNK_SIZE = 250;

type FoodRow = Record<string, unknown>;

function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function nutrientsFromRow(row: FoodRow): FoodNutrients {
  const nutrients: FoodNutrients = {
    caloriesKcal: toNumber(row.calories_kcal),
    proteinG: toNumber(row.protein_g),
    totalFatG: toNumber(row.total_fat_g),
    saturatedFatG: toNumber(row.saturated_fat_g),
    transFatG: toNumber(row.trans_fat_g),
    carbsG: toNumber(row.carbs_g),
    fiberG: toNumber(row.fiber_g),
    sugarsG: toNumber(row.sugars_g),
    addedSugarsG: toNumber(row.added_sugars_g),
    sodiumMg: toNumber(row.sodium_mg),
    cholesterolMg: toNumber(row.cholesterol_mg),
  };

  if (isRecord(row.extended_nutrients)) {
    nutrients.extended = row.extended_nutrients as Record<string, number>;
  }

  return nutrients;
}

function entryRow(entry: FoodEntry) {
  return {
    id: entry.id,
    user_id: entry.userId,
    consumed_at: entry.consumedAt,
    timezone: entry.timezone,
    meal_label: entry.mealLabel,
    title: entry.title,
    summary: entry.summary,
    source: entry.source,
    estimation_confidence: entry.estimationConfidence,
    analysis_model: entry.analysisModel ?? null,
    analysis_schema_version: entry.analysisSchemaVersion,
    calories_kcal: entry.nutrients.caloriesKcal ?? null,
    protein_g: entry.nutrients.proteinG ?? null,
    total_fat_g: entry.nutrients.totalFatG ?? null,
    saturated_fat_g: entry.nutrients.saturatedFatG ?? null,
    trans_fat_g: entry.nutrients.transFatG ?? null,
    carbs_g: entry.nutrients.carbsG ?? null,
    fiber_g: entry.nutrients.fiberG ?? null,
    sugars_g: entry.nutrients.sugarsG ?? null,
    added_sugars_g: entry.nutrients.addedSugarsG ?? null,
    sodium_mg: entry.nutrients.sodiumMg ?? null,
    cholesterol_mg: entry.nutrients.cholesterolMg ?? null,
    extended_nutrients: entry.nutrients.extended ?? {},
    uncertainties: entry.uncertainties,
    created_at: entry.createdAt,
    updated_at: entry.updatedAt,
  };
}

function componentRow(component: FoodEntryComponent) {
  return {
    id: component.id,
    entry_id: component.entryId,
    user_id: component.userId,
    name: component.name,
    category: component.category ?? null,
    estimated_quantity: component.estimatedQuantity ?? null,
    estimated_unit: component.estimatedUnit ?? null,
    grams_estimate: component.gramsEstimate ?? null,
    confidence: component.confidence,
    notes: component.notes ?? null,
    sort_order: component.sortOrder,
  };
}

function componentFromRow(row: FoodRow): FoodEntryComponent {
  return {
    id: String(row.id),
    entryId: String(row.entry_id),
    userId: String(row.user_id),
    name: String(row.name ?? ''),
    category: row.category ? String(row.category) : undefined,
    estimatedQuantity: toNumber(row.estimated_quantity),
    estimatedUnit: row.estimated_unit ? String(row.estimated_unit) : undefined,
    gramsEstimate: toNumber(row.grams_estimate),
    confidence: toNumber(row.confidence) ?? 0,
    notes: row.notes ? String(row.notes) : undefined,
    sortOrder: toNumber(row.sort_order) ?? 0,
  };
}

function entryFromRow(row: FoodRow, components: FoodEntryComponent[]): FoodEntry {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    consumedAt: String(row.consumed_at),
    timezone: String(row.timezone ?? 'UTC'),
    mealLabel: String(row.meal_label ?? 'unknown') as FoodEntry['mealLabel'],
    title: String(row.title ?? ''),
    summary: String(row.summary ?? ''),
    source: String(row.source ?? 'photo_ai') as FoodEntry['source'],
    estimationConfidence: toNumber(row.estimation_confidence) ?? 0,
    analysisModel: row.analysis_model ? String(row.analysis_model) : undefined,
    analysisSchemaVersion: String(row.analysis_schema_version ?? 'food-analysis-v1'),
    nutrients: nutrientsFromRow(row),
    uncertainties: Array.isArray(row.uncertainties) ? row.uncertainties.map(value => String(value)) : [],
    components,
    createdAt: row.created_at ? String(row.created_at) : new Date().toISOString(),
    updatedAt: row.updated_at ? String(row.updated_at) : new Date().toISOString(),
  };
}

export async function syncFoodEntrySave(userId: string, entry: FoodEntry) {
  if (entry.userId !== userId) {
    throw new Error('Food entry sync failed: entry user does not match authenticated user.');
  }

  const supabase = getSupabaseClient();
  const { error: entryError } = await supabase.from('food_entries').upsert(entryRow(entry), { onConflict: 'id' });
  if (entryError) throw new Error(`Food entry sync failed: ${entryError.message}`);

  if (entry.components.length > 0) {
    const { error: componentError } = await supabase
      .from('food_entry_components')
      .upsert(entry.components.map(componentRow), { onConflict: 'id' });
    if (componentError) throw new Error(`Food entry components sync failed: ${componentError.message}`);
  }
}

export async function pullFoodEntriesForRange(
  userId: string,
  fromIso: string,
  toIso: string,
): Promise<FoodEntry[]> {
  const supabase = getSupabaseClient();
  const entryRows: FoodRow[] = [];

  for (let from = 0; ; from += FOOD_PULL_PAGE_SIZE) {
    const { data, error } = await supabase
      .from('food_entries')
      .select('*')
      .eq('user_id', userId)
      .gte('consumed_at', fromIso)
      .lte('consumed_at', toIso)
      .order('consumed_at', { ascending: false })
      .range(from, from + FOOD_PULL_PAGE_SIZE - 1);

    if (error) throw new Error(`Food entries pull failed: ${error.message}`);
    const page = (data ?? []) as FoodRow[];
    entryRows.push(...page);
    if (page.length < FOOD_PULL_PAGE_SIZE) break;
  }

  if (entryRows.length === 0) return [];

  const componentsByEntryId = new Map<string, FoodEntryComponent[]>();
  const entryIds = entryRows.map(row => String(row.id));

  for (const ids of chunk(entryIds, COMPONENT_PULL_CHUNK_SIZE)) {
    const { data, error } = await supabase
      .from('food_entry_components')
      .select('*')
      .eq('user_id', userId)
      .in('entry_id', ids)
      .order('sort_order', { ascending: true });

    if (error) throw new Error(`Food entry components pull failed: ${error.message}`);

    for (const row of (data ?? []) as FoodRow[]) {
      const component = componentFromRow(row);
      const list = componentsByEntryId.get(component.entryId) ?? [];
      list.push(component);
      componentsByEntryId.set(component.entryId, list);
    }
  }

  return entryRows.map(row => entryFromRow(row, componentsByEntryId.get(String(row.id)) ?? []));
}
