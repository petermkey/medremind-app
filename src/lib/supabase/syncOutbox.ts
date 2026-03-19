'use client';

import type { ActiveProtocol, DoseRecord, Protocol, ScheduledDose } from '@/types';
import {
  syncActivation,
  syncActiveStatus,
  syncDoseAction,
  syncSnoozeDoseCommand,
  syncSkipDoseCommand,
  syncTakeDoseCommand,
  syncProtocolDelete,
  syncProtocolItemDelete,
  syncProtocolUpsert,
  syncRegeneratedDoses,
} from './realtimeSync';

type SyncKind =
  | 'protocolUpsert'
  | 'protocolDelete'
  | 'protocolItemDelete'
  | 'activation'
  | 'activeStatus'
  | 'regeneratedDoses'
  | 'doseAction'
  | 'takeCommand'
  | 'skipCommand'
  | 'snoozeCommand';

type SyncPayloadMap = {
  protocolUpsert: { userId: string; protocol: Protocol };
  protocolDelete: { userId: string; protocolId: string };
  protocolItemDelete: { userId: string; protocolId: string; itemId: string };
  activation: { userId: string; active: ActiveProtocol; doses: ScheduledDose[] };
  activeStatus: {
    userId: string;
    activeId: string;
    patch: { status: ActiveProtocol['status']; pausedAt?: string; completedAt?: string };
  };
  regeneratedDoses: { userId: string; active: ActiveProtocol; fromDate: string; newDoses: ScheduledDose[] };
  doseAction: {
    userId: string;
    dose: ScheduledDose;
    patch: {
      status: ScheduledDose['status'];
      snoozedUntil?: string;
      scheduledDate?: string;
      scheduledTime?: string;
      replacementDose?: ScheduledDose;
    };
    record?: DoseRecord;
  };
  takeCommand: {
    userId: string;
    dose: ScheduledDose;
    record: DoseRecord;
    clientOperationId: string;
  };
  skipCommand: {
    userId: string;
    dose: ScheduledDose;
    record: DoseRecord;
    clientOperationId: string;
  };
  snoozeCommand: {
    userId: string;
    dose: ScheduledDose;
    replacementDose: ScheduledDose;
    record: DoseRecord;
    clientOperationId: string;
  };
};

export type SyncOperation =
  | { kind: 'protocolUpsert'; payload: SyncPayloadMap['protocolUpsert'] }
  | { kind: 'protocolDelete'; payload: SyncPayloadMap['protocolDelete'] }
  | { kind: 'protocolItemDelete'; payload: SyncPayloadMap['protocolItemDelete'] }
  | { kind: 'activation'; payload: SyncPayloadMap['activation'] }
  | { kind: 'activeStatus'; payload: SyncPayloadMap['activeStatus'] }
  | { kind: 'regeneratedDoses'; payload: SyncPayloadMap['regeneratedDoses'] }
  | { kind: 'doseAction'; payload: SyncPayloadMap['doseAction'] }
  | { kind: 'takeCommand'; payload: SyncPayloadMap['takeCommand'] }
  | { kind: 'skipCommand'; payload: SyncPayloadMap['skipCommand'] }
  | { kind: 'snoozeCommand'; payload: SyncPayloadMap['snoozeCommand'] };

type StoredSyncOperation = SyncOperation & {
  id: string;
  attempts: number;
  createdAt: number;
  nextAttemptAt: number;
  lastError?: string;
};

export type SyncStatus = {
  pending: number;
  running: boolean;
  lastError: string | null;
  lastSuccessAt: string | null;
};

export type FlushSyncResult = {
  ok: boolean;
  pending: number;
  lastError: string | null;
};

const KEY = 'medremind-sync-outbox-v1';
const listeners = new Set<(status: SyncStatus) => void>();

let started = false;
let pumping = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
const status: SyncStatus = {
  pending: 0,
  running: false,
  lastError: null,
  lastSuccessAt: null,
};

function emit() {
  for (const listener of listeners) listener({ ...status });
}

function hasWindow() {
  return typeof window !== 'undefined' && typeof localStorage !== 'undefined';
}

function readQueue(): StoredSyncOperation[] {
  if (!hasWindow()) return [];
  const raw = localStorage.getItem(KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as StoredSyncOperation[];
  } catch {
    return [];
  }
}

function writeQueue(items: StoredSyncOperation[]) {
  if (!hasWindow()) return;
  localStorage.setItem(KEY, JSON.stringify(items));
  status.pending = items.length;
  emit();
}

function nextBackoffMs(attempts: number) {
  const base = 1500;
  const max = 5 * 60_000;
  return Math.min(base * (2 ** attempts), max);
}

function scheduleNextPump(queue: StoredSyncOperation[]) {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  if (!queue.length || !hasWindow()) return;
  const now = Date.now();
  const nextAt = Math.min(...queue.map(item => item.nextAttemptAt));
  const delay = Math.max(0, nextAt - now);
  retryTimer = setTimeout(() => {
    void pumpOutbox();
  }, delay);
}

