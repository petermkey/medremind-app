// src/lib/weeklyReview/provider.ts
// ONE OpenRouter structured call per user per week, with the
// food/analyze/providers.ts fallback discipline: model chain, coded
// weekly_review_provider_* errors, timeout, schema-validation reject → retry
// the next model. A mock provider (env-gated like FOOD_AI_PROVIDER) keeps
// local runs and the double-fire idempotency check LLM-free.
import { buildWeeklyReviewUserPrompt, WEEKLY_REVIEW_SYSTEM_PROMPT } from './prompt';
import type { WeeklyAggregate } from '@/lib/weeklyReview/aggregate';
import {
  getWeeklyReviewModels,
  shouldFallbackWeeklyReviewModel,
} from '@/lib/weeklyReview/models';
import {
  validateWeeklyReviewPayload,
  WEEKLY_REVIEW_JSON_SCHEMA,
  type WeeklyReviewPayload,
} from '@/lib/weeklyReview/schema';

const PROVIDER_TIMEOUT_MS = 60_000;

export type WeeklyReviewResult = { payload: WeeklyReviewPayload; model: string };

export function getWeeklyReviewProvider(): 'mock' | 'openrouter' {
  const provider = process.env.WEEKLY_REVIEW_AI_PROVIDER;
  if (!provider || provider === 'mock') return 'mock';
  if (provider === 'openrouter') return 'openrouter';
  throw new Error('Unsupported WEEKLY_REVIEW_AI_PROVIDER.');
}

export async function generateWeeklyReview(aggregate: WeeklyAggregate): Promise<WeeklyReviewResult> {
  if (getWeeklyReviewProvider() === 'mock') return mockWeeklyReview(aggregate);

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is required for WEEKLY_REVIEW_AI_PROVIDER=openrouter.');

  const models = getWeeklyReviewModels();
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
          { role: 'system', content: WEEKLY_REVIEW_SYSTEM_PROMPT },
          { role: 'user', content: buildWeeklyReviewUserPrompt(aggregate) },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'weekly_review', strict: true, schema: WEEKLY_REVIEW_JSON_SCHEMA },
        },
      }),
    });

    if (!response.ok) {
      if (shouldFallbackWeeklyReviewModel(response.status, model, models[index + 1])) continue;
      throw new Error(`weekly_review_provider_openrouter_${response.status}`);
    }

    const body = await response.json();
    const outputText = body?.choices?.[0]?.message?.content;
    if (typeof outputText !== 'string' || outputText.trim().length === 0) {
      if (models[index + 1]) continue;
      throw new Error('weekly_review_provider_invalid_output');
    }

    try {
      return { payload: validateWeeklyReviewPayload(parseStructuredOutput(outputText)), model };
    } catch (validationError) {
      // B2: schema reject → retry the fallback model; exhausted → surface.
      if (models[index + 1]) continue;
      throw validationError instanceof Error && validationError.message.startsWith('weekly_review_invalid_payload')
        ? new Error('weekly_review_provider_invalid_output')
        : validationError;
    }
  }
  throw new Error('weekly_review_provider_exhausted');
}

function mockWeeklyReview(aggregate: WeeklyAggregate): WeeklyReviewResult {
  return {
    model: 'mock-weekly-review',
    payload: validateWeeklyReviewPayload({
      schemaVersion: 'weekly-review-v1',
      highlights: [
        `Дней с записями: ${aggregate.loggedDaysCount} из 7`,
        `Приёмы по плану: ${aggregate.adherence.adherencePct ?? 0}%`,
        `Средние калории: ${aggregate.food?.weekAvg.kcal ?? 0} ккал/день`,
      ],
      eatingPatterns: [{ title: 'Мок-паттерн', detail: 'Сгенерировано мок-провайдером для локальной проверки.' }],
      stackAdherence: { summary: `Принято ${aggregate.adherence.takenCount} из ${aggregate.adherence.plannedCount} доз.` },
      ouraLinkage: [],
      actions: [
        { title: 'Мок-действие 1', detail: 'Проверить рендер разбора на странице Progress.' },
        { title: 'Мок-действие 2', detail: 'Проверить дедупликацию повторного запуска крона.' },
      ],
    }),
  };
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
      throw new Error('weekly_review_provider_timeout');
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
