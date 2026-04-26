import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export type OuraAuthorizationUrlInput = {
  authorizationUrl: string;
  clientId: string;
  redirectUri: string;
  scopes: string[];
  state: string;
};

export type OuraOAuthStateInput = {
  userId: string;
  now?: Date;
};

export type OuraOAuthStateValidationInput = {
  state: string | null | undefined;
  expectedState: string | null | undefined;
  userId: string;
  now?: Date;
  ttlMs?: number;
};

const OURA_OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

function toBase64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function fromBase64UrlJson(value: string): unknown {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
}

function timingSafeStringEqual(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  return aBuffer.length === bBuffer.length && timingSafeEqual(aBuffer, bBuffer);
}

function createUserBinding(userId: string, issuedAt: string, nonce: string): string {
  return createHash('sha256').update(`${userId}:${issuedAt}:${nonce}`).digest('base64url');
}

export function parseOuraScopes(scopeString: string): string[] {
  return scopeString.split(/\s+/).map((scope) => scope.trim()).filter(Boolean);
}

export function buildOuraAuthorizationUrl(input: OuraAuthorizationUrlInput): URL {
  const url = new URL(input.authorizationUrl);
  url.searchParams.set('client_id', input.clientId);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', input.scopes.join(' '));
  url.searchParams.set('state', input.state);
  return url;
}

export function createOuraOAuthState(input: OuraOAuthStateInput): string {
  const nonce = randomBytes(32).toString('base64url');
  const issuedAt = (input.now ?? new Date()).toISOString();
  return toBase64UrlJson({
    nonce,
    issuedAt,
    userBinding: createUserBinding(input.userId, issuedAt, nonce),
  });
}

export function validateOuraOAuthState(input: OuraOAuthStateValidationInput): boolean {
  if (!input.state || !input.expectedState || !timingSafeStringEqual(input.state, input.expectedState)) {
    return false;
  }

  try {
    const parsed = fromBase64UrlJson(input.state);
    if (!parsed || typeof parsed !== 'object') {
      return false;
    }

    const payload = parsed as {
      nonce?: unknown;
      issuedAt?: unknown;
      userBinding?: unknown;
    };

    if (
      typeof payload.nonce !== 'string' ||
      payload.nonce.length < 32 ||
      typeof payload.issuedAt !== 'string' ||
      typeof payload.userBinding !== 'string'
    ) {
      return false;
    }

    const issuedAtMs = Date.parse(payload.issuedAt);
    const nowMs = (input.now ?? new Date()).getTime();
    if (!Number.isFinite(issuedAtMs) || issuedAtMs > nowMs) {
      return false;
    }

    if (nowMs - issuedAtMs > (input.ttlMs ?? OURA_OAUTH_STATE_TTL_MS)) {
      return false;
    }

    return timingSafeStringEqual(
      payload.userBinding,
      createUserBinding(input.userId, payload.issuedAt, payload.nonce),
    );
  } catch {
    return false;
  }
}
