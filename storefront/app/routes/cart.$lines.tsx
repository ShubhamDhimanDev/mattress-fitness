import {redirect} from 'react-router';
import type {Route} from './+types/cart.$lines';
import {getCheckoutHref} from '~/lib/cart/checkout';
import {parseCartPermalink, parseDiscountCode} from '~/lib/cart/input';

/**
 * Permalink that builds a cart and goes to checkout: `/cart/<variant number>:<quantity>,...`.
 * Every variant number and quantity is validated (T-01); one invalid entry gives a 400 and nothing is
 * created. Only variant ids and quantities are accepted: prices, discounts and offers are Shopify's, and
 * the offer rules run on the cart page, not here. A `?discount=` code is applied only if it is a plain code.
 */
export async function loader({request, context, params}: Route.LoaderArgs) {
  const {cart} = context;
  const permalink = parseCartPermalink(params.lines);
  if (permalink.status === 'invalid') {
    throw new Response('This cart link is not valid.', {status: 400});
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
    throw new Response('This cart link may have expired.', {status: 410});
  }

  const headers = cart.setCartId(created.id);
  const checkout = getCheckoutHref(created);
  if (!checkout) throw new Error('No checkout URL found');
  return redirect(checkout, {headers});
}

export default function Component() {
  return null;
}
