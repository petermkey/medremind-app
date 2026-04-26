import type { FoodAnalysisDraft } from '@/types/food';
import { validateFoodAnalysisDraft } from '@/lib/food/analysisSchema';
import {
  getOpenRouterFoodVisionModels,
  shouldFallbackOpenRouterFoodModel,
} from './openRouterModels';

export type FoodAnalysisInput = { imageDataUrl: string; imageType: string };

export type FoodAnalysisProvider = 'mock' | 'openai' | 'openrouter' | 'gemini';

const FOOD_ANALYSIS_PROMPT =
  'Estimate the visible food and drink in this image. Return only JSON matching the schema. Include approximate portions, nutrients, confidence, and uncertainties. Do not provide medical advice.';

const PROVIDER_TIMEOUT_MS = 30_000;

const FOOD_ANALYSIS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'title',
    'summary',
    'mealLabel',
    'components',
    'nutrients',
    'uncertainties',
    'estimationConfidence',
    'model',
    'schemaVersion',
  ],
  properties: {
    title: { type: 'string' },
    summary: { type: 'string' },
    mealLabel: {
      type: 'string',
      enum: ['breakfast', 'lunch', 'dinner', 'snack', 'unknown'],
    },
    components: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'name',
          'category',
          'estimatedQuantity',
          'estimatedUnit',
          'gramsEstimate',
          'confidence',
          'notes',
        ],
        properties: {
          name: { type: 'string' },
          category: { type: ['string', 'null'] },
          estimatedQuantity: { type: ['number', 'null'] },
          estimatedUnit: { type: ['string', 'null'] },
          gramsEstimate: { type: ['number', 'null'] },
          confidence: { type: 'number' },
          notes: { type: ['string', 'null'] },
        },
      },
    },
    nutrients: {
      type: 'object',
      additionalProperties: false,
      required: [
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
        'extended',
      ],
      properties: {
        caloriesKcal: { type: ['number', 'null'] },
        proteinG: { type: ['number', 'null'] },
        totalFatG: { type: ['number', 'null'] },
        saturatedFatG: { type: ['number', 'null'] },
        transFatG: { type: ['number', 'null'] },
        carbsG: { type: ['number', 'null'] },
        fiberG: { type: ['number', 'null'] },
        sugarsG: { type: ['number', 'null'] },
        addedSugarsG: { type: ['number', 'null'] },
        sodiumMg: { type: ['number', 'null'] },
        cholesterolMg: { type: ['number', 'null'] },
        extended: {
          type: 'object',
          additionalProperties: false,
          properties: {},
          required: [],
        },
      },
    },
    uncertainties: {
      type: 'array',
      items: { type: 'string' },
    },
    estimationConfidence: { type: 'number' },
    model: { type: 'string' },
    schemaVersion: { type: 'string', enum: ['food-analysis-v1'] },
  },
} as const;

export function getFoodAnalysisProvider(): FoodAnalysisProvider {
  const provider = process.env.FOOD_AI_PROVIDER;

  if (!provider || provider === 'mock') {
    return 'mock';
  }

  if (provider === 'openai' || provider === 'openrouter' || provider === 'gemini') {
    return provider;
  }

  throw new Error('Unsupported FOOD_AI_PROVIDER.');
}

export async function analyzeFoodImage(input: FoodAnalysisInput): Promise<FoodAnalysisDraft> {
  switch (getFoodAnalysisProvider()) {
    case 'openai':
      return analyzeWithOpenAI(input);
    case 'openrouter':
      return analyzeWithOpenRouter(input);
    case 'gemini':
      return analyzeWithGemini(input);
    case 'mock':
    default:
      return mockFoodAnalysis();
  }
}

function mockFoodAnalysis(): FoodAnalysisDraft {
  return validateFoodAnalysisDraft({
    title: 'Estimated salad',
    summary: 'A mixed salad with leafy greens, vegetables, and a light dressing.',
    mealLabel: 'unknown',
    components: [
      {
        name: 'Mixed salad',
        category: 'vegetables',
        estimatedQuantity: 1,
        estimatedUnit: 'bowl',
        gramsEstimate: 250,
        confidence: 0.6,
        notes: 'Mock estimate for development.',
      },
    ],
    nutrients: {
      caloriesKcal: 220,
      proteinG: 6,
      totalFatG: 14,
      carbsG: 20,
      fiberG: 7,
      sodiumMg: 320,
    },
    uncertainties: ['Portion size and dressing amount are estimated from the image.'],
    estimationConfidence: 0.6,
    model: 'mock-food-analysis',
    schemaVersion: 'food-analysis-v1',
  });
}

