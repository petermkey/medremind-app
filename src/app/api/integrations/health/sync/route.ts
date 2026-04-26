import { NextRequest, NextResponse } from 'next/server';

import { mapOuraDailyPayloadToHealthSnapshot } from '@/lib/health/ouraDailyMapper';
import { upsertExternalHealthDailySnapshots } from '@/lib/health/persistence';
import {
  ensureOuraHealthConnection,
  getEnabledHealthConnections,
  markHealthConnectionSyncError,
  markHealthConnectionSyncSuccess,
} from '@/lib/health/sourceRegistry';
import { fetchOuraJson, refreshOuraAccessToken } from '@/lib/oura/client';
import { getOuraServerConfig } from '@/lib/oura/config';
import {
  getStoredOuraTokens,
  markOuraSyncSuccess,
  updateStoredOuraTokens,
} from '@/lib/oura/tokenStore';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type OuraCollectionResponse = {
  data?: unknown[];
};

type OuraDailyCollections = {
  dailySleep: Map<string, Record<string, unknown>>;
  dailyReadiness: Map<string, Record<string, unknown>>;
  dailyActivity: Map<string, Record<string, unknown>>;
  dailySpO2: Map<string, Record<string, unknown>>;
  dailyStress: Map<string, Record<string, unknown>>;
  heartHealth: Map<string, Record<string, unknown>>;
  workouts: Map<string, unknown[]>;
};

function toDateInput(value: string | null): string | null {
  if (!value) return null;
  return DATE_RE.test(value) ? value : null;
}

function defaultStartDate() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - 14);
  return date.toISOString().slice(0, 10);
}

function defaultEndDate() {
  return new Date().toISOString().slice(0, 10);
}

