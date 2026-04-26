import assert from 'node:assert/strict';
import test from 'node:test';

import { assertSafeCorrelationInsightText } from './medicationSafety.ts';

test('assertSafeCorrelationInsightText rejects unsafe direct medication-change language', () => {
  assert.throws(
    () => assertSafeCorrelationInsightText('Stop or reduce the dose when sleep is poor.'),
    /Direct medication-change language is not allowed/,
  );
});

test('assertSafeCorrelationInsightText allows clinician-review medication language', () => {
  assert.doesNotThrow(() => {
    assertSafeCorrelationInsightText('Discuss this medication pattern with your clinician before making any changes.');
  });
});
