import type { FoodDailyTotals, FoodEntry, FoodNutrients } from '@/types/food';

const NUTRIENT_KEYS = [
  'caloriesKcal',
  'proteinG',
  'totalFatG',
  'saturatedFatG',
  'transFatG',
  'carbsG',
  'fiberG',
  'sugarsG',
  'addedSugarsG',
  'sodiumMg',
  'cholesterolMg',
] as const satisfies readonly (keyof Omit<FoodNutrients, 'extended'>)[];

function addOptional(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined && b === undefined) {
    return undefined;
  }

  return Math.round(((a ?? 0) + (b ?? 0)) * 100) / 100;
}

function cleanTimezone(timezone: unknown): string | undefined {
  if (typeof timezone !== 'string') {
    return undefined;
  }

  const trimmed = timezone.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: trimmed });
    return trimmed;
  } catch {
    return undefined;
  }
}

function getResolvedTimezone(timezone?: string): string {
  const providedTimezone = cleanTimezone(timezone);
  if (providedTimezone) {
    return providedTimezone;
  }

  const systemTimezone = cleanTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  return systemTimezone ?? 'UTC';
}

function formatLocalDate(value: string, timezone: string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;

  return year && month && day ? `${year}-${month}-${day}` : null;
}

export function sumFoodNutrients(entries: FoodEntry[]): FoodDailyTotals {
  const totals: FoodDailyTotals = {
    entryCount: entries.length,
  };

  for (const entry of entries) {
    for (const key of NUTRIENT_KEYS) {
      totals[key] = addOptional(totals[key], entry.nutrients[key]);
    }
  }

  return totals;
}

export function filterFoodEntriesForLocalDate(
  entries: FoodEntry[],
  date: string,
  timezone?: string,
): FoodEntry[] {
  const resolvedTimezone = getResolvedTimezone(timezone);

  return entries.filter((entry) => {
    const entryTimezone = cleanTimezone(entry.timezone || resolvedTimezone) ?? resolvedTimezone;
    return formatLocalDate(entry.consumedAt, entryTimezone) === date;
  });
}
