'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useStore } from '@/lib/store/store';
import { getCurrentUser } from '@/lib/supabase/auth';
import { BottomNav } from '@/components/app/BottomNav';
import { ToastProvider } from '@/components/ui/Toast';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { profile, updateProfile } = useStore();
  const [checking, setChecking] = useState(!profile); // skip check if already in store

  useEffect(() => {
    if (profile?.onboarded) { setChecking(false); return; }

    getCurrentUser().then(user => {
      if (!user) {
        router.replace('/login');
      } else {
        updateProfile(user);
        if (!user.onboarded) router.replace('/onboarding');
        setChecking(false);
      }
    });
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
          <div className="flex-1 overflow-hidden">
            {children}
          </div>
          <BottomNav />
        </div>
      </div>
    </ToastProvider>
  );
}
