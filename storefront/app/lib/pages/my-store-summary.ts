// What the site header may know about the shopper's chosen store (REQ-LOC-003, P3B-10). The `my_store`
// cookie is read on the server and validated against the store list; the page gets only the store's name
// and slug, never the cookie text, so a tampered cookie selects nothing and nothing private reaches the
// client or a shared cache key.

import {MY_STORE_COOKIE, readCookie, readMyStore} from '~/lib/pages/my-store';
import type {StoreIndex} from '~/lib/stores/grouping';

export type MyStoreSummary = {
  readonly name: string;
  readonly slug: string;
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
  return store ? {name: store.name, slug: store.slug} : null;
}
