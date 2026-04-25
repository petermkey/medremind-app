import type {
  FoodAnalysisComponentDraft,
  FoodAnalysisDraft,
  FoodMealLabel,
  FoodNutrients,
} from '@/types/food';

const ALLOWED_MEAL_LABELS = new Set<FoodMealLabel>([
  'breakfast',
  'lunch',
  'dinner',
  'snack',
  'unknown',
]);

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cleanString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback;
}

function cleanOptionalString(value: unknown): string | undefined {
  const cleaned = cleanString(value);
  return cleaned.length > 0 ? cleaned : undefined;
}

function cleanNumericValue(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function cleanNumber(value: unknown): number | undefined {
  const parsed = cleanNumericValue(value);
  if (parsed === undefined || parsed < 0) {
    return undefined;
  }

  return Math.round(parsed * 100) / 100;
}

function cleanConfidence(value: unknown): number {
  const parsed = cleanNumericValue(value);
  if (parsed === undefined) {
    return 0;
  }

  const clamped = Math.min(1, Math.max(0, parsed));
  return Math.round(clamped * 100) / 100;
}

function cleanMealLabel(value: unknown): FoodMealLabel {
  return typeof value === 'string' && ALLOWED_MEAL_LABELS.has(value as FoodMealLabel)
    ? (value as FoodMealLabel)
    : 'unknown';
}

function cleanNutrients(value: unknown): FoodNutrients {
  const source = isRecord(value) ? value : {};
  const nutrients: FoodNutrients = {};

  for (const key of NUTRIENT_KEYS) {
    const cleaned = cleanNumber(source[key]);
    if (cleaned !== undefined) {
      nutrients[key] = cleaned;
    }
  }

  if (isRecord(source.extended)) {
    const extended: Record<string, number> = {};

    for (const [key, rawValue] of Object.entries(source.extended)) {
      const cleanedKey = key.trim();
      const cleanedValue = cleanNumber(rawValue);

      if (cleanedKey.length > 0 && cleanedValue !== undefined) {
        extended[cleanedKey] = cleanedValue;
      }
    }

    if (Object.keys(extended).length > 0) {
      nutrients.extended = extended;
    }
  }

  return nutrients;
}

function cleanComponent(value: unknown, _index: number): FoodAnalysisComponentDraft | null {
  if (!isRecord(value)) {
    return null;
  }

  const name = cleanOptionalString(value.name);
  if (!name) {
    return null;
  }

  return {
    name,
    category: cleanOptionalString(value.category),
    estimatedQuantity: cleanNumber(value.estimatedQuantity),
    estimatedUnit: cleanOptionalString(value.estimatedUnit),
    gramsEstimate: cleanNumber(value.gramsEstimate),
    confidence: cleanConfidence(value.confidence),
    notes: cleanOptionalString(value.notes),
  };
}

export function validateFoodAnalysisDraft(value: unknown): FoodAnalysisDraft {
  if (!isRecord(value)) {
    throw new Error('Food analysis response must be an object.');
  }

  const title = cleanOptionalString(value.title);
  if (!title) {
    throw new Error('Food analysis response is missing a title.');
  }

  const summary = cleanOptionalString(value.summary);
  if (!summary) {
    throw new Error('Food analysis response is missing a summary.');
  }

  const components = Array.isArray(value.components)
    ? value.components
        .map((component, index) => cleanComponent(component, index))
        .filter((component): component is FoodAnalysisComponentDraft => component !== null)
    : [];

  if (components.length === 0) {
    throw new Error('Food analysis response must include at least one valid component.');
  }

  const uncertainties = Array.isArray(value.uncertainties)
    ? value.uncertainties
        .map((uncertainty) => cleanOptionalString(uncertainty))
        .filter((uncertainty): uncertainty is string => uncertainty !== undefined)
    : [];

  return {
    title,
    summary,
    mealLabel: cleanMealLabel(value.mealLabel),
    components,
    nutrients: cleanNutrients(value.nutrients),
    uncertainties,
    estimationConfidence: cleanConfidence(value.estimationConfidence),
    model: cleanString(value.model, 'unknown') || 'unknown',
    schemaVersion: 'food-analysis-v1',
  };
}
