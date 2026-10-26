// Cache strategy per kind of data (ARCHITECTURE section 7), in one place so a TTL change is a one-file
// change. Never cache the cart, customer, orders or anything keyed by a ZIP; never put personal data in
// a cache key (the key is the query plus its variables, which for catalog reads hold only handles,
// filters, cursors and a normalised search term).
//
// Rule of thumb (DEC-024): any query that returns a price or availability uses the 60 second strategy,
// because a card showing a stale price or a sold-out size misleads the shopper before the live checkout
// corrects it. Only content with no price or availability (pages, menus, shop settings) is cached long.

import type {Storefront} from '~/lib/hydrogen/storefront';

type CacheSource = Pick<
  Storefront,
  'CacheLong' | 'CacheShort' | 'CacheNone' | 'CacheCustom'
>;

/** Fresh for 60 s, then served stale for up to 300 s while a refresh runs in the background. */
export const PRICED_MAX_AGE_SECONDS = 60;
export const PRICED_STALE_WHILE_REVALIDATE_SECONDS = 300;

/** Content that carries no price or availability: long. */
export const catalogCache = (storefront: CacheSource) => storefront.CacheLong();

/** Cards, listings, home and search: any query whose result includes price or availability (DEC-024). */
export const pricedCache = (storefront: CacheSource) =>
  storefront.CacheCustom({
    mode: 'public',
    maxAge: PRICED_MAX_AGE_SECONDS,
    staleWhileRevalidate: PRICED_STALE_WHILE_REVALIDATE_SECONDS,
  });

/** Price and availability on the product page: same window as the cards so the two never disagree for long. */
export const availabilityCache = pricedCache;

export const searchCache = pricedCache;

/** Cart and customer reads. */
export const noCache = (storefront: CacheSource) => storefront.CacheNone();
