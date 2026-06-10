'use client';

import type { DoseRecord, ScheduledDose } from '@/types';
import { getSupabaseClient } from '../client';
import {
  type TakeCommandResult,
  cloudActiveId,
  cloudDoseId,
  cloudProtocolItemId,
  cloudRecordId,
  isUniqueViolation,
  stableUuid,
  updateDoseSyncOperationLedger,
  upsertDoseSyncOperationLedger,
} from './helpers';

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
  await upsertDoseSyncOperationLedger(userId, clientOperationId, dose, commandPayload, 'take_command');

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
    const { error: eventInsertErr } = await supabase.from('execution_events').insert(executionEventRow);
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
  await upsertDoseSyncOperationLedger(userId, clientOperationId, dose, commandPayload, 'skip_command');

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
    const { error: eventInsertErr } = await supabase.from('execution_events').insert(executionEventRow);
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

export async function syncRemoveDoseCommand(userId: string, dose: ScheduledDose): Promise<void> {
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
