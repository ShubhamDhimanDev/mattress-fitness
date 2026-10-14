import {describe, expect, it} from 'vitest';
import {
  createReplayStore,
  type CacheLike,
  type CacheStorageLike,
} from '~/lib/extend/replay-store';

// REQ-EXT-003 / T-03 / NFR-006: best-effort webhook id marks without a database.

function fakeStorage() {
  const entries = new Map<string, Response>();
  const opened: string[] = [];
  const cache: CacheLike = {
    match: (request) => Promise.resolve(entries.get(request.url)?.clone()),
    put: (request, response) => {
      entries.set(request.url, response);
      return Promise.resolve();
    },
  };
  const storage: CacheStorageLike = {
    open: (name) => {
      opened.push(name);
      return Promise.resolve(cache);
    },
  };
  return {storage, entries, opened};
}

describe('webhook replay store', () => {
  it('remembers a marked id in memory when there is no Cache API', async () => {
    const store = createReplayStore({now: () => 0});
    expect(await store.seen('wh-0001')).toBe(false);
    await store.markSeen('wh-0001');
    expect(await store.seen('wh-0001')).toBe(true);
  });

  it('shares marks through the Cache API, so another isolate sees them', async () => {
    const {storage, entries} = fakeStorage();
    const first = createReplayStore({now: () => 0, storage});
    await first.markSeen('wh-0002');
    expect(entries.size).toBe(1);
    const [key] = [...entries.keys()];
    expect(key).toContain('webhook-replay.invalid');
    expect(entries.values().next().value?.headers.get('Cache-Control')).toMatch(
      /^max-age=\d+$/,
    );

    const other = createReplayStore({now: () => 0, storage});
    expect(await other.seen('wh-0002')).toBe(true);
    expect(await other.seen('wh-0003')).toBe(false);
  });

  it('opens the cache lazily and once', async () => {
    const {storage, opened} = fakeStorage();
    const store = createReplayStore({now: () => 0, storage});
    expect(opened).toEqual([]);
    await store.seen('wh-0004');
    await store.markSeen('wh-0004');
    expect(opened).toEqual(['extend-webhook-replay']);
  });

  it('never throws when the cache is unavailable: it falls back to memory', async () => {
    const storage: CacheStorageLike = {
      open: () => Promise.reject(new Error('no cache here')),
    };
    const store = createReplayStore({now: () => 0, storage});
    expect(await store.seen('wh-0005')).toBe(false);
    await store.markSeen('wh-0005');
    expect(await store.seen('wh-0005')).toBe(true);
  });

  it('never throws when a cache read or write fails', async () => {
    const storage: CacheStorageLike = {
      open: () =>
        Promise.resolve({
          match: () => Promise.reject(new Error('read')),
          put: () => Promise.reject(new Error('write')),
        }),
    };
    const store = createReplayStore({now: () => 0, storage});
    expect(await store.seen('wh-0006')).toBe(false);
    await store.markSeen('wh-0006');
    expect(await store.seen('wh-0006')).toBe(true);
  });

  it('forgets a mark after its time to live in memory', async () => {
    const clock = {t: 0};
    const store = createReplayStore({now: () => clock.t});
    await store.markSeen('wh-0007');
    clock.t += 25 * 3_600_000;
    expect(await store.seen('wh-0007')).toBe(false);
  });

  it('encodes an id into the cache key, so it cannot reshape the URL', async () => {
    const {storage, entries} = fakeStorage();
    const store = createReplayStore({now: () => 0, storage});
    await store.markSeen('a/../b?x=1#y');
    const [key] = [...entries.keys()];
    expect(new URL(key ?? '').host).toBe('webhook-replay.invalid');
    expect(new URL(key ?? '').search).toBe('');
  });
});
