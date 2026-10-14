// Registers the alias hooks once and imports the storefront libraries the detective report needs. See ts-hooks.mjs.

import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = pathToFileURL(path.resolve(HERE, '../../storefront/app/lib/')).href;

let registered = false;

/**
 * @returns {Promise<{
 *   detectWithConfig: typeof import('../../storefront/app/lib/detective/detect').detectWithConfig,
 *   unreadableOrderResult: typeof import('../../storefront/app/lib/detective/detect').unreadableOrderResult,
 *   detectiveConfigFromOffers: typeof import('../../storefront/app/lib/detective/config').detectiveConfigFromOffers,
 *   summarizeResults: typeof import('../../storefront/app/lib/detective/report').summarizeResults,
 *   parseDetectiveOrder: typeof import('../../storefront/app/lib/extend/admin-order').parseDetectiveOrder,
 *   DETECTIVE_ORDERS_PAGE_QUERY: string,
 *   DETECTIVE_ORDERS_PAGE_SIZE: number,
 *   parseOfferConfig: typeof import('../../storefront/app/lib/offers-runtime/config').parseOfferConfig,
 *   readOfferConfig: typeof import('../../storefront/app/lib/offers-runtime/config').readOfferConfig,
 *   normalizeShopifyId: typeof import('../../storefront/app/lib/extend/ids').normalizeShopifyId,
 * }>}
 */
export async function loadDetectiveLibs() {
  if (!registered) {
    register('./ts-hooks.mjs', import.meta.url);
    registered = true;
  }
  const [detect, config, report, adminOrder, offerConfig, ids] = await Promise.all([
    import(`${APP}/detective/detect.ts`),
    import(`${APP}/detective/config.ts`),
    import(`${APP}/detective/report.ts`),
    import(`${APP}/extend/admin-order.ts`),
    import(`${APP}/offers-runtime/config.ts`),
    import(`${APP}/extend/ids.ts`),
  ]);
  return {
    detectWithConfig: detect.detectWithConfig,
    unreadableOrderResult: detect.unreadableOrderResult,
    detectiveConfigFromOffers: config.detectiveConfigFromOffers,
    summarizeResults: report.summarizeResults,
    parseDetectiveOrder: adminOrder.parseDetectiveOrder,
    DETECTIVE_ORDERS_PAGE_QUERY: adminOrder.DETECTIVE_ORDERS_PAGE_QUERY,
    DETECTIVE_ORDERS_PAGE_SIZE: adminOrder.DETECTIVE_ORDERS_PAGE_SIZE,
    parseOfferConfig: offerConfig.parseOfferConfig,
    readOfferConfig: offerConfig.readOfferConfig,
    normalizeShopifyId: ids.normalizeShopifyId,
  };
}
