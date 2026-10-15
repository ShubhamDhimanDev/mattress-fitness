import type {CustomerAddressInput} from '@shopify/hydrogen/customer-account-api-types';
import type {CustomerAccount} from '@shopify/hydrogen';
import type {
  AddressFragment,
  CustomerFragment,
} from 'customer-accountapi.generated';
import {
  data,
  Form,
  useActionData,
  useNavigation,
  useOutletContext,
  type Fetcher,
} from 'react-router';
import type {Route} from './+types/account.addresses';
import {
  UPDATE_ADDRESS_MUTATION,
  DELETE_ADDRESS_MUTATION,
  CREATE_ADDRESS_MUTATION,
} from '~/graphql/customer-account/CustomerAddressMutations';
import {isSameOriginRequest} from '~/lib/cart/http';
import {readSmallForm} from '~/lib/delivery-runtime/form';
import {
  NEW_ADDRESS_FORM_ID,
  accountErrorStatus,
  accountFailure,
  accountNoStoreHeaders,
  hasOversizedField,
  parseAddressId,
  type AccountErrorCode,
  type AccountFailure,
} from '~/lib/account/results';
import {errorFields, logError, logWarn} from '~/lib/logging/logger';

type AddressOperation = 'create' | 'update' | 'delete';

/**
 * The result the page reads. `addressId` is the id the form posted (the form that shows the message), or null
 * when the request named no usable address. No Shopify or exception text is ever part of it (P-L8).
 */
export type ActionResponse =
  | {
      readonly status: 'ok';
      readonly operation: AddressOperation;
      readonly addressId: string;
      readonly defaultAddress: boolean;
    }
  | (AccountFailure & {readonly addressId: string | null});

export const meta: Route.MetaFunction = () => {
  return [{title: 'Addresses'}];
};

export async function loader({context}: Route.LoaderArgs) {
  await context.customerAccount.handleAuthStatus();

  return {};
}

// A form is a few short text fields; 8 KB is generous for ten of them and refuses anything abusive early.
const ADDRESS_FORM_MAX_BYTES = 8192;

const ADDRESS_KEYS: readonly (keyof CustomerAddressInput)[] = [
  'address1',
  'address2',
  'city',
  'company',
  'territoryCode',
  'firstName',
  'lastName',
  'phoneNumber',
  'zoneCode',
  'zip',
];

type Outcome = 'ok' | AccountErrorCode;

function respond(body: ActionResponse) {
  const status = body.status === 'ok' ? 200 : accountErrorStatus(body.code);
  return data(body, {status, headers: accountNoStoreHeaders()});
}

function fail(addressId: string | null, code: AccountErrorCode) {
  return respond({...accountFailure(code), addressId});
}

/**
 * Turns what Shopify answered into one of our outcomes. Messages from `errors` and `userErrors` are not read
 * (they can quote input and ids); only their presence is, and the log carries our own vocabulary.
 */
function judge(
  operation: AddressOperation,
  result: {errors?: readonly unknown[]; userErrors?: readonly unknown[]},
  succeeded: boolean,
): Outcome {
  if (result.errors?.length) {
    logError('account.address_failed', {operation, reason: 'graphql_errors'});
    return 'failed';
  }
  if (result.userErrors?.length) {
    logWarn('account.address_rejected', {operation});
    return 'rejected';
  }
  if (!succeeded) {
    logError('account.address_failed', {operation, reason: 'no_result'});
    return 'failed';
  }
  return 'ok';
}

function outcomeFromThrown(operation: AddressOperation, error: unknown) {
  // The client throws a redirect Response when the session ended during the call.
  if (error instanceof Response) return 'signed-out' as const;
  logError('account.address_failed', {operation, ...errorFields(error)});
  return 'failed' as const;
}

async function createAddress(
  customerAccount: CustomerAccount,
  address: CustomerAddressInput,
  defaultAddress: boolean,
): Promise<Outcome> {
  try {
    const {data: result, errors} = await customerAccount.mutate(
      CREATE_ADDRESS_MUTATION,
      {
        variables: {
          address,
          defaultAddress,
          language: customerAccount.i18n.language,
        },
      },
    );
    return judge(
      'create',
      {
        errors,
        userErrors: result?.customerAddressCreate?.userErrors,
      },
      Boolean(result?.customerAddressCreate?.customerAddress),
    );
  } catch (error: unknown) {
    return outcomeFromThrown('create', error);
  }
}

async function updateAddress(
  customerAccount: CustomerAccount,
  addressId: string,
  address: CustomerAddressInput,
  defaultAddress: boolean,
): Promise<Outcome> {
  try {
    const {data: result, errors} = await customerAccount.mutate(
      UPDATE_ADDRESS_MUTATION,
      {
        variables: {
          address,
          addressId,
          defaultAddress,
          language: customerAccount.i18n.language,
        },
      },
    );
    return judge(
      'update',
      {
        errors,
        userErrors: result?.customerAddressUpdate?.userErrors,
      },
      Boolean(result?.customerAddressUpdate?.customerAddress),
    );
  } catch (error: unknown) {
    return outcomeFromThrown('update', error);
  }
}

