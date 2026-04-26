import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const VERSION = 'v1';

function toBase64Url(buffer: Buffer): string {
  return buffer.toString('base64url');
}

function fromBase64Url(value: string): Buffer {
  return Buffer.from(value, 'base64url');
}

function parseEncryptionKey(rawKey: string): Buffer {
  if (!rawKey) {
    throw new Error('OURA_TOKEN_ENCRYPTION_KEY is required');
  }

  if (rawKey.length === 32) {
    return Buffer.from(rawKey, 'utf8');
  }

  const decoded = Buffer.from(rawKey, 'base64');
  if (decoded.length === 32) {
    return decoded;
  }

  throw new Error('OURA_TOKEN_ENCRYPTION_KEY must be 32 UTF-8 bytes or base64-encoded 32 bytes');
}

export function encryptOuraToken(token: string, rawKey: string): string {
  const key = parseEncryptionKey(rawKey);
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [VERSION, toBase64Url(iv), toBase64Url(tag), toBase64Url(ciphertext)].join(':');
}

export function decryptOuraToken(encryptedToken: string, rawKey: string): string {
  try {
    const [version, encodedIv, encodedTag, encodedCiphertext] = encryptedToken.split(':');
    if (version !== VERSION || !encodedIv || !encodedTag || !encodedCiphertext) {
      throw new Error('Invalid token format');
    }

    const key = parseEncryptionKey(rawKey);
    const decipher = createDecipheriv(ALGORITHM, key, fromBase64Url(encodedIv));
    decipher.setAuthTag(fromBase64Url(encodedTag));

    return Buffer.concat([
      decipher.update(fromBase64Url(encodedCiphertext)),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new Error('Unable to decrypt Oura token');
  }
}
