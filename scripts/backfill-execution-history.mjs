#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';

const PAGE_SIZE = 1000;
const INSERT_CHUNK_SIZE = 500;
const VALID_ACTIONS = new Set(['taken', 'skipped', 'snoozed']);
const HANDLED_STATUSES = new Set(['taken', 'skipped', 'snoozed']);

function parseArgs(argv) {
  const parsed = {
    apply: false,
    userId: null,
    sampleSize: 10,
  };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--apply') {
      parsed.apply = true;
      continue;
    }
    if (token === '--dry-run') {
      parsed.apply = false;
      continue;
    }
    if (token === '--user-id') {
      parsed.userId = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (token === '--sample-size') {
      const value = Number(argv[i + 1]);
      if (!Number.isNaN(value) && value > 0) parsed.sampleSize = Math.floor(value);
      i += 1;
      continue;
    }
    if (token === '--help' || token === '-h') {
      parsed.help = true;
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }
  return parsed;
}

function printHelp() {
  console.log(`Execution history backfill (D2)\n\nUsage:\n  node scripts/backfill-execution-history.mjs [--dry-run] [--apply] [--user-id <uuid>] [--sample-size <n>]\n\nModes:\n  --dry-run  (default) compute/report only; no writes\n  --apply    insert missing execution_events rows\n\nEnvironment:\n  SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL\n  SUPABASE_SERVICE_ROLE_KEY (required for full backfill)`);
}

