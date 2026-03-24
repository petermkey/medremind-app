'use client';
import { useEffect } from 'react';
import { useStore } from '@/lib/store/store';

/**
 * Mounts invisible helpers only in E2E test mode.
 * Exposes store to window so tests can call store methods directly.
 */
export function E2ETestHelpers() {
  const store = useStore;

  useEffect(() => {
    if (typeof window === 'undefined') return;
    (window as any).__medremindStore = store;
  }, [store]);

  if (process.env.NODE_ENV === 'production') return null;

  return null;
}
