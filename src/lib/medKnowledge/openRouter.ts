import type { JsonSchema } from './aiSchemas';
import type { MedicationKnowledgeModelConfig } from './openRouterModels';

type OpenRouterMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

type OpenRouterUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
};

export type OpenRouterStructuredJsonResult<T> = {
  model: string;
  usage: OpenRouterUsage | null;
  output: T;
};

export type CallOpenRouterStructuredJsonInput = {
  config: MedicationKnowledgeModelConfig;
  model: string;
  schemaName: string;
  schema: JsonSchema;
  messages: OpenRouterMessage[];
  fetchImpl?: typeof fetch;
};

export async function callOpenRouterStructuredJson<T = unknown>(
  input: CallOpenRouterStructuredJsonInput,
): Promise<OpenRouterStructuredJsonResult<T>> {
  const fetcher = input.fetchImpl ?? fetch;
  const response = await fetcher(`${input.config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: buildOpenRouterHeaders(input.config),
    body: JSON.stringify({
      model: input.model,
      messages: input.messages,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: input.schemaName,
          strict: true,
          schema: input.schema,
        },
      },
      provider: { require_parameters: true },
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenRouter request failed with status ${response.status}`);
  }

  const payload = await parseJsonResponse(response);
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || content.trim().length === 0) {
    throw new Error('OpenRouter response missing structured content');
  }

  let output: T;
  try {
    output = JSON.parse(content) as T;
  } catch {
    throw new Error('OpenRouter returned malformed structured JSON');
  }

  return {
    model: typeof payload.model === 'string' ? payload.model : input.model,
    usage: isUsage(payload.usage) ? payload.usage : null,
    output,
  };
}

function buildOpenRouterHeaders(config: MedicationKnowledgeModelConfig): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.apiKey}`,
    'Content-Type': 'application/json',
    'X-OpenRouter-Title': config.appTitle,
  };
  if (config.appReferer) headers['HTTP-Referer'] = config.appReferer;
  return headers;
}

async function parseJsonResponse(response: Response): Promise<any> {
  try {
    return await response.json();
  } catch {
    throw new Error('OpenRouter returned malformed response JSON');
  }
}

function isUsage(value: unknown): value is OpenRouterUsage {
  return value !== null && typeof value === 'object';
}
