import assert from 'node:assert/strict';
import test from 'node:test';

import { decryptOuraToken, encryptOuraToken } from './tokenCrypto.ts';

test('encryptOuraToken encrypts and decrypts a token round trip', () => {
  const key = '0123456789abcdef0123456789abcdef';
  const encrypted = encryptOuraToken('secret-token', key);

  assert.match(encrypted, /^v1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/);
  assert.notEqual(encrypted, 'secret-token');
  assert.equal(decryptOuraToken(encrypted, key), 'secret-token');
});

test('decryptOuraToken rejects ciphertext encrypted with another key', () => {
  const encrypted = encryptOuraToken('secret-token', '0123456789abcdef0123456789abcdef');

  assert.throws(
    () => decryptOuraToken(encrypted, 'abcdef0123456789abcdef0123456789'),
    /Unable to decrypt Oura token/,
  );
});
