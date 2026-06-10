'use client';

import type { ActiveProtocol, DoseRecord, Protocol, ScheduledDose } from '@/types';
import type { FoodEntry } from '@/types/food';
import type { NutritionTargetProfile, WaterEntry } from '@/types/nutritionTargets';
import {
  clearPendingDeletedFoodEntryIdsExcept,
  clearPendingDeletedFoodEntryIds,
  readPendingDeletedFoodEntryIds,
  removePendingDeletedFoodEntryId,
} from '@/lib/food/pendingFoodDeletes';
import {
  getInflightFoodEntrySaveIds,
} from '@/lib/food/inflightFoodSaves';
import { sanitizeFoodEntryForSync, syncFoodEntryDelete, syncFoodEntrySave } from './foodSync';
import { syncNutritionTargetProfileSave, syncWaterEntrySave } from './nutritionTargetsSync';
import {
  hasStaleFoodEntrySaveOperationInQueue,
  removeStaleFoodEntrySaveOperationsFromQueue,
  removeSyncOperationFromQueueById,
} from './syncOutboxQueue';
import {
  syncActivation,
  syncActiveStatus,
  syncArchiveProtocolCommand,
  syncCompleteProtocolCommand,
  syncPauseProtocolCommand,
  syncResumeProtocolCommand,
  syncSnoozeDoseCommand,
  syncSkipDoseCommand,
  syncTakeDoseCommand,
  syncProtocolDelete,
  syncProtocolItemDelete,
  syncProtocolUpsert,
  syncRegeneratedDoses,
  syncEndProtocolFromTodayCommand,
  syncRemoveDoseCommand,
} from './realtimeSync';

type SyncKind =
  | 'protocolUpsert'
  | 'protocolDelete'
  | 'protocolItemDelete'
  | 'activation'
  | 'activeStatus'
  | 'regeneratedDoses'
  | 'takeCommand'
  | 'skipCommand'
  | 'snoozeCommand'
  | 'pauseCommand'
  | 'resumeCommand'
  | 'completeCommand'
  | 'archiveCommand'
  | 'endProtocolFromToday'
  | 'removeDose'
  | 'foodEntrySave'
  | 'foodEntryDelete'
  | 'nutritionTargetProfileSave'
  | 'waterEntrySave';

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
    replacementDose: ScheduledDose | null;
    record: DoseRecord;
    clientOperationId: string;
  };
  pauseCommand: {
    userId: string;
    activeId: string;
    pausedAt: string;
    clientOperationId: string;
  };
  resumeCommand: {
    userId: string;
    activeId: string;
    clientOperationId: string;
  };
  completeCommand: {
    userId: string;
    activeId: string;
    completedAt: string;
    clientOperationId: string;
  };
  archiveCommand: {
    userId: string;
    protocol: Protocol;
    activeIds: string[];
    clientOperationId: string;
  };
  endProtocolFromToday: {
    userId: string;
    activeProtocolId: string;
    today: string;
  };
  removeDose: {
    userId: string;
    doseId: string;
    dose?: ScheduledDose;
  };
  foodEntrySave: { userId: string; entry: FoodEntry };
  foodEntryDelete: { userId: string; entryId: string };
  nutritionTargetProfileSave: { userId: string; profile: NutritionTargetProfile };
  waterEntrySave: { userId: string; entry: WaterEntry };
};

export type SyncOperation =
  | { kind: 'protocolUpsert'; payload: SyncPayloadMap['protocolUpsert'] }
  | { kind: 'protocolDelete'; payload: SyncPayloadMap['protocolDelete'] }
  | { kind: 'protocolItemDelete'; payload: SyncPayloadMap['protocolItemDelete'] }
  | { kind: 'activation'; payload: SyncPayloadMap['activation'] }
  | { kind: 'activeStatus'; payload: SyncPayloadMap['activeStatus'] }
  | { kind: 'regeneratedDoses'; payload: SyncPayloadMap['regeneratedDoses'] }
  | { kind: 'takeCommand'; payload: SyncPayloadMap['takeCommand'] }
  | { kind: 'skipCommand'; payload: SyncPayloadMap['skipCommand'] }
  | { kind: 'snoozeCommand'; payload: SyncPayloadMap['snoozeCommand'] }
  | { kind: 'pauseCommand'; payload: SyncPayloadMap['pauseCommand'] }
  | { kind: 'resumeCommand'; payload: SyncPayloadMap['resumeCommand'] }
  | { kind: 'completeCommand'; payload: SyncPayloadMap['completeCommand'] }
  | { kind: 'archiveCommand'; payload: SyncPayloadMap['archiveCommand'] }
  | { kind: 'endProtocolFromToday'; payload: SyncPayloadMap['endProtocolFromToday'] }
  | { kind: 'removeDose'; payload: SyncPayloadMap['removeDose'] }
  | { kind: 'foodEntrySave'; payload: SyncPayloadMap['foodEntrySave'] }
  | { kind: 'foodEntryDelete'; payload: SyncPayloadMap['foodEntryDelete'] }
  | { kind: 'nutritionTargetProfileSave'; payload: SyncPayloadMap['nutritionTargetProfileSave'] }
  | { kind: 'waterEntrySave'; payload: SyncPayloadMap['waterEntrySave'] };

