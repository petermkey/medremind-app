#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';

const PAGE_SIZE = 1000;
const INSERT_CHUNK_SIZE = 500;
const TERMINAL_PROTOCOL_STATUSES = new Set(['completed', 'abandoned']);
const HANDLED_DOSE_STATUSES = new Set(['taken', 'skipped']);
const FUTURE_NON_PLANNED_STATUSES = new Set(['snoozed', 'taken', 'skipped']);

function parseArgs(argv) {
  const parsed = {
    apply: false,
    userId: null,
    sampleSize: 10,
    help: false,
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
  console.log(`Planned future occurrence backfill (D3)\n\nUsage:\n  node scripts/backfill-planned-future-occurrences.mjs [--dry-run] [--apply] [--user-id <uuid>] [--sample-size <n>]\n\nModes:\n  --dry-run  (default) compute/report only; no writes\n  --apply    insert missing planned_occurrences rows\n\nEnvironment:\n  SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL\n  SUPABASE_SERVICE_ROLE_KEY (required for full backfill)`);
}

function toUtcDateString(value) {
  const y = value.getUTCFullYear();
  const m = String(value.getUTCMonth() + 1).padStart(2, '0');
  const d = String(value.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
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

function pushAnomaly(anomalies, kind, details, sampleSize) {
  if (!anomalies[kind]) {
    anomalies[kind] = { count: 0, samples: [] };
  }
  anomalies[kind].count += 1;
  if (anomalies[kind].samples.length < sampleSize) {
    anomalies[kind].samples.push(details);
  }
}

function buildScopedQuery(builder, userId) {
  const query = builder();
  return userId ? query.eq('user_id', userId) : query;
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

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function normalizeTimeText(value) {
  return String(value ?? '').slice(0, 5);
}

async function fetchProtocolsByIds(supabase, protocolIds) {
  if (protocolIds.length === 0) return [];
  const rows = [];
  for (const ids of chunk(protocolIds, 250)) {
    const { data, error } = await supabase
      .from('protocols')
      .select('id,owner_id,is_archived')
      .in('id', ids);
    if (error) {
      throw new Error(`protocols fetch failed: ${error.message}`);
    }
    rows.push(...(data ?? []));
  }
  return rows;
}

function slotKey(dose) {
  return `${dose.user_id}|${dose.active_protocol_id}|${dose.protocol_item_id}|${dose.scheduled_date}|${normalizeTimeText(dose.scheduled_time)}`;
}

function expectedStatusForFutureRow(dose, active, todayDate) {
  let expectedStatus = 'planned';
  if (active.end_date && String(dose.scheduled_date) > String(active.end_date)) {
    expectedStatus = 'cancelled';
  }
  if (TERMINAL_PROTOCOL_STATUSES.has(active.status) && String(dose.scheduled_date) > String(todayDate)) {
    expectedStatus = 'cancelled';
  }
  if (FUTURE_NON_PLANNED_STATUSES.has(dose.status)) {
    expectedStatus = 'cancelled';
  }
  return expectedStatus;
}

function rowDiff(existing, expected) {
  const mismatches = [];
  const fields = [
    'user_id',
    'active_protocol_id',
    'protocol_id',
    'protocol_item_id',
    'occurrence_date',
    'occurrence_time',
    'occurrence_key',
    'revision',
    'status',
    'source_generation',
  ];
  for (const field of fields) {
    const left = existing[field];
    const right = expected[field];
    const normalizedLeft = field === 'occurrence_time' ? normalizeTimeText(left) : left;
    const normalizedRight = field === 'occurrence_time' ? normalizeTimeText(right) : right;
    if (normalizedLeft !== normalizedRight) {
      mismatches.push({ field, existing: left, expected: right });
    }
  }
  return mismatches;
}

async function buildPlan(supabase, options) {
  const { userId, sampleSize, todayDate } = options;
  const anomalies = {};
  const nowIso = new Date().toISOString();

  const [futureDoses, activeProtocols, existingPlannedRows] = await Promise.all([
    fetchAll(
      () => buildScopedQuery(
        () => supabase
          .from('scheduled_doses')
          .select('id,user_id,active_protocol_id,protocol_item_id,scheduled_date,scheduled_time,status,created_at')
          .gte('scheduled_date', todayDate)
          .order('id', { ascending: true }),
        userId,
      ),
      'scheduled_doses(future)',
    ),
    fetchAll(
      () => buildScopedQuery(
        () => supabase
          .from('active_protocols')
          .select('id,user_id,protocol_id,status,start_date,end_date,paused_at,completed_at')
          .order('id', { ascending: true }),
        userId,
      ),
      'active_protocols',
    ),
    fetchAll(
      () => buildScopedQuery(
        () => supabase
          .from('planned_occurrences')
          .select('id,user_id,active_protocol_id,protocol_id,protocol_item_id,occurrence_date,occurrence_time,occurrence_key,revision,status,source_generation,legacy_scheduled_dose_id')
          .not('legacy_scheduled_dose_id', 'is', null)
          .order('id', { ascending: true }),
        userId,
      ),
      'planned_occurrences(legacy bridge)',
    ),
  ]);

  const protocolIds = Array.from(new Set(activeProtocols.map(row => row.protocol_id).filter(Boolean)));
  const protocols = await fetchProtocolsByIds(supabase, protocolIds);

  const activeById = new Map(activeProtocols.map(row => [row.id, row]));
  const protocolById = new Map(protocols.map(row => [row.id, row]));

  const existingByDoseId = new Map();
  for (const row of existingPlannedRows) {
    const doseId = row.legacy_scheduled_dose_id;
    const list = existingByDoseId.get(doseId) ?? [];
    list.push(row);
    existingByDoseId.set(doseId, list);
  }
  for (const [doseId, rows] of existingByDoseId.entries()) {
    if (rows.length > 1) {
      pushAnomaly(
        anomalies,
        'duplicate_planned_occurrence_bridge',
        { legacyScheduledDoseId: doseId, plannedOccurrenceIds: rows.map(row => row.id) },
        sampleSize,
      );
    }
  }

  const slotCounts = new Map();
  for (const dose of futureDoses) {
    const key = slotKey(dose);
    slotCounts.set(key, (slotCounts.get(key) ?? 0) + 1);
  }

  const counters = {
    futureRowsExamined: 0,
    insertableRows: 0,
    skippedExistingBridge: 0,
    skippedUnmappable: 0,
    cancelledByBoundary: 0,
    cancelledByTerminalFuture: 0,
    cancelledByFutureStatusContradiction: 0,
  };

  const rowsToInsert = [];
  const boundaryViolations = [];

  for (const dose of futureDoses) {
    counters.futureRowsExamined += 1;

    if ((slotCounts.get(slotKey(dose)) ?? 0) > 1) {
      pushAnomaly(
        anomalies,
        'ambiguous_legacy_to_additive_mapping',
        {
          scheduledDoseId: dose.id,
          userId: dose.user_id,
          activeProtocolId: dose.active_protocol_id,
          protocolItemId: dose.protocol_item_id,
          scheduledDate: dose.scheduled_date,
          scheduledTime: normalizeTimeText(dose.scheduled_time),
        },
        sampleSize,
      );
    }

    const active = activeById.get(dose.active_protocol_id);
    if (!active) {
      counters.skippedUnmappable += 1;
      pushAnomaly(
        anomalies,
        'missing_legacy_bridge_active_protocol',
        { scheduledDoseId: dose.id, activeProtocolId: dose.active_protocol_id },
        sampleSize,
      );
      continue;
    }
    if (active.user_id !== dose.user_id) {
      counters.skippedUnmappable += 1;
      pushAnomaly(
        anomalies,
        'user_mismatch_dose_vs_active_protocol',
        {
          scheduledDoseId: dose.id,
          activeProtocolId: active.id,
          doseUserId: dose.user_id,
          activeProtocolUserId: active.user_id,
        },
        sampleSize,
      );
      continue;
    }

    const protocol = protocolById.get(active.protocol_id);
    if (!protocol) {
      counters.skippedUnmappable += 1;
      pushAnomaly(
        anomalies,
        'missing_legacy_bridge_protocol',
        { scheduledDoseId: dose.id, activeProtocolId: active.id, protocolId: active.protocol_id },
        sampleSize,
      );
      continue;
    }

    if (active.status === 'completed' && !active.completed_at) {
      pushAnomaly(
        anomalies,
        'lifecycle_status_contradiction',
        { activeProtocolId: active.id, status: active.status, completedAt: active.completed_at ?? null },
        sampleSize,
      );
    }
    if ((active.status === 'active' || active.status === 'paused') && active.completed_at) {
      pushAnomaly(
        anomalies,
        'lifecycle_status_contradiction',
        { activeProtocolId: active.id, status: active.status, completedAt: active.completed_at },
        sampleSize,
      );
    }

    const boundaryViolation = Boolean(active.end_date && String(dose.scheduled_date) > String(active.end_date));
    if (boundaryViolation) {
      counters.cancelledByBoundary += 1;
      boundaryViolations.push({ scheduledDoseId: dose.id, scheduledDate: dose.scheduled_date, endDate: active.end_date });
      pushAnomaly(
        anomalies,
        'boundary_violation_fixed_duration',
        {
          scheduledDoseId: dose.id,
          activeProtocolId: active.id,
          scheduledDate: dose.scheduled_date,
          endDate: active.end_date,
        },
        sampleSize,
      );
    }

    const terminalFuture = TERMINAL_PROTOCOL_STATUSES.has(active.status) && String(dose.scheduled_date) > String(todayDate);
    if (terminalFuture) {
      counters.cancelledByTerminalFuture += 1;
      pushAnomaly(
        anomalies,
        'terminal_lifecycle_future_row',
        {
          scheduledDoseId: dose.id,
          activeProtocolId: active.id,
          activeProtocolStatus: active.status,
          scheduledDate: dose.scheduled_date,
          todayDate,
        },
        sampleSize,
      );
    }

    if (FUTURE_NON_PLANNED_STATUSES.has(dose.status)) {
      counters.cancelledByFutureStatusContradiction += 1;
      pushAnomaly(
        anomalies,
        HANDLED_DOSE_STATUSES.has(dose.status) ? 'unexpected_future_handled_status' : 'unexpected_future_snoozed_status',
        { scheduledDoseId: dose.id, status: dose.status, scheduledDate: dose.scheduled_date },
        sampleSize,
      );
    }

    const mapped = {
      id: stableUuid('planned-backfill-future-dose', dose.id),
      user_id: dose.user_id,
      active_protocol_id: dose.active_protocol_id,
      protocol_id: active.protocol_id,
      protocol_item_id: dose.protocol_item_id,
      occurrence_date: dose.scheduled_date,
      occurrence_time: dose.scheduled_time,
      occurrence_key: `legacy-dose:${dose.id}`,
      revision: 1,
      status: expectedStatusForFutureRow(dose, active, todayDate),
      supersedes_occurrence_id: null,
      superseded_by_occurrence_id: null,
      superseded_at: null,
      source_generation: 'legacy_backfill_d3_future_rows',
      legacy_scheduled_dose_id: dose.id,
      created_at: dose.created_at,
      updated_at: nowIso,
    };

    const existingRows = existingByDoseId.get(dose.id) ?? [];
    if (existingRows.length === 1) {
      counters.skippedExistingBridge += 1;
      const mismatch = rowDiff(existingRows[0], mapped);
      if (mismatch.length > 0) {
        pushAnomaly(
          anomalies,
          'existing_bridge_mapping_mismatch',
          { scheduledDoseId: dose.id, plannedOccurrenceId: existingRows[0].id, mismatches: mismatch },
          sampleSize,
        );
      }
      continue;
    }
    if (existingRows.length > 1) {
      counters.skippedUnmappable += 1;
      continue;
    }

    rowsToInsert.push(mapped);
    counters.insertableRows += 1;
  }

  return {
    counters,
    anomalies,
    rowsToInsert,
    totals: {
      futureLegacyRowsLoaded: futureDoses.length,
      activeProtocolsLoaded: activeProtocols.length,
      protocolsLoaded: protocols.length,
      existingPlannedBridgeRowsLoaded: existingPlannedRows.length,
      rowsToInsert: rowsToInsert.length,
      boundaryViolations: boundaryViolations.length,
    },
  };
}

async function insertRows(supabase, rows) {
  if (rows.length === 0) return { inserted: 0 };
  let inserted = 0;
  for (const part of chunk(rows, INSERT_CHUNK_SIZE)) {
    const { error } = await supabase.from('planned_occurrences').insert(part);
    if (error) {
      throw new Error(`planned_occurrences insert failed: ${error.message}`);
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
  const todayDate = toUtcDateString(new Date());
  const startedAt = new Date().toISOString();

  const plan = await buildPlan(supabase, {
    userId: args.userId,
    sampleSize: args.sampleSize,
    todayDate,
  });

  let insertedRows = 0;
  let rerunPlan = null;

  if (args.apply) {
    const result = await insertRows(supabase, plan.rowsToInsert);
    insertedRows = result.inserted;
    rerunPlan = await buildPlan(supabase, {
      userId: args.userId,
      sampleSize: args.sampleSize,
      todayDate,
    });
  }

  const finishedAt = new Date().toISOString();
  const report = {
    mode,
    startedAt,
    finishedAt,
    todayDate,
    userScope: args.userId ?? 'all-users',
    totals: plan.totals,
    counters: plan.counters,
    rowsPrepared: {
      plannedFutureRows: plan.rowsToInsert.length,
    },
    writes: {
      insertedPlannedOccurrences: insertedRows,
    },
    rerunValidation: rerunPlan
      ? {
        rowsPreparedAfterApply: rerunPlan.rowsToInsert.length,
      }
      : null,
    anomalies: plan.anomalies,
  };

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error('[backfill-planned-future-occurrences] failed:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
