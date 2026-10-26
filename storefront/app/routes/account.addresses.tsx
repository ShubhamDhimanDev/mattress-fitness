import type {CustomerAddressInput} from '@shopify/hydrogen/customer-account-api-types';
import type {CustomerAccount} from '~/lib/hydrogen/customer-account';
import type {
  AddressFragment,
  CustomerFragment,
} from 'customer-accountapi.generated';
import {useId} from 'react';
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
  requireAccountSession,
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
  await requireAccountSession(context.customerAccount);

  return {};
}

// A form is a few short text fields; 8 KB is generous for ten of them and refuses anything abusive early.
const ADDRESS_FORM_MAX_BYTES = 8192;

// Form field names. `territoryCode` is the name of the country field in the form; the Customer Account API 2026-10 calls it
// `countryCode` (ADR-0012), see `readAddress`.
const ADDRESS_KEYS: readonly string[] = [
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

type TextAddressKey = Exclude<
  keyof CustomerAddressInput,
  'countryCode' | 'defaultAddress' | 'territoryCode'
>;

function readAddress(form: FormData): CustomerAddressInput {
  const address: CustomerAddressInput = {};
  for (const key of ADDRESS_KEYS) {
    const value = form.get(key);
    if (typeof value !== 'string') continue;
    if (key === 'territoryCode') {
      // The API's CountryCode enum takes an upper-case two-letter code; anything else would fail the whole request with a
      // validation error, so it is left out and Shopify answers with its own field error.
      const code = value.trim().toUpperCase();
      if (/^[A-Z]{2}$/.test(code)) {
        address.countryCode = code as CustomerAddressInput['countryCode'];
      }
      continue;
    }
    address[key as TextAddressKey] = value;
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
      legend="Create address"
      addressId={NEW_ADDRESS_FORM_ID}
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
      <h3>Existing addresses</h3>
      {addresses.nodes.map((address, index) => (
        <AddressForm
          key={address.id}
          legend={`Saved address ${index + 1}`}
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

/**
 * One address form. Several render on the page, so every control id carries a per-form prefix (a repeated id
 * breaks `label for` and axe's duplicate-id rule), and the group is named by a real `legend` inside its
 * `fieldset`. The posted `addressId` stays the Shopify id; it is a hidden value, never an element id.
 */
export function AddressForm({
  legend,
  addressId,
  address,
  defaultAddress,
  children,
}: {
  legend: string;
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
  const formKey = useId();
  const idOf = (field: string) => `${formKey}-${field}`;
  return (
    <Form>
      <fieldset>
        <legend>{legend}</legend>
        <input type="hidden" name="addressId" defaultValue={addressId} />
        <label htmlFor={idOf('firstName')}>First name*</label>
        <input
          autoComplete="given-name"
          defaultValue={address?.firstName ?? ''}
          id={idOf('firstName')}
          name="firstName"
          placeholder="First name"
          required
          type="text"
        />
        <label htmlFor={idOf('lastName')}>Last name*</label>
        <input
          autoComplete="family-name"
          defaultValue={address?.lastName ?? ''}
          id={idOf('lastName')}
          name="lastName"
          placeholder="Last name"
          required
          type="text"
        />
        <label htmlFor={idOf('company')}>Company</label>
        <input
          autoComplete="organization"
          defaultValue={address?.company ?? ''}
          id={idOf('company')}
          name="company"
          placeholder="Company"
          type="text"
        />
        <label htmlFor={idOf('address1')}>Address line*</label>
        <input
          autoComplete="address-line1"
          defaultValue={address?.address1 ?? ''}
          id={idOf('address1')}
          name="address1"
          placeholder="Address line 1*"
          required
          type="text"
        />
        <label htmlFor={idOf('address2')}>Address line 2</label>
        <input
          autoComplete="address-line2"
          defaultValue={address?.address2 ?? ''}
          id={idOf('address2')}
          name="address2"
          placeholder="Address line 2"
          type="text"
        />
        <label htmlFor={idOf('city')}>City*</label>
        <input
          autoComplete="address-level2"
          defaultValue={address?.city ?? ''}
          id={idOf('city')}
          name="city"
          placeholder="City"
          required
          type="text"
        />
        <label htmlFor={idOf('zoneCode')}>State / Province*</label>
        <input
          autoComplete="address-level1"
          defaultValue={address?.zoneCode ?? ''}
          id={idOf('zoneCode')}
          name="zoneCode"
          placeholder="State / Province"
          required
          type="text"
        />
        <label htmlFor={idOf('zip')}>Zip / Postal Code*</label>
        <input
          autoComplete="postal-code"
          defaultValue={address?.zip ?? ''}
          id={idOf('zip')}
          name="zip"
          placeholder="Zip / Postal Code"
          required
          type="text"
        />
        <label htmlFor={idOf('territoryCode')}>Country Code*</label>
        <input
          autoComplete="country"
          defaultValue={address?.countryCode ?? ''}
          id={idOf('territoryCode')}
          name="territoryCode"
          placeholder="Country"
          required
          type="text"
          maxLength={2}
        />
        <label htmlFor={idOf('phoneNumber')}>Phone</label>
        <input
          autoComplete="tel"
          defaultValue={address?.phoneNumber ?? ''}
          id={idOf('phoneNumber')}
          name="phoneNumber"
          placeholder="+16135551111"
          pattern="^\+?[1-9]\d{3,14}$"
          type="tel"
        />
        <div>
          <input
            defaultChecked={isDefaultAddress}
            id={idOf('defaultAddress')}
            name="defaultAddress"
            type="checkbox"
          />
          <label htmlFor={idOf('defaultAddress')}>Set as default address</label>
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
