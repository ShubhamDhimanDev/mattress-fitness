// SERVER ONLY. Webhook id de-duplication store: memory plus, where the platform has one, the Cache API (ADR-0009
// addendum: no database, NFR-006). Best effort by design: the Cache API is per data centre and eviction is allowed, so
// a miss only means a duplicate delivery is processed again, which the idempotent snapshot makes harmless. It is NOT the
// replay defence on its own; the per-order coalescer (order-coalescer.ts) and the idempotent PUT bound the work.
//
// The Cache API is passed in structurally so this module stays free of platform globals (ADR-0004) and tests use a fake.

import {
  createMemoryReplayStore,
  type WebhookReplayStore,
} from '~/lib/extend/webhook';
import type {NowFn} from '~/lib/extend/types';

export type CacheLike = {
  match: (request: Request) => Promise<Response | undefined>;
  put: (request: Request, response: Response) => Promise<void>;
};

export type CacheStorageLike = {open: (name: string) => Promise<CacheLike>};

const CACHE_NAME = 'extend-webhook-replay';
/** Longer than the 4 hours Shopify retries for plus the freshness window the route enforces. */
const MARK_TTL_SECONDS = 24 * 60 * 60;

// The key only has to be a unique GET URL; `.invalid` can never resolve, so it can never be fetched by mistake.
function keyFor(webhookId: string): Request {
  return new Request(
    `https://webhook-replay.invalid/${encodeURIComponent(webhookId)}`,
  );
}

export function createReplayStore(options: {
  now: NowFn;
  storage?: CacheStorageLike | undefined;
}): WebhookReplayStore {
  const memory = createMemoryReplayStore({
    now: options.now,
    ttlMs: MARK_TTL_SECONDS * 1000,
  });
  const storage = options.storage;
  if (storage === undefined) return memory;

  // Opened lazily and at most once; a failure to open is remembered as "no cache" and never throws into the route.
  let opened: Promise<CacheLike | null> | undefined;
  const cache = (): Promise<CacheLike | null> => {
    opened ??= storage.open(CACHE_NAME).then(
      (value) => value,
      () => null,
    );
    return opened;
  };

  return {
    async seen(webhookId) {
      if (await memory.seen(webhookId)) return true;
      try {
        const store = await cache();
        return (
          store !== null && (await store.match(keyFor(webhookId))) !== undefined
        );
      } catch {
        return false;
      }
    },
    async markSeen(webhookId) {
      await memory.markSeen(webhookId);
      try {
        const store = await cache();
        await store?.put(
          keyFor(webhookId),
          new Response('1', {
            headers: {'Cache-Control': `max-age=${MARK_TTL_SECONDS}`},
          }),
        );
      } catch {
        // Best effort: the in-memory mark above still holds for this isolate.
      }
    },
  };
}
