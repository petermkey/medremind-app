import assert from 'node:assert/strict';
import test from 'node:test';

import { CURATED_MEDICATION_RULES } from './rules.ts';
import { assertSafeMedicationKnowledgeText } from './safety.ts';

test('includes required curated medication knowledge rules', () => {
  const ruleIds = new Set(CURATED_MEDICATION_RULES.map((rule) => rule.id));

  for (const expectedRuleId of [
    'glp1_nutrition_protein_priority',
    'glp1_hydration_fiber_gi_tolerance',
    'testosterone_recovery_aware_training',
    'testosterone_cardiovascular_clinician_review',
    'thyroid_empty_stomach_adherence_monitoring',
    'ssri_sleep_stress_tracking_prompt',
    'metformin_gi_tolerance_nutrition_prompt',
  ]) {
    assert.equal(ruleIds.has(expectedRuleId), true, expectedRuleId);
  }
});

test('keeps all curated user-facing text within medication safety boundary', () => {
  for (const rule of CURATED_MEDICATION_RULES) {
    assert.doesNotThrow(() => assertSafeMedicationKnowledgeText(rule.title), rule.id);
    assert.doesNotThrow(() => assertSafeMedicationKnowledgeText(rule.body), rule.id);
  }
});

test('marks medication-change-adjacent testosterone cardiovascular content as clinician review', () => {
  const rule = CURATED_MEDICATION_RULES.find((candidate) => candidate.id === 'testosterone_cardiovascular_clinician_review');

  assert.equal(rule?.recommendationKind, 'clinician_review');
  assert.equal(rule?.riskLevel, 'medium');
});
