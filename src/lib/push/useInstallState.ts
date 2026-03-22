// Hook to detect whether the app is running as an installed Home Screen PWA.
// iOS only exposes PushManager when in standalone mode.

import { useEffect, useState } from 'react';

export type InstallState =
  | 'standalone'   // Running as installed Home Screen PWA — push available.
  | 'browser'      // Running in Safari/Chrome browser — push not available on iOS.
  | 'unknown';     // SSR / not yet determined.

export function useInstallState(): InstallState {
  const [state, setState] = useState<InstallState>('unknown');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    // navigator.standalone is true when launched from iOS Home Screen.
    // matchMedia standalone covers Android / desktop PWA installs.
    const isStandalone =
      (navigator as { standalone?: boolean }).standalone === true ||
      window.matchMedia('(display-mode: standalone)').matches;

    setState(isStandalone ? 'standalone' : 'browser');
  }, []);

  return state;
}
