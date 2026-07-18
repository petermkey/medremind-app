// ONE structured LLM call per unique normalized supplement - the caller
// (service.ts) checks the supplement_nutrient_facts cache first and inserts
// the result forever after. Model fallback chain + coded error, reusing the
// medKnowledge OpenRouter caller. Relative imports only (test:unit harness;
// the fetchImpl seam doubles as the unit-test mock provider).
import { callOpenRouterStructuredJson } from '../medKnowledge/openRouter';
import {
  getMedicationKnowledgeModelConfig,
  type MedicationKnowledgeModelConfig,
} from '../medKnowledge/openRouterModels';
import { NUTRIENT_DEFS } from './limits';
import { SUPPLEMENT_FACTS_SCHEMA, validateSupplementFacts } from './factsSchema';

const EXTRACTOR_PROMPT = [
  'You are a supplement label analyst. Given a supplement name and a single-dose',
  'amount, return the nutrient content of ONE dose using ONLY the allowed keys.',
  'Use elemental amounts (e.g. elemental magnesium, not compound weight). Set a',
  'key to null when the supplement does not meaningfully contain that nutrient',
  'or you are unsure. Do not guess brands. Return only JSON matching the schema.',
  'Allowed keys and units: ',
  NUTRIENT_DEFS.map(def => `${def.key} (${def.unit})`).join(', '),
].join(' ');

export type ExtractSupplementFactsInput = {
  normalizedName: string;
  doseAmount: number;
  doseUnit: string;
};

export type ExtractedSupplementFacts = {
  nutrients: Record<string, number>;
  model: string;
};

export async function extractSupplementFacts(
  input: ExtractSupplementFactsInput,
  options: { config?: MedicationKnowledgeModelConfig; fetchImpl?: typeof fetch } = {},
): Promise<ExtractedSupplementFacts> {
  const config = options.config ?? getMedicationKnowledgeModelConfig();
  const models = [config.fastModel, config.fallbackModel];

  for (const model of models) {
    try {
      const result = await callOpenRouterStructuredJson({
        config,
        model,
        schemaName: 'supplement_nutrient_facts',
        schema: SUPPLEMENT_FACTS_SCHEMA,
        messages: [
          { role: 'system', content: EXTRACTOR_PROMPT },
          {
            role: 'user',
            content: JSON.stringify({
              supplement: input.normalizedName,
              dose: `${input.doseAmount} ${input.doseUnit}`,
            }),
          },
        ],
        fetchImpl: options.fetchImpl,
      });
      return { nutrients: validateSupplementFacts(result.output), model: result.model };
    } catch {
      // Try the next model in the chain; expose only coded exhaustion to callers.
    }
  }
  throw new Error('nutrient_balance_provider_exhausted');
}
