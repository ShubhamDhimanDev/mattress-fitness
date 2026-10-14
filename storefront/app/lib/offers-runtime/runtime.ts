// SERVER ONLY. The one place a route builds the offer runtime from its request context, so every route
// answers the production question the same way: production fails closed when the offer rules are missing
// (server.ts loadConfig), the dev server and mock stores run with offers off. It also reads the shopper's
// saved delivery ZIP (signed cookie) so every route judges haul-away against the same ZIP (P3B-11).

import type {Storefront} from '@shopify/hydrogen';
import {readDeliveryZip} from '~/lib/delivery-runtime/zip-cookie';
import type {CartHandlerLike, OfferRuntime} from './server';

/**
 * Takes the request because the ZIP lives in a cookie. Required on purpose: a route that forgot it would
 * judge every haul-away line as "no ZIP" and block checkout for a shopper who did save one.
 */
export async function offerRuntimeOf(
  context: {
    readonly storefront: Storefront;
    readonly cart: CartHandlerLike;
    readonly env: object;
  },
  request: Request,
): Promise<OfferRuntime> {
  return {
    storefront: context.storefront,
    cart: context.cart,
    env: context.env,
    production: import.meta.env.PROD,
    zip: await readDeliveryZip(request, context.env),
  };
}
