import {data, Form, NavLink, Outlet, useLoaderData} from 'react-router';
import type {Route} from './+types/account';
import {AccountErrorBoundary} from '~/components/account/AccountErrorBoundary';
import {Button} from '~/components/ui/Button';
import {CUSTOMER_DETAILS_QUERY} from '~/graphql/customer-account/CustomerDetailsQuery';
import {
  accountFailure,
  accountNoStoreHeaders,
  withAccountNoStoreIfResponse,
} from '~/lib/account/results';
import {errorFields, logError} from '~/lib/logging/logger';

export function shouldRevalidate() {
  return true;
}

// Everything under /account is one shopper's data: no cache of any kind may keep a document or a data
// response (T-05, T-11). The root's `private, no-cache` is replaced here; child routes inherit this value
// because none of them exports its own `headers`.
export function headers() {
  return accountNoStoreHeaders();
}

export async function loader({context}: Route.LoaderArgs) {
  const {customerAccount} = context;
  // The customer comes from the signed-in session only; the query below carries no id from the request. A
  // visitor who is not signed in is redirected to the login by the client.
  let result;
  try {
    result = await customerAccount.query(CUSTOMER_DETAILS_QUERY, {
      variables: {
        language: customerAccount.i18n.language,
      },
    });
  } catch (error: unknown) {
    // The login redirect is a Response: it still reaches the router as the same redirect, now with no-store.
    if (error instanceof Response) throw withAccountNoStoreIfResponse(error);
    logError('account.customer_read_failed', errorFields(error));
    throw data(accountFailure('failed'), {
      status: 500,
      headers: accountNoStoreHeaders(),
    });
  }

  const {data: customerData, errors} = result;
  if (errors?.length || !customerData?.customer) {
    logError('account.customer_read_failed', {
      reason: errors?.length ? 'graphql_errors' : 'no_customer',
    });
    throw data(accountFailure('failed'), {
      status: 500,
      headers: accountNoStoreHeaders(),
    });
  }

  return data(
    {customer: customerData.customer},
    {headers: accountNoStoreHeaders()},
  );
}

export function ErrorBoundary() {
  return <AccountErrorBoundary />;
}

export default function AccountLayout() {
  const {customer} = useLoaderData<typeof loader>();

  const heading = customer
    ? customer.firstName
      ? `Welcome, ${customer.firstName}`
      : `Welcome to your account.`
    : 'Account Details';

  return (
    <div className="account mx-auto flex max-w-page flex-col gap-6 py-8">
      <h1 className="type-display text-4xl md:text-5xl">{heading}</h1>
      <AccountMenu />
      <Outlet context={{customer}} />
    </div>
  );
}

const TAB_BASE =
  'inline-flex min-h-touch items-center rounded-pill border-2 px-4 text-base font-bold motion-safe:transition-colors';

function tabClassName({
  isActive,
  isPending,
}: {
  isActive: boolean;
  isPending: boolean;
}) {
  return [
    TAB_BASE,
    isActive
      ? 'border-ink-900 bg-ink-900 text-white'
      : 'border-line-strong bg-surface text-fg hover:border-ink-600 hover:bg-paper',
    isPending ? 'opacity-70' : '',
  ].join(' ');
}

function AccountMenu() {
  return (
    <nav aria-label="Account">
      <ul className="flex flex-wrap items-center gap-2">
        <li>
          <NavLink to="/account/orders" className={tabClassName}>
            Orders
          </NavLink>
        </li>
        <li>
          <NavLink to="/account/profile" className={tabClassName}>
            Profile
          </NavLink>
        </li>
        <li>
          <NavLink to="/account/addresses" className={tabClassName}>
            Addresses
          </NavLink>
        </li>
        <li>
          <NavLink to="/account/quiz" className={tabClassName}>
            Sleep quiz
          </NavLink>
        </li>
        <li>
          <Logout />
        </li>
      </ul>
    </nav>
  );
}

function Logout() {
  return (
    <Form className="account-logout" method="POST" action="/account/logout">
      <Button type="submit" variant="outline" size="sm" shape="pill">
        Sign out
      </Button>
    </Form>
  );
}
