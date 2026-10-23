// A small in-process stand-in for the Workers Cache API (`caches`), which the storefront uses in two places:
// Hydrogen's query cache (`caches.open('hydrogen')` in app/lib/context.ts) and the Extend webhook replay marks
// (app/lib/extend/replay-store.ts). Node has no `caches`. Hydrogen ships an `InMemoryCache`, but it never evicts an
// entry that is not asked for again; this one is bounded, so a stream of distinct search terms cannot grow memory
// without limit on a long-lived process. Same expiry rule as Hydrogen's: max-age plus stale-while-revalidate from
// the stored response's Cache-Control (or the `real-cache-control` Hydrogen writes).
//
// Per process, not shared: with one process (the VPS runbook) that is exactly the Workers behaviour per isolate.

function notSupported(method) {
  return () => {
    throw new Error(`Cache.${method} is not supported; use put or match`);
  };
}

function keyOf(request) {
  return typeof request === 'string' ? request : request.url;
}

function methodOf(request) {
  return typeof request === 'string' ? 'GET' : request.method;
}

class MemoryCache {
  #entries = new Map();
  #maxEntries;
  #now;

  constructor(maxEntries, now) {
    this.#maxEntries = maxEntries;
    this.#now = now;
  }

  add = notSupported('add');
  addAll = notSupported('addAll');
  matchAll = notSupported('matchAll');

  async put(request, response) {
    if (methodOf(request) !== 'GET') throw new TypeError('Cannot cache response to non-GET request.');
    if (response.status === 206) throw new TypeError('Cannot cache response to a range request (206 Partial Content).');
    if (response.headers.get('vary')?.includes('*'))
      throw new TypeError("Cannot cache response with 'Vary: *' header.");
    const key = keyOf(request);
    const stored = {
      body: new Uint8Array(await response.arrayBuffer()),
      status: response.status,
      headers: [...response.headers],
      timestamp: this.#now(),
    };
    // Delete first so a refreshed key moves to the newest end of the insertion order.
    this.#entries.delete(key);
    this.#entries.set(key, stored);
    while (this.#entries.size > this.#maxEntries) {
      const oldest = this.#entries.keys().next();
      if (oldest.done) break;
      this.#entries.delete(oldest.value);
    }
  }

  async match(request) {
    if (methodOf(request) !== 'GET') return undefined;
    const key = keyOf(request);
    const entry = this.#entries.get(key);
    if (entry === undefined) return undefined;
    const headers = new Headers(entry.headers);
    const control = headers.get('cache-control') || headers.get('real-cache-control') || '';
    const maxAge = Number.parseInt(control.match(/max-age=(\d+)/)?.[1] ?? '0', 10);
    const swr = Number.parseInt(control.match(/stale-while-revalidate=(\d+)/)?.[1] ?? '0', 10);
    const ageSeconds = (this.#now() - entry.timestamp) / 1000;
    if (ageSeconds > maxAge + swr) {
      this.#entries.delete(key);
      return undefined;
    }
    headers.set('cache', ageSeconds > maxAge ? 'STALE' : 'HIT');
    headers.set('date', new Date(entry.timestamp).toUTCString());
    return new Response(entry.body, { status: entry.status, headers });
  }

  async delete(request) {
    return this.#entries.delete(keyOf(request));
  }

  async keys() {
    return [...this.#entries.keys()].map((url) => new Request(url));
  }

  get size() {
    return this.#entries.size;
  }
}

/**
 * @param {{maxEntries?: number, now?: () => number}} [options] `maxEntries` applies to each named cache.
 * @returns {{open: (name: string) => Promise<MemoryCache>}}
 */
export function createCacheStorage(options = {}) {
  const maxEntries = options.maxEntries ?? 500;
  const now = options.now ?? (() => Date.now());
  /** @type {Map<string, MemoryCache>} */
  const caches = new Map();
  return {
    async open(name) {
      let cache = caches.get(name);
      if (cache === undefined) {
        cache = new MemoryCache(maxEntries, now);
        caches.set(name, cache);
      }
      return cache;
    },
  };
}
