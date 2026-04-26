export type OuraTokenSet = {
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number | null;
  scope: string | null;
};

export type OuraPersonalInfo = {
  id: string;
  email?: string | null;
  age?: number | null;
  weight?: number | null;
  height?: number | null;
  biological_sex?: string | null;
};

export class OuraApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'OuraApiError';
    this.status = status;
  }
}

function buildBasicAuthHeader(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
}

function parseTokenResponse(value: unknown): OuraTokenSet {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid Oura token response');
  }

  const response = value as {
    access_token?: unknown;
    refresh_token?: unknown;
    expires_in?: unknown;
    scope?: unknown;
  };

  if (typeof response.access_token !== 'string') {
    throw new Error('Oura token response is missing access_token');
  }

  return {
    accessToken: response.access_token,
    refreshToken: typeof response.refresh_token === 'string' ? response.refresh_token : null,
    expiresIn: typeof response.expires_in === 'number' ? response.expires_in : null,
    scope: typeof response.scope === 'string' ? response.scope : null,
  };
}

async function postTokenForm(
  tokenUrl: string,
  clientId: string,
  clientSecret: string,
  body: URLSearchParams,
): Promise<OuraTokenSet> {
  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      Authorization: buildBasicAuthHeader(clientId, clientSecret),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  if (!response.ok) {
    throw new OuraApiError('Oura token exchange failed', response.status);
  }

  return parseTokenResponse(await response.json());
}

export async function exchangeOuraAuthorizationCode(input: {
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
}): Promise<OuraTokenSet> {
  return postTokenForm(
    input.tokenUrl,
    input.clientId,
    input.clientSecret,
    new URLSearchParams({
      grant_type: 'authorization_code',
      code: input.code,
      redirect_uri: input.redirectUri,
    }),
  );
}

export async function refreshOuraAccessToken(input: {
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): Promise<OuraTokenSet> {
  return postTokenForm(
    input.tokenUrl,
    input.clientId,
    input.clientSecret,
    new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: input.refreshToken,
    }),
  );
}

export async function fetchOuraJson<T>(
  apiBaseUrl: string,
  accessToken: string,
  path: string,
  params?: Record<string, string | undefined>,
): Promise<T> {
  const url = new URL(path, apiBaseUrl);
  Object.entries(params ?? {}).forEach(([key, value]) => {
    if (value) url.searchParams.set(key, value);
  });

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new OuraApiError('Oura API request failed', response.status);
  }

  return response.json() as Promise<T>;
}

export function getOuraTokenExpiresAt(expiresIn: number | null, now = new Date()): string | null {
  if (!expiresIn) return null;
  return new Date(now.getTime() + expiresIn * 1000).toISOString();
}
