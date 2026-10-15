import type {Route} from './+types/account_.authorize';
import {withAccountNoStore} from '~/lib/account/results';

// The callback carries the authorization code and sets the session cookie: never cacheable (T-05, T-11).
export async function loader({context}: Route.LoaderArgs) {
  return withAccountNoStore(await context.customerAccount.authorize());
}
