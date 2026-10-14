// Registers the alias hooks once and imports the storefront's Extend libraries. See ts-hooks.mjs.

import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIB = pathToFileURL(path.resolve(HERE, '../../storefront/app/lib/extend/')).href;

let registered = false;

/**
 * @returns {Promise<{
 *   reconcile: typeof import('../../storefront/app/lib/extend/reconcile').reconcile,
 *   parseAdminOrder: typeof import('../../storefront/app/lib/extend/admin-order').parseAdminOrder,
 *   EXTEND_ORDERS_PAGE_QUERY: string,
 *   listQuoteQueries: typeof import('../../storefront/app/lib/extend/orders').listQuoteQueries,
 *   parseExtendConfig: typeof import('../../storefront/app/lib/extend/config').parseExtendConfig,
 *   parseExtendHost: typeof import('../../storefront/app/lib/extend/config').parseExtendHost,
 *   createOffersQuoteLookup: typeof import('../../storefront/app/lib/extend/offers').createOffersQuoteLookup,
 *   syncOrder: typeof import('../../storefront/app/lib/extend/sync').syncOrder,
 *   normalizeShopifyId: typeof import('../../storefront/app/lib/extend/ids').normalizeShopifyId,
 * }>}
 */
export async function loadExtendLibs() {
  if (!registered) {
    register('./ts-hooks.mjs', import.meta.url);
    registered = true;
  }
  const [reconcile, adminOrder, orders, config, offers, sync, ids] = await Promise.all([
    import(`${LIB}/reconcile.ts`),
    import(`${LIB}/admin-order.ts`),
    import(`${LIB}/orders.ts`),
    import(`${LIB}/config.ts`),
    import(`${LIB}/offers.ts`),
    import(`${LIB}/sync.ts`),
    import(`${LIB}/ids.ts`),
  ]);
  return {
    reconcile: reconcile.reconcile,
    parseAdminOrder: adminOrder.parseAdminOrder,
    EXTEND_ORDERS_PAGE_QUERY: adminOrder.EXTEND_ORDERS_PAGE_QUERY,
    listQuoteQueries: orders.listQuoteQueries,
    parseExtendConfig: config.parseExtendConfig,
    parseExtendHost: config.parseExtendHost,
    createOffersQuoteLookup: offers.createOffersQuoteLookup,
    syncOrder: sync.syncOrder,
    normalizeShopifyId: ids.normalizeShopifyId,
  };
}