async function deleteAddress(
  customerAccount: CustomerAccount,
  addressId: string,
): Promise<Outcome> {
  try {
    const {data: result, errors} = await customerAccount.mutate(
      DELETE_ADDRESS_MUTATION,
      {
        variables: {addressId, language: customerAccount.i18n.language},
      },
    );
    return judge(
      'delete',
      {
        errors,
        userErrors: result?.customerAddressDelete?.userErrors,
      },
      Boolean(result?.customerAddressDelete?.deletedAddressId),
    );
  } catch (error: unknown) {
    return outcomeFromThrown('delete', error);
  }
}

function readAddress(form: FormData): CustomerAddressInput {
  const address: CustomerAddressInput = {};
  for (const key of ADDRESS_KEYS) {
    const value = form.get(key);
    if (typeof value === 'string') {
      address[key] = value;
    }
  }
  return address;
}

export async function action({request, context}: Route.ActionArgs) {
  const {customerAccount} = context;

  if (!isSameOriginRequest(request)) return fail(null, 'forbidden');

  const read = await readSmallForm(request, ADDRESS_FORM_MAX_BYTES);
  if (read.status !== 'ok') return fail(null, 'invalid-request');
  const {form} = read;

  // The id only names which form shows the message, plus (for an update or delete) which of the shopper's own
  // addresses to change. The customer is never read from the request: the mutation runs with the signed-in
  // customer's token, so another customer's address id is answered by Shopify as not found.
  const rawId = form.get('addressId');
  const addressId =
    typeof rawId === 'string' &&
    (rawId === NEW_ADDRESS_FORM_ID || parseAddressId(rawId) !== null)
      ? rawId
      : null;
  if (addressId === null) return fail(null, 'invalid-request');

  const method = request.method;
  if (method !== 'POST' && method !== 'PUT' && method !== 'DELETE') {
    return fail(addressId, 'method-not-allowed');
  }

  // This ensures a login redirect never happens for a mutation (it is a fetch, not a navigation).
  if (!(await customerAccount.isLoggedIn())) {
    return fail(addressId, 'signed-out');
  }

  if (hasOversizedField(form, ADDRESS_KEYS)) {
    return fail(addressId, 'invalid-request');
  }

  const defaultAddress = form.has('defaultAddress')
    ? String(form.get('defaultAddress')) === 'on'
    : false;
  const address = readAddress(form);
  const existingId = parseAddressId(addressId);

  let outcome: Outcome;
  let operation: AddressOperation;
  if (method === 'POST') {
    operation = 'create';
    outcome = await createAddress(customerAccount, address, defaultAddress);
  } else if (existingId === null) {
    // An update or delete of "the new address form" names nothing to change.
    return fail(addressId, 'invalid-request');
  } else if (method === 'PUT') {
    operation = 'update';
    outcome = await updateAddress(
      customerAccount,
      existingId,
      address,
      defaultAddress,
    );
  } else {
    operation = 'delete';
    outcome = await deleteAddress(customerAccount, existingId);
  }

  if (outcome !== 'ok') return fail(addressId, outcome);
  return respond({status: 'ok', operation, addressId, defaultAddress});
}

export default function Addresses() {
  const {customer} = useOutletContext<{customer: CustomerFragment}>();
  const {defaultAddress, addresses} = customer;
  const action = useActionData<ActionResponse>();
  // A request that named no usable address has no form to show its message in.
  const pageError =
    action?.status === 'error' && action.addressId === null
      ? action.message
      : null;

  return (
    <div className="account-addresses">
      <h2>Addresses</h2>
      {pageError ? (
        <p role="alert">
          <mark>
            <small>{pageError}</small>
          </mark>
        </p>
      ) : null}
      <br />
      <div>
        <div>
          <legend>Create address</legend>
          <NewAddressForm key={addresses.nodes.length} />
        </div>
        <br />
        <hr />
        <br />
        {!addresses.nodes.length ? (
          <p>You have no addresses saved.</p>
        ) : (
          <ExistingAddresses
            addresses={addresses}
            defaultAddress={defaultAddress}
          />
        )}
      </div>
    </div>
  );
}

function NewAddressForm() {
  const newAddress = {
    address1: '',
    address2: '',
    city: '',
    company: '',
    territoryCode: '',
    firstName: '',
    id: 'new',
    lastName: '',
    phoneNumber: '',
    zoneCode: '',
    zip: '',
  } as CustomerAddressInput;

  return (
    <AddressForm
      addressId={'NEW_ADDRESS_ID'}
      address={newAddress}
      defaultAddress={null}
    >
      {({stateForMethod}) => (
        <div>
          <button
            disabled={stateForMethod('POST') !== 'idle'}
            formMethod="POST"
            type="submit"
          >
            {stateForMethod('POST') !== 'idle' ? 'Creating' : 'Create'}
          </button>
        </div>
      )}
    </AddressForm>
  );
}