function hash32(input, seed) {
  let h = seed >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function stableUuid(namespace, source) {
  const input = `${namespace}:${source}`;
  const p1 = hash32(input, 0x811c9dc5).toString(16).padStart(8, '0');
  const p2 = hash32(input, 0x9e3779b9).toString(16).padStart(8, '0');
  const p3 = hash32(input, 0x85ebca6b).toString(16).padStart(8, '0');
  const p4 = hash32(input, 0xc2b2ae35).toString(16).padStart(8, '0');
  const hex = `${p1}${p2}${p3}${p4}`;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

async function fetchAll(buildQuery, label) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await buildQuery().range(from, to);
    if (error) {
      throw new Error(`${label} fetch failed: ${error.message}`);
    }
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

function pushAnomaly(anomalies, kind, details, sampleSize) {
  if (!anomalies[kind]) {
    anomalies[kind] = { count: 0, samples: [] };
  }
  anomalies[kind].count += 1;
  if (anomalies[kind].samples.length < sampleSize) {
    anomalies[kind].samples.push(details);
  }
}

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function keyDoseType(doseId, type) {
  return `${doseId}|${type}`;
}

function buildScopedQuery(builder, userId) {
  const query = builder();
  return userId ? query.eq('user_id', userId) : query;
}

async function buildPlan(supabase, userId, sampleSize) {
  const anomalies = {};

  const [doseRecords, scheduledDoses, plannedOccurrences, existingByRecord, existingByDose] = await Promise.all([
    fetchAll(
      () => buildScopedQuery(
        () => supabase.from('dose_records').select('id,user_id,scheduled_dose_id,action,recorded_at,note').order('id', { ascending: true }),
        userId,
      ),
      'dose_records',
    ),
    fetchAll(
      () => buildScopedQuery(
        () => supabase
          .from('scheduled_doses')
          .select('id,user_id,active_protocol_id,protocol_item_id,scheduled_date,scheduled_time,status,created_at')
          .order('id', { ascending: true }),
        userId,
      ),
      'scheduled_doses',
    ),
    fetchAll(
      () => buildScopedQuery(
        () => supabase
          .from('planned_occurrences')
          .select('id,user_id,legacy_scheduled_dose_id')
          .not('legacy_scheduled_dose_id', 'is', null)
          .order('id', { ascending: true }),
        userId,
      ),
      'planned_occurrences',
    ),
    fetchAll(
      () => buildScopedQuery(
        () => supabase
          .from('execution_events')
          .select('id,user_id,legacy_dose_record_id,event_type')
          .not('legacy_dose_record_id', 'is', null)
          .order('id', { ascending: true }),
        userId,
      ),
      'execution_events(record bridge)',
    ),
    fetchAll(
      () => buildScopedQuery(
        () => supabase
          .from('execution_events')
          .select('id,user_id,legacy_scheduled_dose_id,event_type,source')
          .not('legacy_scheduled_dose_id', 'is', null)
          .order('id', { ascending: true }),
        userId,
      ),
      'execution_events(dose bridge)',
    ),
  ]);

  const doseById = new Map();
  for (const dose of scheduledDoses) {
    doseById.set(dose.id, dose);
  }

  const plannedByDoseId = new Map();
  for (const row of plannedOccurrences) {
    const doseId = row.legacy_scheduled_dose_id;
    const existing = plannedByDoseId.get(doseId);
    if (existing && existing.id !== row.id) {
      pushAnomaly(
        anomalies,
        'duplicate_planned_occurrence_bridge',
        { legacyScheduledDoseId: doseId, plannedOccurrenceIds: [existing.id, row.id] },
        sampleSize,
      );
      continue;
    }
    plannedByDoseId.set(doseId, row);
  }

  const existingRecordEventCount = new Map();
  const existingRecordEventTypes = new Map();
  for (const row of existingByRecord) {
    const recordId = row.legacy_dose_record_id;
    existingRecordEventCount.set(recordId, (existingRecordEventCount.get(recordId) ?? 0) + 1);
    if (!existingRecordEventTypes.has(recordId)) existingRecordEventTypes.set(recordId, new Set());
    existingRecordEventTypes.get(recordId).add(row.event_type);
  }

  for (const [recordId, count] of existingRecordEventCount.entries()) {
    if (count > 1) {
      pushAnomaly(anomalies, 'duplicate_execution_event_for_legacy_record', { legacyDoseRecordId: recordId, count }, sampleSize);
    }
  }

  const existingDoseTypeAnySource = new Set();
  const existingInferredDoseType = new Set();
  for (const row of existingByDose) {
    const key = keyDoseType(row.legacy_scheduled_dose_id, row.event_type);
    existingDoseTypeAnySource.add(key);
    if (row.source === 'legacy_status_inference_backfill') {
      existingInferredDoseType.add(key);
    }
  }

  const recordByDoseType = new Set();
  const canonicalRows = [];
  const inferredRows = [];
  const counters = {
    canonicalExamined: 0,
    canonicalInsertable: 0,
    canonicalSkippedExisting: 0,
    canonicalSkippedInvalidAction: 0,
    canonicalSkippedUnmappable: 0,
    inferredExamined: 0,
    inferredInsertable: 0,
    inferredSkippedDueToRecord: 0,
    inferredSkippedExisting: 0,
    inferredSkippedNotHandledStatus: 0,
  };

  for (const record of doseRecords) {
    counters.canonicalExamined += 1;

    if (!VALID_ACTIONS.has(record.action)) {
      counters.canonicalSkippedInvalidAction += 1;
      pushAnomaly(anomalies, 'unsupported_dose_record_action', { recordId: record.id, action: record.action }, sampleSize);
      continue;
    }

    recordByDoseType.add(keyDoseType(record.scheduled_dose_id, record.action));

    const dose = doseById.get(record.scheduled_dose_id);
    if (!dose) {
      counters.canonicalSkippedUnmappable += 1;
      pushAnomaly(
        anomalies,
        'missing_scheduled_dose_for_record',
        { recordId: record.id, scheduledDoseId: record.scheduled_dose_id },
        sampleSize,
      );
      continue;
    }

    if (dose.user_id !== record.user_id) {
      counters.canonicalSkippedUnmappable += 1;
      pushAnomaly(
        anomalies,
        'user_mismatch_record_vs_dose',
        { recordId: record.id, recordUserId: record.user_id, doseUserId: dose.user_id, scheduledDoseId: dose.id },
        sampleSize,
      );
      continue;
    }

    if (!dose.active_protocol_id || !dose.protocol_item_id) {
      counters.canonicalSkippedUnmappable += 1;
      pushAnomaly(
        anomalies,
        'missing_protocol_links_for_record',
        { recordId: record.id, scheduledDoseId: dose.id },
        sampleSize,
      );
      continue;
    }

    const existingCount = existingRecordEventCount.get(record.id) ?? 0;
    if (existingCount > 0) {
      counters.canonicalSkippedExisting += 1;
      const existingTypes = existingRecordEventTypes.get(record.id);
      if (existingTypes && !existingTypes.has(record.action)) {
        pushAnomaly(
          anomalies,
          'existing_event_type_mismatch_for_record',
          {
            recordId: record.id,
            recordAction: record.action,
            existingTypes: Array.from(existingTypes),
          },
          sampleSize,
        );
      }
      continue;
    }

    const planned = plannedByDoseId.get(dose.id);
    if (planned && planned.user_id !== record.user_id) {
      pushAnomaly(
        anomalies,
        'user_mismatch_record_vs_planned_occurrence',
        { recordId: record.id, recordUserId: record.user_id, plannedOccurrenceUserId: planned.user_id, plannedOccurrenceId: planned.id },
        sampleSize,
      );
    }

    canonicalRows.push({
      id: stableUuid('execution-backfill-record', record.id),
      user_id: record.user_id,
      planned_occurrence_id: planned?.id ?? null,
      legacy_scheduled_dose_id: dose.id,
      legacy_dose_record_id: record.id,
      active_protocol_id: dose.active_protocol_id,
      protocol_item_id: dose.protocol_item_id,
      event_type: record.action,
      event_at: record.recorded_at,
      effective_date: dose.scheduled_date,
      effective_time: dose.scheduled_time,
      note: record.note ?? null,
      source: 'legacy_dose_record_backfill',
      idempotency_key: null,
    });
    counters.canonicalInsertable += 1;
  }

  for (const dose of scheduledDoses) {
    counters.inferredExamined += 1;

    if (!HANDLED_STATUSES.has(dose.status)) {
      counters.inferredSkippedNotHandledStatus += 1;
      continue;
    }

    const type = dose.status;
    const doseTypeKey = keyDoseType(dose.id, type);

    if (recordByDoseType.has(doseTypeKey)) {
      counters.inferredSkippedDueToRecord += 1;
      continue;
    }

    if (existingDoseTypeAnySource.has(doseTypeKey) || existingInferredDoseType.has(doseTypeKey)) {
      counters.inferredSkippedExisting += 1;
      continue;
    }

    if (!dose.active_protocol_id || !dose.protocol_item_id) {
      pushAnomaly(
        anomalies,
        'missing_protocol_links_for_inferred_status',
        { scheduledDoseId: dose.id, status: dose.status },
        sampleSize,
      );
      continue;
    }

    const planned = plannedByDoseId.get(dose.id);
    if (planned && planned.user_id !== dose.user_id) {
      pushAnomaly(
        anomalies,
        'user_mismatch_dose_vs_planned_occurrence',
        {
          scheduledDoseId: dose.id,
          doseUserId: dose.user_id,
          plannedOccurrenceUserId: planned.user_id,
          plannedOccurrenceId: planned.id,
        },
        sampleSize,
      );
    }

    inferredRows.push({
      id: stableUuid('execution-backfill-inferred', `${dose.id}:${type}`),
      user_id: dose.user_id,
      planned_occurrence_id: planned?.id ?? null,
      legacy_scheduled_dose_id: dose.id,
      legacy_dose_record_id: null,
      active_protocol_id: dose.active_protocol_id,
      protocol_item_id: dose.protocol_item_id,
      event_type: type,
      event_at: dose.created_at,
      effective_date: dose.scheduled_date,
      effective_time: dose.scheduled_time,
      note: 'inferred:missing_dose_record',
      source: 'legacy_status_inference_backfill',
      idempotency_key: null,
    });
    counters.inferredInsertable += 1;
  }

  return {
    counters,
    anomalies,
    canonicalRows,
    inferredRows,
    totals: {
      scheduledDoses: scheduledDoses.length,
      doseRecords: doseRecords.length,
      plannedOccurrenceBridges: plannedOccurrences.length,
      existingExecutionEventsByRecord: existingByRecord.length,
      existingExecutionEventsByDose: existingByDose.length,
      rowsToInsert: canonicalRows.length + inferredRows.length,
    },
  };
}

async function insertRows(supabase, rows) {
  if (rows.length === 0) return { inserted: 0 };
  let inserted = 0;
  for (const part of chunk(rows, INSERT_CHUNK_SIZE)) {
    const { error } = await supabase.from('execution_events').insert(part);
    if (error) {
      throw new Error(`execution_events insert failed: ${error.message}`);
    }
    inserted += part.length;
  }
  return { inserted };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl) {
    throw new Error('Missing SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL).');
  }
  if (!serviceRoleKey) {
    throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY. This tool is intended for one-time migration runs.');
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const mode = args.apply ? 'apply' : 'dry-run';
  const startedAt = new Date().toISOString();

  const plan = await buildPlan(supabase, args.userId, args.sampleSize);

  let insertedCanonical = 0;
  let insertedInferred = 0;
  let rerunPlan = null;

  if (args.apply) {
    const canonicalResult = await insertRows(supabase, plan.canonicalRows);
    insertedCanonical = canonicalResult.inserted;
    const inferredResult = await insertRows(supabase, plan.inferredRows);
    insertedInferred = inferredResult.inserted;

    // Rerun planning after apply to validate rerun idempotency behavior.
    rerunPlan = await buildPlan(supabase, args.userId, args.sampleSize);
  }

  const finishedAt = new Date().toISOString();
  const report = {
    mode,
    startedAt,
    finishedAt,
    userScope: args.userId ?? 'all-users',
    totals: plan.totals,
    counters: plan.counters,
    rowsPrepared: {
      canonical: plan.canonicalRows.length,
      inferred: plan.inferredRows.length,
      all: plan.canonicalRows.length + plan.inferredRows.length,
    },
    writes: {
      insertedCanonical,
      insertedInferred,
      insertedAll: insertedCanonical + insertedInferred,
    },
    rerunValidation: rerunPlan
      ? {
        rowsPreparedAfterApply: rerunPlan.totals.rowsToInsert,
        canonicalRowsAfterApply: rerunPlan.canonicalRows.length,
        inferredRowsAfterApply: rerunPlan.inferredRows.length,
      }
      : null,
    anomalies: plan.anomalies,
  };

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error('[backfill-execution-history] failed:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
