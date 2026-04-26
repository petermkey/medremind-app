import type { MedicationRiskLevel, MedicationRuleRecommendationKind } from './types';

export type CuratedMedicationRule = {
  id: string;
  domain: string;
  medicationClass: string;
  recommendationKind: MedicationRuleRecommendationKind;
  riskLevel: MedicationRiskLevel;
  title: string;
  body: string;
  evidenceRefs: string[];
};

export const CURATED_MEDICATION_RULES: CuratedMedicationRule[] = [
  {
    id: 'glp1_nutrition_protein_priority',
    domain: 'nutrition',
    medicationClass: 'glp1',
    recommendationKind: 'lifestyle_adjustment',
    riskLevel: 'low',
    title: 'Protein-forward meal priority',
    body: 'Prioritize protein-forward meals when appetite is low, with small portions that are easier to finish.',
    evidenceRefs: ['curated_rule:glp1_nutrition_protein_priority'],
  },
  {
    id: 'glp1_hydration_fiber_gi_tolerance',
    domain: 'nutrition',
    medicationClass: 'glp1',
    recommendationKind: 'tracking_prompt',
    riskLevel: 'low',
    title: 'Hydration, fiber, and GI tolerance tracking',
    body: 'Track hydration, fiber intake, nausea, and fullness patterns so meals can stay comfortable and consistent.',
    evidenceRefs: ['curated_rule:glp1_hydration_fiber_gi_tolerance'],
  },
  {
    id: 'testosterone_recovery_aware_training',
    domain: 'training',
    medicationClass: 'testosterone',
    recommendationKind: 'tracking_prompt',
    riskLevel: 'low',
    title: 'Recovery-aware training check-in',
    body: 'Compare training intensity with sleep, soreness, mood, and resting heart rate before planning harder sessions.',
    evidenceRefs: ['curated_rule:testosterone_recovery_aware_training'],
  },
  {
    id: 'testosterone_cardiovascular_clinician_review',
    domain: 'cardiovascular',
    medicationClass: 'testosterone',
    recommendationKind: 'clinician_review',
    riskLevel: 'medium',
    title: 'Cardiovascular clinician review signal',
    body: 'Discuss blood pressure patterns, chest discomfort, shortness of breath, or unusual swelling with a clinician.',
    evidenceRefs: ['curated_rule:testosterone_cardiovascular_clinician_review'],
  },
  {
    id: 'thyroid_empty_stomach_adherence_monitoring',
    domain: 'adherence',
    medicationClass: 'thyroid',
    recommendationKind: 'tracking_prompt',
    riskLevel: 'low',
    title: 'Empty-stomach adherence monitoring',
    body: 'Track whether thyroid medication was taken apart from meals, supplements, and coffee to spot routine friction.',
    evidenceRefs: ['curated_rule:thyroid_empty_stomach_adherence_monitoring'],
  },
  {
    id: 'ssri_sleep_stress_tracking_prompt',
    domain: 'sleep_stress',
    medicationClass: 'ssri',
    recommendationKind: 'tracking_prompt',
    riskLevel: 'low',
    title: 'Sleep and stress tracking prompt',
    body: 'Track sleep timing, stress, mood, and energy patterns to support a clearer clinician conversation.',
    evidenceRefs: ['curated_rule:ssri_sleep_stress_tracking_prompt'],
  },
  {
    id: 'metformin_gi_tolerance_nutrition_prompt',
    domain: 'nutrition',
    medicationClass: 'metformin',
    recommendationKind: 'tracking_prompt',
    riskLevel: 'low',
    title: 'GI tolerance and nutrition prompt',
    body: 'Track stomach comfort, meal timing, carbohydrate balance, and protein intake to identify nutrition patterns.',
    evidenceRefs: ['curated_rule:metformin_gi_tolerance_nutrition_prompt'],
  },
];
