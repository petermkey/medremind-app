# W1-C · Offline-First PWA — App-Shell Cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Read `docs/superpowers/plans/2026-07-18-feature-wave-master.md` FIRST — its Global Constraints, branch rules, and file-ownership matrix bind this plan (W1-C owns `public/sw.js`, `src/lib/push/swRegister*`, `src/app/app/layout.tsx`).

**Goal:** Today `public/sw.js` is push-only and the app is dead without network — the HTML/JS shell cannot load. After this plan, `/app` opens offline: the service worker serves a cached app shell, the client-side boot renders from the persisted Zustand localStorage state (which already exists), and writes keep queueing through the existing sync outbox (which already works — proven by the `offline take survives reload` E2E). The existing push + notificationclick behavior is preserved **exactly**.

**Architecture:** Extend `public/sw.js` with two runtime caches: `medremind-shell-<version>` (navigations, **network-first falling back to cache** — a stale shell can only ever be served while offline, which eliminates the stale-shell-after-deploy class of bug by construction) and `medremind-assets-<version>` (same-origin static assets: `/_next/static/*` is content-hashed and immutable, so **cache-first**; icons/manifest too). Deliberately NOT a build-manifest precache — Next.js App Router hashed chunk lists are brittle to enumerate at SW install time; instead the asset cache populates at runtime as the app loads, and the shell HTML is both precached on install and re-cached on every successful online navigation. `activate` deletes every `medremind-*` cache not in the current allowlist (version-stamped names). `skipWaiting`/`clients.claim` behavior stays. `/api/*` and non-GET requests are never touched. A `node:vm`-based contract test locks the SW's behavior (handlers registered, old-cache cleanup, offline navigation fallback, API passthrough, push semantics unchanged). One Playwright E2E: load → go offline → reload → shell renders.

**Tech Stack:** Plain-JS classic service worker (no bundling, no imports — `public/sw.js` is served as-is), Node `--experimental-strip-types --test` runner with `node:vm` for the contract test, Playwright (`context.setOffline`) for E2E.

## Verified current-state facts (do NOT re-derive)

- `public/sw.js` currently registers exactly four things: `install` (skipWaiting), `activate` (clients.claim), `push`, `notificationclick`. The push handler implements a tag/dedupeId renotify policy and `NOTIFICATION_CLICK` postMessage — Tasks below copy these blocks **verbatim, unchanged**.
- `src/lib/push/swRegister.ts` registers `/sw.js` with `scope: '/'` and `updateViaCache: 'none'` (the browser always refetches sw.js — a changed `SW_VERSION` therefore reaches clients without hard refresh). **No change needed to this file** — it already does the right thing; it is listed in the ownership matrix only so no other wave touches it.
- `src/app/app/layout.tsx` calls `registerServiceWorker()` unconditionally on mount and already survives offline boot: `getCurrentUser()` throws → catch keeps the app if `localProfile?.onboarded` (lines 44–62). The Zustand stores persist to localStorage. The boot drains the outbox before the cloud pull. **The only missing piece is the shell itself.**
- `middleware.ts` server-gates `/app` (redirect to `/login` when unauthenticated) with matcher excluding `_next/static`, `manifest.json`, `icon-*.png`. Consequences: (a) offline navigations never reach middleware, so the cached shell + client-side auth path handles them; (b) a fetch of `/app` can come back as a **redirected** 200 for `/login` — the SW must not cache redirected responses under the `/app` key (guard: `response.ok && !response.redirected`).
- `/app` HTML is a generic client-gated shell (no user data server-rendered into it) — caching it is safe.
- `manifest.json`, `icon-192.png`, `icon-512.png` exist in `public/`.
- Offline-write precedent: `tests/e2e/doseStatusPersistence.spec.ts` `offline take survives reload once back online` (uses `context.setOffline`). Playwright config: `workers: 1`, dev server on port 3200.
- `SyncStatusPill` (`src/components/app/SyncStatusPill.tsx`) is mounted in the layout inside `<div className="absolute left-4 bottom-24 z-20 pointer-events-none">` — the optional offline indicator reuses its pill styling and slots into the same wrapper.
- `package.json` `test:correlation` is the strip-types `--test` file list — the SW contract test (plain `.mjs`, zero TS imports) registers there.
- Repo rule: no `console.log` in committed code (`console.error` in existing code is a separate, allowed pattern; the new SW code uses neither).

