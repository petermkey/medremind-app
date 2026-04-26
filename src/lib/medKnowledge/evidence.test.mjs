import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertEvidenceRequiredForHighRiskOutput,
  createEvidenceContentHash,
  matchEvidence,
  rankEvidenceLexically,
} from './evidence.ts';

const docs = [
  {
    id: 'doc-hydration',
    source: 'curated_rule',
    title: 'Hydration and fiber for GLP-1 therapy',
    content: 'Hydration, fiber, nausea, and fullness tracking can support tolerability conversations.',
    rxnormRxcui: '1991302',
    ingredients: ['semaglutide'],
    classLabels: ['GLP-1 receptor agonist'],
  },
  {
    id: 'doc-sleep',
    source: 'clinical_advisory',
    title: 'Sleep timing basics',
    content: 'Sleep timing and consistent bedtime routines support recovery tracking.',
    ingredients: [],
    classLabels: [],
  },
];

test('content hash is stable for equivalent evidence text', () => {
  const first = createEvidenceContentHash('Hydration and fiber tracking');
  const second = createEvidenceContentHash('Hydration and fiber tracking');

  assert.equal(first, second);
  assert.match(first, /^[a-f0-9]{64}$/);
});

test('lexical evidence ranking places relevant documents first', () => {
  const ranked = rankEvidenceLexically(docs, 'semaglutide hydration nausea fiber');

  assert.equal(ranked[0].id, 'doc-hydration');
  assert.equal(ranked[0].score > ranked[1].score, true);
});

test('matches evidence by RxCUI, ingredient, class label, and content hash', () => {
  const hash = createEvidenceContentHash(docs[0].content);
  const matched = matchEvidence(docs, {
    rxnormRxcui: '1991302',
    ingredients: ['semaglutide'],
    classLabels: ['GLP-1 receptor agonist'],
    contentHashes: [hash],
  });

  assert.deepEqual(matched.map((doc) => doc.id), ['doc-hydration']);
});

test('high-risk medication-adjacent output without evidence refs fails closed', () => {
  assert.throws(
    () => assertEvidenceRequiredForHighRiskOutput({
      riskLevel: 'high',
      recommendationKind: 'clinician_review',
      evidenceRefs: [],
    }),
    /Evidence references are required/,
  );
});
