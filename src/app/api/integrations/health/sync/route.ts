import { NextRequest, NextResponse } from 'next/server';

import { mapOuraDailyPayloadToHealthSnapshot } from '@/lib/health/ouraDailyMapper';
import { upsertExternalHealthDailySnapshots } from '@/lib/health/persistence';
import {
  ensureOuraHealthConnection,
  getEnabledHealthConnections,
  markHealthConnectionSyncError,
  markHealthConnectionSyncSuccess,
} from '@/lib/health/sourceRegistry';
import {
  finishOuraSyncRun,
  type JsonObject,
  pruneOuraRawDocuments,
  recordOuraEndpointCoverage,
  startOuraSyncRun,
  upsertDailyHealthFeature,
  upsertOuraRawDocument,
} from '@/lib/oura/analyticsStore';
import {
  buildOuraAnalyticsSyncPayloads,
  type OuraAnalyticsCollection,
} from '@/lib/oura/analyticsSync';
import { fetchOuraJson, OuraApiError, refreshOuraAccessToken } from '@/lib/oura/client';
import { getOuraServerConfig } from '@/lib/oura/config';
import {
  getStoredOuraTokens,
  markOuraSyncSuccess,
  updateStoredOuraTokens,
} from '@/lib/oura/tokenStore';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const OURA_MAX_PAGES_PER_COLLECTION = 25;

type OuraCollectionResponse = {
  data?: unknown[];
  next_token?: unknown;
  nextToken?: unknown;
  continuation_token?: unknown;
  continuationToken?: unknown;
};

