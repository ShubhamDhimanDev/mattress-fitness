import type {Route} from './+types/account_.login';
import {cleanLoginUrl, withAccountNoStore} from '~/lib/account/results';

export async function loader({request, context}: Route.LoaderArgs) {
  // Hydrogen stores `return_to`, else the Referer, and redirects there after sign-in. Neither may point at
  // another site (S-M1, T-08): a cleaned address with `return_to=/account` is followed instead, so the value
  // Hydrogen reads is always one of ours. The check at the callback (account_.authorize) is the second layer.
  const cleaned = cleanLoginUrl(request);
  if (cleaned !== null) {
    return withAccountNoStore(
      new Response(null, {
        status: 302,
        headers: {Location: `${cleaned.pathname}${cleaned.search}`},
      }),
    );
  }

  const url = new URL(request.url);
  const acrValues = url.searchParams.get('acr_values') || undefined;
  const loginHint = url.searchParams.get('login_hint') || undefined;
  const loginHintMode = url.searchParams.get('login_hint_mode') || undefined;
  const locale = url.searchParams.get('locale') || undefined;

  // The redirect sets the login state cookie: never cacheable (T-05, T-11).
  const response = await context.customerAccount.login({
    countryCode: context.storefront.i18n.country,
    acrValues,
    loginHint,
    loginHintMode,
    locale,
  });
  return withAccountNoStore(response);
}
