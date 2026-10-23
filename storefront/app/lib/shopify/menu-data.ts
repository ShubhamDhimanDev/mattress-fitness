// The navigation menu edited in Shopify admin (Online Store > Navigation), read for the header and the mobile
// drawer (REQ-NAV-002, P3B-02). The mapping to our routes is pure and lives in `lib/nav-menu.ts`; this module
// only runs the query and degrades: an absent menu, an empty menu or a failed read all mean `null`, and the
// layout then keeps the fixed navigation, so the header never goes missing (NFR-013).
//
// A menu carries no price, availability or shopper data, so it uses the long catalog cache (cache.ts). An edit in
// admin shows after the cache window (up to an hour fresh, then one stale answer while it refreshes).

import type {Storefront} from '@shopify/hydrogen';
import {errorFields, logError, logInfo} from '~/lib/logging/logger';
import {buildMainNav, ownHostsFrom, resolveMenuHandle} from '~/lib/nav-menu';
import type {MainNavItem} from '~/lib/navigation';
import {catalogCache} from '~/lib/shopify/cache';

/**
 * Three levels, which is what the Storefront API allows a menu to hold: top-level item, group, link. Only the
 * fields the mapper reads are requested (the item id is not used: ids are positions).
 */
export const MAIN_MENU_QUERY = `#graphql
  query MainMenu(
    $handle: String!
    $country: CountryCode
    $language: LanguageCode
  ) @inContext(country: $country, language: $language) {
    menu(handle: $handle) {
      items {
        title
        type
        url
        items {
          title
          type
          url
          items {
            title
            type
            url
          }
        }
      }
    }
  }
` as const;

type MenuEnv = {
  readonly PUBLIC_STORE_DOMAIN?: string;
  readonly PUBLIC_SITE_URL?: string;
  readonly PUBLIC_NAV_MENU_HANDLE?: string;
};

/**
 * The header menu as navigation items, or null when there is nothing usable (the caller keeps the fixed
 * navigation). The menu is opt-in: `PUBLIC_NAV_MENU_HANDLE` names the handle to read; unset, `none` or invalid reads nothing and makes no request. Only the
 * error's class name is logged (T-05).
 */
export async function loadMainNav(
  storefront: Storefront,
  env: MenuEnv,
): Promise<MainNavItem[] | null> {
  const handle = resolveMenuHandle(env.PUBLIC_NAV_MENU_HANDLE);
  if (handle === null) return null;
  try {
    const {menu} = await storefront.query(MAIN_MENU_QUERY, {
      cache: catalogCache(storefront),
      variables: {handle},
    });
    const {items, dropped} = buildMainNav(menu, {
      ownHosts: ownHostsFrom([env.PUBLIC_STORE_DOMAIN, env.PUBLIC_SITE_URL]),
    });
    if (dropped > 0) logInfo('nav.menu_entries_dropped', {count: dropped});
    return items.length > 0 ? items : null;
  } catch (error: unknown) {
    logError('nav.menu_read_failed', errorFields(error));
    return null;
  }
}
