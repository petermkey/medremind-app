import { mapOuraDailyPayloadToHealthSnapshot } from '@/lib/health/ouraDailyMapper';
import { upsertExternalHealthDailySnapshots, upsertOuraTags } from '@/lib/health/persistence';
import { markHealthConnectionSyncSuccess } from '@/lib/health/sourceRegistry';
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
  sleepPeriods: Map<string, Record<string, unknown>>;
  workouts: Map<string, unknown[]>;
  enhancedTags: OuraCollectionResponse;
  analyticsCollections: Record<string, OuraAnalyticsCollection>;
};

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

// A day can carry several sleep documents (naps). Prefer the long_sleep
// period; fall back to the longest total_sleep_duration.
function pickMainSleepByDate(response: OuraCollectionResponse): Map<string, Record<string, unknown>> {
  const byDate = new Map<string, Record<string, unknown>>();
  for (const item of response.data ?? []) {
    const record = asRecord(item);
    const date = getLocalDate(item);
    if (!record || !date) continue;
    const current = byDate.get(date);
    const duration = (r: Record<string, unknown>) =>
      typeof r.total_sleep_duration === 'number' ? r.total_sleep_duration : 0;
    const isLong = (r: Record<string, unknown>) => r.type === 'long_sleep';
    if (!current || (isLong(record) && !isLong(current)) ||
        (isLong(record) === isLong(current) && duration(record) > duration(current))) {
      byDate.set(date, record);
    }
  }
  return byDate;
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
    collections.sleepPeriods,
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

// A day's heart-health picture is now assembled from three separate
// collections instead of the non-existent /heart_health endpoint.
function mergeHeartHealth(
  vo2: OuraCollectionResponse,
  resilience: OuraCollectionResponse,
  cardioAge: OuraCollectionResponse,
): Map<string, Record<string, unknown>> {
  const merged = new Map<string, Record<string, unknown>>();
  const upsert = (date: string, patch: Record<string, unknown>) => {
    merged.set(date, { ...(merged.get(date) ?? {}), ...patch });
  };
  for (const [date, doc] of groupDailyData(vo2)) upsert(date, { vo2_max: doc.vo2_max });
  for (const [date, doc] of groupDailyData(resilience)) upsert(date, { resilience_level: doc.level });
  for (const [date, doc] of groupDailyData(cardioAge)) upsert(date, { cardiovascular_age: doc.vascular_age });
  return merged;
}

async function fetchOuraDailyCollections(
  apiBaseUrl: string,
  accessToken: string,
  range: { start_date: string; end_date: string },
): Promise<OuraDailyCollections> {
  const [dailySleep, readiness, activity, spo2, stress, vo2MaxRes, resilienceRes, cardioAgeRes, sleepRes, workouts, enhancedTagsRes] = await Promise.all([
    fetchPaginatedOuraCollection(apiBaseUrl, accessToken, '/v2/usercollection/daily_sleep', range),
    fetchPaginatedOuraCollection(apiBaseUrl, accessToken, '/v2/usercollection/daily_readiness', range),
    fetchPaginatedOuraCollection(apiBaseUrl, accessToken, '/v2/usercollection/daily_activity', range),
    fetchPaginatedOuraCollection(apiBaseUrl, accessToken, '/v2/usercollection/daily_spo2', range),
    fetchPaginatedOuraCollection(apiBaseUrl, accessToken, '/v2/usercollection/daily_stress', range),
    fetchOptionalOuraCollection(apiBaseUrl, accessToken, '/v2/usercollection/vO2_max', range),
    fetchOptionalOuraCollection(apiBaseUrl, accessToken, '/v2/usercollection/daily_resilience', range),
    fetchOptionalOuraCollection(apiBaseUrl, accessToken, '/v2/usercollection/daily_cardiovascular_age', range),
    fetchOptionalOuraCollection(apiBaseUrl, accessToken, '/v2/usercollection/sleep', range),
    fetchPaginatedOuraCollection(apiBaseUrl, accessToken, '/v2/usercollection/workout', range),
    fetchOptionalOuraCollection(apiBaseUrl, accessToken, '/v2/usercollection/enhanced_tag', range),
  ]);

  const heartHealth = mergeHeartHealth(vo2MaxRes, resilienceRes, cardioAgeRes);

  return {
    dailySleep: groupDailyData(dailySleep),
    dailyReadiness: groupDailyData(readiness),
    dailyActivity: groupDailyData(activity),
    dailySpO2: groupDailyData(spo2),
    dailyStress: groupDailyData(stress),
    heartHealth,
    sleepPeriods: pickMainSleepByDate(sleepRes),
    workouts: groupWorkoutData(workouts),
    enhancedTags: enhancedTagsRes,
    analyticsCollections: {
      daily_sleep: { required: true, data: collectionData(dailySleep) },
      daily_readiness: { required: true, data: collectionData(readiness) },
      daily_activity: { required: true, data: collectionData(activity) },
      daily_spo2: { required: true, data: collectionData(spo2) },
      daily_stress: { required: true, data: collectionData(stress) },
      workout: { required: true, data: collectionData(workouts) },
      vO2_max: { required: false, data: collectionData(vo2MaxRes) },
      daily_resilience: { required: false, data: collectionData(resilienceRes) },
      daily_cardiovascular_age: { required: false, data: collectionData(cardioAgeRes) },
      sleep: { required: false, data: collectionData(sleepRes) },
      enhanced_tag: { required: false, data: collectionData(enhancedTagsRes) },
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

export async function syncOuraSnapshots(
  userId: string,
  range: { start_date: string; end_date: string },
  syncType: 'initial_backfill' | 'daily' | 'manual_refresh',
): Promise<number> {
  const auth = await getValidOuraTokens(userId);
  if (!auth) return 0;

  const syncRun = await startOuraSyncRun({
    userId,
    syncType,
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
        sleepDetail: collections.sleepPeriods.get(localDate),
        workouts: collections.workouts.get(localDate),
      }),
    );

    const count = await upsertExternalHealthDailySnapshots(snapshots);

    const tagRows = (collections.enhancedTags.data ?? [])
      .map(asRecord)
      .filter((doc): doc is Record<string, unknown> => doc !== null)
      .map((doc) => ({
        userId,
        ouraId: String(doc.id ?? ''),
        localDate: getLocalDate(doc) ?? range.end_date,
        tagType: typeof doc.tag_type_code === 'string' ? doc.tag_type_code : null,
        comment: typeof doc.comment === 'string' ? doc.comment : null,
        startTime: typeof doc.start_time === 'string' ? doc.start_time : null,
      }))
      .filter((row) => row.ouraId.length > 0);
    await upsertOuraTags(tagRows);

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
