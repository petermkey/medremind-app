'use client';

import type { ActiveProtocol, Protocol, ScheduledDose } from '@/types';
import { getSupabaseClient } from '../client';
import {
  type ActiveCommandResult,
  chunk,
  cloudActiveId,
  cloudProtocolId,
  cloudProtocolItemId,
  stableUuid,
  toDateString,
  updateActiveSyncOperationLedger,
  upsertActiveSyncOperationLedger,
  upsertProtocolSyncOperationLedger,
  upsertProtocolWithItems,
} from './helpers';

export async function syncActivation(
  userId: string,
  active: ActiveProtocol,
  doses: ScheduledDose[],
): Promise<void> {
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
): Promise<void> {
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
): Promise<void> {
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
    { activeId, cloudActiveId: cActiveId, status: 'paused', pausedAt },
    'pause_command',
  );

  try {
    const { error } = await supabase
      .from('active_protocols')
      .update({ status: 'paused', paused_at: pausedAt })
      .eq('id', cActiveId)
      .eq('user_id', userId);
    if (error) throw new Error(`Pause command sync failed: ${error.message}`);

    await updateActiveSyncOperationLedger(userId, clientOperationId, 'succeeded');
    return { clientOperationId, status: 'paused', pausedAt };
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
    { activeId, cloudActiveId: cActiveId, status: 'active', pausedAt: null },
    'resume_command',
  );

  try {
    const { error } = await supabase
      .from('active_protocols')
      .update({ status: 'active', paused_at: null })
      .eq('id', cActiveId)
      .eq('user_id', userId);
    if (error) throw new Error(`Resume command sync failed: ${error.message}`);

    await updateActiveSyncOperationLedger(userId, clientOperationId, 'succeeded');
    return { clientOperationId, status: 'active', pausedAt: null };
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
    { activeId, cloudActiveId: cActiveId, status: 'completed', completedAt },
    'complete_command',
  );

  try {
    const { error } = await supabase
      .from('active_protocols')
      .update({ status: 'completed', completed_at: completedAt, paused_at: null })
      .eq('id', cActiveId)
      .eq('user_id', userId);
    if (error) throw new Error(`Complete command sync failed: ${error.message}`);

    await updateActiveSyncOperationLedger(userId, clientOperationId, 'succeeded');
    return { clientOperationId, status: 'completed', pausedAt: null };
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
        .update({ status: 'abandoned', paused_at: null, completed_at: null })
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
