import { supportedOuraScopes } from './oauth';
import { assertValidOuraTokenEncryptionKey } from './tokenCrypto';

const DEFAULT_AUTHORIZATION_URL = 'https://cloud.ouraring.com/oauth/authorize';
const DEFAULT_TOKEN_URL = 'https://api.ouraring.com/oauth/token';
const DEFAULT_API_BASE_URL = 'https://api.ouraring.com';
const DEFAULT_SCOPES = 'email personal daily heartrate tag workout session spo2';

export type OuraServerConfig = {
  authorizationUrl: string;
  tokenUrl: string;
  apiBaseUrl: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string[];
  tokenEncryptionKey: string;
};

function requireEnv(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (!value) {
    throw new Error(`${key} is required`);
  }
  return value;
}

export function getOuraServerConfig(env: NodeJS.ProcessEnv = process.env): OuraServerConfig {
  const tokenEncryptionKey = requireEnv(env, 'OURA_TOKEN_ENCRYPTION_KEY');
  assertValidOuraTokenEncryptionKey(tokenEncryptionKey);

  return {
    authorizationUrl: env.OURA_AUTHORIZATION_URL ?? DEFAULT_AUTHORIZATION_URL,
    tokenUrl: env.OURA_TOKEN_URL ?? DEFAULT_TOKEN_URL,
    apiBaseUrl: env.OURA_API_BASE_URL ?? DEFAULT_API_BASE_URL,
    clientId: requireEnv(env, 'OURA_CLIENT_ID'),
    clientSecret: requireEnv(env, 'OURA_CLIENT_SECRET'),
    redirectUri: requireEnv(env, 'OURA_REDIRECT_URI'),
    scopes: supportedOuraScopes(env.OURA_SCOPES ?? DEFAULT_SCOPES),
    tokenEncryptionKey,
  };
}

export function getOuraPersonalAccessToken(env: NodeJS.ProcessEnv = process.env): string | null {
  return env.OURA_PERSONAL_ACCESS_TOKEN ?? null;
}
