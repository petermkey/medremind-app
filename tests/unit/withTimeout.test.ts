import assert from 'node:assert/strict';
import { test } from 'node:test';
import { withTimeout, TimeoutError } from '../../src/lib/supabase/withTimeout';

test('withTimeout resolves with the value when the promise settles first', async () => {
  const result = await withTimeout(Promise.resolve('ok'), 50);
  assert.equal(result, 'ok');
});

test('withTimeout rejects with TimeoutError when the promise takes too long', async () => {
  const neverResolves = new Promise<string>(() => {});
  await assert.rejects(() => withTimeout(neverResolves, 20), TimeoutError);
});

test('withTimeout propagates a rejection from the underlying promise', async () => {
  const failing = Promise.reject(new Error('boom'));
  await assert.rejects(() => withTimeout(failing, 50), /boom/);
});
