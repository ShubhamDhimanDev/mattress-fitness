// What the site header may know about the shopper's chosen store (REQ-LOC-003, P3B-10). The `my_store` cookie is read on the server and validated
// against the store list; the page gets only the store's name, slug, public key and page path, never the cookie text, so a tampered cookie
// selects nothing and nothing private reaches the client or a shared cache key. The key is the same public `state.city.store` text the store
// page's forms post; the product page sends it back to ask for pickup stock, and the server validates it again.

import {
  MY_STORE_COOKIE,
  myStoreKey,
  readCookie,
  readMyStore,
} from '~/lib/pages/my-store';
import {storePath, type StoreIndex} from '~/lib/stores/grouping';

export type MyStoreSummary = {
  readonly name: string;
  readonly slug: string;
  /** `state.city.store`, validated server side again whenever it comes back. */
  readonly key: string;
  /** The store's own page, for "Try in store". */
  readonly path: string;
};

/** True when the request carries a `my_store` cookie at all, so the store list is loaded only then. */
export function hasMyStoreCookie(cookieHeader: string | null): boolean {
  return readCookie(cookieHeader, MY_STORE_COOKIE) !== null;
}

export function summarizeMyStore(
  index: StoreIndex,
  cookieHeader: string | null,
): MyStoreSummary | null {
  const store = readMyStore(index, cookieHeader);
  return store
    ? {
        name: store.name,
        slug: store.slug,
        key: myStoreKey(store),
        path: storePath(store),
      }
    : null;
}

/**
 * The summary out of the root loader's data, which components read untyped (to avoid an import cycle with the root
 * route). Anything that is not the expected shape means "no store".
 */
export function myStoreFromRootData(rootData: unknown): MyStoreSummary | null {
  if (typeof rootData !== 'object' || rootData === null) return null;
  const candidate = 'myStore' in rootData ? rootData.myStore : null;
  if (typeof candidate !== 'object' || candidate === null) return null;
  if (
    !('name' in candidate && 'slug' in candidate) ||
    !('key' in candidate && 'path' in candidate)
  ) {
    return null;
  }
  const {name, slug, key, path} = candidate;
  return typeof name === 'string' &&
    typeof slug === 'string' &&
    typeof key === 'string' &&
    typeof path === 'string'
    ? {name, slug, key, path}
    : null;
}