type OuraDailyCollections = {
  dailySleep: Map<string, Record<string, unknown>>;
  dailyReadiness: Map<string, Record<string, unknown>>;
  dailyActivity: Map<string, Record<string, unknown>>;
  dailySpO2: Map<string, Record<string, unknown>>;
  dailyStress: Map<string, Record<string, unknown>>;
  heartHealth: Map<string, Record<string, unknown>>;
  workouts: Map<string, unknown[]>;
  analyticsCollections: Record<string, OuraAnalyticsCollection>;
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

function getContinuationToken(response: OuraCollectionResponse): string | null {
  for (const key of ['next_token', 'nextToken', 'continuation_token', 'continuationToken'] as const) {
    const token = response[key];
    if (typeof token === 'string' && token.length > 0) {
      return token;
    }
  }

  return null;
}

function getSnapshotDates(collections: OuraDailyCollections): string[] {
  const dates = new Set<string>();

  for (const collection of [
    collections.dailySleep,
    collections.dailyReadiness,
    collections.dailyActivity,
    collections.dailySpO2,
    collections.dailyStress,
    collections.heartHealth,
    collections.workouts,
  ]) {
    for (const date of collection.keys()) {
      dates.add(date);
    }
  }

  return Array.from(dates).sort();
}

function collectionData(response: OuraCollectionResponse): JsonObject[] {
  return (response.data ?? [])
    .map(asRecord)
    .filter((item): item is Record<string, unknown> => item !== null)
    .map((item) => item as JsonObject);
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

async function fetchPaginatedOuraCollection(
  apiBaseUrl: string,
  accessToken: string,
  path: string,
  range: { start_date: string; end_date: string },
): Promise<OuraCollectionResponse> {
  const data: unknown[] = [];
  const seenTokens = new Set<string>();
  let nextToken: string | null = null;

  for (let page = 0; page < OURA_MAX_PAGES_PER_COLLECTION; page += 1) {
    const response = await fetchOuraJson<OuraCollectionResponse>(
      apiBaseUrl,
      accessToken,
      path,
      nextToken ? { ...range, next_token: nextToken } : range,
    );

    if (Array.isArray(response.data)) {
      data.push(...response.data);
    }

    nextToken = getContinuationToken(response);
    if (!nextToken) {
      return { ...response, data };
    }

    if (seenTokens.has(nextToken)) {
      throw new Error(`Oura pagination repeated a continuation token for ${path}`);
    }

    seenTokens.add(nextToken);
  }

  throw new Error(`Oura pagination exceeded ${OURA_MAX_PAGES_PER_COLLECTION} pages for ${path}`);
}

async function fetchOptionalOuraCollection(
  apiBaseUrl: string,
  accessToken: string,
  path: string,
  range: { start_date: string; end_date: string },
): Promise<OuraCollectionResponse> {
  try {
    return await fetchPaginatedOuraCollection(apiBaseUrl, accessToken, path, range);
  } catch (err) {
    if (err instanceof OuraApiError && [401, 403, 404].includes(err.status)) {
      return { data: [] };
    }

    throw err;
  }
}

async function fetchOuraDailyCollections(
  apiBaseUrl: string,
  accessToken: string,
  range: { start_date: string; end_date: string },
): Promise<OuraDailyCollections> {
  const [dailySleep, readiness, activity, spo2, stress, heartHealth, workouts] = await Promise.all([
    fetchPaginatedOuraCollection(apiBaseUrl, accessToken, '/v2/usercollection/daily_sleep', range),
    fetchPaginatedOuraCollection(apiBaseUrl, accessToken, '/v2/usercollection/daily_readiness', range),
    fetchPaginatedOuraCollection(apiBaseUrl, accessToken, '/v2/usercollection/daily_activity', range),
    fetchPaginatedOuraCollection(apiBaseUrl, accessToken, '/v2/usercollection/daily_spo2', range),
    fetchPaginatedOuraCollection(apiBaseUrl, accessToken, '/v2/usercollection/daily_stress', range),
    fetchOptionalOuraCollection(apiBaseUrl, accessToken, '/v2/usercollection/heart_health', range),
    fetchPaginatedOuraCollection(apiBaseUrl, accessToken, '/v2/usercollection/workout', range),
  ]);

  return {
    dailySleep: groupDailyData(dailySleep),
    dailyReadiness: groupDailyData(readiness),
    dailyActivity: groupDailyData(activity),
    dailySpO2: groupDailyData(spo2),
    dailyStress: groupDailyData(stress),
    heartHealth: groupDailyData(heartHealth),
    workouts: groupWorkoutData(workouts),
    analyticsCollections: {
      daily_sleep: { required: true, data: collectionData(dailySleep) },
      daily_readiness: { required: true, data: collectionData(readiness) },
      daily_activity: { required: true, data: collectionData(activity) },
      daily_spo2: { required: true, data: collectionData(spo2) },
      daily_stress: { required: true, data: collectionData(stress) },
      workout: { required: true, data: collectionData(workouts) },
      heart_health: { required: false, data: collectionData(heartHealth) },
    },
  };
}

async function persistOuraAnalyticsPayloads(input: {
  userId: string;
  connectionId: string;
  syncRunId: string;
  range: { start_date: string; end_date: string };
  collections: OuraDailyCollections;
}) {
  const payloads = buildOuraAnalyticsSyncPayloads({
    userId: input.userId,
    connectionId: input.connectionId,
    syncRunId: input.syncRunId,
    rangeStart: input.range.start_date,
    rangeEnd: input.range.end_date,
    collections: input.collections.analyticsCollections,
  });

  for (const coverage of payloads.endpointCoverage) {
    await recordOuraEndpointCoverage(coverage);
  }

  for (const rawDocument of payloads.rawDocuments) {
    await upsertOuraRawDocument(rawDocument);
  }

  for (const dailyHealthFeature of payloads.dailyHealthFeatures) {
    await upsertDailyHealthFeature(dailyHealthFeature);
  }

  return payloads;
}

async function syncOuraSnapshots(
  userId: string,
  range: { start_date: string; end_date: string },
): Promise<number> {
  const auth = await getValidOuraTokens(userId);
  if (!auth) return 0;

  const syncRun = await startOuraSyncRun({
    userId,
    syncType: 'manual_refresh',
    rangeStart: range.start_date,
    rangeEnd: range.end_date,
  });

  try {
    const collections = await fetchOuraDailyCollections(
      auth.config.apiBaseUrl,
      auth.tokens.accessToken,
      range,
    );

    const analyticsPayloads = await persistOuraAnalyticsPayloads({
      userId,
      connectionId: auth.tokens.rowId,
      syncRunId: syncRun.id,
      range,
      collections,
    });

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
    await finishOuraSyncRun({
      syncRunId: syncRun.id,
      status: 'success',
      counts: {
        endpointCoverage: analyticsPayloads.endpointCoverage.length,
        rawDocuments: analyticsPayloads.rawDocuments.length,
        dailyHealthFeatures: analyticsPayloads.dailyHealthFeatures.length,
        externalHealthSnapshots: count,
      },
    });
    await pruneOuraRawDocuments({ userId });

    return count;
  } catch (err) {
    await finishOuraSyncRun({
      syncRunId: syncRun.id,
      status: 'failed',
      errors: [{
        message: err instanceof Error ? err.message : 'Oura health sync failed.',
      }],
    }).catch((finishErr) => {
      console.error('[health/sync] failed to finish Oura sync run', finishErr);
    });
    throw err;
  }
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