async function executeOperation(op: SyncOperation) {
  switch (op.kind) {
    case 'protocolUpsert':
      return syncProtocolUpsert(op.payload.userId, op.payload.protocol);
    case 'protocolItemDelete':
      return syncProtocolItemDelete(op.payload.userId, op.payload.protocolId, op.payload.itemId);
    case 'protocolDelete':
      return syncProtocolDelete(op.payload.userId, op.payload.protocolId);
    case 'activation':
      return syncActivation(op.payload.userId, op.payload.active, op.payload.doses);
    case 'activeStatus':
      return syncActiveStatus(op.payload.userId, op.payload.activeId, op.payload.patch);
    case 'regeneratedDoses':
      return syncRegeneratedDoses(op.payload.userId, op.payload.active, op.payload.fromDate, op.payload.newDoses);
    case 'doseAction':
      return syncDoseAction(op.payload.userId, op.payload.dose, op.payload.patch, op.payload.record);
    case 'takeCommand':
      return syncTakeDoseCommand(
        op.payload.userId,
        op.payload.dose,
        op.payload.record,
        op.payload.clientOperationId,
      );
    case 'skipCommand':
      return syncSkipDoseCommand(
        op.payload.userId,
        op.payload.dose,
        op.payload.record,
        op.payload.clientOperationId,
      );
    case 'snoozeCommand':
      return syncSnoozeDoseCommand(
        op.payload.userId,
        op.payload.dose,
        op.payload.replacementDose,
        op.payload.record,
        op.payload.clientOperationId,
      );
    default:
      return Promise.resolve();
  }
}

function waitMs(ms: number) {
  return new Promise<void>(resolve => {
    setTimeout(resolve, ms);
  });
}

export function getSyncStatusSnapshot(): SyncStatus {
  return { ...status };
}

export function subscribeSyncStatus(listener: (status: SyncStatus) => void) {
  listeners.add(listener);
  listener({ ...status });
  return () => {
    listeners.delete(listener);
  };
}

export function markSyncSuccess() {
  status.lastSuccessAt = new Date().toISOString();
  status.lastError = null;
  emit();
}

export function markSyncFailure(error: unknown) {
  status.lastError = error instanceof Error ? error.message : String(error);
  emit();
}

export function enqueueSyncOperation(op: SyncOperation) {
  if (!hasWindow()) return;
  const queue = readQueue();
  queue.push({
    ...op,
    id: crypto.randomUUID(),
    attempts: 0,
    createdAt: Date.now(),
    nextAttemptAt: Date.now(),
  });
  writeQueue(queue);
  void pumpOutbox();
}

export async function pumpOutbox(options?: { force?: boolean }) {
  const force = options?.force ?? false;
  if (!hasWindow() || pumping) return;
  pumping = true;
  status.running = true;
  emit();
  let queue = readQueue();
  if (!queue.length) {
    status.running = false;
    status.pending = 0;
    emit();
    pumping = false;
    return;
  }

  const now = Date.now();
  for (const item of [...queue]) {
    if (!force && item.nextAttemptAt > now) continue;
    try {
      await executeOperation(item);
      queue = queue.filter(q => q.id !== item.id);
      writeQueue(queue);
      markSyncSuccess();
    } catch (error) {
      const attempts = item.attempts + 1;
      const nextAttemptAt = Date.now() + nextBackoffMs(attempts);
      queue = queue.map(q => {
        if (q.id !== item.id) return q;
        return {
          ...q,
          attempts,
          nextAttemptAt,
          lastError: error instanceof Error ? error.message : String(error),
        };
      });
      writeQueue(queue);
      markSyncFailure(error);
    }
  }

  scheduleNextPump(queue);
  status.running = false;
  emit();
  pumping = false;
}

export async function flushSyncOutbox(timeoutMs = 10_000): Promise<FlushSyncResult> {
  if (!hasWindow()) return { ok: true, pending: 0, lastError: null };
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    await pumpOutbox({ force: true });
    const pending = readQueue().length;
    status.pending = pending;
    emit();
    if (pending === 0) {
      return { ok: true, pending: 0, lastError: null };
    }
    await waitMs(250);
  }
  const pending = readQueue().length;
  status.pending = pending;
  emit();
  return { ok: pending === 0, pending, lastError: status.lastError };
}

export function startSyncOutbox() {
  if (started || !hasWindow()) return;
  started = true;
  const queue = readQueue();
  status.pending = queue.length;
  emit();

  window.addEventListener('online', () => {
    void pumpOutbox();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void pumpOutbox();
  });
  void pumpOutbox();
}

export function clearSyncOutbox() {
  if (!hasWindow()) return;
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  localStorage.removeItem(KEY);
  status.pending = 0;
  status.running = false;
  status.lastError = null;
  emit();
}
