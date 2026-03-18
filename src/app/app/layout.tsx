'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useStore } from '@/lib/store/store';
import { getCurrentUser } from '@/lib/supabase/auth';
import { pullStoreFromSupabase } from '@/lib/supabase/cloudStore';
import { startSyncOutbox } from '@/lib/supabase/syncOutbox';
import { BottomNav } from '@/components/app/BottomNav';
import { SyncStatusPill } from '@/components/app/SyncStatusPill';
import { ToastProvider } from '@/components/ui/Toast';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { profile, setProfile, resetUserData } = useStore();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    startSyncOutbox();
    let cancelled = false;
    async function boot() {
      const user = await getCurrentUser();
      if (cancelled) return;
      if (!user) {
        resetUserData();
        router.replace('/login');
        setChecking(false);
        return;
      }

      if (profile?.id && profile.id !== user.id) {
        // Prevent cross-account bleed from persisted local state while switching users.
        resetUserData();
      }
      setProfile(user);
      if (!user.onboarded) {
        router.replace('/onboarding');
        setChecking(false);
        return;
      }

      try {
        await pullStoreFromSupabase();
      } catch {
        // Keep app usable if cloud pull fails; local store still works.
      } finally {
        if (!cancelled) setChecking(false);
      }
    }

    boot();
    return () => { cancelled = true; };
  }, []);

  if (checking || !profile?.onboarded) return (
    <div className="min-h-screen bg-[#0D1117] flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <ToastProvider>
      <div className="min-h-screen bg-[#070A10] flex items-center justify-center">
        <div className="
          flex flex-col bg-[#0D1117] w-full h-screen
          sm:w-[430px] sm:h-[900px] sm:rounded-[44px] sm:border sm:border-[rgba(255,255,255,0.08)]
          sm:shadow-[0_40px_80px_rgba(0,0,0,0.6),0_0_0_1px_rgba(255,255,255,0.04)]
          overflow-hidden relative
        ">
          <div className="absolute left-4 bottom-24 z-20 pointer-events-none">
            <SyncStatusPill />
          </div>
          <div className="flex-1 overflow-hidden">
            {children}
          </div>
          <BottomNav />
        </div>
      </div>
    </ToastProvider>
  );
}
