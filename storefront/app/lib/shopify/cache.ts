// Cache strategy per kind of data (ARCHITECTURE section 7), in one place so a TTL decision with the client
// (open item in P3B-01) is a one-file change. Never cache the cart, customer, orders or anything keyed by
// a ZIP; never put personal data in a cache key (the key is the query plus its variables, which for
// catalog reads hold only handles, filters and cursors).

import type {Storefront} from '@shopify/hydrogen';

type CacheSource = Pick<Storefront, 'CacheLong' | 'CacheShort' | 'CacheNone'>;

export const catalogCache = (storefront: CacheSource) => storefront.CacheLong();

/** Price and availability: seconds, not hours, so a sell-out or a price change shows quickly. */
export const availabilityCache = (storefront: CacheSource) =>
  storefront.CacheShort();

export const searchCache = (storefront: CacheSource) => storefront.CacheShort();

/** Cart and customer reads. */
export const noCache = (storefront: CacheSource) => storefront.CacheNone();
