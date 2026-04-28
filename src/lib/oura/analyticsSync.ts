import {
  hashOuraPayload,
  type DailyHealthFeatureInput,
  type JsonObject,
  type OuraRawDocumentInput,
  type RecordOuraEndpointCoverageInput,
} from './analyticsStore';

export type OuraAnalyticsCollection = {
  required: boolean;
  data: JsonObject[];
  error?: JsonObject;
};

export type BuildOuraAnalyticsSyncPayloadsInput = {
  userId: string;
  connectionId: string;
  syncRunId: string;
  rangeStart: string;
  rangeEnd: string;
  collections: Record<string, OuraAnalyticsCollection>;
};

export type OuraAnalyticsSyncPayloads = {
  endpointCoverage: RecordOuraEndpointCoverageInput[];
  rawDocuments: OuraRawDocumentInput[];
  dailyHealthFeatures: DailyHealthFeatureInput[];
};

const DAILY_FEATURE_ENDPOINTS = [
  'daily_activity',
  'daily_readiness',
  'daily_sleep',
  'daily_spo2',
  'daily_stress',
  'heart_health',
] as const;

function dateFromPayload(payload: JsonObject): string | null {
  for (const key of ['day', 'date', 'local_date']) {
    const value = payload[key];
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return value;
    }
  }
  return null;
}

function stringFromPayload(payload: JsonObject, keys: string[]): string | null {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return null;
}

