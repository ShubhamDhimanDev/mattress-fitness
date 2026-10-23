// A small in-process stand-in for the Workers Cache API (`caches`), which the storefront uses in two places:
// Hydrogen's query cache (`caches.open('hydrogen')` in app/lib/context.ts) and the Extend webhook replay marks
// (app/lib/extend/replay-store.ts). Node has no `caches`. Hydrogen ships an `InMemoryCache`, but it never evicts an
// entry that is not asked for again; this one is bounded, so a stream of distinct search terms cannot grow memory
// without limit on a long-lived process. Same expiry rule as Hydrogen's: max-age plus stale-while-revalidate from
// the stored response's Cache-Control (or the `real-cache-control` Hydrogen writes).
//
// Bounds, per named cache (two are opened today, so the worst case is twice the byte limit):
//   - at most `maxEntries` entries;
//   - at most `maxBytes` of stored size (body plus header text plus key, an estimate of the heap held, not an exact figure);
//   - an entry larger than `maxBytes / MAX_ENTRY_FRACTION` is not stored at all (and replaces nothing), so one big
//     response cannot flush the whole cache;
//   - expired entries are removed by a sweep on write and by an unref'd timer, so an idle process lets go of them.
// The oldest write is evicted first. Nothing here is shared between processes.

const MAX_ENTRY_FRACTION = 8;
const encoder = new TextEncoder();

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

function seconds(control, directive) {
  return Number.parseInt(control.match(new RegExp(`${directive}=(\\d+)`))?.[1] ?? '0', 10);
}

/** Rough size of what an entry keeps alive. UTF-8 length, so it never under-counts non-ASCII header text. */
function sizeOf(key, body, headers) {
  let bytes = encoder.encode(key).byteLength + body.byteLength;
  for (const [name, value] of headers) bytes += encoder.encode(name).byteLength + encoder.encode(value).byteLength;
  return bytes;
}

class MemoryCache {
  #entries = new Map();
  #maxEntries;
  #maxBytes;
  #now;
  #sweepEveryMs;
  #lastSweep;
  #bytes = 0;

  constructor({ maxEntries, maxBytes, now, sweepEveryMs }) {
    this.#maxEntries = maxEntries;
    this.#maxBytes = maxBytes;
    this.#now = now;
    this.#sweepEveryMs = sweepEveryMs;
    this.#lastSweep = now();
  }

  add = notSupported('add');
  addAll = notSupported('addAll');
  matchAll = notSupported('matchAll');

  #remove(key) {
    const entry = this.#entries.get(key);
    if (entry === undefined) return false;
    this.#entries.delete(key);
    this.#bytes -= entry.size;
    return true;
  }

  /** Removes every entry that is past max-age plus stale-while-revalidate. Returns how many went. */
  sweep() {
    const now = this.#now();
    this.#lastSweep = now;
    let removed = 0;
    for (const [key, entry] of this.#entries) {
      if ((now - entry.timestamp) / 1000 > entry.maxAge + entry.swr) {
        this.#remove(key);
        removed += 1;
      }
    }
    return removed;
  }

  async put(request, response) {
    if (methodOf(request) !== 'GET') throw new TypeError('Cannot cache response to non-GET request.');
    if (response.status === 206) throw new TypeError('Cannot cache response to a range request (206 Partial Content).');
    if (response.headers.get('vary')?.includes('*'))
      throw new TypeError("Cannot cache response with 'Vary: *' header.");
    const key = keyOf(request);
    const body = new Uint8Array(await response.arrayBuffer());
    const headers = [...response.headers];
    const size = sizeOf(key, body, headers);
    // Whatever was stored under this key is out of date now, whether or not the new answer fits.
    this.#remove(key);
    if (size > this.#maxBytes / MAX_ENTRY_FRACTION) return;
    const control = response.headers.get('cache-control') || response.headers.get('real-cache-control') || '';
    // Insertion order is write order, so a refreshed key moves to the newest end.
    this.#entries.set(key, {
      body,
      status: response.status,
      headers,
      timestamp: this.#now(),
      maxAge: seconds(control, 'max-age'),
      swr: seconds(control, 'stale-while-revalidate'),
      size,
    });
    this.#bytes += size;
    if (this.#now() - this.#lastSweep >= this.#sweepEveryMs) this.sweep();
    while (this.#entries.size > this.#maxEntries || this.#bytes > this.#maxBytes) {
      const oldest = this.#entries.keys().next();
      if (oldest.done) break;
      this.#remove(oldest.value);
    }
  }

  async match(request) {
    if (methodOf(request) !== 'GET') return undefined;
    const key = keyOf(request);
    const entry = this.#entries.get(key);
    if (entry === undefined) return undefined;
    const ageSeconds = (this.#now() - entry.timestamp) / 1000;
    if (ageSeconds > entry.maxAge + entry.swr) {
      this.#remove(key);
      return undefined;
    }
    const headers = new Headers(entry.headers);
    headers.set('cache', ageSeconds > entry.maxAge ? 'STALE' : 'HIT');
    headers.set('date', new Date(entry.timestamp).toUTCString());
    return new Response(entry.body, { status: entry.status, headers });
  }

  async delete(request) {
    return this.#remove(keyOf(request));
  }

  async keys() {
    return [...this.#entries.keys()].map((url) => new Request(url));
  }

  get size() {
    return this.#entries.size;
  }

  get bytes() {
    return this.#bytes;
  }
}

/**
 * @param {{maxEntries?: number, maxBytes?: number, sweepIntervalMs?: number, now?: () => number}} [options]
 *   `maxEntries` and `maxBytes` apply to each named cache. `sweepIntervalMs` 0 turns the timer off (a sweep still runs on
 *   every write); the timer is unref'd so it never keeps the process alive.
 * @returns {{open: (name: string) => Promise<MemoryCache>, sweepAll: () => number, stop: () => void}}
 */
export function createCacheStorage(options = {}) {
  const maxEntries = options.maxEntries ?? 500;
  const maxBytes = options.maxBytes ?? 64 * 1024 * 1024;
  const sweepIntervalMs = options.sweepIntervalMs ?? 60_000;
  const now = options.now ?? (() => Date.now());
  /** @type {Map<string, MemoryCache>} */
  const caches = new Map();
  const sweepAll = () => {
    let removed = 0;
    for (const cache of caches.values()) removed += cache.sweep();
    return removed;
  };
  const timer = sweepIntervalMs > 0 ? setInterval(sweepAll, sweepIntervalMs) : undefined;
  timer?.unref();
  return {
    async open(name) {
      let cache = caches.get(name);
      if (cache === undefined) {
        cache = new MemoryCache({ maxEntries, maxBytes, now, sweepEveryMs: sweepIntervalMs });
        caches.set(name, cache);
      }
      return cache;
    },
    sweepAll,
    stop() {
      if (timer !== undefined) clearInterval(timer);
    },
  };
}
