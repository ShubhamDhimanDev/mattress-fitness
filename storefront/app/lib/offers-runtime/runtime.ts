// SERVER ONLY. The one place a route builds the offer runtime from its request context, so every route
// answers the production question the same way: production fails closed when the offer rules are missing
// (server.ts loadConfig), the dev server and mock stores run with offers off.

import type {Storefront} from '@shopify/hydrogen';
import type {CartHandlerLike, OfferRuntime} from './server';

export function offerRuntimeOf(context: {
  readonly storefront: Storefront;
  readonly cart: CartHandlerLike;
  readonly env: object;
}): OfferRuntime {
  return {
    storefront: context.storefront,
    cart: context.cart,
    env: context.env,
    production: import.meta.env.PROD,
  };
}
