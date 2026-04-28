export const DEFAULT_OPENROUTER_FOOD_VISION_MODEL = 'google/gemma-4-31b-it:free';

const FALLBACKABLE_OPENROUTER_STATUSES = new Set([404, 408, 409, 429, 500, 502, 503, 504]);

type OpenRouterModelEnv = Record<string, string | undefined>;

function cleanModelId(value: string | undefined): string | undefined {
  const cleaned = value?.trim();
  return cleaned ? cleaned : undefined;
}

export function getOpenRouterFoodVisionModels(env: OpenRouterModelEnv = process.env): string[] {
  const primaryModel =
    cleanModelId(env.OPENROUTER_FOOD_VISION_MODEL) ?? DEFAULT_OPENROUTER_FOOD_VISION_MODEL;
  const fallbackModel = cleanModelId(env.OPENROUTER_FOOD_VISION_FALLBACK_MODEL);

  return Array.from(new Set([primaryModel, fallbackModel].filter((model): model is string => Boolean(model))));
}

export function shouldFallbackOpenRouterFoodModel(
  status: number,
  currentModel: string,
  nextModel: string | undefined,
): boolean {
  return Boolean(
    nextModel &&
    nextModel !== currentModel &&
    FALLBACKABLE_OPENROUTER_STATUSES.has(status),
  );
}
