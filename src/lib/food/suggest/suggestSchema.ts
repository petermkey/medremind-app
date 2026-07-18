import type { FoodNutrients } from '../../../types/food';

export const FOOD_SUGGEST_SCHEMA_VERSION = 'food-suggest-v1';
export const MAX_SUGGESTIONS = 3;

export type FoodSuggestion = {
  title: string;
  description: string;
  approxNutrients: FoodNutrients;
  rationale: string;
};

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
] as const;

const NUTRIENT_SCHEMA_PROPERTIES = Object.fromEntries(
  NUTRIENT_KEYS.map(key => [key, { type: ['number', 'null'] }]),
);

export const FOOD_SUGGEST_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['suggestions'],
  properties: {
    suggestions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'description', 'rationale', 'approxNutrients'],
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          rationale: { type: 'string' },
          approxNutrients: {
            type: 'object',
            additionalProperties: false,
            required: [...NUTRIENT_KEYS],
            properties: NUTRIENT_SCHEMA_PROPERTIES,
          },
        },
      },
    },
  },
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cleanString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function cleanNumber(value: unknown): number | undefined {
  const parsed =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim()) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return Math.round(parsed * 100) / 100;
}

function cleanNutrients(value: unknown): FoodNutrients {
  const source = isRecord(value) ? value : {};
  const nutrients: FoodNutrients = {};
  for (const key of NUTRIENT_KEYS) {
    const cleaned = cleanNumber(source[key]);
    if (cleaned !== undefined) nutrients[key] = cleaned;
  }
  return nutrients;
}

function cleanSuggestion(value: unknown): FoodSuggestion | null {
  if (!isRecord(value)) return null;
  const title = cleanString(value.title);
  const description = cleanString(value.description);
  if (!title || !description) return null;
  return {
    title,
    description,
    rationale: cleanString(value.rationale) ?? '',
    approxNutrients: cleanNutrients(value.approxNutrients),
  };
}

export function validateFoodSuggestions(value: unknown): FoodSuggestion[] {
  if (!isRecord(value) || !Array.isArray(value.suggestions)) {
    throw new Error('Food suggest response must contain a suggestions array.');
  }
  const suggestions = value.suggestions
    .map(cleanSuggestion)
    .filter((item): item is FoodSuggestion => item !== null)
    .slice(0, MAX_SUGGESTIONS);
  if (suggestions.length === 0) {
    throw new Error('Food suggest response must include at least one valid suggestion.');
  }
  return suggestions;
}
