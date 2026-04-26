import assert from 'node:assert/strict';
import test from 'node:test';

import { lookupRxNormApproximate, normalizeMedicationFromLocalRules } from './normalizer.ts';

test('recognizes semaglutide locally as GLP-1 before network lookup', async () => {
  const normalization = await normalizeMedicationFromLocalRules({
    medicationMapItemId: 'map-1',
    displayName: 'Ozempic semaglutide pen',
  });

  assert.equal(normalization.medicationMapItemId, 'map-1');
  assert.equal(normalization.normalizedName, 'semaglutide');
  assert.deepEqual(normalization.ingredients, ['semaglutide']);
  assert.equal(normalization.classLabels.includes('GLP-1 receptor agonist'), true);
  assert.equal(normalization.source, 'local_alias');
  assert.equal(normalization.confidence >= 0.9, true);
});

test('returns low-confidence manual candidate for unknown medication', async () => {
  const normalization = await normalizeMedicationFromLocalRules({
    medicationMapItemId: 'map-unknown',
    displayName: 'unmapped supplement blend',
  });

  assert.equal(normalization.medicationMapItemId, 'map-unknown');
  assert.deepEqual(normalization.ingredients, []);
  assert.deepEqual(normalization.classLabels, []);
  assert.equal(normalization.source, 'manual');
  assert.equal(normalization.confidence < 0.5, true);
  assert.match(normalization.ambiguityNotes, /manual review/i);
});

test('lookupRxNormApproximate throws on non-ok response', async () => {
  const fetchImpl = async () => new Response('rate limited', { status: 429 });

  await assert.rejects(
    () => lookupRxNormApproximate('semaglutide', { fetchImpl }),
    /RxNorm approximate lookup failed/,
  );
});
