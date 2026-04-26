import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  MEDICATION_AI_RUN_VALIDATION_STATUSES,
  MEDICATION_JOB_STATUSES,
  MEDICATION_MAP_ITEM_STATUSES,
  MEDICATION_RULE_RECOMMENDATION_KINDS,
} from './types.ts';

test('exports medication knowledge status domains', () => {
  assert.deepEqual(MEDICATION_MAP_ITEM_STATUSES, ['active', 'paused', 'completed', 'abandoned', 'unknown']);
  assert.ok(MEDICATION_RULE_RECOMMENDATION_KINDS.includes('clinician_review'));
  assert.ok(MEDICATION_AI_RUN_VALIDATION_STATUSES.includes('error'));
  assert.ok(MEDICATION_JOB_STATUSES.includes('cancelled'));
});

test('migration 009 contains the medication knowledge entity set', () => {
  const sql = readFileSync(new URL('../../../supabase/009_medication_knowledge.sql', import.meta.url), 'utf8');
  for (const tableName of [
    'medication_map_items',
    'medication_normalizations',
    'medication_rule_evaluations',
    'medication_evidence_documents',
    'medication_ai_runs',
    'medication_processing_jobs',
    'daily_medication_exposures',
  ]) {
    assert.match(sql, new RegExp(`create table if not exists ${tableName}`));
  }
  assert.doesNotMatch(sql, /vector\(/i);
});
