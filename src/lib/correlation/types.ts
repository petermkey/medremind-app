export type RecommendationKind = 'lifestyle_adjustment' | 'tracking_prompt' | 'clinician_review';
export type CorrelationStrength = 'weak' | 'moderate' | 'strong';
export type CorrelationDirection = 'positive' | 'negative';

export type CorrelationConsent = {
  enabled: boolean;
  includesMedicationPatterns: boolean;
  includesHealthData: boolean;
  acknowledgedNoMedChanges: boolean;
};

export type DailyLifestyleSnapshot = {
  userId: string;
  localDate: string;
  caloriesKcal?: number | null;
  proteinG?: number | null;
  fiberG?: number | null;
  waterMl?: number | null;
  takenCount?: number | null;
  skippedCount?: number | null;
  missedCount?: number | null;
  adherencePct?: number | null;
  sleepScore?: number | null;
  readinessScore?: number | null;
  activityScore?: number | null;
  stressHighSeconds?: number | null;
  recoveryHighSeconds?: number | null;
  steps?: number | null;
  averageSpo2?: number | null;
  hasGlp1Active?: boolean;
  daysSinceGlp1Start?: number | null;
  glp1DoseEscalationPhase?: boolean;
  hasTestosteroneActive?: boolean;
  testosteroneInjectionDayOffset?: number | null;
  hasBetaBlockerActive?: boolean;
  hasThyroidMedActive?: boolean;
  hasSsriActive?: boolean;
  withFoodMismatchCount?: number | null;
  lateMedicationCount?: number | null;
  missedMedicationCount?: number | null;
  medicationClassExposureScore?: number | null;
  medicationReviewSignalCount?: number | null;
  sourcePayload?: Record<string, number>;
};

export type CorrelationInsightCard = {
  userId: string;
  windowDays: 30 | 60 | 90;
  feature: string;
  outcome: string;
  r: number;
  n: number;
  strength: CorrelationStrength;
  direction: CorrelationDirection;
  recommendationKind: RecommendationKind;
  title: string;
  body: string;
  evidence: SanitizedCorrelationEvidence;
  generatedAt: string;
};

export type SanitizedCorrelationEvidence = {
  dateRange: { start: string; end: string };
  pairedDays: number;
  featureSummary: { label: string; average: number | null };
  outcomeSummary: { label: string; average: number | null };
};

export type CorrelationResult = {
  feature: string;
  outcome: string;
  r: number;
  n: number;
};
