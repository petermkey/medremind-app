'use client';
import { createContext, useCallback, useContext, useState } from 'react';

type ToastType = 'success' | 'warning' | 'error' | 'info';

interface Toast { id: number; message: string; type: ToastType }

interface ToastCtx { show: (message: string, type?: ToastType) => void }
const ToastContext = createContext<ToastCtx>({ show: () => {} });

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  let nextId = 0;

  const show = useCallback((message: string, type: ToastType = 'success') => {
    const id = ++nextId;
    setToasts(t => [...t, { id, message, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 2500);
  }, []);

  const bgMap: Record<ToastType, string> = {
    success: 'bg-[#10B981]',
    warning: 'bg-[#FBBF24] text-black',
    error:   'bg-[#EF4444]',
    info:    'bg-[#3B82F6]',
  };

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[200] flex w-[calc(100vw-24px)] max-w-sm flex-col gap-2 pointer-events-none px-1">
        {toasts.map(t => (
          <div
            key={t.id}
            className={`${bgMap[t.type]} text-white text-sm font-semibold px-4 py-3 rounded-xl shadow-lg fade-in break-words leading-snug`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
