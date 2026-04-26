export type OuraAuthorizationUrlInput = {
  authorizationUrl: string;
  clientId: string;
  redirectUri: string;
  scopes: string[];
  state: string;
};

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
