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
      status: 'connected',
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

export async function updateOuraDeviceStatus(
  userId: string,
  patch: {
    sleepWindow?: Record<string, unknown> | null;
    sleepWindowDate?: string | null;
    batteryLevel?: number | null;
    batteryCharging?: boolean | null;
    batteryAt?: string | null;
  },
) {
  const supabase = createHealthServiceClient();
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if ('sleepWindow' in patch) row.sleep_window = patch.sleepWindow;
  if ('sleepWindowDate' in patch) row.sleep_window_date = patch.sleepWindowDate;
  if ('batteryLevel' in patch) row.battery_level = patch.batteryLevel;
  if ('batteryCharging' in patch) row.battery_charging = patch.batteryCharging;
  if ('batteryAt' in patch) row.battery_at = patch.batteryAt;

  const { error } = await supabase
    .from('external_health_connections')
    .update(row)
    .eq('user_id', userId)
    .eq('source', 'oura');

  if (error) {
    throw error;
  }
}

export async function listConnectedOuraUserIds(): Promise<Array<{ userId: string; lastSyncAt: string | null }>> {
  const supabase = createHealthServiceClient();
  const { data, error } = await supabase
    .from('external_health_connections')
    .select('user_id, last_sync_at, status')
    .eq('source', 'oura')
    .in('status', ['connected', 'error']); // include 'error' so transient failures self-heal

  if (error) throw error;

  return ((data ?? []) as Array<{ user_id: string; last_sync_at: string | null }>).map((row) => ({
    userId: row.user_id,
    lastSyncAt: row.last_sync_at,
  }));
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
