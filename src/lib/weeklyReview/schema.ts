// src/lib/weeklyReview/schema.ts
// The weekly-review LLM output contract: OpenRouter strict json_schema plus a
// server-side validator (validateFoodAnalysisDraft role). Leaf module.

export type WeeklyReviewPayload = {
  schemaVersion: 'weekly-review-v1';
  highlights: string[]; // exactly 3
  eatingPatterns: Array<{ title: string; detail: string }>; // 1..4
  stackAdherence: { summary: string };
  ouraLinkage: string[]; // 0..3
  actions: Array<{ title: string; detail: string }>; // 2..3
};

export const WEEKLY_REVIEW_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'highlights', 'eatingPatterns', 'stackAdherence', 'ouraLinkage', 'actions'],
  properties: {
    schemaVersion: { type: 'string', enum: ['weekly-review-v1'] },
    highlights: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'string' } },
    eatingPatterns: {
      type: 'array',
      minItems: 1,
      maxItems: 4,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'detail'],
        properties: { title: { type: 'string' }, detail: { type: 'string' } },
      },
    },
    stackAdherence: {
      type: 'object',
      additionalProperties: false,
      required: ['summary'],
      properties: { summary: { type: 'string' } },
    },
    ouraLinkage: { type: 'array', minItems: 0, maxItems: 3, items: { type: 'string' } },
    actions: {
      type: 'array',
      minItems: 2,
      maxItems: 3,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'detail'],
        properties: { title: { type: 'string' }, detail: { type: 'string' } },
      },
    },
  },
} as const;

function fail(reason: string): never {
  throw new Error(`weekly_review_invalid_payload: ${reason}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown, where: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) fail(where);
  return value.trim();
}

function titleDetailList(
  value: unknown,
  min: number,
  max: number,
  where: string,
): Array<{ title: string; detail: string }> {
  if (!Array.isArray(value) || value.length < min || value.length > max) fail(where);
  return value.map((item, index) => {
    if (!isRecord(item)) fail(`${where}[${index}]`);
    return {
      title: nonEmptyString(item.title, `${where}[${index}].title`),
      detail: nonEmptyString(item.detail, `${where}[${index}].detail`),
    };
  });
}

export function validateWeeklyReviewPayload(value: unknown): WeeklyReviewPayload {
  if (!isRecord(value)) fail('root');
  if (value.schemaVersion !== 'weekly-review-v1') fail('schemaVersion');

  const highlights = value.highlights;
  if (!Array.isArray(highlights) || highlights.length !== 3) fail('highlights');

  const ouraLinkage = value.ouraLinkage;
  if (!Array.isArray(ouraLinkage) || ouraLinkage.length > 3) fail('ouraLinkage');

  if (!isRecord(value.stackAdherence)) fail('stackAdherence');

  return {
    schemaVersion: 'weekly-review-v1',
    highlights: highlights.map((item, index) => nonEmptyString(item, `highlights[${index}]`)),
    eatingPatterns: titleDetailList(value.eatingPatterns, 1, 4, 'eatingPatterns'),
    stackAdherence: { summary: nonEmptyString(value.stackAdherence.summary, 'stackAdherence.summary') },
    ouraLinkage: ouraLinkage.map((item, index) => nonEmptyString(item, `ouraLinkage[${index}]`)),
    actions: titleDetailList(value.actions, 2, 3, 'actions'),
  };
}
