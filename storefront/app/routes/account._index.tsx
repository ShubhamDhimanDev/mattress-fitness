import {redirect} from 'react-router';
import {accountNoStoreHeaders} from '~/lib/account/results';

export async function loader() {
  return redirect('/account/orders', {headers: accountNoStoreHeaders()});
}
