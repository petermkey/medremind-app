import assert from 'node:assert/strict';
import test from 'node:test';

import { assertSafeMedicationKnowledgeText } from './safety.ts';

test('allows lifestyle language', () => {
  assert.doesNotThrow(() => assertSafeMedicationKnowledgeText('Prioritize protein-forward meals when appetite is low.'));
});

test('blocks direct medication change language', () => {
  assert.throws(
    () => assertSafeMedicationKnowledgeText('Stop testosterone for three days.'),
    /Direct medication-change language is not allowed/,
  );
});
