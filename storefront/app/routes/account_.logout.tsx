import {redirect} from 'react-router';
import type {Route} from './+types/account_.logout';
import {isSameOriginRequest} from '~/lib/cart/http';
import {
  accountErrorStatus,
  accountFailure,
  accountNoStoreHeaders,
  withAccountNoStore,
} from '~/lib/account/results';

// if we don't implement this, /account/logout will get caught by account.$.tsx to do login
export async function loader() {
  return redirect('/', {headers: accountNoStoreHeaders()});
}

export async function action({request, context}: Route.ActionArgs) {
  // Signing someone out from another site is a nuisance, not a breach, but the check is the same one every
  // other account action makes and costs nothing.
  if (!isSameOriginRequest(request)) {
    return new Response(JSON.stringify(accountFailure('forbidden')), {
      status: accountErrorStatus('forbidden'),
      headers: accountNoStoreHeaders({'Content-Type': 'application/json'}),
    });
  }
  return withAccountNoStore(await context.customerAccount.logout());
}
