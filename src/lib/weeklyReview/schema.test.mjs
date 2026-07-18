import assert from 'node:assert/strict';
import test from 'node:test';

import { validateWeeklyReviewPayload } from './schema.ts';

const VALID = {
  schemaVersion: 'weekly-review-v1',
  highlights: ['Белок в среднем 92 г/день', 'Адхиренс 86%', 'HRV +6 мс к прошлой неделе'],
  eatingPatterns: [{ title: 'Поздние ужины', detail: '3 дня приём пищи после 21:00.' }],
  stackAdherence: { summary: 'Принято 36 из 42 доз (86%). Слабый день — суббота.' },
  ouraLinkage: ['Средний сон вырос на 4 балла на фоне более коротких пищевых окон.'],
  actions: [
    { title: 'Ужин до 21:00', detail: 'В будни закрывать пищевое окно до 21:00.' },
    { title: 'Вода в выходные', detail: 'Держать не меньше 1.5 л в сб и вс.' },
  ],
};

test('accepts a valid payload and returns it typed', () => {
  const payload = validateWeeklyReviewPayload(VALID);
  assert.equal(payload.schemaVersion, 'weekly-review-v1');
  assert.equal(payload.highlights.length, 3);
  assert.equal(payload.actions.length, 2);
});

test('rejects wrong highlight count', () => {
  assert.throws(
    () => validateWeeklyReviewPayload({ ...VALID, highlights: ['a', 'b'] }),
    /weekly_review_invalid_payload/,
  );
});

test('rejects empty strings, wrong action count, and missing sections', () => {
  assert.throws(() => validateWeeklyReviewPayload({ ...VALID, highlights: ['a', 'b', ''] }), /weekly_review_invalid_payload/);
  assert.throws(() => validateWeeklyReviewPayload({ ...VALID, actions: [VALID.actions[0]] }), /weekly_review_invalid_payload/);
  assert.throws(() => validateWeeklyReviewPayload({ ...VALID, actions: [...VALID.actions, ...VALID.actions] }), /weekly_review_invalid_payload/);
  assert.throws(() => validateWeeklyReviewPayload({ ...VALID, stackAdherence: undefined }), /weekly_review_invalid_payload/);
  assert.throws(() => validateWeeklyReviewPayload({ ...VALID, eatingPatterns: [] }), /weekly_review_invalid_payload/);
  assert.throws(() => validateWeeklyReviewPayload(null), /weekly_review_invalid_payload/);
  assert.throws(() => validateWeeklyReviewPayload({ ...VALID, schemaVersion: 'v2' }), /weekly_review_invalid_payload/);
});

test('ouraLinkage may be empty but not overlong', () => {
  assert.doesNotThrow(() => validateWeeklyReviewPayload({ ...VALID, ouraLinkage: [] }));
  assert.throws(
    () => validateWeeklyReviewPayload({ ...VALID, ouraLinkage: ['a', 'b', 'c', 'd'] }),
    /weekly_review_invalid_payload/,
  );
});