function numberFromPayload(payload: JsonObject | undefined, key: string): number | null {
  const value = payload?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function nestedNumberFromPayload(payload: JsonObject | undefined, key: string, nestedKey: string): number | null {
  const value = payload?.[key];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const nested = (value as JsonObject)[nestedKey];
  return typeof nested === 'number' && Number.isFinite(nested) ? nested : null;
}

function rawDocumentInput(
  input: BuildOuraAnalyticsSyncPayloadsInput,
  endpoint: string,
  payload: JsonObject,
): OuraRawDocumentInput {
  return {
    userId: input.userId,
    connectionId: input.connectionId,
    syncRunId: input.syncRunId,
    endpoint,
    ouraDocumentId: stringFromPayload(payload, ['id', 'oura_document_id']),
    localDate: dateFromPayload(payload),
    startDatetime: stringFromPayload(payload, ['start_datetime', 'start_time', 'timestamp']),
    endDatetime: stringFromPayload(payload, ['end_datetime', 'end_time']),
    payload,
    payloadHash: hashOuraPayload(payload),
    schemaVersion: 1,
  };
}

function groupByDate(collection: OuraAnalyticsCollection | undefined): Map<string, JsonObject[]> {
  const grouped = new Map<string, JsonObject[]>();

  for (const payload of collection?.data ?? []) {
    const localDate = dateFromPayload(payload);
    if (!localDate) continue;
    grouped.set(localDate, [...(grouped.get(localDate) ?? []), payload]);
  }

  return grouped;
}

function firstByDate(collection: OuraAnalyticsCollection | undefined): Map<string, JsonObject> {
  const grouped = new Map<string, JsonObject>();

  for (const payload of collection?.data ?? []) {
    const localDate = dateFromPayload(payload);
    if (localDate && !grouped.has(localDate)) grouped.set(localDate, payload);
  }

  return grouped;
}

function buildDailyHealthFeatures(input: BuildOuraAnalyticsSyncPayloadsInput): DailyHealthFeatureInput[] {
  const byEndpoint = Object.fromEntries(
    DAILY_FEATURE_ENDPOINTS.map((endpoint) => [endpoint, firstByDate(input.collections[endpoint])]),
  ) as Record<typeof DAILY_FEATURE_ENDPOINTS[number], Map<string, JsonObject>>;
  const workoutsByDate = groupByDate(input.collections.workout);
  const dates = new Set<string>();

  for (const grouped of Object.values(byEndpoint)) {
    for (const date of grouped.keys()) dates.add(date);
  }
  for (const date of workoutsByDate.keys()) dates.add(date);

  return Array.from(dates).sort().map((date) => {
    const dailyActivity = byEndpoint.daily_activity.get(date);
    const dailyReadiness = byEndpoint.daily_readiness.get(date);
    const dailySleep = byEndpoint.daily_sleep.get(date);
    const dailySpO2 = byEndpoint.daily_spo2.get(date);
    const dailyStress = byEndpoint.daily_stress.get(date);
    const heartHealth = byEndpoint.heart_health.get(date);
    const availableEndpoints = Object.entries({
      daily_activity: dailyActivity,
      daily_readiness: dailyReadiness,
      daily_sleep: dailySleep,
      daily_spo2: dailySpO2,
      daily_stress: dailyStress,
      heart_health: heartHealth,
      workout: workoutsByDate.has(date) ? workoutsByDate.get(date) : undefined,
    }).filter(([, payload]) => payload !== undefined).map(([endpoint]) => endpoint).sort();
    const missingRequiredEndpoints = Object.entries(input.collections)
      .filter(([, collection]) => collection.required)
      .filter(([endpoint]) => !availableEndpoints.includes(endpoint))
      .map(([endpoint]) => endpoint)
      .sort();
    const sourcePayloadHashes = Object.entries({
      daily_activity: dailyActivity,
      daily_readiness: dailyReadiness,
      daily_sleep: dailySleep,
      daily_spo2: dailySpO2,
      daily_stress: dailyStress,
      heart_health: heartHealth,
    }).reduce<Record<string, string>>((acc, [endpoint, payload]) => {
      if (payload) acc[endpoint] = hashOuraPayload(payload);
      return acc;
    }, {});

    return {
      userId: input.userId,
      date,
      sleepScore: numberFromPayload(dailySleep, 'score'),
      readinessScore: numberFromPayload(dailyReadiness, 'score'),
      activityScore: numberFromPayload(dailyActivity, 'score'),
      stressSummary: {
        stressHighSeconds: numberFromPayload(dailyStress, 'stress_high'),
        recoveryHighSeconds: numberFromPayload(dailyStress, 'recovery_high'),
      },
      spo2Average: nestedNumberFromPayload(dailySpO2, 'spo2_percentage', 'average'),
      restingHeartRate: numberFromPayload(heartHealth, 'resting_heart_rate'),
      hrvAverage: numberFromPayload(heartHealth, 'hrv_average'),
      steps: numberFromPayload(dailyActivity, 'steps'),
      activeCalories: numberFromPayload(dailyActivity, 'active_calories'),
      workoutCount: workoutsByDate.get(date)?.length ?? 0,
      bedtimeStart: stringFromPayload(dailySleep ?? {}, ['bedtime_start', 'bedtime_start_time']),
      bedtimeEnd: stringFromPayload(dailySleep ?? {}, ['bedtime_end', 'bedtime_end_time']),
      dataQuality: {
        availableEndpoints,
        missingRequiredEndpoints,
      },
      sourcePayloadHashes,
    };
  });
}

export function buildOuraAnalyticsSyncPayloads(
  input: BuildOuraAnalyticsSyncPayloadsInput,
): OuraAnalyticsSyncPayloads {
  return {
    endpointCoverage: Object.entries(input.collections).map(([endpoint, collection]) => ({
      syncRunId: input.syncRunId,
      userId: input.userId,
      endpoint,
      status: collection.error ? 'failed' : 'success',
      required: collection.required,
      rangeStart: input.rangeStart,
      rangeEnd: input.rangeEnd,
      documentCount: collection.data.length,
      error: collection.error,
    })),
    rawDocuments: Object.entries(input.collections).flatMap(([endpoint, collection]) =>
      collection.data.map((payload) => rawDocumentInput(input, endpoint, payload)),
    ),
    dailyHealthFeatures: buildDailyHealthFeatures(input),
  };
}
