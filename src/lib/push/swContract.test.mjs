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
