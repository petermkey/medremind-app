import { createHash } from 'node:crypto';

import { createClient } from '@supabase/supabase-js';

export type OuraEndpoint =
  | 'daily_sleep'
  | 'daily_readiness'
  | 'daily_activity'
  | 'daily_spo2'
  | 'daily_stress'
  | 'sleep'
  | 'workout'
  | 'heartrate';

export type OuraSyncType = 'initial_backfill' | 'daily' | 'manual_refresh';
export type OuraSyncRunStatus = 'running' | 'success' | 'partial_success' | 'failed';
export type OuraEndpointStatus = 'success' | 'failed' | 'skipped';

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type OuraSyncRun = {
  id: string;
  user_id: string;
  provider: 'oura';
  sync_type: OuraSyncType;
  range_start: string;
  range_end: string;
  status: OuraSyncRunStatus;
  counts: JsonValue;
  errors: JsonValue;
  started_at: string;
  finished_at: string | null;
};

export type StartOuraSyncRunInput = {
  userId: string;
  syncType: OuraSyncType;
  rangeStart: string;
  rangeEnd: string;
  counts?: JsonValue;
};

export type FinishOuraSyncRunInput = {
  syncRunId: string;
  status: Exclude<OuraSyncRunStatus, 'running'>;
  counts?: JsonValue;
  errors?: JsonValue;
  finishedAt?: string;
};

export type RecordOuraEndpointCoverageInput = {
  syncRunId: string;
  userId: string;
  endpoint: OuraEndpoint | string;
  status: OuraEndpointStatus;
  required?: boolean;
  rangeStart: string;
  rangeEnd: string;
  documentCount?: number;
  error?: JsonValue;
  fetchedAt?: string;
};

export type OuraRawDocumentInput = {
  userId: string;
  connectionId: string;
  endpoint: OuraEndpoint | string;
  ouraDocumentId?: string | null;
  localDate?: string | null;
  startDatetime?: string | null;
  endDatetime?: string | null;
  payload: JsonValue;
  payloadHash?: string;
  fetchedAt?: string;
  syncRunId?: string | null;
  schemaVersion?: number;
};

export type OuraRawDocumentResult = {
  id: string;
  payloadHash: string;
};

export type DailyHealthFeatureInput = {
  userId: string;
  date: string;
  sleepScore?: number | null;
  readinessScore?: number | null;
  activityScore?: number | null;
  stressSummary?: JsonValue;
  spo2Average?: number | null;
  restingHeartRate?: number | null;
  hrvAverage?: number | null;
  steps?: number | null;
  activeCalories?: number | null;
  workoutCount?: number | null;
  bedtimeStart?: string | null;
  bedtimeEnd?: string | null;
  dataQuality?: JsonValue;
  sourcePayloadHashes?: JsonValue;
};

function getServiceClient() {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Supabase service role environment is required for Oura analytics storage');
  }

  return createClient(supabaseUrl, serviceRoleKey);
}

