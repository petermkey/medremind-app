import { createHash } from 'node:crypto';

import type {
  MedicationEvidenceSource,
  MedicationRiskLevel,
  MedicationRuleRecommendationKind,
} from './types';

export type MedicationEvidenceDocument = {
  id: string;
  source: MedicationEvidenceSource;
  title: string;
  content: string;
  rxnormRxcui?: string | null;
  ingredients?: string[];
  classLabels?: string[];
  contentHash?: string;
};

export type RankedMedicationEvidenceDocument = MedicationEvidenceDocument & {
  score: number;
};

export type EvidenceMatchQuery = {
  rxnormRxcui?: string | null;
  ingredients?: string[];
  classLabels?: string[];
  contentHashes?: string[];
};

export type HighRiskEvidenceCheckInput = {
  riskLevel?: MedicationRiskLevel;
  recommendationKind?: MedicationRuleRecommendationKind;
  evidenceRefs?: unknown[];
};

export function createEvidenceContentHash(content: string): string {
  return createHash('sha256').update(normalizeHashContent(content)).digest('hex');
}

export function rankEvidenceLexically(
  documents: MedicationEvidenceDocument[],
  query: string,
): RankedMedicationEvidenceDocument[] {
  const queryTerms = tokenize(query);

  return documents
    .map((document) => ({
      ...document,
      score: scoreDocument(document, queryTerms),
    }))
    .sort((first, second) => second.score - first.score || first.id.localeCompare(second.id));
}

export function matchEvidence(
  documents: MedicationEvidenceDocument[],
  query: EvidenceMatchQuery,
): MedicationEvidenceDocument[] {
  const rxnormRxcui = query.rxnormRxcui ?? null;
  const ingredients = new Set((query.ingredients ?? []).map(normalizeComparable));
  const classLabels = new Set((query.classLabels ?? []).map(normalizeComparable));
  const contentHashes = new Set(query.contentHashes ?? []);

  return documents.filter((document) => {
    if (rxnormRxcui && document.rxnormRxcui === rxnormRxcui) return true;
    if ((document.ingredients ?? []).some((ingredient) => ingredients.has(normalizeComparable(ingredient)))) return true;
    if ((document.classLabels ?? []).some((label) => classLabels.has(normalizeComparable(label)))) return true;

    const documentHash = document.contentHash ?? createEvidenceContentHash(document.content);
    return contentHashes.has(documentHash);
  });
}

export function assertEvidenceRequiredForHighRiskOutput(input: HighRiskEvidenceCheckInput): void {
  const requiresEvidence = input.riskLevel === 'high' || input.recommendationKind === 'clinician_review';
  if (requiresEvidence && (!input.evidenceRefs || input.evidenceRefs.length === 0)) {
    throw new Error('Evidence references are required for high-risk medication-adjacent output');
  }
}

function scoreDocument(document: MedicationEvidenceDocument, queryTerms: string[]): number {
  const haystack = tokenize([
    document.title,
    document.content,
    document.rxnormRxcui,
    ...(document.ingredients ?? []),
    ...(document.classLabels ?? []),
  ].filter(Boolean).join(' '));

  const haystackCounts = new Map<string, number>();
  for (const term of haystack) {
    haystackCounts.set(term, (haystackCounts.get(term) ?? 0) + 1);
  }

  return queryTerms.reduce((score, term) => score + Math.min(haystackCounts.get(term) ?? 0, 3), 0);
}

function tokenize(value: string): string[] {
  return normalizeComparable(value).split(' ').filter((term) => term.length > 1);
}

function normalizeComparable(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function normalizeHashContent(content: string): string {
  return content.replace(/\s+/g, ' ').trim();
}