type StoredSyncOperation = SyncOperation & {
  id: string;
  attempts: number;
  createdAt: number;
  nextAttemptAt: number;
  lastError?: string;
  // Set once attempts exceed MAX_ATTEMPTS: the operation stops retrying and is
  // surfaced to the user instead of spinning forever and pinning pending > 0.
  dead?: boolean;
};

export type SyncStatus = {
  pending: number;
  running: boolean;
  lastError: string | null;
  lastSuccessAt: string | null;
  deadLettered: number;
};

export type FlushSyncResult = {
  ok: boolean;
  pending: number;
  lastError: string | null;
};

const KEY = 'medremind-sync-outbox-v1';
const LOCK_NAME = 'medremind-sync-outbox';
// After this many failed attempts an operation is dead-lettered: a poisoned
// payload (e.g. a permanent 4xx) otherwise retries forever. At the capped
// 5-min backoff, 20 attempts is roughly 1.5h of retries before giving up.
const MAX_ATTEMPTS = 20;
const listeners = new Set<(status: SyncStatus) => void>();

let started = false;
let pumping = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
const status: SyncStatus = {
  pending: 0,
  running: false,
  lastError: null,
  lastSuccessAt: null,
  deadLettered: 0,
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
  localStorage.setItem(KEY, JSON.stringify(items.map(normalizeStoredSyncOperation)));
  status.pending = items.filter(item => !item.dead).length;
  status.deadLettered = items.filter(item => item.dead).length;
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
  const live = queue.filter(item => !item.dead);
  if (!live.length || !hasWindow()) return;
  const now = Date.now();
  const nextAt = Math.min(...live.map(item => item.nextAttemptAt));
  const delay = Math.max(0, nextAt - now);
  retryTimer = setTimeout(() => {
    void pumpOutbox();
  }, delay);
}

function todayDateLocal() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isFutureDoseOperation(op: SyncOperation): boolean {
  const today = todayDateLocal();
  if (op.kind === 'takeCommand') return op.payload.dose.scheduledDate > today;
  if (op.kind === 'skipCommand') return op.payload.dose.scheduledDate > today;
  if (op.kind === 'snoozeCommand') return op.payload.dose.scheduledDate > today;
  return false;
}

function normalizeSyncOperation(op: SyncOperation): SyncOperation {
  if (op.kind !== 'foodEntrySave') return op;
  return {
    kind: 'foodEntrySave',
    payload: {
      userId: op.payload.userId,
      entry: sanitizeFoodEntryForSync(op.payload.entry),
    },
  };
}

function normalizeStoredSyncOperation(item: StoredSyncOperation): StoredSyncOperation {
  return {
    ...item,
    ...normalizeSyncOperation(item),
  };
}

