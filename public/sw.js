// MedRemind Service Worker — Web Push + offline app shell.
//
// Offline strategy:
//   • navigations: network-first, falling back to the cached shell — a stale
//     shell can only ever be served while offline;
//   • same-origin static assets (/_next/static/*, icons, manifest): cache-first
//     (Next.js content-hashes asset URLs, so a cached URL never goes stale);
//   • /api/* and non-GET requests: never intercepted — the sync outbox owns
//     offline write semantics.
//
// Bump SW_VERSION when changing caching logic here — activate() drops every
// medremind-* cache not in KNOWN_CACHES. Routine app deploys need no bump.

const APP_URL = self.location.origin;

const SW_VERSION = 'v1';
const SHELL_CACHE = 'medremind-shell-' + SW_VERSION;
const ASSET_CACHE = 'medremind-assets-' + SW_VERSION;
const KNOWN_CACHES = [SHELL_CACHE, ASSET_CACHE];

// The app shell: /app renders its loading skeleton without network (auth and
// data boot are client-side against persisted local state).
const PRECACHE_URLS = ['/app', '/manifest.json', '/icon-192.png', '/icon-512.png'];
const OFFLINE_FALLBACK_URL = '/app';

// Middleware can 307 an unauthenticated /app fetch to /login; a redirected
// response must never be cached under the requested key.
function isCacheableResponse(response) {
  return Boolean(response) && response.ok && !response.redirected;
}

function isStaticAssetPath(pathname) {
  return pathname.indexOf('/_next/static/') === 0 || PRECACHE_URLS.indexOf(pathname) !== -1;
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      Promise.allSettled(
        PRECACHE_URLS.map((url) =>
          fetch(new Request(url, { cache: 'reload' })).then((response) => {
            if (isCacheableResponse(response)) return cache.put(url, response);
            return undefined;
          }),
        ),
      ),
    ),
  );
  // Skip waiting so the new SW activates immediately without waiting for old
  // clients to close. Required for first-install on iOS Home Screen PWA.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.indexOf('medremind-') === 0 && KNOWN_CACHES.indexOf(key) === -1)
            .map((key) => caches.delete(key)),
        ),
      )
      // Take control of all open clients immediately so the first push received
      // after install is handled by this SW without a page reload.
      .then(() => self.clients.claim()),
  );
});

// ── Fetch: offline app shell ──────────────────────────────────────────────────

async function handleNavigation(request) {
  try {
    const response = await fetch(request);
    if (isCacheableResponse(response)) {
      const cache = await caches.open(SHELL_CACHE);
      await cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await caches.match(request, { ignoreSearch: true });
    if (cached) return cached;
    const fallback = await caches.match(OFFLINE_FALLBACK_URL);
    if (fallback) return fallback;
    throw err;
  }
}

async function handleStaticAsset(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (isCacheableResponse(response)) {
    const cache = await caches.open(ASSET_CACHE);
    await cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch (err) {
    return;
  }
  if (url.origin !== APP_URL) return;
  if (url.pathname.indexOf('/api/') === 0) return;

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request));
    return;
  }
  if (isStaticAssetPath(url.pathname)) {
    event.respondWith(handleStaticAsset(request));
  }
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

  const { title = 'MedRemind', body = '', url = '/app', tag, dedupeId } = payload;

  // renotify policy:
  //   tag present, no dedupeId          → new reminder on existing slot, re-alert the user
  //   tag present, valid dedupeId       → exact duplicate delivery, suppress re-alert
  //   no tag                            → generic fallback, use unique tag so it never
  //                                       overwrites an active reminder notification
  const hasValidDedupeId = typeof dedupeId === 'string' && dedupeId.length > 0;
  const notificationTag = tag ?? `medremind-fallback-${Date.now()}`;
  const renotify = tag != null && !hasValidDedupeId;

  const options = {
    body,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: notificationTag,
    renotify,
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
