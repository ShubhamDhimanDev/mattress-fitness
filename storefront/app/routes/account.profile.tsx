import type {CustomerFragment} from 'customer-accountapi.generated';
import type {CustomerUpdateInput} from '@shopify/hydrogen/customer-account-api-types';
import {CUSTOMER_UPDATE_MUTATION} from '~/graphql/customer-account/CustomerUpdateMutation';
import {
  data,
  Form,
  useActionData,
  useNavigation,
  useOutletContext,
} from 'react-router';
import type {Route} from './+types/account.profile';
import {isSameOriginRequest} from '~/lib/cart/http';
import {readSmallForm} from '~/lib/delivery-runtime/form';
import {
  accountErrorStatus,
  accountFailure,
  accountNoStoreHeaders,
  hasOversizedField,
  type AccountErrorCode,
  type AccountFailure,
} from '~/lib/account/results';
import {errorFields, logError, logWarn} from '~/lib/logging/logger';

/** What the page needs after a save: the two names, nothing else leaves the server (T-05). */
export type ActionResponse =
  | {
      readonly status: 'ok';
      readonly customer: Pick<CustomerFragment, 'firstName' | 'lastName'>;
    }
  | AccountFailure;

export const meta: Route.MetaFunction = () => {
  return [{title: 'Profile'}];
};

export async function loader({context}: Route.LoaderArgs) {
  await context.customerAccount.handleAuthStatus();

  return {};
}

const VALID_INPUT_KEYS = ['firstName', 'lastName'] as const;

function respond(body: ActionResponse) {
  const status = body.status === 'ok' ? 200 : accountErrorStatus(body.code);
  return data(body, {status, headers: accountNoStoreHeaders()});
}

function fail(code: AccountErrorCode) {
  return respond(accountFailure(code));
}

export async function action({request, context}: Route.ActionArgs) {
  const {customerAccount} = context;

  if (request.method !== 'PUT') return fail('method-not-allowed');
  if (!isSameOriginRequest(request)) return fail('forbidden');

  const read = await readSmallForm(request);
  if (read.status !== 'ok') return fail('invalid-request');
  const {form} = read;
  if (hasOversizedField(form, VALID_INPUT_KEYS)) {
    return fail('invalid-request');
  }

  // This ensures a login redirect never happens for a mutation (it is a fetch, not a navigation).
  if (!(await customerAccount.isLoggedIn())) return fail('signed-out');

  const customer: CustomerUpdateInput = {};
  for (const key of VALID_INPUT_KEYS) {
    const value = form.get(key);
    if (typeof value === 'string' && value.length) {
      customer[key] = value;
    }
  }

  try {
    const {data: result, errors} = await customerAccount.mutate(
      CUSTOMER_UPDATE_MUTATION,
      {
        variables: {
          customer,
          language: customerAccount.i18n.language,
        },
      },
    );

    // Messages from Shopify are not read: they can quote input (P-L8). Only their presence is.
    if (errors?.length) {
      logError('account.profile_failed', {reason: 'graphql_errors'});
      return fail('failed');
    }
    if (result?.customerUpdate?.userErrors?.length) {
      logWarn('account.profile_rejected');
      return fail('rejected');
    }
    const updated = result?.customerUpdate?.customer;
    if (!updated) {
      logError('account.profile_failed', {reason: 'no_result'});
      return fail('failed');
    }

    return respond({
      status: 'ok',
      customer: {firstName: updated.firstName, lastName: updated.lastName},
    });
  } catch (error: unknown) {
    // The client throws a redirect Response when the session ended during the call.
    if (error instanceof Response) return fail('signed-out');
    logError('account.profile_failed', errorFields(error));
    return fail('failed');
  }
}

export default function AccountProfile() {
  const account = useOutletContext<{customer: CustomerFragment}>();
  const {state} = useNavigation();
  const action = useActionData<ActionResponse>();
  const customer =
    action?.status === 'ok' ? action.customer : account?.customer;

  return (
    <div className="account-profile">
      <h2>My profile</h2>
      <br />
      <Form method="PUT">
        <legend>Personal information</legend>
        <fieldset>
          <label htmlFor="firstName">First name</label>
          <input
            id="firstName"
            name="firstName"
            type="text"
            autoComplete="given-name"
            placeholder="First name"
            aria-label="First name"
            defaultValue={customer.firstName ?? ''}
            minLength={2}
          />
          <label htmlFor="lastName">Last name</label>
          <input
            id="lastName"
            name="lastName"
            type="text"
            autoComplete="family-name"
            placeholder="Last name"
            aria-label="Last name"
            defaultValue={customer.lastName ?? ''}
            minLength={2}
          />
        </fieldset>
        {action?.status === 'error' ? (
          <p role="alert">
            <mark>
              <small>{action.message}</small>
            </mark>
          </p>
        ) : (
          <br />
        )}
        <button type="submit" disabled={state !== 'idle'}>
          {state !== 'idle' ? 'Updating' : 'Update'}
        </button>
      </Form>
    </div>
  );
}
