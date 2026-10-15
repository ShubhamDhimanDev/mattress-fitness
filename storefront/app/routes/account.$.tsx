import {redirect} from 'react-router';
import type {Route} from './+types/account.$';
import {
  accountNoStoreHeaders,
  requireAccountSession,
} from '~/lib/account/results';

// fallback wild card for all unauthenticated routes in account section
export async function loader({context}: Route.LoaderArgs) {
  await requireAccountSession(context.customerAccount);

  return redirect('/account', {headers: accountNoStoreHeaders()});
}
