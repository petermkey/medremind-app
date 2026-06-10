import {
  enqueueSyncOperation,
  markSyncFailure,
  markSyncSuccess,
  pumpOutbox,
  removeQueuedSyncOperation,
  type SyncOperation,
} from '@/lib/supabase/syncOutbox';

const inflightRealtimeSync = new Set<Promise<unknown>>();

function trackRealtimeSync(task: Promise<unknown>) {
  inflightRealtimeSync.add(task);
  void task.finally(() => {
    inflightRealtimeSync.delete(task);
  });
  return task;
}

export async function waitForRealtimeSyncIdle(timeoutMs = 8_000): Promise<{ ok: boolean; pending: number }> {
  const startedAt = Date.now();
  while (inflightRealtimeSync.size > 0) {
    if (Date.now() - startedAt >= timeoutMs) {
      return { ok: false, pending: inflightRealtimeSync.size };
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return { ok: true, pending: 0 };
}

export function syncFireAndForget(task: Promise<unknown>, fallbackOp?: SyncOperation) {
  const queuedFallbackId = fallbackOp
    ? enqueueSyncOperation(fallbackOp, { pump: false })
    : null;
  const tracked = trackRealtimeSync(task);
  void tracked
    .then(() => {
      if (queuedFallbackId) removeQueuedSyncOperation(queuedFallbackId);
      markSyncSuccess();
    })
    .catch((err: unknown) => {
      markSyncFailure(err);
      if (queuedFallbackId) {
        void pumpOutbox({ force: true });
      } else if (fallbackOp) {
        enqueueSyncOperation(fallbackOp);
      }
    // Keep UX responsive; failed writes are queued for retry and logged for diagnostics.
    console.error('[realtime-sync]', err);
  });
}