function tokenExpiresSoon(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  return Date.parse(expiresAt) - Date.now() < 60_000;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function getLocalDate(value: unknown): string | null {
  const record = asRecord(value);
  if (!record) return null;

  for (const key of ['day', 'date', 'local_date']) {
    const candidate = record[key];
    if (typeof candidate === 'string' && DATE_RE.test(candidate)) {
      return candidate;
    }
  }

  return null;
}

function groupDailyData(response: OuraCollectionResponse): Map<string, Record<string, unknown>> {
  const grouped = new Map<string, Record<string, unknown>>();

  for (const item of response.data ?? []) {
    const localDate = getLocalDate(item);
    const record = asRecord(item);
    if (localDate && record) {
      grouped.set(localDate, record);
    }
  }

  return grouped;
}

function groupWorkoutData(response: OuraCollectionResponse): Map<string, unknown[]> {
  const grouped = new Map<string, unknown[]>();

  for (const item of response.data ?? []) {
    const localDate = getLocalDate(item);
    if (!localDate) continue;

    const existing = grouped.get(localDate) ?? [];
    existing.push(item);
    grouped.set(localDate, existing);
  }

  return grouped;
}

function getSnapshotDates(collections: OuraDailyCollections): string[] {
  const dates = new Set<string>();

  for (const collection of Object.values(collections)) {
    for (const date of collection.keys()) {
      dates.add(date);
    }
  }

  return Array.from(dates).sort();
}

async function getValidOuraTokens(userId: string) {
  const config = getOuraServerConfig();
  let tokens = await getStoredOuraTokens(userId, config.tokenEncryptionKey);

  if (!tokens) {
    return null;
  }

  if (tokenExpiresSoon(tokens.expiresAt)) {
    if (!tokens.refreshToken) {
      throw new Error('Oura refresh token is unavailable.');
    }

    const refreshed = await refreshOuraAccessToken({
      tokenUrl: config.tokenUrl,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      refreshToken: tokens.refreshToken,
    });

    await updateStoredOuraTokens({
      rowId: tokens.rowId,
      tokenSet: refreshed,
      existingScopes: tokens.scopes,
      encryptionKey: config.tokenEncryptionKey,
    });

    tokens = await getStoredOuraTokens(userId, config.tokenEncryptionKey);
    if (!tokens) {
      throw new Error('Oura token refresh failed.');
    }
  }

  return { config, tokens };
}

async function fetchOuraDailyCollections(
  apiBaseUrl: string,
  accessToken: string,
  range: { start_date: string; end_date: string },
): Promise<OuraDailyCollections> {
  const [dailySleep, readiness, activity, spo2, stress, heartHealth, workouts] = await Promise.all([
    fetchOuraJson<OuraCollectionResponse>(apiBaseUrl, accessToken, '/v2/usercollection/daily_sleep', range),
    fetchOuraJson<OuraCollectionResponse>(apiBaseUrl, accessToken, '/v2/usercollection/daily_readiness', range),
    fetchOuraJson<OuraCollectionResponse>(apiBaseUrl, accessToken, '/v2/usercollection/daily_activity', range),
    fetchOuraJson<OuraCollectionResponse>(apiBaseUrl, accessToken, '/v2/usercollection/daily_spo2', range),
    fetchOuraJson<OuraCollectionResponse>(apiBaseUrl, accessToken, '/v2/usercollection/daily_stress', range),
    fetchOuraJson<OuraCollectionResponse>(apiBaseUrl, accessToken, '/v2/usercollection/heart_health', range),
    fetchOuraJson<OuraCollectionResponse>(apiBaseUrl, accessToken, '/v2/usercollection/workout', range),
  ]);

  return {
    dailySleep: groupDailyData(dailySleep),
    dailyReadiness: groupDailyData(readiness),
    dailyActivity: groupDailyData(activity),
    dailySpO2: groupDailyData(spo2),
    dailyStress: groupDailyData(stress),
    heartHealth: groupDailyData(heartHealth),
    workouts: groupWorkoutData(workouts),
  };
}

async function syncOuraSnapshots(
  userId: string,
  range: { start_date: string; end_date: string },
): Promise<number> {
  const auth = await getValidOuraTokens(userId);
  if (!auth) return 0;

  const collections = await fetchOuraDailyCollections(
    auth.config.apiBaseUrl,
    auth.tokens.accessToken,
    range,
  );

  const snapshots = getSnapshotDates(collections).map((localDate) =>
    mapOuraDailyPayloadToHealthSnapshot({
      userId,
      localDate,
      dailySleep: collections.dailySleep.get(localDate),
      dailyReadiness: collections.dailyReadiness.get(localDate),
      dailyActivity: collections.dailyActivity.get(localDate),
      dailyStress: collections.dailyStress.get(localDate),
      dailySpO2: collections.dailySpO2.get(localDate),
      heartHealth: collections.heartHealth.get(localDate),
      workouts: collections.workouts.get(localDate),
    }),
  );

  const count = await upsertExternalHealthDailySnapshots(snapshots);
  await markOuraSyncSuccess(userId);
  await markHealthConnectionSyncSuccess(userId, 'oura');

  return count;
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startDate = toDateInput(request.nextUrl.searchParams.get('start_date')) ?? defaultStartDate();
  const endDate = toDateInput(request.nextUrl.searchParams.get('end_date')) ?? defaultEndDate();

  if (startDate > endDate) {
    return NextResponse.json({ error: 'start_date must be before or equal to end_date.' }, { status: 400 });
  }

  const userId = data.user.id;
  const range = { start_date: startDate, end_date: endDate };

  try {
    await ensureOuraHealthConnection(userId);
    const connections = await getEnabledHealthConnections(userId);
    const counts: Record<string, number> = {};

    for (const connection of connections) {
      if (connection.source === 'oura') {
        counts.oura = await syncOuraSnapshots(userId, range);
      }
    }

    return NextResponse.json({ counts });
  } catch (err) {
    console.error('[health/sync] sync failed', err);

    try {
      await markHealthConnectionSyncError(
        userId,
        'oura',
        err instanceof Error ? err.message : 'Health sync failed.',
      );
    } catch (markErr) {
      console.error('[health/sync] failed to mark sync error', markErr);
    }

    return NextResponse.json({ error: 'Health sync failed.' }, { status: 502 });
  }
}
