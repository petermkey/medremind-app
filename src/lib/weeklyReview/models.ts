// src/lib/weeklyReview/models.ts
// Model chain for the weekly review (clone of food/analyze/openRouterModels.ts).
// Leaf module. The code-default model is always the terminal fallback so a
// stale env-pinned model can never sink the whole chain.

export const DEFAULT_WEEKLY_REVIEW_MODEL = 'google/gemini-2.5-flash';

const FALLBACKABLE_STATUSES = new Set([404, 408, 409, 429, 500, 502, 503, 504]);

type ModelEnv = Record<string, string | undefined>;

function cleanModelId(value: string | undefined): string | undefined {
  const cleaned = value?.trim();
  return cleaned ? cleaned : undefined;
}

export function getWeeklyReviewModels(env: ModelEnv = process.env): string[] {
  const primaryModel =
    cleanModelId(env.OPENROUTER_WEEKLY_REVIEW_MODEL) ?? DEFAULT_WEEKLY_REVIEW_MODEL;
  const fallbackModel = cleanModelId(env.OPENROUTER_WEEKLY_REVIEW_FALLBACK_MODEL);
  return Array.from(
    new Set(
      [primaryModel, fallbackModel, DEFAULT_WEEKLY_REVIEW_MODEL].filter(
        (model): model is string => Boolean(model),
      ),
    ),
  );
}

export function shouldFallbackWeeklyReviewModel(
  status: number,
  currentModel: string,
  nextModel: string | undefined,
): boolean {
  return Boolean(nextModel && nextModel !== currentModel && FALLBACKABLE_STATUSES.has(status));
}
