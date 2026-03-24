'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { getSyncStatusSnapshot, subscribeSyncStatus, type SyncStatus } from '@/lib/supabase/syncOutbox';

// Delay before showing a sync error in the UI — avoids flashing "Sync error"
// for transient failures that self-heal within the same operation (e.g. network blip
// followed by immediate outbox retry).
const ERROR_DISPLAY_DELAY_MS = 4000;

function tone(status: SyncStatus) {
  if (status.lastError) return 'border-[rgba(239,68,68,0.35)] bg-[rgba(239,68,68,0.12)] text-[#FCA5A5]';
  if (status.pending > 0 || status.running) return 'border-[rgba(245,158,11,0.35)] bg-[rgba(245,158,11,0.12)] text-[#FCD34D]';
  return 'border-[rgba(16,185,129,0.35)] bg-[rgba(16,185,129,0.12)] text-[#6EE7B7]';
}

function label(status: SyncStatus) {
  if (status.lastError) return 'Sync error';
  if (status.pending > 0 || status.running) return `Syncing ${status.pending}`;
  return 'Synced';
}

export function SyncStatusPill() {
  const [status, setStatus] = useState<SyncStatus>(getSyncStatusSnapshot());
  // displayedError is the debounced error: only set after ERROR_DISPLAY_DELAY_MS
  // of continuous failure. Cleared immediately on success.
  const [displayedError, setDisplayedError] = useState<string | null>(getSyncStatusSnapshot().lastError);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return subscribeSyncStatus((next) => {
      setStatus(next);
      if (next.lastError) {
        // Schedule error display after delay (if not already scheduled).
        if (!errorTimerRef.current) {
          errorTimerRef.current = setTimeout(() => {
            errorTimerRef.current = null;
            setDisplayedError(next.lastError);
          }, ERROR_DISPLAY_DELAY_MS);
        }
      } else {
        // Success — clear immediately, cancel any pending error timer.
        if (errorTimerRef.current) {
          clearTimeout(errorTimerRef.current);
          errorTimerRef.current = null;
        }
        setDisplayedError(null);
      }
    });
  }, []);

  const visibleStatus: SyncStatus = { ...status, lastError: displayedError };

  return (
    <Link
      href="/app/settings"
      className={[
        'pointer-events-auto inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold backdrop-blur-md transition-colors',
        tone(visibleStatus),
      ].join(' ')}
      title="Open settings for sync details"
    >
      <span>{visibleStatus.lastError ? '!' : visibleStatus.pending > 0 || visibleStatus.running ? '…' : '✓'}</span>
      <span>{label(visibleStatus)}</span>
    </Link>
  );
}
