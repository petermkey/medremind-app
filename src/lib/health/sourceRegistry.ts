import { getOuraIntegrationStatus } from '@/lib/oura/tokenStore';

import { createHealthServiceClient } from './persistence';
import type { ExternalHealthSource } from './types';

export type ExternalHealthConnection = {
  source: ExternalHealthSource;
  scopes: string[];
};

type ExternalHealthConnectionRow = {
  source: ExternalHealthSource;
  scopes: string[] | null;
};

export async function ensureOuraHealthConnection(userId: string): Promise<boolean> {
  const status = await getOuraIntegrationStatus(userId);
  if (!status.connected) return false;

  const supabase = createHealthServiceClient();
  const { error } = await supabase
    .from('external_health_connections')
    .upsert(
      {
        user_id: userId,
        source: 'oura',
        status: 'connected',
        scopes: status.scopes,
        last_error: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,source' },
    );

  if (error) {
    throw error;
  }

  return true;
}

export async function getEnabledHealthConnections(
  userId: string,
): Promise<ExternalHealthConnection[]> {
  const supabase = createHealthServiceClient();
  const { data, error } = await supabase
    .from('external_health_connections')
    .select('source, scopes')
    .eq('user_id', userId)
    .eq('status', 'connected');

  if (error) {
    throw error;
  }

  return ((data ?? []) as ExternalHealthConnectionRow[]).map((row) => ({
    source: row.source,
    scopes: row.scopes ?? [],
  }));
}

export async function markHealthConnectionSyncSuccess(
  userId: string,
  source: ExternalHealthSource,
) {
  const supabase = createHealthServiceClient();
  const { error } = await supabase
    .from('external_health_connections')
    .update({
      last_sync_at: new Date().toISOString(),
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId)
    .eq('source', source);

  if (error) {
    throw error;
  }
}

export async function markHealthConnectionSyncError(
  userId: string,
  source: ExternalHealthSource,
  message: string,
) {
  const supabase = createHealthServiceClient();
  const { error } = await supabase
    .from('external_health_connections')
    .update({
      status: 'error',
      last_error: message,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId)
    .eq('source', source);

  if (error) {
    throw error;
  }
}