async function analyzeWithOpenAI(input: FoodAnalysisInput): Promise<FoodAnalysisDraft> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is required for FOOD_AI_PROVIDER=openai.');
  }

  const model = process.env.OPENAI_FOOD_VISION_MODEL || 'gpt-4o-mini';
  const response = await fetchWithTimeout(
    'https://api.openai.com/v1/responses',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        input: [
          {
            role: 'user',
            content: [
              { type: 'input_text', text: FOOD_ANALYSIS_PROMPT },
              { type: 'input_image', image_url: input.imageDataUrl },
            ],
          },
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'food_analysis',
            schema: FOOD_ANALYSIS_SCHEMA,
            strict: true,
          },
        },
      }),
    },
  );

  if (!response.ok) {
    throw new Error('Food analysis failed.');
  }

  const payload = await response.json();
  const outputText = extractOpenAIOutputText(payload);
  if (!outputText) {
    throw new Error('Food analysis returned no structured output.');
  }

  return validateProviderDraft(parseStructuredOutput(outputText), model);
}

async function analyzeWithOpenRouter(input: FoodAnalysisInput): Promise<FoodAnalysisDraft> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is required for FOOD_AI_PROVIDER=openrouter.');
  }

  const models = getOpenRouterFoodVisionModels();

  for (let index = 0; index < models.length; index += 1) {
    const model = models[index];
    const response = await fetchOpenRouterFoodAnalysis(input, apiKey, model);

    if (!response.ok) {
      if (shouldFallbackOpenRouterFoodModel(response.status, model, models[index + 1])) {
        continue;
      }

      throw new Error('Food analysis failed.');
    }

    const payload = await response.json();
    const outputText = payload?.choices?.[0]?.message?.content;
    if (typeof outputText !== 'string' || outputText.trim().length === 0) {
      throw new Error('Food analysis returned no structured output.');
    }

    return validateProviderDraft(parseStructuredOutput(outputText), model);
  }

  throw new Error('Food analysis failed.');
}

function fetchOpenRouterFoodAnalysis(
  input: FoodAnalysisInput,
  apiKey: string,
  model: string,
): Promise<Response> {
  return fetchWithTimeout(
    'https://openrouter.ai/api/v1/chat/completions',
    {
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
          {
            role: 'user',
            content: [
              { type: 'text', text: FOOD_ANALYSIS_PROMPT },
              { type: 'image_url', image_url: { url: input.imageDataUrl } },
            ],
          },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'food_analysis',
            strict: true,
            schema: FOOD_ANALYSIS_SCHEMA,
          },
        },
      }),
    },
  );
}

async function analyzeWithGemini(input: FoodAnalysisInput): Promise<FoodAnalysisDraft> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is required for FOOD_AI_PROVIDER=gemini.');
  }

  const model = process.env.GEMINI_FOOD_VISION_MODEL || 'gemini-2.5-flash';
  const response = await fetchWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              { text: `${FOOD_ANALYSIS_PROMPT}\n\nSchema: ${JSON.stringify(FOOD_ANALYSIS_SCHEMA)}` },
              {
                inlineData: {
                  mimeType: input.imageType,
                  data: extractBase64Data(input.imageDataUrl),
                },
              },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          responseJsonSchema: FOOD_ANALYSIS_SCHEMA,
        },
      }),
    },
  );

  if (!response.ok) {
    throw new Error('Food analysis failed.');
  }

  const payload = await response.json();
  const outputText = payload?.candidates?.[0]?.content?.parts
    ?.map((part: { text?: unknown }) => (typeof part.text === 'string' ? part.text : ''))
    .join('')
    .trim();

  if (!outputText) {
    throw new Error('Food analysis returned no structured output.');
  }

  return validateProviderDraft(parseStructuredOutput(outputText), model);
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error('Food analysis failed.');
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function validateProviderDraft(value: unknown, model: string): FoodAnalysisDraft {
  const draft = validateFoodAnalysisDraft(value);

  return {
    ...draft,
    model,
  };
}

function extractOpenAIOutputText(payload: unknown): string | null {
  if (!isRecord(payload)) {
    return null;
  }

  if (typeof payload.output_text === 'string' && payload.output_text.trim().length > 0) {
    return payload.output_text;
  }

  const output = Array.isArray(payload.output) ? payload.output : [];
  const textParts: string[] = [];

  for (const item of output) {
    if (!isRecord(item) || !Array.isArray(item.content)) {
      continue;
    }

    for (const content of item.content) {
      if (!isRecord(content)) {
        continue;
      }

      if (typeof content.text === 'string') {
        textParts.push(content.text);
      } else if (typeof content.output_text === 'string') {
        textParts.push(content.output_text);
      }
    }
  }

  const joined = textParts.join('').trim();
  return joined.length > 0 ? joined : null;
}

function parseStructuredOutput(outputText: string): unknown {
  const trimmed = outputText.trim();
  const fencedMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);

  return JSON.parse(fencedMatch ? fencedMatch[1] : trimmed);
}

function extractBase64Data(dataUrl: string): string {
  const marker = ';base64,';
  const markerIndex = dataUrl.indexOf(marker);

  if (markerIndex === -1) {
    throw new Error('Invalid image data URL.');
  }

  return dataUrl.slice(markerIndex + marker.length);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'AbortError' || error.name === 'TimeoutError')
  );
}
