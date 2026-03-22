// Service worker registration and message bridge for Web Push.
// Called once from the app layout after auth bootstrap.

let registered = false;

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === 'undefined') return null;
  if (!('serviceWorker' in navigator)) return null;
  if (registered) return navigator.serviceWorker.ready;

  try {
    const registration = await navigator.serviceWorker.register('/sw.js', {
      scope: '/',
      // updateViaCache: 'none' forces the browser to always fetch the SW file
      // from the network, ensuring users get the latest SW without a hard refresh.
      updateViaCache: 'none',
    });
    registered = true;
    console.log('[sw] registered', registration.scope);

    // Wire NOTIFICATION_CLICK messages from the SW to the current window URL.
    // The SW cannot use the Next.js router directly — it postMessages the target URL.
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data?.type === 'NOTIFICATION_CLICK' && event.data.url) {
        window.location.href = event.data.url;
      }
    });

    return registration;
  } catch (err) {
    console.error('[sw] registration failed', err);
    return null;
  }
}

export async function getSwRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === 'undefined') return null;
  if (!('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.ready;
  } catch {
    return null;
  }
}