## Spec

### Requirements

1. **Versioned caches.** `SW_VERSION` const stamped into `medremind-shell-<v>` / `medremind-assets-<v>`; `activate` deletes every cache whose name starts with `medremind-` and is not in the allowlist, then `clients.claim()` (existing behavior kept).
2. **Precache on install:** `/app`, `/manifest.json`, `/icon-192.png`, `/icon-512.png` — individually, tolerating failures (`Promise.allSettled`), never caching non-OK or redirected responses. `skipWaiting()` kept.
3. **Navigations (`request.mode === 'navigate'`):** network-first; successful non-redirected responses are re-cached (keeps the shell fresh on every online visit); on network failure serve `caches.match(request, { ignoreSearch: true })`, falling back to the cached `/app` shell.
4. **Static assets** (`/_next/static/*` + the precache URLs): cache-first with runtime population into the asset cache.
5. **Never intercept:** non-GET, cross-origin, `/api/*` (writes must hit the network and fail fast so the outbox — not the SW — owns retry semantics).
6. **Push preserved:** `push` and `notificationclick` handlers byte-for-byte identical to current `main`.
7. **Contract test** (node:vm) + **Playwright E2E** (offline reload renders the shell).
8. **Optional (cheap) offline indicator:** `OfflineBanner` pill in the app layout driven by `navigator.onLine` + `online`/`offline` events, styled like `SyncStatusPill`. Marked OPTIONAL — skip without guilt if anything about it turns non-trivial.

### Non-goals

- No migration, no API-response caching (Zustand persistence already covers offline reads), no background sync API, no offline queue changes (the outbox already handles queued writes), no `swRegister.ts` changes.

## Global Constraints

