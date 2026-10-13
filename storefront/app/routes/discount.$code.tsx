import {redirect} from 'react-router';
import type {Route} from './+types/discount.$code';
import {parseDiscountCode, safeRedirectPath} from '~/lib/cart/input';

/**
 * Applies a discount code from the URL, then redirects (default: home).
 * `/discount/FREESHIPPING?redirect=/collections/mattresses`
 * The target must be a path on this site (`safeRedirectPath`); anything else, including `//host`,
 * backslashes, schemes and `javascript:`, goes to `/` (T-08). The code must be a plain code (T-01).
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
  if (!code) return redirect(redirectUrl);

  const result = await cart.updateDiscountCodes([code]);
  // Without a cart there is nothing to remember; the shopper still reaches the page.
  const headers = result.cart ? cart.setCartId(result.cart.id) : new Headers();

  // A 303 with Set-Cookie does not work on a localhost origin with a port; it does on real hosts.
  return redirect(redirectUrl, {status: 303, headers});
}
