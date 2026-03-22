// MedRemind Service Worker — Web Push support
// Handles push events and notification clicks for iOS Home Screen PWA.

const APP_URL = self.location.origin;

// ── Lifecycle ─────────────────────────────────────────────────────────────────

self.addEventListener('install', (event) => {
  // Skip waiting so the new SW activates immediately without waiting for old
  // clients to close. Required for first-install on iOS Home Screen PWA.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Take control of all open clients immediately so the first push received
  // after install is handled by this SW without a page reload.
  event.waitUntil(self.clients.claim());
});

// ── Push ──────────────────────────────────────────────────────────────────────

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    // Fallback: treat raw text as the notification body.
    payload = { title: 'MedRemind', body: event.data.text(), url: '/app' };
  }

  const { title = 'MedRemind', body = '', url = '/app', tag } = payload;

  const options = {
    body,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: tag ?? 'medremind-dose',
    // renotify: show a new notification even if one with the same tag is active.
    renotify: Boolean(tag),
    data: { url },
    // iOS 16.4+ honors requireInteraction on Home Screen PWA.
    requireInteraction: false,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// ── Notification click ────────────────────────────────────────────────────────

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = (event.notification.data && event.notification.data.url)
    ? new URL(event.notification.data.url, APP_URL).href
    : APP_URL + '/app';

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // If the app is already open, focus it and navigate to the target URL.
        for (const client of clientList) {
          if (client.url.startsWith(APP_URL) && 'focus' in client) {
            client.postMessage({ type: 'NOTIFICATION_CLICK', url: targetUrl });
            return client.focus();
          }
        }
        // Otherwise open a new window.
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
      })
  );
});
