import {redirect} from 'react-router';
import type {Route} from './+types/account.$';
import {accountNoStoreHeaders} from '~/lib/account/results';

// fallback wild card for all unauthenticated routes in account section
export async function loader({context}: Route.LoaderArgs) {
  await context.customerAccount.handleAuthStatus();

  return redirect('/account', {headers: accountNoStoreHeaders()});
}
