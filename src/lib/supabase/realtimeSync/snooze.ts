'use client';

import type { DoseRecord, ScheduledDose } from '@/types';
import { getSupabaseClient } from '../client';
import {
  type TakeCommandResult,
  cloudActiveId,
  cloudDoseId,
  cloudProtocolId,
  cloudProtocolItemId,
  cloudRecordId,
  isUniqueViolation,
  stableUuid,
  updateDoseSyncOperationLedger,
  upsertDoseSyncOperationLedger,
} from './helpers';

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
  const cReplacementActiveId = replacementDose
    ? cloudActiveId(userId, replacementDose.activeProtocolId)
    : cloudActiveId(userId, dose.activeProtocolId);
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
  await upsertDoseSyncOperationLedger(userId, clientOperationId, dose, commandPayload, 'snooze_command');

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
