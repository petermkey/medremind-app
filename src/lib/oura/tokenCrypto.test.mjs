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

test('encryptOuraToken accepts exactly 32 UTF-8 bytes or base64-decoded bytes', () => {
  const utf8Key = 'é'.repeat(16);
  const base64Key = Buffer.from('0123456789abcdef0123456789abcdef', 'utf8').toString('base64');

  const utf8Encrypted = encryptOuraToken('secret-token', utf8Key);
  const base64Encrypted = encryptOuraToken('secret-token', base64Key);

  assert.equal(decryptOuraToken(utf8Encrypted, utf8Key), 'secret-token');
  assert.equal(decryptOuraToken(base64Encrypted, base64Key), 'secret-token');
});

test('encryptOuraToken rejects invalid encryption key lengths', () => {
  assert.throws(
    () => encryptOuraToken('secret-token', 'short-key'),
    /OURA_TOKEN_ENCRYPTION_KEY must be 32 UTF-8 bytes or base64-encoded 32 bytes/,
  );
  assert.throws(
    () => encryptOuraToken('secret-token', 'é'.repeat(15)),
    /OURA_TOKEN_ENCRYPTION_KEY must be 32 UTF-8 bytes or base64-encoded 32 bytes/,
  );
});
