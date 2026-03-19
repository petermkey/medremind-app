#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';

const PAGE_SIZE = 1000;
const VALID_ACTIONS = new Set(['taken', 'skipped', 'snoozed']);
const HANDLED_STATUSES = new Set(['taken', 'skipped', 'snoozed']);
const COMMAND_SOURCES = new Set(['take_command', 'skip_command', 'snooze_command']);
const BACKFILL_SOURCES = new Set(['legacy_dose_record_backfill', 'legacy_status_inference_backfill']);

function parseArgs(argv) {
  const parsed = {
    userId: null,
    sampleSize: 10,
    strict: false,
    mode: 'dry-run',
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--help' || token === '-h') {
      parsed.help = true;
      continue;
    }
    if (token === '--dry-run') {
      parsed.mode = 'dry-run';
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
    if (token === '--strict') {
      parsed.strict = true;
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  return parsed;
}

function printHelp() {
  console.log(`Lifecycle parity validator (C5)\n\nUsage:\n  node scripts/validate-lifecycle-parity.mjs [--dry-run] [--user-id <uuid>] [--sample-size <n>] [--strict]\n\nModes:\n  --dry-run   default; read-only inspection/reporting\n\nOptions:\n  --user-id <uuid>   scope validation to a single user\n  --sample-size <n>  anomaly sample cap per category (default: 10)\n  --strict           exits non-zero when parity misses/anomalies are detected\n\nEnvironment:\n  SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL\n  SUPABASE_SERVICE_ROLE_KEY`);
}

function toDateString(value) {
  const y = value.getUTCFullYear();
  const m = String(value.getUTCMonth() + 1).padStart(2, '0');
  const d = String(value.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function toTimeString(value) {
  const h = String(value.getUTCHours()).padStart(2, '0');
  const m = String(value.getUTCMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

function snoozeIsoToDateTime(iso) {
  if (!iso) return null;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  return {
    scheduledDate: toDateString(parsed),
    scheduledTime: toTimeString(parsed),
  };
}

function pushAnomaly(anomalies, kind, details, sampleSize) {
  if (!anomalies[kind]) anomalies[kind] = { count: 0, samples: [] };
  anomalies[kind].count += 1;
  if (anomalies[kind].samples.length < sampleSize) {
    anomalies[kind].samples.push(details);
  }
}

function keyDoseType(doseId, type) {
  return `${doseId}|${type}`;
}

function keyDoseSlot(activeProtocolId, protocolItemId, scheduledDate, scheduledTime) {
  return `${activeProtocolId}|${protocolItemId}|${scheduledDate}|${String(scheduledTime).slice(0, 5)}`;
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
    if (error) throw new Error(`${label} fetch failed: ${error.message}`);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

function anomalyTotal(anomalies) {
  return Object.values(anomalies).reduce((sum, item) => sum + item.count, 0);
}

async function buildReport(supabase, userId, sampleSize) {
  const anomalies = {};

  const [
    doseRecords,
    scheduledDoses,
    executionEvents,
  ] = await Promise.all([
    fetchAll(
      () => buildScopedQuery(
        () => supabase
          .from('dose_records')
          .select('id,user_id,scheduled_dose_id,action,recorded_at,note')
          .order('id', { ascending: true }),
        userId,
      ),
      'dose_records',
    ),
    fetchAll(
      () => buildScopedQuery(
        () => supabase
          .from('scheduled_doses')
          .select('id,user_id,active_protocol_id,protocol_item_id,scheduled_date,scheduled_time,status,snoozed_until,created_at')
          .order('id', { ascending: true }),
        userId,
      ),
      'scheduled_doses',
    ),
    fetchAll(
      () => buildScopedQuery(
        () => supabase
          .from('execution_events')
          .select('id,user_id,legacy_scheduled_dose_id,legacy_dose_record_id,active_protocol_id,protocol_item_id,event_type,effective_date,effective_time,source,idempotency_key')
          .order('id', { ascending: true }),
        userId,
      ),
      'execution_events',
    ),
  ]);

  const doseById = new Map();
  const doseSlotMap = new Map();
  for (const dose of scheduledDoses) {
    doseById.set(dose.id, dose);
    doseSlotMap.set(
      keyDoseSlot(dose.active_protocol_id, dose.protocol_item_id, dose.scheduled_date, dose.scheduled_time),
      dose,
    );
  }

  const recordById = new Map();
  for (const record of doseRecords) recordById.set(record.id, record);

  const eventsByLegacyRecordId = new Map();
  const eventsByDoseType = new Map();
  const sourceCounts = {};
  const idempotencyCounts = new Map();

  for (const event of executionEvents) {
    sourceCounts[event.source ?? 'null'] = (sourceCounts[event.source ?? 'null'] ?? 0) + 1;

    if (event.idempotency_key) {
      const k = `${event.user_id}|${event.idempotency_key}`;
      idempotencyCounts.set(k, (idempotencyCounts.get(k) ?? 0) + 1);
    }

    if (event.legacy_dose_record_id) {
      const list = eventsByLegacyRecordId.get(event.legacy_dose_record_id) ?? [];
      list.push(event);
      eventsByLegacyRecordId.set(event.legacy_dose_record_id, list);
    }

    if (event.legacy_scheduled_dose_id && event.event_type) {
      const key = keyDoseType(event.legacy_scheduled_dose_id, event.event_type);
      const list = eventsByDoseType.get(key) ?? [];
      list.push(event);
      eventsByDoseType.set(key, list);
    }
  }

  const totals = {
    doseRecords: doseRecords.length,
    scheduledDoses: scheduledDoses.length,
    executionEvents: executionEvents.length,
  };

  const parity = {
    handledDoseRecordsTotal: 0,
    handledDoseRecordsRepresented: 0,
    handledDoseRecordsMissing: 0,
    handledScheduledDosesTotal: 0,
    handledScheduledDosesRepresented: 0,
    handledScheduledDosesMissing: 0,
  };

  for (const [idKey, count] of idempotencyCounts.entries()) {
    if (count > 1) {
      const [eventUserId, idempotencyKey] = idKey.split('|');
      pushAnomaly(anomalies, 'duplicate_idempotency_key', { userId: eventUserId, idempotencyKey, count }, sampleSize);
    }
  }

  for (const event of executionEvents) {
    if (event.legacy_dose_record_id) {
      const record = recordById.get(event.legacy_dose_record_id);
      if (!record) {
        pushAnomaly(
          anomalies,
          'event_bridge_missing_dose_record',
          { eventId: event.id, legacyDoseRecordId: event.legacy_dose_record_id },
          sampleSize,
        );
      } else {
        if (record.user_id !== event.user_id) {
          pushAnomaly(
            anomalies,
            'event_record_user_mismatch',
            { eventId: event.id, recordId: record.id, eventUserId: event.user_id, recordUserId: record.user_id },
            sampleSize,
          );
        }
        if (event.event_type !== record.action) {
          pushAnomaly(
            anomalies,
            'event_record_action_mismatch',
            { eventId: event.id, recordId: record.id, eventType: event.event_type, recordAction: record.action },
            sampleSize,
          );
        }
        if (event.legacy_scheduled_dose_id && event.legacy_scheduled_dose_id !== record.scheduled_dose_id) {
          pushAnomaly(
            anomalies,
            'event_record_scheduled_dose_mismatch',
            {
              eventId: event.id,
              recordId: record.id,
              eventLegacyScheduledDoseId: event.legacy_scheduled_dose_id,
              recordScheduledDoseId: record.scheduled_dose_id,
            },
            sampleSize,
          );
        }
      }
    }

    if (event.legacy_scheduled_dose_id) {
      const dose = doseById.get(event.legacy_scheduled_dose_id);
      if (!dose) {
        pushAnomaly(
          anomalies,
          'event_bridge_missing_scheduled_dose',
          { eventId: event.id, legacyScheduledDoseId: event.legacy_scheduled_dose_id },
          sampleSize,
        );
      } else {
        if (dose.user_id !== event.user_id) {
          pushAnomaly(
            anomalies,
            'event_dose_user_mismatch',
            { eventId: event.id, doseId: dose.id, eventUserId: event.user_id, doseUserId: dose.user_id },
            sampleSize,
          );
        }
        if (event.active_protocol_id && dose.active_protocol_id && event.active_protocol_id !== dose.active_protocol_id) {
          pushAnomaly(
            anomalies,
            'event_dose_active_protocol_mismatch',
            {
              eventId: event.id,
              doseId: dose.id,
              eventActiveProtocolId: event.active_protocol_id,
              doseActiveProtocolId: dose.active_protocol_id,
            },
            sampleSize,
          );
        }
        if (event.protocol_item_id && dose.protocol_item_id && event.protocol_item_id !== dose.protocol_item_id) {
          pushAnomaly(
            anomalies,
            'event_dose_protocol_item_mismatch',
            {
              eventId: event.id,
              doseId: dose.id,
              eventProtocolItemId: event.protocol_item_id,
              doseProtocolItemId: dose.protocol_item_id,
            },
            sampleSize,
          );
        }
      }
    }
  }

  for (const record of doseRecords) {
    if (!VALID_ACTIONS.has(record.action)) continue;
    parity.handledDoseRecordsTotal += 1;

    const events = eventsByLegacyRecordId.get(record.id) ?? [];
    if (events.length === 0) {
      parity.handledDoseRecordsMissing += 1;
      pushAnomaly(
        anomalies,
        'missing_execution_event_for_dose_record',
        { recordId: record.id, scheduledDoseId: record.scheduled_dose_id, action: record.action },
        sampleSize,
      );
      continue;
    }

    parity.handledDoseRecordsRepresented += 1;
    if (events.length > 1) {
      pushAnomaly(
        anomalies,
        'duplicate_execution_events_for_dose_record',
        { recordId: record.id, eventIds: events.map(event => event.id), count: events.length },
        sampleSize,
      );
    }
  }

  for (const dose of scheduledDoses) {
    if (!HANDLED_STATUSES.has(dose.status)) continue;

    parity.handledScheduledDosesTotal += 1;
    const key = keyDoseType(dose.id, dose.status);
    const events = eventsByDoseType.get(key) ?? [];

    if (events.length === 0) {
      parity.handledScheduledDosesMissing += 1;
      pushAnomaly(
        anomalies,
        'missing_execution_event_for_handled_scheduled_dose',
        { scheduledDoseId: dose.id, status: dose.status },
        sampleSize,
      );
      continue;
    }

    parity.handledScheduledDosesRepresented += 1;
    if (events.length > 1) {
      pushAnomaly(
        anomalies,
        'duplicate_execution_events_for_scheduled_dose_type',
        { scheduledDoseId: dose.id, eventType: dose.status, eventIds: events.map(event => event.id), count: events.length },
        sampleSize,
      );
    }

    if (dose.status === 'snoozed') {
      const mapped = snoozeIsoToDateTime(dose.snoozed_until);
      if (!mapped) {
        pushAnomaly(
          anomalies,
          'snooze_row_missing_or_invalid_snoozed_until',
          { scheduledDoseId: dose.id, snoozedUntil: dose.snoozed_until },
          sampleSize,
        );
      } else {
        const replacement = doseSlotMap.get(
          keyDoseSlot(dose.active_protocol_id, dose.protocol_item_id, mapped.scheduledDate, mapped.scheduledTime),
        );
        if (!replacement) {
          pushAnomaly(
            anomalies,
            'missing_snooze_replacement_row',
            {
              scheduledDoseId: dose.id,
              expectedDate: mapped.scheduledDate,
              expectedTime: mapped.scheduledTime,
            },
            sampleSize,
          );
        } else if (replacement.status !== 'pending') {
          pushAnomaly(
            anomalies,
            'snooze_replacement_not_pending',
            { scheduledDoseId: dose.id, replacementDoseId: replacement.id, replacementStatus: replacement.status },
            sampleSize,
          );
        }
      }
    }
  }

  const sourceSummary = {
    command: {
      total: 0,
      bySource: {},
    },
    backfill: {
      total: 0,
      bySource: {},
    },
    other: {
      total: 0,
      bySource: {},
    },
  };

  for (const [source, count] of Object.entries(sourceCounts)) {
    if (COMMAND_SOURCES.has(source)) {
      sourceSummary.command.bySource[source] = count;
      sourceSummary.command.total += count;
    } else if (BACKFILL_SOURCES.has(source)) {
      sourceSummary.backfill.bySource[source] = count;
      sourceSummary.backfill.total += count;
    } else {
      sourceSummary.other.bySource[source] = count;
      sourceSummary.other.total += count;
    }
  }

  const summary = {
    missingParityTotal:
      parity.handledDoseRecordsMissing
      + parity.handledScheduledDosesMissing,
    anomaliesTotal: anomalyTotal(anomalies),
  };

  return {
    mode: 'dry-run',
    userScope: userId ?? 'all-users',
    totals,
    parity,
    sourceSummary,
    summary,
    anomalies,
  };
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
    throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY.');
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const startedAt = new Date().toISOString();
  const report = await buildReport(supabase, args.userId, args.sampleSize);
  const finishedAt = new Date().toISOString();

  console.log(
    JSON.stringify(
      {
        ...report,
        startedAt,
        finishedAt,
      },
      null,
      2,
    ),
  );

  if (args.strict && (report.summary.missingParityTotal > 0 || report.summary.anomaliesTotal > 0)) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('[validate-lifecycle-parity] failed:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
