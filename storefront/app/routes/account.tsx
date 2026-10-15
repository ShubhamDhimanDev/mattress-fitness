import {data, Form, NavLink, Outlet, useLoaderData} from 'react-router';
import type {Route} from './+types/account';
import {AccountErrorBoundary} from '~/components/account/AccountErrorBoundary';
import {CUSTOMER_DETAILS_QUERY} from '~/graphql/customer-account/CustomerDetailsQuery';
import {accountFailure, accountNoStoreHeaders} from '~/lib/account/results';
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
    // The login redirect is a Response and must reach the router untouched.
    if (error instanceof Response) throw error;
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
    <div className="account">
      <h1>{heading}</h1>
      <br />
      <AccountMenu />
      <br />
      <br />
      <Outlet context={{customer}} />
    </div>
  );
}

function AccountMenu() {
  function isActiveStyle({
    isActive,
    isPending,
  }: {
    isActive: boolean;
    isPending: boolean;
  }) {
    return {
      fontWeight: isActive ? 'bold' : undefined,
      color: isPending ? 'grey' : 'black',
    };
  }

  return (
    <nav role="navigation">
      <NavLink to="/account/orders" style={isActiveStyle}>
        Orders &nbsp;
      </NavLink>
      &nbsp;|&nbsp;
      <NavLink to="/account/profile" style={isActiveStyle}>
        &nbsp; Profile &nbsp;
      </NavLink>
      &nbsp;|&nbsp;
      <NavLink to="/account/addresses" style={isActiveStyle}>
        &nbsp; Addresses &nbsp;
      </NavLink>
      &nbsp;|&nbsp;
      <Logout />
    </nav>
  );
}

function Logout() {
  return (
    <Form className="account-logout" method="POST" action="/account/logout">
      &nbsp;<button type="submit">Sign out</button>
    </Form>
  );
}
