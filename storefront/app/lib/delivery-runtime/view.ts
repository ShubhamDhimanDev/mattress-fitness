// SERVER ONLY. The one place that turns the environment and the saved ZIP into the `DeliveryView` every surface
// renders (the /delivery route, the root loader's seed). Keeping it in one function is what makes the header, the
// product page and the cart agree, including in the case where nothing can be said at all.

import {deliveryViewFor, type DeliveryView} from '~/lib/delivery/status';
import {deliveryZipSavingAvailable} from '~/lib/delivery-runtime/zip-cookie';
import {loadDeliveryZone} from '~/lib/delivery-runtime/zone';

/**
 * In production with a missing or short DELIVERY_COOKIE_SECRET no ZIP can be saved or read, so any yes or no would
 * be a guess: the answer is `service-unavailable` whatever ZIP is passed (P3B-11). The cause is logged once by
 * variable name inside `deliveryZipSavingAvailable`; nothing about the ZIP is logged here. Development keeps the
 * normal answer so the mock stores stay usable (saving there still answers with the fixed error).
 */
export function deliveryViewForEnv(
  env: object,
  zip: unknown,
  production: boolean = import.meta.env.PROD,
): DeliveryView {
  if (!deliveryZipSavingAvailable(env, production)) {
    return {status: 'service-unavailable'};
  }
  return deliveryViewFor(loadDeliveryZone(env), zip);
}