async function executeOperation(op: SyncOperation) {
  const normalizedOp = normalizeSyncOperation(op);
  if (isFutureDoseOperation(normalizedOp)) {
    console.warn('[sync-outbox] dropped future dose operation', normalizedOp.kind);
    return;
  }
  switch (normalizedOp.kind) {
    case 'protocolUpsert':
      return syncProtocolUpsert(normalizedOp.payload.userId, normalizedOp.payload.protocol);
    case 'protocolItemDelete':
      return syncProtocolItemDelete(normalizedOp.payload.userId, normalizedOp.payload.protocolId, normalizedOp.payload.itemId);
    case 'protocolDelete':
      return syncProtocolDelete(normalizedOp.payload.userId, normalizedOp.payload.protocolId);
    case 'activation':
      return syncActivation(normalizedOp.payload.userId, normalizedOp.payload.active, normalizedOp.payload.doses);
    case 'activeStatus':
      return syncActiveStatus(normalizedOp.payload.userId, normalizedOp.payload.activeId, normalizedOp.payload.patch);
    case 'regeneratedDoses':
      return syncRegeneratedDoses(normalizedOp.payload.userId, normalizedOp.payload.active, normalizedOp.payload.fromDate, normalizedOp.payload.newDoses);
    case 'takeCommand':
      return syncTakeDoseCommand(
        normalizedOp.payload.userId,
        normalizedOp.payload.dose,
        normalizedOp.payload.record,
        normalizedOp.payload.clientOperationId,
      );
    case 'skipCommand':
      return syncSkipDoseCommand(
        normalizedOp.payload.userId,
        normalizedOp.payload.dose,
        normalizedOp.payload.record,
        normalizedOp.payload.clientOperationId,
      );
    case 'snoozeCommand':
      return syncSnoozeDoseCommand(
        normalizedOp.payload.userId,
        normalizedOp.payload.dose,
        normalizedOp.payload.replacementDose,
        normalizedOp.payload.record,
        normalizedOp.payload.clientOperationId,
      );
    case 'pauseCommand':
      return syncPauseProtocolCommand(
        normalizedOp.payload.userId,
        normalizedOp.payload.activeId,
        normalizedOp.payload.pausedAt,
        normalizedOp.payload.clientOperationId,
      );
    case 'resumeCommand':
      return syncResumeProtocolCommand(
        normalizedOp.payload.userId,
        normalizedOp.payload.activeId,
        normalizedOp.payload.clientOperationId,
      );
    case 'completeCommand':
      return syncCompleteProtocolCommand(
        normalizedOp.payload.userId,
        normalizedOp.payload.activeId,
        normalizedOp.payload.completedAt,
        normalizedOp.payload.clientOperationId,
      );
    case 'archiveCommand':
      return syncArchiveProtocolCommand(
        normalizedOp.payload.userId,
        normalizedOp.payload.protocol,
        normalizedOp.payload.activeIds,
        normalizedOp.payload.clientOperationId,
      );
    case 'endProtocolFromToday':
      return syncEndProtocolFromTodayCommand(
        normalizedOp.payload.userId,
        normalizedOp.payload.activeProtocolId,
        normalizedOp.payload.today,
      );
    case 'removeDose':
      if (!normalizedOp.payload.dose) return Promise.resolve();
      return syncRemoveDoseCommand(normalizedOp.payload.userId, normalizedOp.payload.dose);
    case 'foodEntrySave':
      if (readPendingDeletedFoodEntryIds().includes(normalizedOp.payload.entry.id)) {
        return Promise.resolve();
      }
      return syncFoodEntrySave(normalizedOp.payload.userId, normalizedOp.payload.entry);
    case 'foodEntryDelete':
      await syncFoodEntryDelete(normalizedOp.payload.userId, normalizedOp.payload.entryId);
      removePendingDeletedFoodEntryId(normalizedOp.payload.entryId);
      return;
    case 'nutritionTargetProfileSave':
      return syncNutritionTargetProfileSave(normalizedOp.payload.userId, normalizedOp.payload.profile);
    case 'waterEntrySave':
      return syncWaterEntrySave(normalizedOp.payload.userId, normalizedOp.payload.entry);
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

export function enqueueSyncOperation(op: SyncOperation, options?: { pump?: boolean }): string | null {
  if (!hasWindow()) return null;
  const queue = readQueue();
  const id = crypto.randomUUID();
  const normalizedOp = normalizeSyncOperation(op);
  queue.push({
    ...normalizedOp,
    id,
    attempts: 0,
    createdAt: Date.now(),
    nextAttemptAt: Date.now(),
  });
  writeQueue(queue);
  if (options?.pump ?? true) void pumpOutbox();
  return id;
}

export function removeQueuedSyncOperation(id: string) {
  if (!hasWindow()) return;
  const queue = readQueue();
  const next = queue.filter(item => item.id !== id);
  if (next.length === queue.length) return;
  writeQueue(next);
  scheduleNextPump(next);
}

export function removeQueuedFoodEntrySaveOperations(userId: string, entryId: string) {
  if (!hasWindow()) return;
  const queue = readQueue();
  const next = removeStaleFoodEntrySaveOperationsFromQueue(queue, userId, entryId);
  if (next.length === queue.length) return;
  writeQueue(next);
  scheduleNextPump(next);
}

export function hasQueuedFoodEntrySaveOperation(userId: string, entryId: string): boolean {
  if (!hasWindow()) return false;
  return hasStaleFoodEntrySaveOperationInQueue(readQueue(), userId, entryId);
}

export function hasQueuedNutritionTargetProfileSaveOperation(userId: string): boolean {
  if (!hasWindow()) return false;
  return readQueue().some(item => (
    item.kind === 'nutritionTargetProfileSave' &&
    item.payload.userId === userId
  ));
}

// Run the pump body under a cross-tab Web Lock so two open tabs never drain the
// same queue concurrently (legacy non-idempotent ops would double-apply).
// Background pumps use ifAvailable — if another tab holds the lock, skip rather
// than queue up. flushSyncOutbox passes blocking=true to wait for the lock.
async function withOutboxLock(blocking: boolean, fn: () => Promise<void>): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.locks) {
    await fn();
    return;
  }
  await navigator.locks.request(
    LOCK_NAME,
    blocking ? {} : { ifAvailable: true },
    async (lock) => {
      if (!lock) return; // another tab is pumping
      await fn();
    },
  );
}

