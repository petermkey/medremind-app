'use client';

import type {
  ActiveProtocol,
  DoseRecord,
  Protocol,
  ScheduledDose,
} from '@/types';
import { getSupabaseClient } from './client';

function isUuid(value: string | undefined | null): value is string {
  if (!value) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function hash32(input: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function stableUuid(namespace: string, source: string): string {
  const input = `${namespace}:${source}`;
  const p1 = hash32(input, 0x811c9dc5).toString(16).padStart(8, '0');
  const p2 = hash32(input, 0x9e3779b9).toString(16).padStart(8, '0');
  const p3 = hash32(input, 0x85ebca6b).toString(16).padStart(8, '0');
  const p4 = hash32(input, 0xc2b2ae35).toString(16).padStart(8, '0');
  const hex = `${p1}${p2}${p3}${p4}`;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function cloudProtocolId(userId: string, protocolId: string): string {
  return isUuid(protocolId) ? protocolId : stableUuid(`protocol:${userId}`, protocolId);
}

function cloudProtocolItemId(userId: string, protocolId: string, itemId: string): string {
  if (isUuid(itemId)) return itemId;
  return stableUuid(`protocol-item:${cloudProtocolId(userId, protocolId)}`, itemId);
}

function cloudActiveId(userId: string, activeId: string): string {
  return isUuid(activeId) ? activeId : stableUuid(`active:${userId}`, activeId);
}

function cloudDoseId(userId: string, doseId: string): string {
  return isUuid(doseId) ? doseId : stableUuid(`dose:${userId}`, doseId);
}

function cloudRecordId(userId: string, recordId: string): string {
  return isUuid(recordId) ? recordId : stableUuid(`record:${userId}`, recordId);
}

function cloudOperationId(userId: string, operationId: string): string {
  return isUuid(operationId) ? operationId : stableUuid(`sync-operation:${userId}`, operationId);
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function toDateString(value: Date): string {
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, '0');
  const d = String(value.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function toTimeString(value: Date): string {
  const h = String(value.getHours()).padStart(2, '0');
  const m = String(value.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

function isUniqueViolation(error: { code?: string; message?: string } | null, constraintName: string): boolean {
  if (!error) return false;
  if (error.code === '23505') return true;
  return Boolean(error.message?.includes(constraintName));
}

async function upsertProtocolWithItems(userId: string, protocol: Protocol) {
  const supabase = getSupabaseClient();
  const cProtocolId = cloudProtocolId(userId, protocol.id);
  const protocolRow = {
    id: cProtocolId,
    owner_id: userId,
    name: protocol.name,
    description: protocol.description ?? null,
    category: protocol.category ?? 'custom',
    duration_days: protocol.durationDays ?? null,
    is_template: Boolean(protocol.isTemplate),
    is_archived: Boolean(protocol.isArchived),
    created_at: protocol.createdAt ?? new Date().toISOString(),
  };

  const { error: pErr } = await supabase.from('protocols').upsert(protocolRow, { onConflict: 'id' });
  if (pErr) throw new Error(`Protocol sync failed: ${pErr.message}`);

  const itemRows = protocol.items.map(item => ({
    id: cloudProtocolItemId(userId, protocol.id, item.id),
    protocol_id: cProtocolId,
    item_type: item.itemType,
    name: item.name,
    drug_id: item.drugId && isUuid(item.drugId) ? item.drugId : null,
    analysis_id: null,
    dose_amount: item.doseAmount ?? null,
    dose_unit: item.doseUnit ?? null,
    dose_form: item.doseForm ?? null,
    route: item.route ?? null,
    frequency_type: item.frequencyType,
    frequency_value: item.frequencyValue ?? null,
    times: item.times ?? [],
    with_food: item.withFood ?? null,
    instructions: item.instructions ?? null,
    start_day: item.startDay ?? 1,
    end_day: item.endDay ?? null,
    sort_order: item.sortOrder ?? 0,
    icon: item.icon ?? null,
    color: item.color ?? null,
  }));

  for (const part of chunk(itemRows, 250)) {
    const { error } = await supabase.from('protocol_items').upsert(part, { onConflict: 'id' });
    if (error) throw new Error(`Protocol items sync failed: ${error.message}`);
  }
}

export async function syncProtocolUpsert(userId: string, protocol: Protocol) {
  await upsertProtocolWithItems(userId, protocol);
}

export async function syncProtocolItemDelete(userId: string, protocolId: string, itemId: string) {
  const supabase = getSupabaseClient();
  const id = cloudProtocolItemId(userId, protocolId, itemId);
  // Cascade on protocol_items → planned_occurrences handles occurrence cleanup.
  const { error } = await supabase.from('protocol_items').delete().eq('id', id);
  if (error) throw new Error(`Delete protocol item failed: ${error.message}`);
}

export async function syncProtocolDelete(userId: string, protocolId: string) {
  const supabase = getSupabaseClient();
  const cProtocolId = cloudProtocolId(userId, protocolId);

  const { data: activeRows, error: activeErr } = await supabase
    .from('active_protocols')
    .select('id')
    .eq('user_id', userId)
    .eq('protocol_id', cProtocolId);
  if (activeErr) throw new Error(`Load active protocols for delete failed: ${activeErr.message}`);

  const activeIds = ((activeRows ?? []) as Array<{ id: string }>).map(row => row.id);
  if (activeIds.length) {
    // Delete active_protocols — cascade handles planned_occurrences.
    for (const ids of chunk(activeIds, 250)) {
      const { error: aErr } = await supabase
        .from('active_protocols')
        .delete()
        .eq('user_id', userId)
        .in('id', ids);
      if (aErr) throw new Error(`Delete active protocols failed: ${aErr.message}`);
    }
  }

  const { error: pErr } = await supabase
    .from('protocols')
    .delete()
    .eq('owner_id', userId)
    .eq('id', cProtocolId);
  if (pErr) throw new Error(`Delete protocol failed: ${pErr.message}`);
}

export async function syncActivation(
  userId: string,
  active: ActiveProtocol,
  doses: ScheduledDose[],
) {
  const supabase = getSupabaseClient();
  await upsertProtocolWithItems(userId, active.protocol);

  const cActiveId = cloudActiveId(userId, active.id);
  const cProtocolId = cloudProtocolId(userId, active.protocolId);

  const activeRow = {
    id: cActiveId,
    user_id: userId,
    protocol_id: cProtocolId,
    status: active.status,
    start_date: active.startDate,
    end_date: active.endDate ?? null,
    paused_at: active.pausedAt ?? null,
    completed_at: active.completedAt ?? null,
    notes: active.notes ?? null,
    created_at: active.createdAt ?? new Date().toISOString(),
  };

  const { error: aErr } = await supabase.from('active_protocols').upsert(activeRow, { onConflict: 'id' });
  if (aErr) throw new Error(`Activate protocol sync failed: ${aErr.message}`);

  const todayDate = toDateString(new Date());
  const plannedRows = doses
    .filter(d => d.scheduledDate >= todayDate)
    .map(d => {
      const cItemId = cloudProtocolItemId(userId, active.protocolId, d.protocolItemId);
      const occurrenceKey = `${cActiveId}|${cItemId}|${d.scheduledDate}|${d.scheduledTime.slice(0, 5)}`;
      return {
        id: stableUuid(`planned-occurrence:${userId}`, occurrenceKey),
        user_id: userId,
        active_protocol_id: cActiveId,
        protocol_id: cProtocolId,
        protocol_item_id: cItemId,
        occurrence_date: d.scheduledDate,
        occurrence_time: d.scheduledTime,
        occurrence_key: occurrenceKey,
        revision: 1,
        status: 'planned',
        source_generation: 'activation_write_through',
      };
    });

  for (const part of chunk(plannedRows, 250)) {
    const { error } = await supabase
      .from('planned_occurrences')
      .upsert(part, { onConflict: 'user_id,occurrence_key,revision' });
    if (error) throw new Error(`Planned occurrences write-through failed: ${error.message}`);
  }
}

export async function syncActiveStatus(
  userId: string,
  activeId: string,
  patch: { status: ActiveProtocol['status']; pausedAt?: string; completedAt?: string },
) {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('active_protocols')
    .update({
      status: patch.status,
      paused_at: patch.pausedAt ?? null,
      completed_at: patch.completedAt ?? null,
    })
    .eq('id', cloudActiveId(userId, activeId))
    .eq('user_id', userId);
  if (error) throw new Error(`Active status sync failed: ${error.message}`);
}

export async function syncRegeneratedDoses(
  userId: string,
  active: ActiveProtocol,
  fromDate: string,
  newDoses: ScheduledDose[],
) {
  const supabase = getSupabaseClient();
  const cActiveId = cloudActiveId(userId, active.id);
  const cProtocolId = cloudProtocolId(userId, active.protocolId);

  const { data: existingRows, error: existingErr } = await supabase
    .from('planned_occurrences')
    .select('id, protocol_item_id, occurrence_date, occurrence_time, status, supersedes_occurrence_id, execution_events(id)')
    .eq('user_id', userId)
    .eq('active_protocol_id', cActiveId)
    .gte('occurrence_date', fromDate)
    .is('superseded_by_occurrence_id', null);
  if (existingErr) throw new Error(`Load existing regenerated occurrences failed: ${existingErr.message}`);

  const existing = (existingRows ?? []) as Array<{
    id: string;
    protocol_item_id: string;
    occurrence_date: string;
    occurrence_time: string;
    status: string;
    supersedes_occurrence_id: string | null;
    execution_events: Array<{ id: string }> | null;
  }>;

  const retainedSlots = new Set<string>();
  const deletableOccurrenceIds: string[] = [];

  for (const row of existing) {
    const hasEvent = (row.execution_events ?? []).length > 0;
    const isSnoozeSuccessor = Boolean(row.supersedes_occurrence_id);
    const slot = `${row.protocol_item_id}|${row.occurrence_date}|${String(row.occurrence_time).slice(0, 5)}`;
    const shouldDelete = row.status === 'planned' && !hasEvent && !isSnoozeSuccessor;
    if (shouldDelete) {
      deletableOccurrenceIds.push(row.id);
      continue;
    }
    retainedSlots.add(slot);
  }

  for (const ids of chunk(deletableOccurrenceIds, 250)) {
    const { error: delErr } = await supabase
      .from('planned_occurrences')
      .delete()
      .eq('user_id', userId)
      .eq('status', 'planned')
      .in('id', ids);
    if (delErr) throw new Error(`Delete regenerated V2 occurrences failed: ${delErr.message}`);
  }

  const plannedRows = newDoses
    .map(d => {
      const cItemId = cloudProtocolItemId(userId, active.protocolId, d.protocolItemId);
      const occurrenceKey = `${cActiveId}|${cItemId}|${d.scheduledDate}|${d.scheduledTime.slice(0, 5)}`;
      const slot = `${cItemId}|${d.scheduledDate}|${d.scheduledTime.slice(0, 5)}`;
      if (retainedSlots.has(slot)) return null;
      return {
        id: stableUuid(`planned-occurrence:${userId}`, occurrenceKey),
        user_id: userId,
        active_protocol_id: cActiveId,
        protocol_id: cProtocolId,
        protocol_item_id: cItemId,
        occurrence_date: d.scheduledDate,
        occurrence_time: d.scheduledTime,
        occurrence_key: occurrenceKey,
        revision: 1,
        status: 'planned',
        source_generation: 'regeneration_write_through',
      };
    })
    .filter(Boolean) as Record<string, unknown>[];

  for (const part of chunk(plannedRows, 250)) {
    const { error: v2UpsertErr } = await supabase
      .from('planned_occurrences')
      .upsert(part, { onConflict: 'user_id,occurrence_key,revision' });
    if (v2UpsertErr) throw new Error(`Upsert regenerated V2 occurrences failed: ${v2UpsertErr.message}`);
  }
}

type TakeCommandResult = {
  clientOperationId: string;
  status: ScheduledDose['status'];
  scheduledDate: string;
  scheduledTime: string;
  recordId: string | null;
};

type ActiveCommandResult = {
  clientOperationId: string;
  status: ActiveProtocol['status'];
  pausedAt: string | null;
};

async function upsertActiveSyncOperationLedger(
  userId: string,
  activeId: string,
  clientOperationId: string,
  payload: Record<string, unknown>,
  operationKind: 'pause_command' | 'resume_command' | 'complete_command',
) {
  const supabase = getSupabaseClient();
  const row = {
    id: cloudOperationId(userId, clientOperationId),
    user_id: userId,
    operation_kind: operationKind,
    entity_type: 'active_protocol',
    entity_id: cloudActiveId(userId, activeId),
    idempotency_key: clientOperationId,
    payload,
    status: 'inflight',
    attempt_count: 1,
    source: 'client',
    next_attempt_at: null,
    last_error: null,
    completed_at: null,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase.from('sync_operations').upsert(row, {
    onConflict: 'user_id,idempotency_key',
  });
  if (error) {
    console.warn('[sync-operations-ledger]', error.message);
  }
}

async function upsertProtocolSyncOperationLedger(
  userId: string,
  protocolId: string,
  clientOperationId: string,
  payload: Record<string, unknown>,
  operationKind: 'archive_command',
) {
  const supabase = getSupabaseClient();
  const row = {
    id: cloudOperationId(userId, clientOperationId),
    user_id: userId,
    operation_kind: operationKind,
    entity_type: 'protocol',
    entity_id: cloudProtocolId(userId, protocolId),
    idempotency_key: clientOperationId,
    payload,
    status: 'inflight',
    attempt_count: 1,
    source: 'client',
    next_attempt_at: null,
    last_error: null,
    completed_at: null,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase.from('sync_operations').upsert(row, {
    onConflict: 'user_id,idempotency_key',
  });
  if (error) {
    console.warn('[sync-operations-ledger]', error.message);
  }
}

async function updateActiveSyncOperationLedger(
  userId: string,
  clientOperationId: string,
  status: 'succeeded' | 'failed',
  lastError?: string,
) {
  const supabase = getSupabaseClient();
  const patch = {
    status,
    last_error: lastError ?? null,
    completed_at: status === 'succeeded' ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
    next_attempt_at: null,
  };
  const { error } = await supabase
    .from('sync_operations')
    .update(patch)
    .eq('user_id', userId)
    .eq('idempotency_key', clientOperationId);
  if (error) {
    console.warn('[sync-operations-ledger]', error.message);
  }
}

async function upsertDoseSyncOperationLedger(
  userId: string,
  clientOperationId: string,
  dose: ScheduledDose,
  payload: Record<string, unknown>,
  operationKind: 'take_command' | 'skip_command' | 'snooze_command',
) {
  const supabase = getSupabaseClient();
  const row = {
    id: cloudOperationId(userId, clientOperationId),
    user_id: userId,
    operation_kind: operationKind,
    entity_type: 'scheduled_dose',
    entity_id: cloudDoseId(userId, dose.id),
    idempotency_key: clientOperationId,
    payload,
    status: 'inflight',
    attempt_count: 1,
    source: 'client',
    next_attempt_at: null,
    last_error: null,
    completed_at: null,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase.from('sync_operations').upsert(row, {
    onConflict: 'user_id,idempotency_key',
  });
  if (error) {
    console.warn('[sync-operations-ledger]', error.message);
  }
}

async function updateDoseSyncOperationLedger(
  userId: string,
  clientOperationId: string,
  status: 'succeeded' | 'failed',
  lastError?: string,
) {
  const supabase = getSupabaseClient();
  const patch = {
    status,
    last_error: lastError ?? null,
    completed_at: status === 'succeeded' ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
    next_attempt_at: null,
  };
  const { error } = await supabase
    .from('sync_operations')
    .update(patch)
    .eq('user_id', userId)
    .eq('idempotency_key', clientOperationId);
  if (error) {
    console.warn('[sync-operations-ledger]', error.message);
  }
}

export async function syncTakeDoseCommand(
  userId: string,
  dose: ScheduledDose,
  record: DoseRecord,
  clientOperationId: string,
): Promise<TakeCommandResult> {
  const supabase = getSupabaseClient();
  const cDoseId = cloudDoseId(userId, dose.id);
  const cRecordId = cloudRecordId(userId, record.id);
  const commandPayload = {
    doseId: dose.id,
    cloudDoseId: cDoseId,
    scheduledDate: dose.scheduledDate,
    scheduledTime: dose.scheduledTime,
    action: 'taken',
    recordId: record.id,
    cloudRecordId: cRecordId,
    recordedAt: record.recordedAt,
  };
  await upsertDoseSyncOperationLedger(
    userId,
    clientOperationId,
    dose,
    commandPayload,
    'take_command',
  );

  try {
    const executionEventRow = {
      id: stableUuid(`execution-event:${userId}`, clientOperationId),
      user_id: userId,
      planned_occurrence_id: null,
      active_protocol_id: cloudActiveId(userId, dose.activeProtocolId),
      protocol_item_id: cloudProtocolItemId(userId, dose.activeProtocol.protocolId, dose.protocolItemId),
      event_type: 'taken',
      event_at: record.recordedAt,
      effective_date: dose.scheduledDate,
      effective_time: dose.scheduledTime,
      note: record.note ?? null,
      source: 'take_command',
      idempotency_key: clientOperationId,
    };
    const { error: eventInsertErr } = await supabase
      .from('execution_events')
      .insert(executionEventRow);
    if (eventInsertErr) {
      if (isUniqueViolation(eventInsertErr, 'uq_execution_events_idempotency')) {
        const { data: existingEvent, error: existingEventErr } = await supabase
          .from('execution_events')
          .select('id')
          .eq('user_id', userId)
          .eq('idempotency_key', clientOperationId)
          .maybeSingle();
        if (existingEventErr || !existingEvent) {
          throw new Error(`Execution event idempotency check failed: ${existingEventErr?.message ?? 'existing row not found'}`);
        }
      } else {
        throw new Error(`Execution event sync failed: ${eventInsertErr.message}`);
      }
    }

    await updateDoseSyncOperationLedger(userId, clientOperationId, 'succeeded');

    return {
      clientOperationId,
      status: 'taken',
      scheduledDate: dose.scheduledDate,
      scheduledTime: dose.scheduledTime,
      recordId: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateDoseSyncOperationLedger(userId, clientOperationId, 'failed', message);
    throw error;
  }
}

export async function syncSkipDoseCommand(
  userId: string,
  dose: ScheduledDose,
  record: DoseRecord,
  clientOperationId: string,
): Promise<TakeCommandResult> {
  const supabase = getSupabaseClient();
  const cDoseId = cloudDoseId(userId, dose.id);
  const cRecordId = cloudRecordId(userId, record.id);
  const commandPayload = {
    doseId: dose.id,
    cloudDoseId: cDoseId,
    scheduledDate: dose.scheduledDate,
    scheduledTime: dose.scheduledTime,
    action: 'skipped',
    recordId: record.id,
    cloudRecordId: cRecordId,
    recordedAt: record.recordedAt,
  };
  await upsertDoseSyncOperationLedger(
    userId,
    clientOperationId,
    dose,
    commandPayload,
    'skip_command',
  );

  try {
    const executionEventRow = {
      id: stableUuid(`execution-event:${userId}`, clientOperationId),
      user_id: userId,
      planned_occurrence_id: null,
      active_protocol_id: cloudActiveId(userId, dose.activeProtocolId),
      protocol_item_id: cloudProtocolItemId(userId, dose.activeProtocol.protocolId, dose.protocolItemId),
      event_type: 'skipped',
      event_at: record.recordedAt,
      effective_date: dose.scheduledDate,
      effective_time: dose.scheduledTime,
      note: record.note ?? null,
      source: 'skip_command',
      idempotency_key: clientOperationId,
    };
    const { error: eventInsertErr } = await supabase
      .from('execution_events')
      .insert(executionEventRow);
    if (eventInsertErr) {
      if (isUniqueViolation(eventInsertErr, 'uq_execution_events_idempotency')) {
        const { data: existingEvent, error: existingEventErr } = await supabase
          .from('execution_events')
          .select('id')
          .eq('user_id', userId)
          .eq('idempotency_key', clientOperationId)
          .maybeSingle();
        if (existingEventErr || !existingEvent) {
          throw new Error(`Execution event idempotency check failed: ${existingEventErr?.message ?? 'existing row not found'}`);
        }
      } else {
        throw new Error(`Execution event sync failed: ${eventInsertErr.message}`);
      }
    }

    await updateDoseSyncOperationLedger(userId, clientOperationId, 'succeeded');

    return {
      clientOperationId,
      status: 'skipped',
      scheduledDate: dose.scheduledDate,
      scheduledTime: dose.scheduledTime,
      recordId: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateDoseSyncOperationLedger(userId, clientOperationId, 'failed', message);
    throw error;
  }
}

export async function syncSnoozeDoseCommand(
  userId: string,
  dose: ScheduledDose,
  replacementDose: ScheduledDose | null,
  record: DoseRecord,
  clientOperationId: string,
): Promise<TakeCommandResult> {
  const supabase = getSupabaseClient();
  const cDoseId = cloudDoseId(userId, dose.id);
  const cRecordId = cloudRecordId(userId, record.id);
  const cReplacementDoseId = replacementDose ? cloudDoseId(userId, replacementDose.id) : cDoseId;
  const cReplacementActiveId = replacementDose ? cloudActiveId(userId, replacementDose.activeProtocolId) : cloudActiveId(userId, dose.activeProtocolId);
  const cReplacementItemId = replacementDose
    ? cloudProtocolItemId(userId, replacementDose.activeProtocol.protocolId, replacementDose.protocolItemId)
    : cloudProtocolItemId(userId, dose.activeProtocol.protocolId, dose.protocolItemId);
  const commandPayload = {
    doseId: dose.id,
    cloudDoseId: cDoseId,
    replacementDoseId: replacementDose?.id ?? null,
    cloudReplacementDoseId: cReplacementDoseId,
    scheduledDate: replacementDose?.scheduledDate ?? null,
    scheduledTime: replacementDose?.scheduledTime ?? null,
    action: 'snoozed',
    recordId: record.id,
    cloudRecordId: cRecordId,
    recordedAt: record.recordedAt,
  };
  await upsertDoseSyncOperationLedger(
    userId,
    clientOperationId,
    dose,
    commandPayload,
    'snooze_command',
  );

  try {
    const targetDate = replacementDose?.scheduledDate ?? dose.scheduledDate;
    const targetTime = replacementDose?.scheduledTime ?? dose.scheduledTime;

    const executionEventRow = {
      id: stableUuid(`execution-event:${userId}`, clientOperationId),
      user_id: userId,
      planned_occurrence_id: null,
      active_protocol_id: cReplacementActiveId,
      protocol_item_id: cReplacementItemId,
      event_type: 'snoozed',
      event_at: record.recordedAt,
      effective_date: targetDate,
      effective_time: targetTime,
      note: record.note ?? null,
      source: 'snooze_command',
      idempotency_key: clientOperationId,
    };
    const { error: eventInsertErr } = await supabase
      .from('execution_events')
      .insert(executionEventRow);
    if (eventInsertErr) {
      if (isUniqueViolation(eventInsertErr, 'uq_execution_events_idempotency')) {
        const { data: existingEvent, error: existingEventErr } = await supabase
          .from('execution_events')
          .select('id')
          .eq('user_id', userId)
          .eq('idempotency_key', clientOperationId)
          .maybeSingle();
        if (existingEventErr || !existingEvent) {
          throw new Error(`Execution event idempotency check failed: ${existingEventErr?.message ?? 'existing row not found'}`);
        }
      } else {
        throw new Error(`Execution event sync failed: ${eventInsertErr.message}`);
      }
    }

    // Update planned_occurrences lineage for snooze.
    // Look up origin by occurrence_key (works for both pre- and post-Phase-2 occurrences).
    // Non-fatal — execution_event already written above.
    try {
      const cOriginActiveId = cloudActiveId(userId, dose.activeProtocolId);
      const cOriginItemId = cloudProtocolItemId(userId, dose.activeProtocol.protocolId, dose.protocolItemId);
      const originOccurrenceKey = `${cOriginActiveId}|${cOriginItemId}|${dose.scheduledDate}|${dose.scheduledTime.slice(0, 5)}`;

      const { data: originOccurrence } = await supabase
        .from('planned_occurrences')
        .select('id, occurrence_key, revision')
        .eq('user_id', userId)
        .eq('occurrence_key', originOccurrenceKey)
        .is('superseded_by_occurrence_id', null)
        .maybeSingle();

      if (originOccurrence) {
        const successorOccurrenceKey = `${cReplacementActiveId}|${cReplacementItemId}|${targetDate}|${targetTime.slice(0, 5)}`;
        const successorOccurrenceId = stableUuid(`planned-occurrence:${userId}`, successorOccurrenceKey);

        await supabase.from('planned_occurrences').upsert({
          id: successorOccurrenceId,
          user_id: userId,
          active_protocol_id: cReplacementActiveId,
          protocol_id: cloudProtocolId(userId, dose.activeProtocol.protocolId),
          protocol_item_id: cReplacementItemId,
          occurrence_date: targetDate,
          occurrence_time: targetTime,
          occurrence_key: successorOccurrenceKey,
          revision: 1,
          status: 'planned',
          supersedes_occurrence_id: originOccurrence.id,
          source_generation: 'snooze_command',
        }, { onConflict: 'user_id,occurrence_key,revision' });

        await supabase.from('planned_occurrences').update({
          status: 'superseded',
          superseded_by_occurrence_id: successorOccurrenceId,
          superseded_at: record.recordedAt,
        }).eq('id', originOccurrence.id).eq('user_id', userId);
      }
    } catch (occurrenceErr) {
      console.warn('[snooze-occurrence-lineage]', occurrenceErr instanceof Error ? occurrenceErr.message : occurrenceErr);
    }

    await updateDoseSyncOperationLedger(userId, clientOperationId, 'succeeded');

    return {
      clientOperationId,
      status: 'snoozed',
      scheduledDate: targetDate,
      scheduledTime: targetTime,
      recordId: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateDoseSyncOperationLedger(userId, clientOperationId, 'failed', message);
    throw error;
  }
}

export async function syncPauseProtocolCommand(
  userId: string,
  activeId: string,
  pausedAt: string,
  clientOperationId: string,
): Promise<ActiveCommandResult> {
  const supabase = getSupabaseClient();
  const cActiveId = cloudActiveId(userId, activeId);
  await upsertActiveSyncOperationLedger(
    userId,
    activeId,
    clientOperationId,
    {
      activeId,
      cloudActiveId: cActiveId,
      status: 'paused',
      pausedAt,
    },
    'pause_command',
  );

  try {
    const { error } = await supabase
      .from('active_protocols')
      .update({
        status: 'paused',
        paused_at: pausedAt,
      })
      .eq('id', cActiveId)
      .eq('user_id', userId);
    if (error) throw new Error(`Pause command sync failed: ${error.message}`);

    await updateActiveSyncOperationLedger(userId, clientOperationId, 'succeeded');

    return {
      clientOperationId,
      status: 'paused',
      pausedAt,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateActiveSyncOperationLedger(userId, clientOperationId, 'failed', message);
    throw error;
  }
}

export async function syncResumeProtocolCommand(
  userId: string,
  activeId: string,
  clientOperationId: string,
): Promise<ActiveCommandResult> {
  const supabase = getSupabaseClient();
  const cActiveId = cloudActiveId(userId, activeId);
  await upsertActiveSyncOperationLedger(
    userId,
    activeId,
    clientOperationId,
    {
      activeId,
      cloudActiveId: cActiveId,
      status: 'active',
      pausedAt: null,
    },
    'resume_command',
  );

  try {
    const { error } = await supabase
      .from('active_protocols')
      .update({
        status: 'active',
        paused_at: null,
      })
      .eq('id', cActiveId)
      .eq('user_id', userId);
    if (error) throw new Error(`Resume command sync failed: ${error.message}`);

    await updateActiveSyncOperationLedger(userId, clientOperationId, 'succeeded');

    return {
      clientOperationId,
      status: 'active',
      pausedAt: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateActiveSyncOperationLedger(userId, clientOperationId, 'failed', message);
    throw error;
  }
}

export async function syncCompleteProtocolCommand(
  userId: string,
  activeId: string,
  completedAt: string,
  clientOperationId: string,
): Promise<ActiveCommandResult> {
  const supabase = getSupabaseClient();
  const cActiveId = cloudActiveId(userId, activeId);
  await upsertActiveSyncOperationLedger(
    userId,
    activeId,
    clientOperationId,
    {
      activeId,
      cloudActiveId: cActiveId,
      status: 'completed',
      completedAt,
    },
    'complete_command',
  );

  try {
    const { error } = await supabase
      .from('active_protocols')
      .update({
        status: 'completed',
        completed_at: completedAt,
        paused_at: null,
      })
      .eq('id', cActiveId)
      .eq('user_id', userId);
    if (error) throw new Error(`Complete command sync failed: ${error.message}`);

    await updateActiveSyncOperationLedger(userId, clientOperationId, 'succeeded');

    return {
      clientOperationId,
      status: 'completed',
      pausedAt: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateActiveSyncOperationLedger(userId, clientOperationId, 'failed', message);
    throw error;
  }
}

export async function syncArchiveProtocolCommand(
  userId: string,
  protocol: Protocol,
  activeIds: string[],
  clientOperationId: string,
): Promise<{ clientOperationId: string; status: 'archived' }> {
  const supabase = getSupabaseClient();
  const cloudActiveIds = activeIds.map(activeId => cloudActiveId(userId, activeId));
  await upsertProtocolSyncOperationLedger(
    userId,
    protocol.id,
    clientOperationId,
    {
      protocolId: protocol.id,
      cloudProtocolId: cloudProtocolId(userId, protocol.id),
      activeIds,
      cloudActiveIds,
      status: 'abandoned',
      isArchived: true,
    },
    'archive_command',
  );

  try {
    await upsertProtocolWithItems(userId, protocol);
    if (cloudActiveIds.length) {
      const { error: activeErr } = await supabase
        .from('active_protocols')
        .update({
          status: 'abandoned',
          paused_at: null,
          completed_at: null,
        })
        .eq('user_id', userId)
        .in('id', cloudActiveIds);
      if (activeErr) throw new Error(`Archive command sync failed: ${activeErr.message}`);
    }

    await updateActiveSyncOperationLedger(userId, clientOperationId, 'succeeded');
    return { clientOperationId, status: 'archived' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateActiveSyncOperationLedger(userId, clientOperationId, 'failed', message);
    throw error;
  }
}

export async function syncRemoveDoseCommand(
  userId: string,
  dose: ScheduledDose,
): Promise<void> {
  const supabase = getSupabaseClient();
  const cActiveId = cloudActiveId(userId, dose.activeProtocolId);
  const cItemId = cloudProtocolItemId(userId, dose.activeProtocol.protocolId, dose.protocolItemId);
  const occKey = `${cActiveId}|${cItemId}|${dose.scheduledDate}|${dose.scheduledTime.slice(0, 5)}`;

  const { error } = await supabase
    .from('planned_occurrences')
    .delete()
    .eq('user_id', userId)
    .eq('occurrence_key', occKey)
    .eq('status', 'planned');
  if (error) throw new Error(`removeDose occurrence delete failed: ${error.message}`);
}

export async function syncEndProtocolFromTodayCommand(
  userId: string,
  activeProtocolId: string,
  todayDate: string,
): Promise<void> {
  const supabase = getSupabaseClient();
  const cActiveId = cloudActiveId(userId, activeProtocolId);

  // Set end_date to the day before cutoffDate so the protocol stops before that date.
  const dayBefore = new Date(todayDate);
  dayBefore.setDate(dayBefore.getDate() - 1);
  const endDate = dayBefore.toISOString().slice(0, 10);

  const { error: updateError } = await supabase
    .from('active_protocols')
    .update({ end_date: endDate })
    .eq('id', cActiveId)
    .eq('user_id', userId);
  if (updateError) throw new Error(`endProtocolFromToday update failed: ${updateError.message}`);

  const { error: v2Err } = await supabase
    .from('planned_occurrences')
    .delete()
    .eq('active_protocol_id', cActiveId)
    .eq('user_id', userId)
    .gte('occurrence_date', todayDate)
    .eq('status', 'planned');
  if (v2Err) throw new Error(`endProtocolFromToday delete occurrences failed: ${v2Err.message}`);
}
