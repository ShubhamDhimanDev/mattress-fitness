import {redirect} from 'react-router';
import type {Route} from './+types/account_.logout';
import {accountNoStoreHeaders, withAccountNoStore} from '~/lib/account/results';

// if we don't implement this, /account/logout will get caught by account.$.tsx to do login
export async function loader() {
  return redirect('/', {headers: accountNoStoreHeaders()});
}

export async function action({context}: Route.ActionArgs) {
  return withAccountNoStore(await context.customerAccount.logout());
}