export async function pumpOutbox(options?: { force?: boolean; blocking?: boolean }) {
  await withOutboxLock(options?.blocking ?? false, () => pumpOutboxLocked(options?.force ?? false));
}

async function pumpOutboxLocked(force: boolean) {
  if (!hasWindow() || pumping) return;
  pumping = true;
  status.running = true;
  emit();
  let queue = readQueue();
  if (!queue.filter(item => !item.dead).length) {
    status.running = false;
    writeQueue(queue);
    pumping = false;
    return;
  }

  const now = Date.now();
  for (const item of [...queue]) {
    if (item.dead) continue;
    const liveBefore = readQueue();
    const liveItem = liveBefore.find(q => q.id === item.id);
    if (!liveItem || liveItem.dead) {
      queue = liveBefore;
      continue;
    }
    if (!force && liveItem.nextAttemptAt > now) {
      queue = liveBefore;
      continue;
    }
    try {
      await executeOperation(liveItem);
      let liveAfter = readQueue();
      if (liveItem.kind === 'foodEntryDelete') {
        liveAfter = removeStaleFoodEntrySaveOperationsFromQueue(
          liveAfter,
          liveItem.payload.userId,
          liveItem.payload.entryId,
        );
      }
      queue = removeSyncOperationFromQueueById(liveAfter, liveItem.id);
      writeQueue(queue);
      markSyncSuccess();
    } catch (error) {
      const attempts = liveItem.attempts + 1;
      const dead = attempts >= MAX_ATTEMPTS;
      const nextAttemptAt = dead ? liveItem.nextAttemptAt : Date.now() + nextBackoffMs(attempts);
      const liveAfter = readQueue();
      if (!liveAfter.some(q => q.id === item.id)) {
        queue = liveAfter;
        continue;
      }
      queue = liveAfter.map(q => {
        if (q.id !== item.id) return q;
        return {
          ...q,
          attempts,
          nextAttemptAt,
          dead: dead || undefined,
          lastError: error instanceof Error ? error.message : String(error),
        };
      });
      writeQueue(queue);
      if (dead) {
        console.error('[sync-outbox] operation dead-lettered after max attempts', liveItem.kind);
      }
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
  const countPending = () => readQueue().filter(item => !item.dead).length;
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    await pumpOutbox({ force: true, blocking: true });
    const pending = countPending();
    status.pending = pending;
    emit();
    if (pending === 0) {
      return { ok: true, pending: 0, lastError: null };
    }
    await waitMs(250);
  }
  const pending = countPending();
  status.pending = pending;
  emit();
  return { ok: pending === 0, pending, lastError: status.lastError };
}

/**
 * Discard dead-lettered operations that have exhausted all retries. Returns the
 * number removed. Live (still-retrying) operations are untouched.
 */
export function discardDeadLetteredOperations(): number {
  if (!hasWindow()) return 0;
  const queue = readQueue();
  const next = queue.filter(item => !item.dead);
  const removed = queue.length - next.length;
  if (removed > 0) {
    writeQueue(next);
    scheduleNextPump(next);
  }
  return removed;
}

export function startSyncOutbox() {
  if (started || !hasWindow()) return;
  started = true;
  const queue = readQueue();
  status.pending = queue.filter(item => !item.dead).length;
  status.deadLettered = queue.filter(item => item.dead).length;
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
  const inflightSaveIds = getInflightFoodEntrySaveIds();
  if (inflightSaveIds.length > 0) {
    clearPendingDeletedFoodEntryIdsExcept(inflightSaveIds);
  } else {
    clearPendingDeletedFoodEntryIds();
  }
  status.pending = 0;
  status.running = false;
  status.lastError = null;
  status.deadLettered = 0;
  emit();
}