function ExistingAddresses({
  addresses,
  defaultAddress,
}: Pick<CustomerFragment, 'addresses' | 'defaultAddress'>) {
  return (
    <div>
      <legend>Existing addresses</legend>
      {addresses.nodes.map((address) => (
        <AddressForm
          key={address.id}
          addressId={address.id}
          address={address}
          defaultAddress={defaultAddress}
        >
          {({stateForMethod}) => (
            <div>
              <button
                disabled={stateForMethod('PUT') !== 'idle'}
                formMethod="PUT"
                type="submit"
              >
                {stateForMethod('PUT') !== 'idle' ? 'Saving' : 'Save'}
              </button>
              <button
                disabled={stateForMethod('DELETE') !== 'idle'}
                formMethod="DELETE"
                type="submit"
              >
                {stateForMethod('DELETE') !== 'idle' ? 'Deleting' : 'Delete'}
              </button>
            </div>
          )}
        </AddressForm>
      ))}
    </div>
  );
}

export function AddressForm({
  addressId,
  address,
  defaultAddress,
  children,
}: {
  addressId: AddressFragment['id'];
  address: CustomerAddressInput;
  defaultAddress: CustomerFragment['defaultAddress'];
  children: (props: {
    stateForMethod: (method: 'PUT' | 'POST' | 'DELETE') => Fetcher['state'];
  }) => React.ReactNode;
}) {
  const {state, formMethod} = useNavigation();
  const action = useActionData<ActionResponse>();
  const error =
    action?.status === 'error' && action.addressId === addressId
      ? action.message
      : null;
  const isDefaultAddress = defaultAddress?.id === addressId;
  return (
    <Form id={addressId}>
      <fieldset>
        <input type="hidden" name="addressId" defaultValue={addressId} />
        <label htmlFor="firstName">First name*</label>
        <input
          aria-label="First name"
          autoComplete="given-name"
          defaultValue={address?.firstName ?? ''}
          id="firstName"
          name="firstName"
          placeholder="First name"
          required
          type="text"
        />
        <label htmlFor="lastName">Last name*</label>
        <input
          aria-label="Last name"
          autoComplete="family-name"
          defaultValue={address?.lastName ?? ''}
          id="lastName"
          name="lastName"
          placeholder="Last name"
          required
          type="text"
        />
        <label htmlFor="company">Company</label>
        <input
          aria-label="Company"
          autoComplete="organization"
          defaultValue={address?.company ?? ''}
          id="company"
          name="company"
          placeholder="Company"
          type="text"
        />
        <label htmlFor="address1">Address line*</label>
        <input
          aria-label="Address line 1"
          autoComplete="address-line1"
          defaultValue={address?.address1 ?? ''}
          id="address1"
          name="address1"
          placeholder="Address line 1*"
          required
          type="text"
        />
        <label htmlFor="address2">Address line 2</label>
        <input
          aria-label="Address line 2"
          autoComplete="address-line2"
          defaultValue={address?.address2 ?? ''}
          id="address2"
          name="address2"
          placeholder="Address line 2"
          type="text"
        />
        <label htmlFor="city">City*</label>
        <input
          aria-label="City"
          autoComplete="address-level2"
          defaultValue={address?.city ?? ''}
          id="city"
          name="city"
          placeholder="City"
          required
          type="text"
        />
        <label htmlFor="zoneCode">State / Province*</label>
        <input
          aria-label="State/Province"
          autoComplete="address-level1"
          defaultValue={address?.zoneCode ?? ''}
          id="zoneCode"
          name="zoneCode"
          placeholder="State / Province"
          required
          type="text"
        />
        <label htmlFor="zip">Zip / Postal Code*</label>
        <input
          aria-label="Zip"
          autoComplete="postal-code"
          defaultValue={address?.zip ?? ''}
          id="zip"
          name="zip"
          placeholder="Zip / Postal Code"
          required
          type="text"
        />
        <label htmlFor="territoryCode">Country Code*</label>
        <input
          aria-label="Country code"
          autoComplete="country"
          defaultValue={address?.territoryCode ?? ''}
          id="territoryCode"
          name="territoryCode"
          placeholder="Country"
          required
          type="text"
          maxLength={2}
        />
        <label htmlFor="phoneNumber">Phone</label>
        <input
          aria-label="Phone Number"
          autoComplete="tel"
          defaultValue={address?.phoneNumber ?? ''}
          id="phoneNumber"
          name="phoneNumber"
          placeholder="+16135551111"
          pattern="^\+?[1-9]\d{3,14}$"
          type="tel"
        />
        <div>
          <input
            defaultChecked={isDefaultAddress}
            id="defaultAddress"
            name="defaultAddress"
            type="checkbox"
          />
          <label htmlFor="defaultAddress">Set as default address</label>
        </div>
        {error ? (
          <p role="alert">
            <mark>
              <small>{error}</small>
            </mark>
          </p>
        ) : (
          <br />
        )}
        {children({
          stateForMethod: (method) => (formMethod === method ? state : 'idle'),
        })}
      </fieldset>
    </Form>
  );
}
