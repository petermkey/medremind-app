import { createClient } from '@supabase/supabase-js';

import { fetchOuraJson, getOuraTokenExpiresAt, OuraPersonalInfo, OuraTokenSet } from './client';
import { parseOuraScopes } from './oauth';
import { decryptOuraToken, encryptOuraToken } from './tokenCrypto';

type UserIntegrationRow = {
  id: string;
  user_id: string;
  provider: 'oura';
  provider_user_id: string | null;
  access_token_ciphertext: string;
  refresh_token_ciphertext: string | null;
  expires_at: string | null;
  scopes: string[] | null;
  status: 'connected' | 'expired' | 'revoked' | 'error';
  last_sync_at: string | null;
  created_at: string;
  updated_at: string;
};

export type OuraIntegrationStatus = {
  connected: boolean;
  providerUserId: string | null;
  scopes: string[];
  expiresAt: string | null;
  lastSyncAt: string | null;
  status: string | null;
};

export type StoredOuraTokens = {
  rowId: string;
  providerUserId: string | null;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
  scopes: string[];
};

function getServiceClient() {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Supabase service role environment is required for Oura integration storage');
  }

  return createClient(supabaseUrl, serviceRoleKey);
}

function normalizeScopes(scope: string | null, fallback: string[]): string[] {
  return scope ? parseOuraScopes(scope) : fallback;
}

export async function saveOuraConnection(input: {
  userId: string;
  tokenSet: OuraTokenSet;
  personalInfo: OuraPersonalInfo;
  fallbackScopes: string[];
  encryptionKey: string;
}) {
  const supabase = getServiceClient();
  const now = new Date().toISOString();

  const row = {
    user_id: input.userId,
    provider: 'oura',
    provider_user_id: input.personalInfo.id,
    access_token_ciphertext: encryptOuraToken(input.tokenSet.accessToken, input.encryptionKey),
    refresh_token_ciphertext: input.tokenSet.refreshToken
      ? encryptOuraToken(input.tokenSet.refreshToken, input.encryptionKey)
      : null,
    expires_at: getOuraTokenExpiresAt(input.tokenSet.expiresIn),
    scopes: normalizeScopes(input.tokenSet.scope, input.fallbackScopes),
    status: 'connected',
    updated_at: now,
  };

  const { error } = await supabase
    .from('user_integrations')
    .upsert(row, { onConflict: 'user_id,provider' });

  if (error) {
    throw error;
  }
}

export async function getOuraIntegrationStatus(userId: string): Promise<OuraIntegrationStatus> {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from('user_integrations')
    .select('provider_user_id, expires_at, scopes, status, last_sync_at')
    .eq('user_id', userId)
    .eq('provider', 'oura')
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    return {
      connected: false,
      providerUserId: null,
      scopes: [],
      expiresAt: null,
      lastSyncAt: null,
      status: null,
    };
  }

  return {
    connected: data.status === 'connected',
    providerUserId: data.provider_user_id,
    scopes: data.scopes ?? [],
    expiresAt: data.expires_at,
    lastSyncAt: data.last_sync_at,
    status: data.status,
  };
}

export async function getStoredOuraTokens(
  userId: string,
  encryptionKey: string,
): Promise<StoredOuraTokens | null> {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from('user_integrations')
    .select('id, provider_user_id, access_token_ciphertext, refresh_token_ciphertext, expires_at, scopes')
    .eq('user_id', userId)
    .eq('provider', 'oura')
    .eq('status', 'connected')
    .maybeSingle();

  if (error) {
    throw error;
  }

  const row = data as UserIntegrationRow | null;
  if (!row) return null;

  return {
    rowId: row.id,
    providerUserId: row.provider_user_id,
    accessToken: decryptOuraToken(row.access_token_ciphertext, encryptionKey),
    refreshToken: row.refresh_token_ciphertext
      ? decryptOuraToken(row.refresh_token_ciphertext, encryptionKey)
      : null,
    expiresAt: row.expires_at,
    scopes: row.scopes ?? [],
  };
}

export async function updateStoredOuraTokens(input: {
  rowId: string;
  tokenSet: OuraTokenSet;
  existingScopes: string[];
  encryptionKey: string;
}) {
  const supabase = getServiceClient();
  const updates = {
    access_token_ciphertext: encryptOuraToken(input.tokenSet.accessToken, input.encryptionKey),
    refresh_token_ciphertext: input.tokenSet.refreshToken
      ? encryptOuraToken(input.tokenSet.refreshToken, input.encryptionKey)
      : undefined,
    expires_at: getOuraTokenExpiresAt(input.tokenSet.expiresIn),
    scopes: normalizeScopes(input.tokenSet.scope, input.existingScopes),
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from('user_integrations')
    .update(updates)
    .eq('id', input.rowId);

  if (error) {
    throw error;
  }
}

export async function markOuraSyncSuccess(userId: string) {
  const supabase = getServiceClient();
  await supabase
    .from('user_integrations')
    .update({ last_sync_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('provider', 'oura');
}

export async function fetchOuraPersonalInfo(apiBaseUrl: string, accessToken: string) {
  return fetchOuraJson<OuraPersonalInfo>(apiBaseUrl, accessToken, '/v2/usercollection/personal_info');
}
