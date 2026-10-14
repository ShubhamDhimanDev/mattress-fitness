import {redirect, type HeadersFunction} from 'react-router';
import type {Route} from './+types/cart.$lines';
import {CHECKOUT_STEPS_PATH} from '~/lib/cart/checkout';
import {mayCreateCartFromLink, noStoreHeaders} from '~/lib/cart/http';
import {parseCartPermalink, parseDiscountCode} from '~/lib/cart/input';

// The cart cookie is set here: no shared cache may keep this response (P-L3).
export const headers: HeadersFunction = ({loaderHeaders, errorHeaders}) =>
  noStoreHeaders(errorHeaders ?? loaderHeaders);

function refuse(message: string, status: number): never {
  throw new Response(message, {status, headers: noStoreHeaders()});
}

/**
 * Permalink that builds a cart and continues to checkout: `/cart/<variant number>:<quantity>,...`.
 * Every variant number and quantity is validated first (T-01) and a request that is not a top-level
 * navigation is refused, so bad or embedded requests never create a Shopify cart (P-L4). Rate limiting
 * proper needs the hosting decision (Q-003). Only variant ids and quantities are accepted: prices,
 * discounts and offers are Shopify's. The cart is not sent straight to Shopify: it goes through the
 * server gate (`/checkout-steps`), which revalidates it with the offer engine like any other cart
 * (REQ-PRE-006), so a crafted permalink cannot carry a gift or service line past the rules.
 */
export async function loader({request, context, params}: Route.LoaderArgs) {
  const {cart} = context;
  const permalink = parseCartPermalink(params.lines);
  if (permalink.status === 'invalid') {
    return refuse('This cart link is not valid.', 400);
  }
  if (!mayCreateCartFromLink(request.headers)) {
    return refuse('This cart link must be opened directly.', 400);
  }

  const discount = parseDiscountCode(
    new URL(request.url).searchParams.get('discount'),
  );

  const result = await cart.create({
    lines: [...permalink.lines],
    discountCodes: discount ? [discount] : [],
  });

  const created = result.cart;
  if (result.errors?.length || !created) {
    return refuse('This cart link may have expired.', 410);
  }

  return redirect(CHECKOUT_STEPS_PATH, {
    headers: noStoreHeaders(cart.setCartId(created.id)),
  });
}

export default function Component() {
  return null;
}
