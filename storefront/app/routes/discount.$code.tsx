import {redirect} from 'react-router';
import type {Route} from './+types/discount.$code';
import {mayCreateCartFromLink} from '~/lib/cart/http';
import {parseDiscountCode, safeRedirectPath} from '~/lib/cart/input';
import {PRIVATE_NO_STORE_HEADERS} from '~/lib/pages/private-response';
import {mergeDiscountCodes} from '~/lib/shopify/discount-codes';

/**
 * Applies a discount code from the URL, then redirects (default: home).
 * `/discount/FREESHIPPING?redirect=/collections/mattresses`
 * The target must be a path on this site (`safeRedirectPath`); anything else, including `//host`,
 * backslashes, schemes and `javascript:`, goes to `/` (T-08). The code must be a plain code (T-01).
 * The code is added to the codes already on the cart, never in place of them (P-L4). The response sets a
 * cart cookie, so it is marked private (P-L3).
 */
export async function loader({request, context, params}: Route.LoaderArgs) {
  const {cart} = context;
  const searchParams = new URL(request.url).searchParams;

  const target = safeRedirectPath(
    searchParams.get('redirect') ?? searchParams.get('return_to'),
  );
  // Remaining parameters (utm tags and the like) travel with the redirect.
  searchParams.delete('redirect');
  searchParams.delete('return_to');
  const query = searchParams.toString();
  const redirectUrl = query
    ? `${target}${target.includes('?') ? '&' : '?'}${query}`
    : target;

  const code = parseDiscountCode(params.code);
  // Document navigations only (O-L4): an image, frame or prefetch of this URL must not touch the cart.
  if (!code || !mayCreateCartFromLink(request.headers)) {
    return redirect(redirectUrl, {
      headers: new Headers(PRIVATE_NO_STORE_HEADERS),
    });
  }

  // `cartDiscountCodesUpdate` replaces the whole list, so the cart's own codes are read first and kept.
  const existing = await cart.get();
  const result = await cart.updateDiscountCodes(
    mergeDiscountCodes(
      existing?.discountCodes?.map((applied) => applied.code) ?? [],
      code,
    ),
  );
  // Without a cart there is nothing to remember; the shopper still reaches the page.
  const headers = result.cart ? cart.setCartId(result.cart.id) : new Headers();
  for (const [name, value] of Object.entries(PRIVATE_NO_STORE_HEADERS)) {
    headers.set(name, value);
  }

  // A 303 with Set-Cookie does not work on a localhost origin with a port; it does on real hosts.
  return redirect(redirectUrl, {status: 303, headers});
}
