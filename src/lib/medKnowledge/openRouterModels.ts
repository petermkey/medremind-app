export type MedicationKnowledgeModelConfig = {
  baseUrl: string;
  apiKey: string;
  appReferer: string | null;
  appTitle: string;
  fastModel: string;
  reasoningModel: string;
  secondOpinionModel: string;
  nanoModel: string;
  longContextModel: string;
  fallbackModel: string;
};

export function getMedicationKnowledgeModelConfig(env: NodeJS.ProcessEnv = process.env): MedicationKnowledgeModelConfig {
  const apiKey = env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is required');

  return {
    baseUrl: env.OPENROUTER_API_BASE_URL ?? 'https://openrouter.ai/api/v1',
    apiKey,
    appReferer: env.OPENROUTER_HTTP_REFERER ?? env.NEXT_PUBLIC_APP_URL ?? null,
    appTitle: env.OPENROUTER_APP_TITLE ?? 'MedRemind',
    fastModel: env.MED_KNOWLEDGE_FAST_MODEL ?? 'google/gemini-2.5-flash',
    reasoningModel: env.MED_KNOWLEDGE_REASONING_MODEL ?? 'anthropic/claude-sonnet-4.5',
    secondOpinionModel: env.MED_KNOWLEDGE_SECOND_OPINION_MODEL ?? 'google/gemini-2.5-pro',
    nanoModel: env.MED_KNOWLEDGE_NANO_MODEL ?? 'google/gemini-2.5-flash-lite',
    longContextModel: env.MED_KNOWLEDGE_LONG_CONTEXT_MODEL ?? 'qwen/qwen3.6-plus',
    fallbackModel: env.MED_KNOWLEDGE_AUTO_FALLBACK_MODEL ?? 'openrouter/auto',
  };
}
