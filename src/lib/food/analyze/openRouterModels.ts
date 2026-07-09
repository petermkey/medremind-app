export const DEFAULT_OPENROUTER_FOOD_VISION_MODEL = 'google/gemini-2.5-flash';

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

  // The code-default model is always appended as a terminal fallback so a
  // stale/removed env-pinned model (which happens when OpenRouter retires a
  // model id) can never take the whole chain below a model we know is live.
  return Array.from(
    new Set(
      [primaryModel, fallbackModel, DEFAULT_OPENROUTER_FOOD_VISION_MODEL].filter(
        (model): model is string => Boolean(model),
      ),
    ),
  );
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
