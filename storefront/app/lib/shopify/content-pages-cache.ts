// Which cache window a content read gets (security review C-M2). Pages, blogs and articles are cached long (an hour,
// cache.ts), but the handle comes from the URL: every junk handle would otherwise leave an hour-long "not found"
// entry in the 500-entry in-memory cache and push out entries that matter. So a handle starts on the SHORT window and
// moves to the long one only after Shopify has actually answered with content for it (`rememberFound`), which
// makes the strategy follow the answer: an unknown handle, a null page or a null article never gets a long entry.
// The registry's own handles (at most 15 pages) are always long: they are known to be worth keeping.
//
// The memory holds handles only, is the same for every shopper, and is bounded.

import {catalogCache} from '~/lib/shopify/cache';

type CacheSource = Parameters<typeof catalogCache>[0];

const MAX_KNOWN = 200;
const known = new Set<string>();

/** The cache strategy for a content read: long for a known good key, short otherwise. */
export function contentCache(
  storefront: CacheSource,
  key: string,
  options: {readonly alwaysLong?: boolean} = {},
) {
  return options.alwaysLong === true || known.has(key)
    ? catalogCache(storefront)
    : storefront.CacheShort();
}

/** Records that Shopify answered with content for `key`, so the next read of it may use the long window. */
export function rememberFound(key: string): void {
  if (known.size >= MAX_KNOWN) known.clear();
  known.add(key);
}

/** Test seam: forgets what was found, like a fresh isolate. */
export function resetContentCacheMemory(): void {
  known.clear();
}
