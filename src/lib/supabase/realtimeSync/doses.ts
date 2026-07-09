'use client';

import type { DoseRecord, ScheduledDose } from '@/types';
import { getSupabaseClient } from '../client';
import {
  type TakeCommandResult,
  cloudActiveId,
  cloudDoseId,
  cloudProtocolItemId,
  cloudRecordId,
  resolvePlannedOccurrenceId,
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
    const plannedOccurrenceId = await resolvePlannedOccurrenceId(userId, dose);
    const executionEventRow = {
      id: stableUuid(`execution-event:${userId}`, clientOperationId),
      user_id: userId,
      planned_occurrence_id: plannedOccurrenceId,
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
    // id is a deterministic hash of clientOperationId, so a retried command
    // always re-derives the same row: upsert+ignoreDuplicates makes that a
    // silent no-op instead of a logged 23505/409 (the row's presence IS the
    // idempotency confirmation — no follow-up select needed).
    const { error: eventInsertErr } = await supabase
      .from('execution_events')
      .upsert(executionEventRow, { onConflict: 'id', ignoreDuplicates: true });
    if (eventInsertErr) {
      throw new Error(`Execution event sync failed: ${eventInsertErr.message}`);
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
    const plannedOccurrenceId = await resolvePlannedOccurrenceId(userId, dose);
    const executionEventRow = {
      id: stableUuid(`execution-event:${userId}`, clientOperationId),
      user_id: userId,
      planned_occurrence_id: plannedOccurrenceId,
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
    // See syncTakeDoseCommand above for why upsert+ignoreDuplicates replaces
    // the old insert-then-catch-23505 pattern.
    const { error: eventInsertErr } = await supabase
      .from('execution_events')
      .upsert(executionEventRow, { onConflict: 'id', ignoreDuplicates: true });
    if (eventInsertErr) {
      throw new Error(`Execution event sync failed: ${eventInsertErr.message}`);
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
  const occurrenceId = await resolvePlannedOccurrenceId(userId, dose, { createIfMissing: false });
  if (!occurrenceId) return; // nothing in the cloud to remove

  // Cancel instead of delete: the cancelled row is a tombstone that stops
  // rolling-horizon regeneration from recreating the slot, and keeps any
  // linked execution_events anchored (their FK is on-delete-set-null).
  const { error } = await supabase
    .from('planned_occurrences')
    .update({ status: 'cancelled' })
    .eq('user_id', userId)
    .eq('id', occurrenceId);
  if (error) throw new Error(`removeDose occurrence cancel failed: ${error.message}`);
}
