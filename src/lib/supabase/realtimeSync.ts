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

function isDoseSlotConflict(message: string | undefined): boolean {
  if (!message) return false;
  return message.includes('scheduled_doses_active_protocol_id_protocol_item_id_schedul_key');
}

async function findNextAvailableDoseSlot(
  userId: string,
  doseId: string,
  activeProtocolId: string,
  protocolId: string,
  protocolItemId: string,
  baseDate: string,
  baseTime: string,
): Promise<{ scheduledDate: string; scheduledTime: string } | null> {
  const supabase = getSupabaseClient();
  const start = new Date(`${baseDate}T${baseTime}:00`);
  if (Number.isNaN(start.getTime())) return null;
  const cDoseId = cloudDoseId(userId, doseId);
  const cActiveId = cloudActiveId(userId, activeProtocolId);
  const cItemId = cloudProtocolItemId(userId, protocolId, protocolItemId);

  const cursor = new Date(start);
  for (let i = 0; i < 72; i++) {
    const slotDate = toDateString(cursor);
    const slotTime = toTimeString(cursor);
    const { data, error } = await supabase
      .from('scheduled_doses')
      .select('id')
      .eq('user_id', userId)
      .eq('active_protocol_id', cActiveId)
      .eq('protocol_item_id', cItemId)
      .eq('scheduled_date', slotDate)
      .eq('scheduled_time', slotTime);
    if (error) return null;
    const occupiedByAnother = (data ?? []).some((row: { id: string }) => row.id !== cDoseId);
    if (!occupiedByAnother) {
      return { scheduledDate: slotDate, scheduledTime: slotTime };
    }
    cursor.setMinutes(cursor.getMinutes() + 5);
  }
  return null;
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
    const doseIds: string[] = [];
    for (const ids of chunk(activeIds, 250)) {
      const { data: dRows, error: dErr } = await supabase
        .from('scheduled_doses')
        .select('id')
        .eq('user_id', userId)
        .in('active_protocol_id', ids);
      if (dErr) throw new Error(`Load scheduled doses for delete failed: ${dErr.message}`);
      doseIds.push(...(((dRows ?? []) as Array<{ id: string }>).map(row => row.id)));
    }

    for (const ids of chunk(doseIds, 250)) {
      const { error: rErr } = await supabase
        .from('dose_records')
        .delete()
        .eq('user_id', userId)
        .in('scheduled_dose_id', ids);
      if (rErr) throw new Error(`Delete dose records for protocol failed: ${rErr.message}`);
    }

    for (const ids of chunk(activeIds, 250)) {
      const { error: sErr } = await supabase
        .from('scheduled_doses')
        .delete()
        .eq('user_id', userId)
        .in('active_protocol_id', ids);
      if (sErr) throw new Error(`Delete scheduled doses for protocol failed: ${sErr.message}`);
    }

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

  const doseRows = doses.map(d => ({
    id: cloudDoseId(userId, d.id),
    user_id: userId,
    active_protocol_id: cActiveId,
    protocol_item_id: cloudProtocolItemId(userId, active.protocolId, d.protocolItemId),
    scheduled_date: d.scheduledDate,
    scheduled_time: d.scheduledTime,
    status: d.status,
    snoozed_until: d.snoozedUntil ?? null,
  }));

  for (const part of chunk(doseRows, 250)) {
    const { error } = await supabase.from('scheduled_doses').upsert(part, { onConflict: 'id' });
    if (error) throw new Error(`Scheduled doses sync failed: ${error.message}`);
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

  const { data: existingRows, error: existingErr } = await supabase
    .from('scheduled_doses')
    .select('id, protocol_item_id, scheduled_date, scheduled_time, status, snoozed_until')
    .eq('user_id', userId)
    .eq('active_protocol_id', cActiveId)
    .gte('scheduled_date', fromDate);
  if (existingErr) throw new Error(`Load existing regenerated doses failed: ${existingErr.message}`);

  const existing = (existingRows ?? []) as Array<{
    id: string;
    protocol_item_id: string;
    scheduled_date: string;
    scheduled_time: string;
    status: ScheduledDose['status'];
    snoozed_until: string | null;
  }>;

  const existingDoseIds = existing.map(row => row.id);
  const protectedByRecord = new Set<string>();
  if (existingDoseIds.length) {
    for (const ids of chunk(existingDoseIds, 250)) {
      const { data: recordRows, error: rErr } = await supabase
        .from('dose_records')
        .select('scheduled_dose_id')
        .eq('user_id', userId)
        .in('scheduled_dose_id', ids);
      if (rErr) throw new Error(`Load dose records for regeneration failed: ${rErr.message}`);
      for (const row of (recordRows ?? []) as Array<{ scheduled_dose_id: string }>) {
        protectedByRecord.add(row.scheduled_dose_id);
      }
    }
  }

  const retainedSlots = new Set<string>();
  const deletableIds: string[] = [];

  for (const row of existing) {
    const hasRecord = protectedByRecord.has(row.id);
    const hasSnoozeLink = Boolean(row.snoozed_until);
    const slot = `${row.protocol_item_id}|${row.scheduled_date}|${String(row.scheduled_time).slice(0, 5)}`;
    const isPending = row.status === 'pending';
    const shouldDelete = isPending && !hasRecord && !hasSnoozeLink;
    if (shouldDelete) {
      deletableIds.push(row.id);
      continue;
    }
    retainedSlots.add(slot);
  }

  for (const ids of chunk(deletableIds, 250)) {
    const { error: delErr } = await supabase
      .from('scheduled_doses')
      .delete()
      .eq('user_id', userId)
      .in('id', ids);
    if (delErr) throw new Error(`Delete regenerated doses failed: ${delErr.message}`);
  }

  const rows = newDoses
    .map(d => ({
      id: cloudDoseId(userId, d.id),
      user_id: userId,
      active_protocol_id: cActiveId,
      protocol_item_id: cloudProtocolItemId(userId, active.protocolId, d.protocolItemId),
      scheduled_date: d.scheduledDate,
      scheduled_time: d.scheduledTime,
      status: d.status,
      snoozed_until: d.snoozedUntil ?? null,
    }))
    .filter(row => {
      const slot = `${row.protocol_item_id}|${row.scheduled_date}|${row.scheduled_time}`;
      return !retainedSlots.has(slot);
    });
  for (const part of chunk(rows, 250)) {
    const { error } = await supabase.from('scheduled_doses').upsert(part, { onConflict: 'id' });
    if (error) throw new Error(`Insert regenerated doses failed: ${error.message}`);
  }
}

export async function syncDoseAction(
  userId: string,
  dose: ScheduledDose,
  patch: {
    status: ScheduledDose['status'];
    snoozedUntil?: string;
    scheduledDate?: string;
    scheduledTime?: string;
    replacementDose?: ScheduledDose;
  },
  record?: DoseRecord,
) {
  const supabase = getSupabaseClient();
  const cDoseId = cloudDoseId(userId, dose.id);
  let syncError: { message: string } | null = null;
  const replacementDose = patch.replacementDose;

  if (replacementDose) {
    const { error: originalErr } = await supabase
      .from('scheduled_doses')
      .update({
        status: patch.status,
        snoozed_until: patch.snoozedUntil ?? null,
      })
      .eq('id', cDoseId)
      .eq('user_id', userId);
    if (originalErr) syncError = originalErr;

    if (!syncError) {
      const cReplacementDoseId = cloudDoseId(userId, replacementDose.id);
      const cReplacementActiveId = cloudActiveId(userId, replacementDose.activeProtocolId);
      const cReplacementItemId = cloudProtocolItemId(
        userId,
        replacementDose.activeProtocol.protocolId,
        replacementDose.protocolItemId,
      );
      const upsertReplacementAt = async (scheduledDate: string, scheduledTime: string) => {
        const resolvedDateTime = new Date(`${scheduledDate}T${scheduledTime}:00`);
        const row = {
          id: cReplacementDoseId,
          user_id: userId,
          active_protocol_id: cReplacementActiveId,
          protocol_item_id: cReplacementItemId,
          scheduled_date: scheduledDate,
          scheduled_time: scheduledTime,
          status: 'pending',
          snoozed_until: Number.isNaN(resolvedDateTime.getTime())
            ? replacementDose.snoozedUntil ?? patch.snoozedUntil ?? null
            : resolvedDateTime.toISOString(),
        };
        return supabase.from('scheduled_doses').upsert(row, { onConflict: 'id' });
      };

      let targetDate = replacementDose.scheduledDate;
      let targetTime = replacementDose.scheduledTime;
      let { error: replacementErr } = await upsertReplacementAt(targetDate, targetTime);
      if (replacementErr && isDoseSlotConflict(replacementErr.message)) {
        const resolvedSlot = await findNextAvailableDoseSlot(
          userId,
          replacementDose.id,
          replacementDose.activeProtocolId,
          replacementDose.activeProtocol.protocolId,
          replacementDose.protocolItemId,
          targetDate,
          targetTime,
        );
        if (resolvedSlot) {
          targetDate = resolvedSlot.scheduledDate;
          targetTime = resolvedSlot.scheduledTime;
          const { error: retryErr } = await upsertReplacementAt(targetDate, targetTime);
          replacementErr = retryErr;
          if (!replacementErr) {
            const resolvedDateTime = new Date(`${targetDate}T${targetTime}:00`);
            const { error: updateOriginalErr } = await supabase
              .from('scheduled_doses')
              .update({
                snoozed_until: Number.isNaN(resolvedDateTime.getTime())
                  ? patch.snoozedUntil ?? null
                  : resolvedDateTime.toISOString(),
              })
              .eq('id', cDoseId)
              .eq('user_id', userId);
            if (updateOriginalErr) replacementErr = updateOriginalErr;
          }
        }
      }
      if (replacementErr) syncError = replacementErr;
    }
  } else {
    const targetDate = patch.scheduledDate ?? dose.scheduledDate;
    const targetTime = patch.scheduledTime ?? dose.scheduledTime;
    const baseUpdate = {
      status: patch.status,
      snoozed_until: patch.snoozedUntil ?? null,
      scheduled_date: targetDate,
      scheduled_time: targetTime,
    };

    let { error: dErr } = await supabase
      .from('scheduled_doses')
      .update(baseUpdate)
      .eq('id', cDoseId)
      .eq('user_id', userId);

    if (
      dErr &&
      isDoseSlotConflict(dErr.message) &&
      Boolean(patch.scheduledDate || patch.scheduledTime)
    ) {
      const resolvedSlot = await findNextAvailableDoseSlot(
        userId,
        dose.id,
        dose.activeProtocolId,
        dose.activeProtocol.protocolId,
        dose.protocolItemId,
        targetDate,
        targetTime,
      );
      if (resolvedSlot) {
        const resolvedDateTime = new Date(`${resolvedSlot.scheduledDate}T${resolvedSlot.scheduledTime}:00`);
        const { error: retryErr } = await supabase
          .from('scheduled_doses')
          .update({
            status: patch.status,
            snoozed_until: Number.isNaN(resolvedDateTime.getTime()) ? patch.snoozedUntil ?? null : resolvedDateTime.toISOString(),
            scheduled_date: resolvedSlot.scheduledDate,
            scheduled_time: resolvedSlot.scheduledTime,
          })
          .eq('id', cDoseId)
          .eq('user_id', userId);
        dErr = retryErr;
      }
    }
    if (dErr) syncError = dErr;
  }

  if (syncError) throw new Error(`Dose status sync failed: ${syncError.message}`);

  if (record) {
    const row = {
      id: cloudRecordId(userId, record.id),
      user_id: userId,
      scheduled_dose_id: cDoseId,
      action: record.action,
      recorded_at: record.recordedAt,
      note: record.note ?? null,
    };
    const { error: rErr } = await supabase.from('dose_records').upsert(row, { onConflict: 'id' });
    if (rErr) throw new Error(`Dose record sync failed: ${rErr.message}`);
  }
}

type TakeCommandResult = {
  clientOperationId: string;
  status: ScheduledDose['status'];
  scheduledDate: string;
  scheduledTime: string;
  recordId: string | null;
};

async function upsertDoseSyncOperationLedger(
  userId: string,
  clientOperationId: string,
  dose: ScheduledDose,
  payload: Record<string, unknown>,
  operationKind: 'take_command' | 'skip_command',
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

async function updateTakeSyncOperationLedger(
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
    const { error: doseErr } = await supabase
      .from('scheduled_doses')
      .update({
        status: 'taken',
      })
      .eq('id', cDoseId)
      .eq('user_id', userId);
    if (doseErr) throw new Error(`Dose status sync failed: ${doseErr.message}`);

    const recordRow = {
      id: cRecordId,
      user_id: userId,
      scheduled_dose_id: cDoseId,
      action: 'taken',
      recorded_at: record.recordedAt,
      note: record.note ?? null,
    };
    const { error: recordErr } = await supabase.from('dose_records').upsert(recordRow, { onConflict: 'id' });
    if (recordErr) throw new Error(`Dose record sync failed: ${recordErr.message}`);

    await updateTakeSyncOperationLedger(userId, clientOperationId, 'succeeded');

    return {
      clientOperationId,
      status: 'taken',
      scheduledDate: dose.scheduledDate,
      scheduledTime: dose.scheduledTime,
      recordId: cRecordId,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateTakeSyncOperationLedger(userId, clientOperationId, 'failed', message);
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
    const { error: doseErr } = await supabase
      .from('scheduled_doses')
      .update({
        status: 'skipped',
      })
      .eq('id', cDoseId)
      .eq('user_id', userId);
    if (doseErr) throw new Error(`Dose status sync failed: ${doseErr.message}`);

    const recordRow = {
      id: cRecordId,
      user_id: userId,
      scheduled_dose_id: cDoseId,
      action: 'skipped',
      recorded_at: record.recordedAt,
      note: record.note ?? null,
    };
    const { error: recordErr } = await supabase.from('dose_records').upsert(recordRow, { onConflict: 'id' });
    if (recordErr) throw new Error(`Dose record sync failed: ${recordErr.message}`);

    await updateTakeSyncOperationLedger(userId, clientOperationId, 'succeeded');

    return {
      clientOperationId,
      status: 'skipped',
      scheduledDate: dose.scheduledDate,
      scheduledTime: dose.scheduledTime,
      recordId: cRecordId,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateTakeSyncOperationLedger(userId, clientOperationId, 'failed', message);
    throw error;
  }
}
