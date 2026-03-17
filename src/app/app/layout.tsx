'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useStore } from '@/lib/store/store';
import { BottomNav } from '@/components/app/BottomNav';
import { ToastProvider } from '@/components/ui/Toast';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const profile = useStore(s => s.profile);

  useEffect(() => {
    if (!profile) { router.replace('/login'); return; }
    if (!profile.onboarded) { router.replace('/onboarding'); return; }
  }, [profile, router]);

  if (!profile?.onboarded) return null;

  return (
    <ToastProvider>
      {/* Outer: dark bg on desktop to frame the phone */}
      <div className="min-h-screen bg-[#070A10] flex items-center justify-center">
        {/* Phone frame */}
        <div className="
          flex flex-col bg-[#0D1117] w-full h-screen
          sm:w-[430px] sm:h-[900px] sm:rounded-[44px] sm:border sm:border-[rgba(255,255,255,0.08)]
          sm:shadow-[0_40px_80px_rgba(0,0,0,0.6),0_0_0_1px_rgba(255,255,255,0.04)]
          overflow-hidden relative
        ">
          {/* Content area */}
          <div className="flex-1 overflow-hidden">
            {children}
          </div>

          {/* Bottom nav */}
          <BottomNav />
        </div>
      </div>
    </ToastProvider>
  );
}
