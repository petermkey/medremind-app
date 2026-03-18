'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { getSyncStatusSnapshot, subscribeSyncStatus, type SyncStatus } from '@/lib/supabase/syncOutbox';

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

  useEffect(() => {
    return subscribeSyncStatus(setStatus);
  }, []);

  return (
    <Link
      href="/app/settings"
      className={[
        'pointer-events-auto inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold backdrop-blur-md transition-colors',
        tone(status),
      ].join(' ')}
      title="Open settings for sync details"
    >
      <span>{status.lastError ? '!' : status.pending > 0 || status.running ? '…' : '✓'}</span>
      <span>{label(status)}</span>
    </Link>
  );
}
