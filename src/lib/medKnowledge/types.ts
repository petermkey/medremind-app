import type { DoseForm, FrequencyType, RouteOfAdmin } from '../../types';

export const MEDICATION_MAP_ITEM_STATUSES = ['active', 'paused', 'completed', 'abandoned', 'unknown'] as const;
export type MedicationMapItemStatus = typeof MEDICATION_MAP_ITEM_STATUSES[number];

export const MEDICATION_NORMALIZATION_SOURCES = ['seed', 'local_alias', 'rxnorm', 'openrouter', 'manual'] as const;
export type MedicationNormalizationSource = typeof MEDICATION_NORMALIZATION_SOURCES[number];

export const MEDICATION_RULE_RECOMMENDATION_KINDS = [
  'lifestyle_adjustment',
  'tracking_prompt',
  'clinician_review',
] as const;
export type MedicationRuleRecommendationKind = typeof MEDICATION_RULE_RECOMMENDATION_KINDS[number];

export const MEDICATION_RISK_LEVELS = ['low', 'medium', 'high'] as const;
export type MedicationRiskLevel = typeof MEDICATION_RISK_LEVELS[number];

export const MEDICATION_EVIDENCE_SOURCES = [
  'rxnorm',
  'rxclass',
  'dailymed',
  'openfda',
  'curated_rule',
  'clinical_advisory',
] as const;
export type MedicationEvidenceSource = typeof MEDICATION_EVIDENCE_SOURCES[number];

export const MEDICATION_EVIDENCE_RETRIEVAL_STRATEGIES = ['lexical', 'model_rerank', 'vector'] as const;
export type MedicationEvidenceRetrievalStrategy = typeof MEDICATION_EVIDENCE_RETRIEVAL_STRATEGIES[number];

export const MEDICATION_EVIDENCE_REVIEW_STATUSES = ['unreviewed', 'curated', 'rejected'] as const;
export type MedicationEvidenceReviewStatus = typeof MEDICATION_EVIDENCE_REVIEW_STATUSES[number];

export const MEDICATION_AI_RUN_VALIDATION_STATUSES = ['accepted', 'rejected', 'error'] as const;
export type MedicationAiRunValidationStatus = typeof MEDICATION_AI_RUN_VALIDATION_STATUSES[number];

export const MEDICATION_JOB_TYPES = [
  'medication_map_refresh',
  'medication_normalization',
  'evidence_refresh',
  'daily_feature_build',
  'insight_generation',
] as const;
export type MedicationJobType = typeof MEDICATION_JOB_TYPES[number];

export const MEDICATION_JOB_STATUSES = ['queued', 'running', 'completed', 'failed', 'cancelled'] as const;
export type MedicationJobStatus = typeof MEDICATION_JOB_STATUSES[number];

export type MedicationMapItem = {
  id?: string;
  userId: string;
  activeProtocolId: string;
  protocolItemId: string;
  drugId?: string | null;
  displayName: string;
  genericName?: string | null;
  doseAmount?: number | null;
  doseUnit?: string | null;
  doseForm?: DoseForm | string | null;
  route?: RouteOfAdmin | string | null;
  frequencyType: FrequencyType | string;
  times: string[];
  withFood?: 'yes' | 'no' | 'any' | string | null;
  startDate: string;
  endDate?: string | null;
  status: MedicationMapItemStatus;
  sourceHash: string;
};

export type MedicationNormalization = {
  userId?: string;
  medicationMapItemId: string;
  rxnormRxcui?: string | null;
  normalizedName?: string | null;
  ingredients: string[];
  classCodes?: string[];
  classLabels: string[];
  source?: MedicationNormalizationSource;
  confidence?: number | null;
  ambiguityNotes?: string | null;
};

export type MedicationRuleEvaluation = {
  userId?: string;
  medicationMapItemId: string;
  ruleId?: string;
  domain?: string;
  recommendationKind: MedicationRuleRecommendationKind;
  riskLevel?: MedicationRiskLevel;
  title?: string;
  body?: string;
  evidenceRefs?: unknown[];
};

export type DailyMedicationExposure = {
  userId: string;
  localDate: string;
  hasGlp1Active: boolean;
  daysSinceGlp1Start: number | null;
  glp1DoseEscalationPhase: boolean;
  hasTestosteroneActive: boolean;
  testosteroneInjectionDayOffset: number | null;
  hasBetaBlockerActive: boolean;
  hasThyroidMedActive: boolean;
  hasSsriActive: boolean;
  withFoodMismatchCount: number;
  lateMedicationCount: number;
  missedMedicationCount: number;
  medicationClassExposureScore: number;
  medicationReviewSignalCount: number;
  sourcePayload: Record<string, unknown>;
};
