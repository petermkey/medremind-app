export type JsonSchema = {
  type: string;
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties: false;
  items?: unknown;
  enum?: readonly string[];
};

const STRING_ARRAY_SCHEMA = {
  type: 'array',
  items: { type: 'string' },
};

export const MEDICATION_CLASSIFICATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['label', 'confidence', 'rationale'],
  properties: {
    label: { type: 'string' },
    rxnormRxcui: { type: ['string', 'null'] },
    normalizedName: { type: ['string', 'null'] },
    ingredients: STRING_ARRAY_SCHEMA,
    classLabels: STRING_ARRAY_SCHEMA,
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    rationale: { type: 'string' },
    ambiguityNotes: { type: ['string', 'null'] },
  },
} as const satisfies JsonSchema;

export const EVIDENCE_SUMMARY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'evidenceRefs', 'confidence'],
  properties: {
    summary: { type: 'string' },
    evidenceRefs: STRING_ARRAY_SCHEMA,
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    limitations: STRING_ARRAY_SCHEMA,
  },
} as const satisfies JsonSchema;

export const INSIGHT_DRAFT_REVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['accepted', 'riskLevel', 'recommendationKind', 'evidenceRefs', 'reasons'],
  properties: {
    accepted: { type: 'boolean' },
    riskLevel: { type: 'string', enum: ['low', 'medium', 'high'] },
    recommendationKind: {
      type: 'string',
      enum: ['lifestyle_adjustment', 'tracking_prompt', 'clinician_review'],
    },
    evidenceRefs: STRING_ARRAY_SCHEMA,
    reasons: STRING_ARRAY_SCHEMA,
    revisedTitle: { type: ['string', 'null'] },
    revisedBody: { type: ['string', 'null'] },
  },
} as const satisfies JsonSchema;

export const SECOND_OPINION_REVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['agrees', 'riskLevel', 'evidenceRefs', 'concerns'],
  properties: {
    agrees: { type: 'boolean' },
    riskLevel: { type: 'string', enum: ['low', 'medium', 'high'] },
    evidenceRefs: STRING_ARRAY_SCHEMA,
    concerns: STRING_ARRAY_SCHEMA,
    requiredChanges: STRING_ARRAY_SCHEMA,
  },
} as const satisfies JsonSchema;

export const INSIGHT_DEDUPLICATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['isDuplicate', 'canonicalInsightId', 'reason'],
  properties: {
    isDuplicate: { type: 'boolean' },
    canonicalInsightId: { type: ['string', 'null'] },
    reason: { type: 'string' },
  },
} as const satisfies JsonSchema;
