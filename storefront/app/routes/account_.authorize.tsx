import type {Route} from './+types/account_.authorize';
import {
  withAccountNoStore,
  withSameOriginRedirect,
} from '~/lib/account/results';

// The callback carries the authorization code and sets the session cookie: never cacheable (T-05, T-11).
// Hydrogen redirects to the target stored at login (`return_to` or the Referer) without checking its origin, so a
// target on another site is replaced with /account here, keeping the status and the session cookie (S-M1, T-08).
export async function loader({request, context}: Route.LoaderArgs) {
  const response = await context.customerAccount.authorize();
  return withAccountNoStore(withSameOriginRedirect(response, request.url));
}
