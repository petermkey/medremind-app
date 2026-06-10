'use client';

import type { ActiveProtocol, Protocol, ScheduledDose } from '@/types';
import { getSupabaseClient } from '../client';

export function isUuid(value: string | undefined | null): value is string {
  if (!value) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function hash32(input: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function stableUuid(namespace: string, source: string): string {
  const input = `${namespace}:${source}`;
  const p1 = hash32(input, 0x811c9dc5).toString(16).padStart(8, '0');
  const p2 = hash32(input, 0x9e3779b9).toString(16).padStart(8, '0');
  const p3 = hash32(input, 0x85ebca6b).toString(16).padStart(8, '0');
  const p4 = hash32(input, 0xc2b2ae35).toString(16).padStart(8, '0');
  const hex = `${p1}${p2}${p3}${p4}`;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function cloudProtocolId(userId: string, protocolId: string): string {
  return isUuid(protocolId) ? protocolId : stableUuid(`protocol:${userId}`, protocolId);
}

export function cloudProtocolItemId(userId: string, protocolId: string, itemId: string): string {
  if (isUuid(itemId)) return itemId;
  return stableUuid(`protocol-item:${cloudProtocolId(userId, protocolId)}`, itemId);
}

export function cloudActiveId(userId: string, activeId: string): string {
  return isUuid(activeId) ? activeId : stableUuid(`active:${userId}`, activeId);
}

export function cloudDoseId(userId: string, doseId: string): string {
  return isUuid(doseId) ? doseId : stableUuid(`dose:${userId}`, doseId);
}

export function cloudRecordId(userId: string, recordId: string): string {
  return isUuid(recordId) ? recordId : stableUuid(`record:${userId}`, recordId);
}

export function cloudOperationId(userId: string, operationId: string): string {
  return isUuid(operationId) ? operationId : stableUuid(`sync-operation:${userId}`, operationId);
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function toDateString(value: Date): string {
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, '0');
  const d = String(value.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function toTimeString(value: Date): string {
  const h = String(value.getHours()).padStart(2, '0');
  const m = String(value.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

export function isUniqueViolation(
  error: { code?: string; message?: string } | null,
  constraintName: string,
): boolean {
  if (!error) return false;
  if (error.code === '23505') return true;
  return Boolean(error.message?.includes(constraintName));
}

export type TakeCommandResult = {
  clientOperationId: string;
  status: ScheduledDose['status'];
  scheduledDate: string;
  scheduledTime: string;
  recordId: string | null;
};

export type ActiveCommandResult = {
  clientOperationId: string;
  status: ActiveProtocol['status'];
  pausedAt: string | null;
};

export async function upsertProtocolWithItems(userId: string, protocol: Protocol): Promise<void> {
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

export async function upsertActiveSyncOperationLedger(
  userId: string,
  activeId: string,
  clientOperationId: string,
  payload: Record<string, unknown>,
  operationKind: 'pause_command' | 'resume_command' | 'complete_command',
): Promise<void> {
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

export async function upsertProtocolSyncOperationLedger(
  userId: string,
  protocolId: string,
  clientOperationId: string,
  payload: Record<string, unknown>,
  operationKind: 'archive_command',
): Promise<void> {
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

export async function updateActiveSyncOperationLedger(
  userId: string,
  clientOperationId: string,
  status: 'succeeded' | 'failed',
  lastError?: string,
): Promise<void> {
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

export async function upsertDoseSyncOperationLedger(
  userId: string,
  clientOperationId: string,
  dose: ScheduledDose,
  payload: Record<string, unknown>,
  operationKind: 'take_command' | 'skip_command' | 'snooze_command',
): Promise<void> {
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

export async function updateDoseSyncOperationLedger(
  userId: string,
  clientOperationId: string,
  status: 'succeeded' | 'failed',
  lastError?: string,
): Promise<void> {
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
