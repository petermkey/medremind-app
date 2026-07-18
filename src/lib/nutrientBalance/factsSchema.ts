// Structured-output schema + validator for supplement nutrient extraction.
// Relative imports only (test:unit harness). The schema whitelists exactly
// the curated nutrient keys - the model cannot invent nutrients, and it
// cannot supply ULs (those live in limits.ts by design).
import type { JsonSchema } from '../medKnowledge/aiSchemas';
import { findNutrientDef, NUTRIENT_DEFS } from './limits';

export function normalizeSupplementName(displayName: string): string {
  return displayName.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

const NUTRIENT_PROPERTIES = Object.fromEntries(
  NUTRIENT_DEFS.map(def => [def.key, { type: ['number', 'null'] }]),
);

export const SUPPLEMENT_FACTS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['nutrients', 'confidence', 'notes'],
  properties: {
    nutrients: {
      type: 'object',
      additionalProperties: false,
      required: NUTRIENT_DEFS.map(def => def.key),
      properties: NUTRIENT_PROPERTIES,
    },
    confidence: { type: 'number' },
    notes: { type: ['string', 'null'] },
  },
} as unknown as JsonSchema;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validateSupplementFacts(value: unknown): Record<string, number> {
  if (!isRecord(value) || !isRecord(value.nutrients)) {
    throw new Error('Supplement facts response must contain a nutrients object.');
  }
  const nutrients: Record<string, number> = {};
  for (const [rawKey, rawValue] of Object.entries(value.nutrients)) {
    const def = findNutrientDef(rawKey);
    if (!def) continue;
    const parsed = typeof rawValue === 'number' ? rawValue : Number.NaN;
    if (!Number.isFinite(parsed) || parsed <= 0) continue;
    nutrients[def.key] = Math.round(parsed * 100) / 100;
  }
  return nutrients;
}
