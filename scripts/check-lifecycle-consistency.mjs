#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';

const PAGE_SIZE = 1000;
const DEFAULT_SAMPLE_SIZE = 10;
const HANDLED_STATUSES = new Set(['taken', 'skipped', 'snoozed']);
const LIVE_DOSE_STATUSES = new Set(['pending', 'snoozed', 'overdue']);
const TERMINAL_PROTOCOL_STATUSES = new Set(['completed', 'abandoned']);
const VALID_DOSE_ACTIONS = new Set(['taken', 'skipped', 'snoozed']);

function parseArgs(argv) {
  const parsed = {
    userId: null,
    sampleSize: DEFAULT_SAMPLE_SIZE,
    failOnAnomalies: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--user-id') {
      parsed.userId = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (token === '--sample-size') {
      const value = Number(argv[i + 1]);
      if (!Number.isNaN(value) && value > 0) {
        parsed.sampleSize = Math.floor(value);
      }
      i += 1;
      continue;
    }
    if (token === '--fail-on-anomalies') {
      parsed.failOnAnomalies = true;
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
  console.log(`Lifecycle consistency checker (D4)\n\nUsage:\n  node scripts/check-lifecycle-consistency.mjs [--user-id <uuid>] [--sample-size <n>] [--fail-on-anomalies]\n\nBehavior:\n  - Inspection/report only (dry-run always)\n  - No schema writes, no data mutation\n\nOptions:\n  --user-id <uuid>       Limit checks to one user scope\n  --sample-size <n>      Maximum samples per anomaly category (default: ${DEFAULT_SAMPLE_SIZE})\n  --fail-on-anomalies    Exit code 2 when anomaly count > 0\n  --help, -h             Show this message\n\nEnvironment:\n  SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL\n  SUPABASE_SERVICE_ROLE_KEY`);
}

function safeErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
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

function filterByUser(rows, userId) {
  if (!userId) return rows;
  return rows.filter(row => row.user_id === userId || row.owner_id === userId);
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

async function fetchTableSafe(label, fetcher) {
  try {
    const rows = await fetcher();
    return { rows, available: true, error: null };
  } catch (error) {
    return { rows: [], available: false, error: safeErrorMessage(error), table: label };
  }
}

function normalizeTimeText(value) {
  if (!value || typeof value !== 'string') return null;
  return value.slice(0, 5);
}

function timestampToDateTimeParts(value) {
  if (!value || typeof value !== 'string') return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const iso = d.toISOString();
  return {
    date: iso.slice(0, 10),
    time: iso.slice(11, 16),
  };
}

function doseTypeKey(doseId, eventType) {
  return `${doseId}|${eventType}`;
}

function toDateTimeText(dateValue, timeValue) {
  if (!dateValue || !timeValue) return null;
  return `${dateValue}T${String(timeValue).slice(0, 5)}`;
}

function parseSnoozeLineage(note) {
  if (!note || typeof note !== 'string') return null;
  const match = note.match(/^snooze-replacement\|original=([^|]+)\|replacement=([^|]+)\|target=(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})$/);
  if (!match) return null;
  return {
    originalDoseId: match[1],
    replacementDoseId: match[2],
    targetDateTime: match[3],
  };
}

function buildMapById(rows) {
  const out = new Map();
  for (const row of rows) out.set(row.id, row);
  return out;
}

function summarizeAnomalies(anomalies) {
  let total = 0;
  for (const entry of Object.values(anomalies)) {
    total += entry.count;
  }
  return total;
}

function ensureMapArray(map, key) {
  if (!map.has(key)) map.set(key, []);
  return map.get(key);
}

function buildDoseByActive(doses) {
  const map = new Map();
  for (const dose of doses) {
    const arr = ensureMapArray(map, dose.active_protocol_id);
    arr.push(dose);
  }
  return map;
}

function buildPlannedByActive(plannedOccurrences) {
  const map = new Map();
  for (const row of plannedOccurrences) {
    const arr = ensureMapArray(map, row.active_protocol_id);
    arr.push(row);
  }
  return map;
}

function buildDoseByCompositeSlot(doses) {
  const map = new Map();
  for (const dose of doses) {
    const key = `${dose.user_id}|${dose.active_protocol_id}|${dose.protocol_item_id}|${dose.scheduled_date}|${normalizeTimeText(dose.scheduled_time)}`;
    const arr = ensureMapArray(map, key);
    arr.push(dose);
  }
  return map;
}

function isDateGreater(lhs, rhs) {
  return String(lhs) > String(rhs);
}

function isDateTimeGreater(lhsDate, lhsTime, rhsIso) {
  const lhs = new Date(`${lhsDate}T${String(lhsTime).slice(0, 5)}:00Z`);
  const rhs = new Date(rhsIso);
  if (Number.isNaN(lhs.getTime()) || Number.isNaN(rhs.getTime())) return false;
  return lhs.getTime() > rhs.getTime();
}

function detectHandledHistoryConsistency(ctx) {
  const {
    scheduledDoses,
    doseRecords,
    executionEvents,
    anomalies,
    sampleSize,
  } = ctx;

  const recordsByDoseAndAction = new Map();
  for (const record of doseRecords) {
    const key = doseTypeKey(record.scheduled_dose_id, record.action);
    const arr = ensureMapArray(recordsByDoseAndAction, key);
    arr.push(record);
    if (!VALID_DOSE_ACTIONS.has(record.action)) {
      pushAnomaly(
        anomalies,
        'invalid_dose_record_action',
        { recordId: record.id, action: record.action },
        sampleSize,
      );
    }
  }

  const eventsByRecordId = new Map();
  const eventsByDoseAction = new Map();
  for (const event of executionEvents) {
    if (event.legacy_dose_record_id) {
      const arr = ensureMapArray(eventsByRecordId, event.legacy_dose_record_id);
      arr.push(event);
    }
    if (event.legacy_scheduled_dose_id && event.event_type) {
      const key = doseTypeKey(event.legacy_scheduled_dose_id, event.event_type);
      const arr = ensureMapArray(eventsByDoseAction, key);
      arr.push(event);
    }
  }

  for (const dose of scheduledDoses) {
    if (!HANDLED_STATUSES.has(dose.status)) continue;

    const key = doseTypeKey(dose.id, dose.status);
    const matchedRecords = recordsByDoseAndAction.get(key) ?? [];
    if (matchedRecords.length === 0) {
      pushAnomaly(
        anomalies,
        'handled_missing_durable_record',
        {
          scheduledDoseId: dose.id,
          userId: dose.user_id,
          status: dose.status,
          scheduledDate: dose.scheduled_date,
          scheduledTime: normalizeTimeText(dose.scheduled_time),
        },
        sampleSize,
      );
    }

    const matchedEvents = eventsByDoseAction.get(key) ?? [];
    if (matchedEvents.length === 0) {
      pushAnomaly(
        anomalies,
        'handled_missing_execution_bridge',
        {
          scheduledDoseId: dose.id,
          userId: dose.user_id,
          status: dose.status,
          scheduledDate: dose.scheduled_date,
          scheduledTime: normalizeTimeText(dose.scheduled_time),
        },
        sampleSize,
      );
    }
  }

  for (const record of doseRecords) {
    const events = eventsByRecordId.get(record.id) ?? [];
    if (events.length === 0) {
      pushAnomaly(
        anomalies,
        'dose_record_missing_execution_event',
        {
          recordId: record.id,
          userId: record.user_id,
          scheduledDoseId: record.scheduled_dose_id,
          action: record.action,
        },
        sampleSize,
      );
      continue;
    }

    const hasMatchingType = events.some(event => event.event_type === record.action);
    if (!hasMatchingType) {
      pushAnomaly(
        anomalies,
        'dose_record_execution_type_mismatch',
        {
          recordId: record.id,
          action: record.action,
          executionEventTypes: Array.from(new Set(events.map(event => event.event_type))),
        },
        sampleSize,
      );
    }
  }

  return {
    recordsExamined: doseRecords.length,
    handledDosesExamined: scheduledDoses.filter(dose => HANDLED_STATUSES.has(dose.status)).length,
  };
}

function detectDuplicateExecutionHistory(ctx) {
  const { executionEvents, anomalies, sampleSize } = ctx;

  const byRecord = new Map();
  const byDoseType = new Map();
  const byIdempotency = new Map();

  for (const event of executionEvents) {
    if (event.legacy_dose_record_id) {
      const arr = ensureMapArray(byRecord, event.legacy_dose_record_id);
      arr.push(event);
    }
    if (event.legacy_scheduled_dose_id && event.event_type) {
      const key = doseTypeKey(event.legacy_scheduled_dose_id, event.event_type);
      const arr = ensureMapArray(byDoseType, key);
      arr.push(event);
    }
    if (event.idempotency_key) {
      const key = `${event.user_id}|${event.idempotency_key}`;
      const arr = ensureMapArray(byIdempotency, key);
      arr.push(event);
    }
  }

  for (const [legacyDoseRecordId, rows] of byRecord.entries()) {
    if (rows.length <= 1) continue;
    pushAnomaly(
      anomalies,
      'duplicate_execution_event_for_legacy_record',
      { legacyDoseRecordId, executionEventIds: rows.map(row => row.id) },
      sampleSize,
    );
  }

  for (const [key, rows] of byDoseType.entries()) {
    if (rows.length <= 1) continue;
    const [legacyScheduledDoseId, eventType] = key.split('|');
    pushAnomaly(
      anomalies,
      'duplicate_execution_event_for_legacy_dose_type',
      { legacyScheduledDoseId, eventType, executionEventIds: rows.map(row => row.id) },
      sampleSize,
    );
  }

  for (const [key, rows] of byIdempotency.entries()) {
    if (rows.length <= 1) continue;
    const [userId, idempotencyKey] = key.split('|');
    pushAnomaly(
      anomalies,
      'duplicate_execution_event_for_idempotency_key',
      { userId, idempotencyKey, executionEventIds: rows.map(row => row.id) },
      sampleSize,
    );
  }

  return {
    executionEventsExamined: executionEvents.length,
  };
}

function detectSnoozeLineageAnomalies(ctx) {
  const { scheduledDoses, doseRecords, anomalies, sampleSize } = ctx;

  const doseById = buildMapById(scheduledDoses);
  const snoozeRecords = doseRecords.filter(record => record.action === 'snoozed');
  const snoozeByOriginal = new Map();
  const replacementToOriginals = new Map();

  for (const record of snoozeRecords) {
    const lineage = parseSnoozeLineage(record.note);
    if (!lineage) {
      pushAnomaly(
        anomalies,
        'snooze_record_unparseable_lineage',
        { recordId: record.id, scheduledDoseId: record.scheduled_dose_id },
        sampleSize,
      );
      continue;
    }

    if (lineage.originalDoseId !== record.scheduled_dose_id) {
      pushAnomaly(
        anomalies,
        'snooze_lineage_original_mismatch',
        {
          recordId: record.id,
          expectedOriginalDoseId: record.scheduled_dose_id,
          lineageOriginalDoseId: lineage.originalDoseId,
        },
        sampleSize,
      );
    }

    const originalArr = ensureMapArray(snoozeByOriginal, lineage.originalDoseId);
    originalArr.push({ recordId: record.id, ...lineage });

    const replacementArr = ensureMapArray(replacementToOriginals, lineage.replacementDoseId);
    replacementArr.push({ recordId: record.id, originalDoseId: lineage.originalDoseId });

    const replacementDose = doseById.get(lineage.replacementDoseId);
    if (!replacementDose) {
      pushAnomaly(
        anomalies,
        'snooze_replacement_dose_missing',
        {
          recordId: record.id,
          originalDoseId: lineage.originalDoseId,
          replacementDoseId: lineage.replacementDoseId,
          targetDateTime: lineage.targetDateTime,
        },
        sampleSize,
      );
      continue;
    }

    const replacementSlot = toDateTimeText(replacementDose.scheduled_date, replacementDose.scheduled_time);
    if (replacementSlot !== lineage.targetDateTime) {
      pushAnomaly(
        anomalies,
        'snooze_replacement_target_mismatch',
        {
          recordId: record.id,
          replacementDoseId: replacementDose.id,
          lineageTarget: lineage.targetDateTime,
          replacementSlot,
        },
        sampleSize,
      );
    }

    if (replacementDose.user_id !== record.user_id) {
      pushAnomaly(
        anomalies,
        'snooze_replacement_user_mismatch',
        {
          recordId: record.id,
          replacementDoseId: replacementDose.id,
          recordUserId: record.user_id,
          replacementUserId: replacementDose.user_id,
        },
        sampleSize,
      );
    }
  }

  for (const [originalDoseId, lineageRows] of snoozeByOriginal.entries()) {
    const replacementIds = new Set(lineageRows.map(row => row.replacementDoseId));
    if (replacementIds.size > 1) {
      pushAnomaly(
        anomalies,
        'snooze_original_multiple_replacements',
        {
          originalDoseId,
          replacementDoseIds: Array.from(replacementIds),
          snoozeRecordIds: lineageRows.map(row => row.recordId),
        },
        sampleSize,
      );
    }
  }

  for (const [replacementDoseId, refs] of replacementToOriginals.entries()) {
    const originals = Array.from(new Set(refs.map(ref => ref.originalDoseId)));
    if (originals.length > 1) {
      pushAnomaly(
        anomalies,
        'snooze_replacement_linked_to_multiple_originals',
        {
          replacementDoseId,
          originalDoseIds: originals,
          snoozeRecordIds: refs.map(ref => ref.recordId),
        },
        sampleSize,
      );
    }
  }

  const snoozeRecordsByOriginalDoseId = new Map();
  for (const record of snoozeRecords) {
    const arr = ensureMapArray(snoozeRecordsByOriginalDoseId, record.scheduled_dose_id);
    arr.push(record);
  }

  const doseByCompositeSlot = buildDoseByCompositeSlot(scheduledDoses);

  for (const dose of scheduledDoses) {
    if (dose.status !== 'snoozed') continue;

    const sourceRecords = snoozeRecordsByOriginalDoseId.get(dose.id) ?? [];
    if (sourceRecords.length === 0) {
      pushAnomaly(
        anomalies,
        'snoozed_dose_missing_lineage_record',
        {
          scheduledDoseId: dose.id,
          userId: dose.user_id,
          snoozedUntil: dose.snoozed_until,
        },
        sampleSize,
      );
    }

    if (!dose.snoozed_until) {
      pushAnomaly(
        anomalies,
        'snoozed_dose_missing_snoozed_until',
        {
          scheduledDoseId: dose.id,
          userId: dose.user_id,
        },
        sampleSize,
      );
      continue;
    }

    const dt = timestampToDateTimeParts(dose.snoozed_until);
    if (!dt) {
      pushAnomaly(
        anomalies,
        'snoozed_dose_invalid_snoozed_until',
        {
          scheduledDoseId: dose.id,
          userId: dose.user_id,
          snoozedUntil: dose.snoozed_until,
        },
        sampleSize,
      );
      continue;
    }

    const key = `${dose.user_id}|${dose.active_protocol_id}|${dose.protocol_item_id}|${dt.date}|${dt.time}`;
    const candidates = (doseByCompositeSlot.get(key) ?? []).filter(candidate => candidate.id !== dose.id);

    if (candidates.length === 0) {
      pushAnomaly(
        anomalies,
        'snoozed_dose_missing_inferred_replacement',
        {
          scheduledDoseId: dose.id,
          userId: dose.user_id,
          inferredTargetDateTime: `${dt.date}T${dt.time}`,
        },
        sampleSize,
      );
    } else if (candidates.length > 1) {
      pushAnomaly(
        anomalies,
        'snoozed_dose_ambiguous_inferred_replacement',
        {
          scheduledDoseId: dose.id,
          userId: dose.user_id,
          inferredTargetDateTime: `${dt.date}T${dt.time}`,
          candidateReplacementDoseIds: candidates.map(candidate => candidate.id),
        },
        sampleSize,
      );
    }
  }

  return {
    snoozeRecordsExamined: snoozeRecords.length,
    snoozedDosesExamined: scheduledDoses.filter(dose => dose.status === 'snoozed').length,
  };
}

function detectFixedDurationBoundaryAnomalies(ctx) {
  const { activeProtocols, scheduledDoses, plannedOccurrences, plannedOccurrencesAvailable, anomalies, sampleSize } = ctx;

  const dosesByActive = buildDoseByActive(scheduledDoses);
  const plannedByActive = plannedOccurrencesAvailable ? buildPlannedByActive(plannedOccurrences) : new Map();

  for (const active of activeProtocols) {
    if (!active.end_date) continue;

    const doses = dosesByActive.get(active.id) ?? [];
    for (const dose of doses) {
      if (isDateGreater(dose.scheduled_date, active.end_date)) {
        pushAnomaly(
          anomalies,
          'scheduled_dose_beyond_active_end_date',
          {
            activeProtocolId: active.id,
            status: active.status,
            endDate: active.end_date,
            scheduledDoseId: dose.id,
            scheduledDate: dose.scheduled_date,
            scheduledTime: normalizeTimeText(dose.scheduled_time),
          },
          sampleSize,
        );
      }
    }

    if (!plannedOccurrencesAvailable) continue;

    const plannedRows = plannedByActive.get(active.id) ?? [];
    for (const row of plannedRows) {
      if (isDateGreater(row.occurrence_date, active.end_date)) {
        pushAnomaly(
          anomalies,
          'planned_occurrence_beyond_active_end_date',
          {
            activeProtocolId: active.id,
            endDate: active.end_date,
            plannedOccurrenceId: row.id,
            occurrenceDate: row.occurrence_date,
            occurrenceTime: normalizeTimeText(row.occurrence_time),
          },
          sampleSize,
        );
      }
    }
  }

  return {
    activeProtocolsWithEndDate: activeProtocols.filter(active => Boolean(active.end_date)).length,
  };
}

function detectLifecycleStateContradictions(ctx) {
  const {
    activeProtocols,
    scheduledDoses,
    protocols,
    anomalies,
    sampleSize,
  } = ctx;

  const protocolById = buildMapById(protocols);
  const dosesByActive = buildDoseByActive(scheduledDoses);
  const today = new Date().toISOString().slice(0, 10);

  for (const active of activeProtocols) {
    if (active.status === 'completed' && !active.completed_at) {
      pushAnomaly(
        anomalies,
        'completed_protocol_missing_completed_at',
        { activeProtocolId: active.id, userId: active.user_id },
        sampleSize,
      );
    }

    if ((active.status === 'active' || active.status === 'paused') && active.completed_at) {
      pushAnomaly(
        anomalies,
        'non_terminal_protocol_has_completed_at',
        {
          activeProtocolId: active.id,
          status: active.status,
          completedAt: active.completed_at,
        },
        sampleSize,
      );
    }

    if (active.status === 'paused' && !active.paused_at) {
      pushAnomaly(
        anomalies,
        'paused_protocol_missing_paused_at',
        { activeProtocolId: active.id, userId: active.user_id },
        sampleSize,
      );
    }

    if (active.status === 'active' && active.paused_at) {
      pushAnomaly(
        anomalies,
        'active_protocol_has_paused_at',
        {
          activeProtocolId: active.id,
          pausedAt: active.paused_at,
        },
        sampleSize,
      );
    }

    const owningProtocol = protocolById.get(active.protocol_id);
    if (owningProtocol?.is_archived && (active.status === 'active' || active.status === 'paused')) {
      pushAnomaly(
        anomalies,
        'archived_protocol_has_non_terminal_instance',
        {
          protocolId: owningProtocol.id,
          activeProtocolId: active.id,
          status: active.status,
        },
        sampleSize,
      );
    }

    if (!TERMINAL_PROTOCOL_STATUSES.has(active.status)) continue;

    const doses = dosesByActive.get(active.id) ?? [];
    for (const dose of doses) {
      if (!LIVE_DOSE_STATUSES.has(dose.status)) continue;

      if (isDateGreater(dose.scheduled_date, today)) {
        pushAnomaly(
          anomalies,
          'terminal_protocol_has_future_live_dose',
          {
            activeProtocolId: active.id,
            status: active.status,
            scheduledDoseId: dose.id,
            scheduledDate: dose.scheduled_date,
            scheduledTime: normalizeTimeText(dose.scheduled_time),
            doseStatus: dose.status,
          },
          sampleSize,
        );
      }

      if (active.completed_at && isDateTimeGreater(dose.scheduled_date, dose.scheduled_time, active.completed_at)) {
        pushAnomaly(
          anomalies,
          'dose_after_completion_still_live',
          {
            activeProtocolId: active.id,
            completedAt: active.completed_at,
            scheduledDoseId: dose.id,
            scheduledDate: dose.scheduled_date,
            scheduledTime: normalizeTimeText(dose.scheduled_time),
            doseStatus: dose.status,
          },
          sampleSize,
        );
      }
    }
  }

  return {
    activeProtocolsExamined: activeProtocols.length,
  };
}

function detectBridgeIntegrityIssues(ctx) {
  const {
    activeProtocols,
    scheduledDoses,
    doseRecords,
    executionEvents,
    plannedOccurrences,
    plannedOccurrencesAvailable,
    anomalies,
    sampleSize,
  } = ctx;

  const activeById = buildMapById(activeProtocols);
  const doseById = buildMapById(scheduledDoses);
  const recordById = buildMapById(doseRecords);
  const plannedById = buildMapById(plannedOccurrences);

  for (const dose of scheduledDoses) {
    const active = activeById.get(dose.active_protocol_id);
    if (!active) {
      pushAnomaly(
        anomalies,
        'scheduled_dose_missing_active_protocol',
        { scheduledDoseId: dose.id, activeProtocolId: dose.active_protocol_id, userId: dose.user_id },
        sampleSize,
      );
      continue;
    }
    if (active.user_id !== dose.user_id) {
      pushAnomaly(
        anomalies,
        'scheduled_dose_user_mismatch_with_active_protocol',
        {
          scheduledDoseId: dose.id,
          doseUserId: dose.user_id,
          activeProtocolId: active.id,
          activeProtocolUserId: active.user_id,
        },
        sampleSize,
      );
    }
  }

  for (const record of doseRecords) {
    const dose = doseById.get(record.scheduled_dose_id);
    if (!dose) {
      pushAnomaly(
        anomalies,
        'dose_record_missing_scheduled_dose',
        { recordId: record.id, scheduledDoseId: record.scheduled_dose_id, userId: record.user_id },
        sampleSize,
      );
      continue;
    }
    if (dose.user_id !== record.user_id) {
      pushAnomaly(
        anomalies,
        'dose_record_user_mismatch_with_scheduled_dose',
        {
          recordId: record.id,
          recordUserId: record.user_id,
          scheduledDoseId: dose.id,
          scheduledDoseUserId: dose.user_id,
        },
        sampleSize,
      );
    }
  }

  if (plannedOccurrencesAvailable) {
    for (const occurrence of plannedOccurrences) {
      if (!occurrence.legacy_scheduled_dose_id) continue;
      const dose = doseById.get(occurrence.legacy_scheduled_dose_id);
      if (!dose) {
        pushAnomaly(
          anomalies,
          'planned_occurrence_missing_legacy_scheduled_dose',
          { plannedOccurrenceId: occurrence.id, legacyScheduledDoseId: occurrence.legacy_scheduled_dose_id, userId: occurrence.user_id },
          sampleSize,
        );
        continue;
      }

      if (dose.user_id !== occurrence.user_id) {
        pushAnomaly(
          anomalies,
          'planned_occurrence_user_mismatch_with_legacy_dose',
          {
            plannedOccurrenceId: occurrence.id,
            plannedOccurrenceUserId: occurrence.user_id,
            legacyScheduledDoseId: dose.id,
            scheduledDoseUserId: dose.user_id,
          },
          sampleSize,
        );
      }

      if (dose.active_protocol_id !== occurrence.active_protocol_id) {
        pushAnomaly(
          anomalies,
          'planned_occurrence_active_protocol_mismatch_with_legacy_dose',
          {
            plannedOccurrenceId: occurrence.id,
            activeProtocolId: occurrence.active_protocol_id,
            legacyScheduledDoseId: dose.id,
            scheduledDoseActiveProtocolId: dose.active_protocol_id,
          },
          sampleSize,
        );
      }

      if (dose.protocol_item_id !== occurrence.protocol_item_id) {
        pushAnomaly(
          anomalies,
          'planned_occurrence_protocol_item_mismatch_with_legacy_dose',
          {
            plannedOccurrenceId: occurrence.id,
            protocolItemId: occurrence.protocol_item_id,
            legacyScheduledDoseId: dose.id,
            scheduledDoseProtocolItemId: dose.protocol_item_id,
          },
          sampleSize,
        );
      }
    }
  }

  for (const event of executionEvents) {
    const active = activeById.get(event.active_protocol_id);
    if (!active) {
      pushAnomaly(
        anomalies,
        'execution_event_missing_active_protocol',
        { executionEventId: event.id, activeProtocolId: event.active_protocol_id, userId: event.user_id },
        sampleSize,
      );
    } else if (active.user_id !== event.user_id) {
      pushAnomaly(
        anomalies,
        'execution_event_user_mismatch_with_active_protocol',
        {
          executionEventId: event.id,
          eventUserId: event.user_id,
          activeProtocolId: active.id,
          activeProtocolUserId: active.user_id,
        },
        sampleSize,
      );
    }

    let linkedDose = null;
    if (event.legacy_scheduled_dose_id) {
      linkedDose = doseById.get(event.legacy_scheduled_dose_id);
      if (!linkedDose) {
        pushAnomaly(
          anomalies,
          'execution_event_missing_legacy_scheduled_dose',
          {
            executionEventId: event.id,
            legacyScheduledDoseId: event.legacy_scheduled_dose_id,
            userId: event.user_id,
          },
          sampleSize,
        );
      } else {
        if (linkedDose.user_id !== event.user_id) {
          pushAnomaly(
            anomalies,
            'execution_event_user_mismatch_with_legacy_scheduled_dose',
            {
              executionEventId: event.id,
              eventUserId: event.user_id,
              legacyScheduledDoseId: linkedDose.id,
              scheduledDoseUserId: linkedDose.user_id,
            },
            sampleSize,
          );
        }
        if (event.active_protocol_id !== linkedDose.active_protocol_id) {
          pushAnomaly(
            anomalies,
            'execution_event_active_protocol_mismatch_with_legacy_scheduled_dose',
            {
              executionEventId: event.id,
              executionEventActiveProtocolId: event.active_protocol_id,
              legacyScheduledDoseId: linkedDose.id,
              scheduledDoseActiveProtocolId: linkedDose.active_protocol_id,
            },
            sampleSize,
          );
        }
        if (event.protocol_item_id !== linkedDose.protocol_item_id) {
          pushAnomaly(
            anomalies,
            'execution_event_protocol_item_mismatch_with_legacy_scheduled_dose',
            {
              executionEventId: event.id,
              executionEventProtocolItemId: event.protocol_item_id,
              legacyScheduledDoseId: linkedDose.id,
              scheduledDoseProtocolItemId: linkedDose.protocol_item_id,
            },
            sampleSize,
          );
        }
      }
    }

    if (event.legacy_dose_record_id) {
      const linkedRecord = recordById.get(event.legacy_dose_record_id);
      if (!linkedRecord) {
        pushAnomaly(
          anomalies,
          'execution_event_missing_legacy_dose_record',
          {
            executionEventId: event.id,
            legacyDoseRecordId: event.legacy_dose_record_id,
            userId: event.user_id,
          },
          sampleSize,
        );
      } else {
        if (linkedRecord.user_id !== event.user_id) {
          pushAnomaly(
            anomalies,
            'execution_event_user_mismatch_with_legacy_dose_record',
            {
              executionEventId: event.id,
              eventUserId: event.user_id,
              legacyDoseRecordId: linkedRecord.id,
              doseRecordUserId: linkedRecord.user_id,
            },
            sampleSize,
          );
        }
        if (linkedDose && linkedRecord.scheduled_dose_id !== linkedDose.id) {
          pushAnomaly(
            anomalies,
            'execution_event_legacy_record_mismatch_with_legacy_dose',
            {
              executionEventId: event.id,
              legacyDoseRecordId: linkedRecord.id,
              recordScheduledDoseId: linkedRecord.scheduled_dose_id,
              executionLegacyScheduledDoseId: linkedDose.id,
            },
            sampleSize,
          );
        }
      }
    }

    if (plannedOccurrencesAvailable && event.planned_occurrence_id) {
      const planned = plannedById.get(event.planned_occurrence_id);
      if (!planned) {
        pushAnomaly(
          anomalies,
          'execution_event_missing_planned_occurrence',
          {
            executionEventId: event.id,
            plannedOccurrenceId: event.planned_occurrence_id,
            userId: event.user_id,
          },
          sampleSize,
        );
      } else {
        if (planned.user_id !== event.user_id) {
          pushAnomaly(
            anomalies,
            'execution_event_user_mismatch_with_planned_occurrence',
            {
              executionEventId: event.id,
              eventUserId: event.user_id,
              plannedOccurrenceId: planned.id,
              plannedOccurrenceUserId: planned.user_id,
            },
            sampleSize,
          );
        }
        if (planned.active_protocol_id !== event.active_protocol_id) {
          pushAnomaly(
            anomalies,
            'execution_event_active_protocol_mismatch_with_planned_occurrence',
            {
              executionEventId: event.id,
              executionEventActiveProtocolId: event.active_protocol_id,
              plannedOccurrenceId: planned.id,
              plannedOccurrenceActiveProtocolId: planned.active_protocol_id,
            },
            sampleSize,
          );
        }
        if (planned.protocol_item_id !== event.protocol_item_id) {
          pushAnomaly(
            anomalies,
            'execution_event_protocol_item_mismatch_with_planned_occurrence',
            {
              executionEventId: event.id,
              executionEventProtocolItemId: event.protocol_item_id,
              plannedOccurrenceId: planned.id,
              plannedOccurrenceProtocolItemId: planned.protocol_item_id,
            },
            sampleSize,
          );
        }
      }
    }
  }

  return {
    activeProtocolsExamined: activeProtocols.length,
    scheduledDosesExamined: scheduledDoses.length,
    doseRecordsExamined: doseRecords.length,
    executionEventsExamined: executionEvents.length,
    plannedOccurrencesExamined: plannedOccurrences.length,
  };
}

async function collectData(supabase, userId) {
  const scheduledDosesResult = await fetchTableSafe(
    'scheduled_doses',
    () => fetchAll(
      () => supabase
        .from('scheduled_doses')
        .select('id,user_id,active_protocol_id,protocol_item_id,scheduled_date,scheduled_time,status,snoozed_until,created_at')
        .order('id', { ascending: true }),
      'scheduled_doses',
    ),
  );

  const doseRecordsResult = await fetchTableSafe(
    'dose_records',
    () => fetchAll(
      () => supabase
        .from('dose_records')
        .select('id,user_id,scheduled_dose_id,action,recorded_at,note')
        .order('id', { ascending: true }),
      'dose_records',
    ),
  );

  const executionEventsResult = await fetchTableSafe(
    'execution_events',
    () => fetchAll(
      () => supabase
        .from('execution_events')
        .select('id,user_id,planned_occurrence_id,legacy_scheduled_dose_id,legacy_dose_record_id,active_protocol_id,protocol_item_id,event_type,event_at,effective_date,effective_time,source,idempotency_key')
        .order('id', { ascending: true }),
      'execution_events',
    ),
  );

  const plannedOccurrencesResult = await fetchTableSafe(
    'planned_occurrences',
    () => fetchAll(
      () => supabase
        .from('planned_occurrences')
        .select('id,user_id,active_protocol_id,protocol_id,protocol_item_id,occurrence_date,occurrence_time,occurrence_key,revision,status,supersedes_occurrence_id,superseded_by_occurrence_id,legacy_scheduled_dose_id')
        .order('id', { ascending: true }),
      'planned_occurrences',
    ),
  );

  const activeProtocolsResult = await fetchTableSafe(
    'active_protocols',
    () => fetchAll(
      () => supabase
        .from('active_protocols')
        .select('id,user_id,protocol_id,status,start_date,end_date,paused_at,completed_at,created_at')
        .order('id', { ascending: true }),
      'active_protocols',
    ),
  );

  const protocolsResult = await fetchTableSafe(
    'protocols',
    () => fetchAll(
      () => supabase
        .from('protocols')
        .select('id,owner_id,is_archived')
        .order('id', { ascending: true }),
      'protocols',
    ),
  );

  const tableAvailability = {
    scheduled_doses: scheduledDosesResult.available,
    dose_records: doseRecordsResult.available,
    execution_events: executionEventsResult.available,
    planned_occurrences: plannedOccurrencesResult.available,
    active_protocols: activeProtocolsResult.available,
    protocols: protocolsResult.available,
  };

  const tableErrors = [
    scheduledDosesResult,
    doseRecordsResult,
    executionEventsResult,
    plannedOccurrencesResult,
    activeProtocolsResult,
    protocolsResult,
  ]
    .filter(result => !result.available)
    .map(result => ({ table: result.table, error: result.error }));

  return {
    tableAvailability,
    tableErrors,
    scheduledDoses: filterByUser(scheduledDosesResult.rows, userId),
    doseRecords: filterByUser(doseRecordsResult.rows, userId),
    executionEvents: filterByUser(executionEventsResult.rows, userId),
    plannedOccurrences: filterByUser(plannedOccurrencesResult.rows, userId),
    activeProtocols: filterByUser(activeProtocolsResult.rows, userId),
    protocols: filterByUser(protocolsResult.rows, userId),
  };
}

function runChecks(data, sampleSize) {
  const anomalies = {};

  const ctx = {
    ...data,
    anomalies,
    sampleSize,
    plannedOccurrencesAvailable: data.tableAvailability.planned_occurrences,
  };

  const checkSummaries = {
    handledHistoryConsistency: detectHandledHistoryConsistency(ctx),
    duplicateExecutionHistory: detectDuplicateExecutionHistory(ctx),
    snoozeLineage: detectSnoozeLineageAnomalies(ctx),
    fixedDurationBoundaries: detectFixedDurationBoundaryAnomalies(ctx),
    lifecycleStateContradictions: detectLifecycleStateContradictions(ctx),
    bridgeIntegrity: detectBridgeIntegrityIssues(ctx),
  };

  const anomalyCount = summarizeAnomalies(anomalies);

  return {
    anomalyCount,
    anomalyCategories: Object.keys(anomalies).sort(),
    anomalies,
    checkSummaries,
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
  const data = await collectData(supabase, args.userId);
  const check = runChecks(data, args.sampleSize);
  const finishedAt = new Date().toISOString();

  const report = {
    tool: 'D4 lifecycle consistency checker',
    mode: 'dry-run',
    startedAt,
    finishedAt,
    userScope: args.userId ?? 'all-users',
    options: {
      sampleSize: args.sampleSize,
      failOnAnomalies: args.failOnAnomalies,
    },
    tableAvailability: data.tableAvailability,
    tableErrors: data.tableErrors,
    totals: {
      scheduledDoses: data.scheduledDoses.length,
      doseRecords: data.doseRecords.length,
      executionEvents: data.executionEvents.length,
      plannedOccurrences: data.plannedOccurrences.length,
      activeProtocols: data.activeProtocols.length,
      protocols: data.protocols.length,
    },
    checks: check.checkSummaries,
    anomalySummary: {
      total: check.anomalyCount,
      categoryCount: check.anomalyCategories.length,
      categories: check.anomalyCategories,
    },
    anomalies: check.anomalies,
  };

  console.log(JSON.stringify(report, null, 2));

  if (args.failOnAnomalies && check.anomalyCount > 0) {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error('[check-lifecycle-consistency] failed:', safeErrorMessage(error));
  process.exitCode = 1;
});
