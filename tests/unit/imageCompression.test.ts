import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeTargetDimensions, MAX_UPLOAD_BYTES } from '../../src/lib/food/imageCompression';

test('downscales the long edge to 1280 keeping aspect ratio', () => {
  assert.deepEqual(computeTargetDimensions(4032, 3024), { width: 1280, height: 960, scaled: true });
  assert.deepEqual(computeTargetDimensions(3024, 4032), { width: 960, height: 1280, scaled: true });
});

test('keeps small images unscaled', () => {
  assert.deepEqual(computeTargetDimensions(800, 600), { width: 800, height: 600, scaled: false });
});

test('exports an upload cap below the Vercel 4.5 MB request body limit', () => {
  assert.ok(MAX_UPLOAD_BYTES <= 3.5 * 1024 * 1024);
});
