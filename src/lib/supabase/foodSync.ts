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

function sanitizeExtendedNutrients(value: unknown): Record<string, number> | undefined {
  if (!isRecord(value)) return undefined;
  const sanitized: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value)) {
    const parsed = toNumber(raw);
    if (parsed !== undefined) sanitized[key] = parsed;
  }
  return Object.keys(sanitized).length ? sanitized : undefined;
}

function sanitizeNutrients(nutrients: FoodNutrients): FoodNutrients {
  return {
    caloriesKcal: toNumber(nutrients.caloriesKcal),
    proteinG: toNumber(nutrients.proteinG),
    totalFatG: toNumber(nutrients.totalFatG),
    saturatedFatG: toNumber(nutrients.saturatedFatG),
    transFatG: toNumber(nutrients.transFatG),
    carbsG: toNumber(nutrients.carbsG),
    fiberG: toNumber(nutrients.fiberG),
    sugarsG: toNumber(nutrients.sugarsG),
    addedSugarsG: toNumber(nutrients.addedSugarsG),
    sodiumMg: toNumber(nutrients.sodiumMg),
    cholesterolMg: toNumber(nutrients.cholesterolMg),
    extended: sanitizeExtendedNutrients(nutrients.extended),
  };
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

  nutrients.extended = sanitizeExtendedNutrients(row.extended_nutrients);

  return nutrients;
}

export function sanitizeFoodEntryForSync(entry: FoodEntry): FoodEntry {
  return {
    id: entry.id,
    userId: entry.userId,
    consumedAt: entry.consumedAt,
    timezone: entry.timezone,
    mealLabel: entry.mealLabel,
    title: entry.title,
    summary: entry.summary,
    source: entry.source,
    estimationConfidence: entry.estimationConfidence,
    analysisModel: entry.analysisModel,
    analysisSchemaVersion: entry.analysisSchemaVersion,
    nutrients: sanitizeNutrients(entry.nutrients),
    uncertainties: entry.uncertainties.map(value => String(value)),
    components: entry.components.map(component => ({
      id: component.id,
      entryId: component.entryId,
      userId: component.userId,
      name: component.name,
      category: component.category,
      estimatedQuantity: toNumber(component.estimatedQuantity),
      estimatedUnit: component.estimatedUnit,
      gramsEstimate: toNumber(component.gramsEstimate),
      confidence: component.confidence,
      notes: component.notes,
      sortOrder: component.sortOrder,
    })),
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
}

function entryRow(entry: FoodEntry) {
  const nutrients = sanitizeNutrients(entry.nutrients);
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
    calories_kcal: nutrients.caloriesKcal ?? null,
    protein_g: nutrients.proteinG ?? null,
    total_fat_g: nutrients.totalFatG ?? null,
    saturated_fat_g: nutrients.saturatedFatG ?? null,
    trans_fat_g: nutrients.transFatG ?? null,
    carbs_g: nutrients.carbsG ?? null,
    fiber_g: nutrients.fiberG ?? null,
    sugars_g: nutrients.sugarsG ?? null,
    added_sugars_g: nutrients.addedSugarsG ?? null,
    sodium_mg: nutrients.sodiumMg ?? null,
    cholesterol_mg: nutrients.cholesterolMg ?? null,
    extended_nutrients: nutrients.extended ?? {},
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

  for (const component of entry.components) {
    if (component.userId !== userId) {
      throw new Error('Food entry sync failed: component user does not match authenticated user.');
    }
    if (component.entryId !== entry.id) {
      throw new Error('Food entry sync failed: component entry does not match food entry.');
    }
  }

  const supabase = getSupabaseClient();
  const sanitizedEntry = sanitizeFoodEntryForSync(entry);
  const { error: entryError } = await supabase.from('food_entries').upsert(entryRow(sanitizedEntry), { onConflict: 'id' });
  if (entryError) throw new Error(`Food entry sync failed: ${entryError.message}`);

  const componentIds = sanitizedEntry.components.map(component => component.id);
  const deleteQuery = supabase
    .from('food_entry_components')
    .delete()
    .eq('entry_id', sanitizedEntry.id)
    .eq('user_id', userId);
  const { error: deleteError } = componentIds.length
    ? await deleteQuery.not('id', 'in', `(${componentIds.join(',')})`)
    : await deleteQuery;
  if (deleteError) throw new Error(`Food entry components replace failed: ${deleteError.message}`);

  if (sanitizedEntry.components.length > 0) {
    const { error: componentError } = await supabase
      .from('food_entry_components')
      .upsert(sanitizedEntry.components.map(componentRow), { onConflict: 'id' });
    if (componentError) throw new Error(`Food entry components sync failed: ${componentError.message}`);
  }
}

export async function syncFoodEntryDelete(userId: string, entryId: string) {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('food_entries')
    .delete()
    .eq('id', entryId)
    .eq('user_id', userId);

  if (error) throw new Error(`Food entry delete failed: ${error.message}`);
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
      .order('id', { ascending: true })
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
      .order('sort_order', { ascending: true })
      .order('id', { ascending: true });

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