function stableStringify(value: JsonValue): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(',')}}`;
}

export function hashOuraPayload(payload: JsonValue): string {
  return createHash('sha256').update(stableStringify(payload)).digest('hex');
}

function requireRawDocumentIdentity(input: OuraRawDocumentInput) {
  if (!input.ouraDocumentId && !input.localDate && !input.startDatetime) {
    throw new Error('Oura raw documents require ouraDocumentId, localDate, or startDatetime');
  }
}

function rawDocumentMatch(input: OuraRawDocumentInput, payloadHash: string) {
  return {
    user_id: input.userId,
    connection_id: input.connectionId,
    endpoint: input.endpoint,
    oura_document_id: input.ouraDocumentId ?? null,
    local_date: input.localDate ?? null,
    start_datetime: input.startDatetime ?? null,
    payload_hash: payloadHash,
  };
}

async function findRawDocument(input: OuraRawDocumentInput, payloadHash: string) {
  const supabase = getServiceClient();
  const match = rawDocumentMatch(input, payloadHash);
  let query = supabase
    .from('oura_raw_documents')
    .select('id')
    .eq('user_id', match.user_id)
    .eq('connection_id', match.connection_id)
    .eq('endpoint', match.endpoint)
    .eq('payload_hash', match.payload_hash);

  query = match.oura_document_id
    ? query.eq('oura_document_id', match.oura_document_id)
    : query.is('oura_document_id', null);
  query = match.local_date
    ? query.eq('local_date', match.local_date)
    : query.is('local_date', null);
  query = match.start_datetime
    ? query.eq('start_datetime', match.start_datetime)
    : query.is('start_datetime', null);

  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data as { id: string } | null;
}

export async function startOuraSyncRun(input: StartOuraSyncRunInput): Promise<OuraSyncRun> {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from('external_health_sync_runs')
    .insert({
      user_id: input.userId,
      provider: 'oura',
      sync_type: input.syncType,
      range_start: input.rangeStart,
      range_end: input.rangeEnd,
      status: 'running',
      counts: input.counts ?? {},
      errors: [],
    })
    .select('*')
    .single();

  if (error) throw error;
  return data as OuraSyncRun;
}

export async function finishOuraSyncRun(input: FinishOuraSyncRunInput): Promise<void> {
  const supabase = getServiceClient();
  const updates: Record<string, JsonValue | string> = {
    status: input.status,
    finished_at: input.finishedAt ?? new Date().toISOString(),
  };

  if (input.counts !== undefined) updates.counts = input.counts;
  if (input.errors !== undefined) updates.errors = input.errors;

  const { error } = await supabase
    .from('external_health_sync_runs')
    .update(updates)
    .eq('id', input.syncRunId);

  if (error) throw error;
}

export async function recordOuraEndpointCoverage(
  input: RecordOuraEndpointCoverageInput,
): Promise<void> {
  const supabase = getServiceClient();
  const { error } = await supabase
    .from('oura_sync_endpoint_coverage')
    .upsert({
      sync_run_id: input.syncRunId,
      user_id: input.userId,
      provider: 'oura',
      endpoint: input.endpoint,
      status: input.status,
      required: input.required ?? true,
      range_start: input.rangeStart,
      range_end: input.rangeEnd,
      document_count: input.documentCount ?? 0,
      error: input.error ?? null,
      fetched_at: input.fetchedAt ?? new Date().toISOString(),
    }, { onConflict: 'sync_run_id,endpoint' });

  if (error) throw error;
}

export async function upsertOuraRawDocument(
  input: OuraRawDocumentInput,
): Promise<OuraRawDocumentResult> {
  requireRawDocumentIdentity(input);

  const supabase = getServiceClient();
  const payloadHash = input.payloadHash ?? hashOuraPayload(input.payload);
  const existing = await findRawDocument(input, payloadHash);

  if (existing) {
    const { error } = await supabase
      .from('oura_raw_documents')
      .update({
        payload: input.payload,
        fetched_at: input.fetchedAt ?? new Date().toISOString(),
        sync_run_id: input.syncRunId ?? null,
        schema_version: input.schemaVersion ?? 1,
      })
      .eq('id', existing.id);

    if (error) throw error;
    return { id: existing.id, payloadHash };
  }

  const { data, error } = await supabase
    .from('oura_raw_documents')
    .insert({
      user_id: input.userId,
      connection_id: input.connectionId,
      endpoint: input.endpoint,
      oura_document_id: input.ouraDocumentId ?? null,
      local_date: input.localDate ?? null,
      start_datetime: input.startDatetime ?? null,
      end_datetime: input.endDatetime ?? null,
      payload: input.payload,
      payload_hash: payloadHash,
      fetched_at: input.fetchedAt ?? new Date().toISOString(),
      sync_run_id: input.syncRunId ?? null,
      schema_version: input.schemaVersion ?? 1,
    })
    .select('id')
    .single();

  if (error) {
    if (error.code === '23505') {
      const duplicate = await findRawDocument(input, payloadHash);
      if (duplicate) return { id: duplicate.id, payloadHash };
    }
    throw error;
  }

  return { id: (data as { id: string }).id, payloadHash };
}

export async function pruneOuraRawDocuments(input: {
  cutoffDate?: string;
  now?: Date;
  retentionDays?: number;
  userId?: string;
} = {}): Promise<number | null> {
  const supabase = getServiceClient();
  const cutoffDate = input.cutoffDate
    ?? getOuraRawRetentionCutoffDate(input.now, input.retentionDays);
  const cutoffTimestamp = `${cutoffDate}T00:00:00.000Z`;
  let query = supabase
    .from('oura_raw_documents')
    .delete({ count: 'exact' })
    .or([
      `local_date.lt.${cutoffDate}`,
      `and(local_date.is.null,start_datetime.lt.${cutoffTimestamp})`,
      `and(local_date.is.null,start_datetime.is.null,fetched_at.lt.${cutoffTimestamp})`,
    ].join(','));

  if (input.userId) {
    query = query.eq('user_id', input.userId);
  }

  const { count, error } = await query;
  if (error) throw error;
  return count;
}

export function getOuraRawRetentionCutoffDate(now = new Date(), retentionDays = 90): string {
  const cutoff = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  cutoff.setUTCDate(cutoff.getUTCDate() - retentionDays + 1);
  return cutoff.toISOString().slice(0, 10);
}

export async function upsertDailyHealthFeature(input: DailyHealthFeatureInput): Promise<void> {
  const supabase = getServiceClient();
  const { error } = await supabase
    .from('daily_health_features')
    .upsert({
      user_id: input.userId,
      date: input.date,
      sleep_score: input.sleepScore ?? null,
      readiness_score: input.readinessScore ?? null,
      activity_score: input.activityScore ?? null,
      stress_summary: input.stressSummary ?? null,
      spo2_average: input.spo2Average ?? null,
      resting_heart_rate: input.restingHeartRate ?? null,
      hrv_average: input.hrvAverage ?? null,
      steps: input.steps ?? null,
      active_calories: input.activeCalories ?? null,
      workout_count: input.workoutCount ?? null,
      bedtime_start: input.bedtimeStart ?? null,
      bedtime_end: input.bedtimeEnd ?? null,
      data_quality: input.dataQuality ?? {},
      source_payload_hashes: input.sourcePayloadHashes ?? {},
    }, { onConflict: 'user_id,date' });

  if (error) throw error;
}