- Branch: `codex/w1c-offline-pwa` off fresh `origin/main` (`bash scripts/git-state-check.sh` first). Never push to `main`; PR at the end; STOP before merge.
- `public/sw.js` stays a classic script: no `import`/`export`, no top-level `await`; syntax must parse on iOS 16 Safari (the existing file's `??` and optional `catch` binding are fine — do NOT "modernize" or rewrite the verbatim push blocks).
- TypeScript strict for the optional banner; `npx tsc --noEmit` after any `.ts/.tsx` change; `npm run build` before the PR; no `console.log`; conventional commits.
- Verification gates before PR: `npx tsc --noEmit && npm run build && npm run test:unit && npm run test:correlation`.
- **Deploy note for the PR body:** bump `SW_VERSION` in any future PR that changes SW caching logic; routine app deploys do NOT require a bump (navigations are network-first, so fresh HTML+hashed assets flow through automatically).

## File Structure

- Modify: `public/sw.js` — caching lifecycle + fetch handler; push blocks untouched.
- Create: `src/lib/push/swContract.test.mjs` — node:vm contract test.
- Modify: `package.json` — register the test in `test:correlation`.
- Create (OPTIONAL): `src/components/app/OfflineBanner.tsx`.
- Modify (OPTIONAL): `src/app/app/layout.tsx` — mount the banner.
- Create: `tests/e2e/offlinePwa.spec.ts`.

---

### Task 1: Rewrite `public/sw.js` with the offline shell strategy

**Files:**
- Modify: `public/sw.js`

**Interfaces:**
- Produces: cache names `medremind-shell-v1` / `medremind-assets-v1` (consumed by Task 2's assertions and Task 4's E2E `caches.keys()` probe — the `medremind-shell-` prefix is load-bearing); unchanged push message contract (`{ title, body, url, tag, dedupeId }`) and `NOTIFICATION_CLICK` postMessage (consumed by `swRegister.ts`, unchanged).

- [ ] **Step 1: Replace the file with this exact content** (the `push` and `notificationclick` sections are the current file's blocks copied verbatim — diff them against `main` to confirm zero drift):

```js
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
```

- [ ] **Step 2: Confirm the push blocks did not drift**

Run: `git diff main -- public/sw.js | grep -E '^[-+].*(renotify|NOTIFICATION_CLICK|showNotification|dedupeId)' || echo "push blocks unchanged"`
Expected: `push blocks unchanged` (no +/− lines touching the push/notificationclick logic).

- [ ] **Step 3: Commit**

```bash
git add public/sw.js
git commit -m "feat: offline app-shell caching in service worker (network-first navigations)"
```

---

### Task 2: SW contract test (`node:vm`)

**Files:**
- Create: `src/lib/push/swContract.test.mjs`
- Modify: `package.json` (append to `test:correlation`)

**Interfaces:**
- Consumes: `public/sw.js` source (loaded as text, executed in a sandboxed vm context with fake `self`/`caches`/`fetch` — the SW file itself stays import-free).
- Produces: regression lock on: registered handlers, versioned-cache cleanup, offline navigation fallback, API/non-GET passthrough, unchanged push semantics.

- [ ] **Step 1: Write the failing test**

```js
// src/lib/push/swContract.test.mjs
// Contract test for public/sw.js: loads the classic service-worker script in a
// node:vm sandbox with fake self/caches/fetch and asserts the offline-shell
// behavior plus the unchanged push semantics. No browser needed.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const SW_URL = new URL('../../../public/sw.js', import.meta.url);
const ORIGIN = 'https://medremind.test';

class FakeCache {
  constructor() {
    this.entries = new Map();
  }

  keyFor(request) {
    return typeof request === 'string' ? request : request.url;
  }

  async put(request, response) {
    this.entries.set(this.keyFor(request), response);
  }

  async match(request) {
    return this.entries.get(this.keyFor(request));
  }
}

class FakeCacheStorage {
  constructor(initialNames = []) {
    this.stores = new Map(initialNames.map((name) => [name, new FakeCache()]));
    this.deleted = [];
  }

  async open(name) {
    if (!this.stores.has(name)) this.stores.set(name, new FakeCache());
    return this.stores.get(name);
  }

  async keys() {
    return Array.from(this.stores.keys());
  }

  async delete(name) {
    this.deleted.push(name);
    return this.stores.delete(name);
  }

  async match(request) {
    for (const store of this.stores.values()) {
      const hit = await store.match(request);
      if (hit) return hit;
    }
    return undefined;
  }
}

class FakeRequest {
  constructor(url, init = {}) {
    this.url = url;
    this.method = init.method ?? 'GET';
    this.mode = init.mode ?? 'no-cors';
    this.cache = init.cache;
  }
}

async function loadServiceWorker({ cacheNames = [], fetchImpl } = {}) {
  const source = await readFile(SW_URL, 'utf8');
  const listeners = new Map();
  const shownNotifications = [];
  const cacheStorage = new FakeCacheStorage(cacheNames);
  const swSelf = {
    location: { origin: ORIGIN },
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    skipWaiting() {},
    clients: {
      claim: async () => {},
      matchAll: async () => [],
      openWindow: async () => {},
    },
    registration: {
      showNotification: async (title, options) => {
        shownNotifications.push({ title, options });
      },
    },
  };
  const sandbox = {
    self: swSelf,
    caches: cacheStorage,
    fetch: fetchImpl ?? (async () => {
      throw new Error('network unavailable');
    }),
    Request: FakeRequest,
    URL,
    Date,
    Promise,
    console,
  };
  vm.createContext(sandbox);
  new vm.Script(source, { filename: 'sw.js' }).runInContext(sandbox);
  return { listeners, cacheStorage, shownNotifications };
}

test('registers install, activate, fetch, push, and notificationclick handlers', async () => {
  const { listeners } = await loadServiceWorker();
  for (const type of ['install', 'activate', 'fetch', 'push', 'notificationclick']) {
    assert.ok(listeners.has(type), `missing ${type} handler`);
  }
});

test('activate deletes stale medremind caches and keeps foreign ones', async () => {
  const { listeners, cacheStorage } = await loadServiceWorker({
    cacheNames: ['medremind-shell-v0', 'medremind-assets-v0', 'unrelated-cache'],
  });
  const event = {
    waitUntil(promise) {
      this.promise = promise;
    },
  };
  listeners.get('activate')(event);
  await event.promise;
  assert.deepEqual(cacheStorage.deleted.sort(), ['medremind-assets-v0', 'medremind-shell-v0']);
  assert.ok((await cacheStorage.keys()).includes('unrelated-cache'));
});

test('offline navigation falls back to the cached /app shell', async () => {
  const { listeners, cacheStorage } = await loadServiceWorker();
  const shell = await cacheStorage.open('medremind-shell-v1');
  await shell.put('/app', { ok: true, marker: 'shell-html' });

  const event = {
    request: new FakeRequest(`${ORIGIN}/app/progress?tab=oura`, { mode: 'navigate' }),
    respondWith(promise) {
      this.responsePromise = promise;
    },
  };
  listeners.get('fetch')(event);
  const response = await event.responsePromise;
  assert.equal(response.marker, 'shell-html');
});

test('API and non-GET requests are never intercepted', async () => {
  const { listeners } = await loadServiceWorker();
  const apiEvent = {
    request: new FakeRequest(`${ORIGIN}/api/health/oura/summary?days=90`, { mode: 'cors' }),
    respondWith() {
      this.called = true;
    },
  };
  listeners.get('fetch')(apiEvent);
  assert.notEqual(apiEvent.called, true);

  const postEvent = {
    request: new FakeRequest(`${ORIGIN}/app`, { method: 'POST', mode: 'navigate' }),
    respondWith() {
      this.called = true;
    },
  };
  listeners.get('fetch')(postEvent);
  assert.notEqual(postEvent.called, true);
});

test('successful navigations are re-cached; redirected responses are not', async () => {
  const freshResponse = { ok: true, redirected: false, marker: 'fresh', clone: () => ({ marker: 'fresh-clone' }) };
  const { listeners, cacheStorage } = await loadServiceWorker({ fetchImpl: async () => freshResponse });
  const event = {
    request: new FakeRequest(`${ORIGIN}/app`, { mode: 'navigate' }),
    respondWith(promise) {
      this.responsePromise = promise;
    },
  };
  listeners.get('fetch')(event);
  assert.equal((await event.responsePromise).marker, 'fresh');
  const shell = await cacheStorage.open('medremind-shell-v1');
  assert.equal((await shell.match(`${ORIGIN}/app`)).marker, 'fresh-clone');

  const redirected = { ok: true, redirected: true, marker: 'login', clone: () => ({ marker: 'login-clone' }) };
  const { listeners: listeners2, cacheStorage: cacheStorage2 } = await loadServiceWorker({ fetchImpl: async () => redirected });
  const event2 = {
    request: new FakeRequest(`${ORIGIN}/app`, { mode: 'navigate' }),
    respondWith(promise) {
      this.responsePromise = promise;
    },
  };
  listeners2.get('fetch')(event2);
  assert.equal((await event2.responsePromise).marker, 'login');
  const shell2 = await cacheStorage2.open('medremind-shell-v1');
  assert.equal(await shell2.match(`${ORIGIN}/app`), undefined);
});

test('push semantics are unchanged: tag renotify policy and payload mapping', async () => {
  const { listeners, shownNotifications } = await loadServiceWorker();
  const pushHandler = listeners.get('push');

  const tagged = {
    data: { json: () => ({ title: 'Dose due', body: 'Vitamin D3', url: '/app', tag: 'slot-08' }) },
    waitUntil(promise) {
      this.promise = promise;
    },
  };
  pushHandler(tagged);
  await tagged.promise;

  const deduped = {
    data: { json: () => ({ title: 'Dose due', body: 'Vitamin D3', url: '/app', tag: 'slot-08', dedupeId: 'abc' }) },
    waitUntil(promise) {
      this.promise = promise;
    },
  };
  pushHandler(deduped);
  await deduped.promise;

  assert.equal(shownNotifications.length, 2);
  assert.equal(shownNotifications[0].title, 'Dose due');
  assert.equal(shownNotifications[0].options.tag, 'slot-08');
  assert.equal(shownNotifications[0].options.renotify, true);
  assert.equal(shownNotifications[0].options.data.url, '/app');
  assert.equal(shownNotifications[1].options.renotify, false);
});
```

- [ ] **Step 2: Run the test**

Run: `node --experimental-strip-types --test src/lib/push/swContract.test.mjs`
Expected: 6 tests PASS. (If Task 1 was skipped or the cache names differ, the shell-fallback and re-cache tests FAIL — that is the contract doing its job. If you wrote this test before Task 1, expected first run: FAIL on the missing `fetch` handler; either order is acceptable as long as you witness both states.)

- [ ] **Step 3: Register in `test:correlation`**

In `package.json`, append ` src/lib/push/swContract.test.mjs` to the end of the `test:correlation` file list.

Run: `npm run test:correlation`
Expected: full suite passes (all previously-passing tests + 6 new).

- [ ] **Step 4: Commit**

```bash
git add src/lib/push/swContract.test.mjs package.json
git commit -m "test: service-worker contract — offline shell, cache cleanup, push semantics"
```

---

### Task 3 (OPTIONAL — skip if anything turns non-trivial): Offline indicator pill

**Files:**
- Create: `src/components/app/OfflineBanner.tsx`
- Modify: `src/app/app/layout.tsx`

**Interfaces:**
- Consumes: browser `navigator.onLine` + `online`/`offline` window events only (no SW coupling, no store coupling).
- Produces: `export function OfflineBanner()` — a pill matching `SyncStatusPill` styling, rendered above it in the layout.

- [ ] **Step 1: Write the component**

```tsx
'use client';

import { useEffect, useState } from 'react';

// Minimal offline indicator: browser connectivity only. The SyncStatusPill
// below it already reports outbox state (pending count / errors).
export function OfflineBanner() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    setOffline(!navigator.onLine);
    const handleOffline = () => setOffline(true);
    const handleOnline = () => setOffline(false);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);
    return () => {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
    };
  }, []);

  if (!offline) return null;

  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-[rgba(245,158,11,0.35)] bg-[rgba(245,158,11,0.12)] px-2.5 py-1 text-[11px] font-semibold text-[#FCD34D] backdrop-blur-md">
      <span>⚠</span>
      <span>Offline — changes will sync later</span>
    </span>
  );
}
```

- [ ] **Step 2: Mount it in the layout**

In `src/app/app/layout.tsx`, add the import next to the other component imports:

```ts
import { OfflineBanner } from '@/components/app/OfflineBanner';
```

and replace the pill wrapper

```tsx
          <div className="absolute left-4 bottom-24 z-20 pointer-events-none">
            <SyncStatusPill />
          </div>
```

with

```tsx
          <div className="absolute left-4 bottom-24 z-20 pointer-events-none flex flex-col items-start gap-2">
            <OfflineBanner />
            <SyncStatusPill />
          </div>
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm run build`
Expected: both clean.

- [ ] **Step 4: Commit**

```bash
git add src/components/app/OfflineBanner.tsx src/app/app/layout.tsx
git commit -m "feat: offline indicator pill above the sync status pill"
```

---

### Task 4: Playwright E2E — shell renders offline

**Files:**
- Create: `tests/e2e/offlinePwa.spec.ts`

**Interfaces:**
- Consumes: the `medremind-shell-` cache-name prefix (Task 1), the login helper pattern from `smoke.spec.ts`, `context.setOffline` from the `doseStatusPersistence.spec.ts` precedent. No DB writes → no `afterEach` cleanup needed. Requires `E2E_EMAIL`/`E2E_PASSWORD` (skips otherwise).
- Known caveat, do NOT "fix" it by weakening the assertion: Playwright's network emulation is per-target; on some Chromium versions service-worker fetches may bypass `setOffline`. The test therefore FIRST proves the shell is genuinely in the cache (`caches.match('/app')`), THEN does the offline reload. If the reload assertion flakes on your Chromium build, keep the cache assertions and mark ONLY the reload block with `test.fixme` + a comment referencing this plan — never delete the cache proof.

- [ ] **Step 1: Write the spec**

```ts
import { expect, test, type Page } from '@playwright/test';

const e2eEmail = process.env.E2E_EMAIL;
const e2ePassword = process.env.E2E_PASSWORD;
const hasAuthCreds = Boolean(e2eEmail && e2ePassword);

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(e2eEmail!);
  await page.getByLabel('Password').fill(e2ePassword!);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/(app|onboarding)(\/|$)/, { timeout: 30_000 });
}

test.describe('offline PWA shell (requires E2E_EMAIL and E2E_PASSWORD)', () => {
  test.skip(!hasAuthCreds, 'Set E2E_EMAIL and E2E_PASSWORD to run the offline shell E2E.');

  test('app shell is cached and renders from cache when offline', async ({ page, context }) => {
    await login(page);
    await page.waitForURL('/app', { timeout: 30_000 });

    // 1. Prove the SW took control and the shell landed in the versioned cache.
    await page.waitForFunction(async () => {
      if (!('serviceWorker' in navigator)) return false;
      if (!navigator.serviceWorker.controller) return false;
      const keys = await caches.keys();
      const shellKey = keys.find((key) => key.startsWith('medremind-shell-'));
      if (!shellKey) return false;
      const cache = await caches.open(shellKey);
      return Boolean(await cache.match('/app'));
    }, undefined, { timeout: 30_000 });

    // 2. Go offline and reload — the SW must serve the cached shell and the
    //    client boot must render from persisted local state.
    await context.setOffline(true);
    try {
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.getByText("Today's progress")).toBeVisible({ timeout: 30_000 });
    } finally {
      await context.setOffline(false);
    }
  });
});
```

- [ ] **Step 2: Run the spec**

Run: `set -a && source .env.local && set +a && npx playwright test tests/e2e/offlinePwa.spec.ts`
Expected: `1 passed`. If the reload step fails with `net::ERR_INTERNET_DISCONNECTED` **and** step 1 passed, apply the caveat procedure from the Interfaces block (keep cache proof, `test.fixme` the reload with a comment) and record it as a deviation in the PR body.

- [ ] **Step 3: Offline-write regression (already-existing test)**

Run: `set -a && source .env.local && set +a && npx playwright test tests/e2e/doseStatusPersistence.spec.ts`
Expected: passes — proves the SW does not interfere with the outbox's offline write path (the SW never intercepts `/api/*` or non-GET).

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/offlinePwa.spec.ts
git commit -m "test: offline e2e — shell served from cache after reload"
```

---

### Task 5: Full verification + PR

- [ ] **Step 1: Full local gate**

Run: `npx tsc --noEmit && npm run test:correlation && npm run test:unit && npm run build`
Expected: all pass.

- [ ] **Step 2: Manual sanity pass (dev server)**

Start the dev server, sign in, open DevTools → Application → Service Workers: confirm `sw.js` is activated and `medremind-shell-v1` / `medremind-assets-v1` appear under Cache Storage. Toggle "Offline" in DevTools Network, reload `/app` — the shell and today's schedule (from persisted state) must render; push notifications settings page must still show the subscription as before.

- [ ] **Step 3: Open PR**

```bash
git push -u origin codex/w1c-offline-pwa
gh pr create --base main --title "feat: offline-first PWA — versioned app-shell cache in the service worker" --body "Implements docs/superpowers/plans/2026-07-18-offline-pwa.md (W1-C). Network-first navigations with cached-shell fallback, cache-first hashed assets, versioned medremind-* caches cleaned on activate, push/notificationclick handlers byte-identical to main (locked by a node:vm contract test). /api/* and non-GET are never intercepted, so the sync outbox keeps owning offline writes. No migration.

Deploy note: future PRs that change SW caching logic must bump SW_VERSION; routine deploys need no bump (navigations are network-first).

Verification: tsc, build, test:unit, test:correlation (incl. 6 SW contract tests), offlinePwa.spec.ts + doseStatusPersistence.spec.ts green."
```

STOP — do not merge (production deploy on merge; owner-only action).
