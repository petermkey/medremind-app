import {
  getOpenRouterFoodVisionModels,
  shouldFallbackOpenRouterFoodModel,
} from '@/lib/food/analyze/openRouterModels';
import type { NutrientGaps } from './gaps';
import {
  FOOD_SUGGEST_SCHEMA,
  FOOD_SUGGEST_SCHEMA_VERSION,
  validateFoodSuggestions,
  type FoodSuggestion,
} from './suggestSchema';

const PROVIDER_TIMEOUT_MS = 30_000;

const SUGGEST_PROMPT = [
  'Ты - помощник по питанию. Пользователю осталось добрать до дневных целей',
  'нутриенты, перечисленные в JSON ниже (нулевые значения означают, что цель',
  'уже закрыта). Предложи 2-3 конкретных блюда или перекуса, реально',
  'закрывающих самые большие пробелы. Обычные продукты, без экзотики.',
  'Отвечай на русском. Верни только JSON по схеме. Никаких медицинских советов.',
].join(' ');

export type FoodSuggestResult = { suggestions: FoodSuggestion[]; model: string };

export async function suggestFoodForGaps(gaps: NutrientGaps): Promise<FoodSuggestResult> {
  const provider = process.env.FOOD_AI_PROVIDER;
  if (!provider || provider === 'mock') return mockSuggestions(gaps);
  if (provider !== 'openrouter') {
    throw new Error('food_suggest_provider_unsupported');
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is required for FOOD_AI_PROVIDER=openrouter.');

  const models = getOpenRouterFoodVisionModels();
  for (let index = 0; index < models.length; index += 1) {
    const model = models[index];
    const response = await fetchWithTimeout('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
        'X-Title': 'MedRemind',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SUGGEST_PROMPT },
          { role: 'user', content: JSON.stringify({ remainingToday: gaps }) },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'food_suggest', strict: true, schema: FOOD_SUGGEST_SCHEMA },
        },
      }),
    });

    if (!response.ok) {
      if (shouldFallbackOpenRouterFoodModel(response.status, model, models[index + 1])) continue;
      throw new Error(`food_provider_openrouter_${response.status}`);
    }

    const payload = await response.json();
    const outputText = payload?.choices?.[0]?.message?.content;
    if (typeof outputText !== 'string' || outputText.trim().length === 0) {
      throw new Error('Food suggest returned no structured output.');
    }
    return { suggestions: validateFoodSuggestions(parseStructuredOutput(outputText)), model };
  }
  throw new Error('food_provider_openrouter_exhausted');
}

function mockSuggestions(gaps: NutrientGaps): FoodSuggestResult {
  const suggestions = validateFoodSuggestions({
    suggestions: [
      {
        title: 'Творог с ягодами',
        description: '200 г творога 5% с горстью черники.',
        rationale: `Закрывает около 34 г из ${gaps.proteinG} г недостающего белка.`,
        approxNutrients: { caloriesKcal: 280, proteinG: 34, totalFatG: 10, carbsG: 14, fiberG: 2 },
      },
      {
        title: 'Чечевичный суп',
        description: 'Тарелка чечевичного супа с цельнозерновым хлебом.',
        rationale: `Дает около 12 г клетчатки из недостающих ${gaps.fiberG} г.`,
        approxNutrients: { caloriesKcal: 350, proteinG: 18, totalFatG: 6, carbsG: 52, fiberG: 12 },
      },
    ],
  });
  return { suggestions, model: `mock-${FOOD_SUGGEST_SCHEMA_VERSION}` };
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === 'AbortError' || error.name === 'TimeoutError')
    ) {
      throw new Error('food_provider_timeout');
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function parseStructuredOutput(outputText: string): unknown {
  const trimmed = outputText.trim();
  const fencedMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return JSON.parse(fencedMatch ? fencedMatch[1] : trimmed);
}
