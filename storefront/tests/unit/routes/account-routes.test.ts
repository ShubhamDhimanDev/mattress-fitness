import {afterEach, describe, expect, it, vi} from 'vitest';
import {
  action as addressesAction,
  loader as addressesLoader,
} from '~/routes/account.addresses';
import {action as profileAction} from '~/routes/account.profile';
import {
  headers as accountHeaders,
  loader as accountLoader,
} from '~/routes/account';
import {loader as ordersLoader} from '~/routes/account.orders._index';
import {loader as orderLoader} from '~/routes/account.orders.$id';
import {loader as accountIndexLoader} from '~/routes/account._index';
import {loader as wildcardLoader} from '~/routes/account.$';
import {loader as loginLoader} from '~/routes/account_.login';
import {loader as authorizeLoader} from '~/routes/account_.authorize';
import {
  action as logoutAction,
  loader as logoutLoader,
} from '~/routes/account_.logout';
import {ACCOUNT_ERROR_MESSAGES} from '~/lib/account/results';

// P6-07, carry-over P-L8 (no Shopify or exception text reaches the browser), T-05 (no PII in logs, private
// no-store everywhere under /account) and T-11 (customer from the session only, order ids validated, the same
// answer for a missing and a foreign order). A fake customer account client stands in for Shopify: no real
// credentials, no network. The route argument types are framework-generated; `args` builds them from plain
// parts (a documented test-only narrowing, as in the other route tests).

const ORIGIN = 'http://localhost:3000';
const ADDRESS_GID =
  'gid://shopify/CustomerAddress/9?model_name=CustomerAddress';
const ORDER_GID = 'gid://shopify/Order/4242?key=k1';
// Text that must never reach a response body or a log line.
const LEAK = 'LEAK-jane.doe@example.com-token-shpat_123';

type Variables = {variables: Record<string, unknown>};
type Answer = {data?: unknown; errors?: Array<{message: string}>};
type Responder = (query: string, options: Variables) => Answer;

function fakeCustomerAccount(
  options: {loggedIn?: boolean; query?: Responder; mutate?: Responder} = {},
) {
  const loggedIn = options.loggedIn ?? true;
  const redirectToLogin = () =>
    new Response(null, {status: 302, headers: {Location: '/account/login'}});
  const query = vi.fn(async (text: string, call: Variables) => {
    if (!loggedIn) throw redirectToLogin();
    return (options.query ?? (() => ({data: {}})))(text, call);
  });
  const mutate = vi.fn(async (text: string, call: Variables) => {
    if (!loggedIn) throw redirectToLogin();
    return (options.mutate ?? (() => ({data: {}})))(text, call);
  });
  return {
    isLoggedIn: vi.fn(async () => loggedIn),
    handleAuthStatus: vi.fn(async () => {
      if (!loggedIn) throw redirectToLogin();
    }),
    query,
    mutate,
    i18n: {language: 'EN'},
    login: vi.fn(async () => {
      const response = new Response(null, {status: 302});
      response.headers.set('Location', 'https://shopify.example/login');
      response.headers.append('Set-Cookie', 'state=1; HttpOnly');
      return response;
    }),
    authorize: vi.fn(async () => {
      const response = new Response(null, {status: 302});
      response.headers.set('Location', '/account');
      response.headers.append('Set-Cookie', 'session=1; HttpOnly');
      return response;
    }),
    logout: vi.fn(async () => {
      const response = new Response(null, {status: 302});
      response.headers.set('Location', '/');
      return response;
    }),
  };
}

type FakeAccount = ReturnType<typeof fakeCustomerAccount>;

function args(
  request: Request,
  customerAccount: FakeAccount,
  params: Record<string, string> = {},
) {
  return {
    request,
    params,
    context: {
      customerAccount,
      storefront: {i18n: {country: 'US', language: 'EN'}},
    },
  } as never;
}

function formRequest(
  method: string,
  fields: Record<string, string>,
  path = '/account/addresses',
  headers: Record<string, string> = {},
) {
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...headers,
    },
    body: new URLSearchParams(fields).toString(),
  });
}

type Unwrapped = {status: number; body: unknown; headers: Headers};

/** `data(...)` results carry body, status and headers in `init`; plain Responses carry them on the response. */
async function unwrap(result: unknown): Promise<Unwrapped> {
  if (result instanceof Response) {
    return {
      status: result.status,
      body: await result.text(),
      headers: result.headers,
    };
  }
  const wrapped = result as {
    data: unknown;
    init?: {status?: number; headers?: HeadersInit} | null;
  };
  return {
    status: wrapped.init?.status ?? 200,
    body: wrapped.data,
    headers: new Headers(wrapped.init?.headers),
  };
}

type Thrown = {data: unknown; init: {status: number; headers?: HeadersInit}};

async function thrown(work: () => unknown): Promise<unknown> {
  try {
    await work();
  } catch (error: unknown) {
    return error;
  }
  throw new Error('expected the loader to throw');
}

function logSpies() {
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  return {
    text: () =>
      [...error.mock.calls, ...warn.mock.calls]
        .map((call) => String(call[0]))
        .join('\n'),
  };
}

afterEach(() => vi.restoreAllMocks());

const ADDRESS_FIELDS = {
  addressId: ADDRESS_GID,
  firstName: 'Jane',
  lastName: 'Doe',
  address1: '1 Main St',
  city: 'Chicago',
  zoneCode: 'IL',
  zip: '60601',
  territoryCode: 'US',
};
const NEW_FORM = {...ADDRESS_FIELDS, addressId: 'NEW_ADDRESS_ID'};

describe('account addresses action', () => {
  it('creates an address and answers with a typed ok result, no-store', async () => {
    const account = fakeCustomerAccount({
      mutate: () => ({
        data: {
          customerAddressCreate: {
            customerAddress: {id: ADDRESS_GID},
            userErrors: [],
          },
        },
      }),
    });
    const result = await unwrap(
      await addressesAction(
        args(formRequest('POST', {...NEW_FORM, defaultAddress: 'on'}), account),
      ),
    );
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      status: 'ok',
      operation: 'create',
      addressId: 'NEW_ADDRESS_ID',
      defaultAddress: true,
    });
    expect(result.headers.get('Cache-Control')).toBe('private, no-store');
    expect(account.mutate).toHaveBeenCalledTimes(1);
  });

  it('updates and deletes with the decoded id and never sends a customer id', async () => {
    const account = fakeCustomerAccount({
      mutate: (text) =>
        text.includes('customerAddressDelete')
          ? {
              data: {
                customerAddressDelete: {
                  deletedAddressId: ADDRESS_GID,
                  userErrors: [],
                },
              },
            }
          : {
              data: {
                customerAddressUpdate: {
                  customerAddress: {id: ADDRESS_GID},
                  userErrors: [],
                },
              },
            },
    });
    const encoded = encodeURIComponent(ADDRESS_GID);
    const put = await unwrap(
      await addressesAction(
        args(
          formRequest('PUT', {
            ...ADDRESS_FIELDS,
            addressId: encoded,
            customerId: 'gid://shopify/Customer/1',
          }),
          account,
        ),
      ),
    );
    const del = await unwrap(
      await addressesAction(
        args(formRequest('DELETE', {addressId: encoded}), account),
      ),
    );
    expect(put.body).toMatchObject({status: 'ok', operation: 'update'});
    expect(del.body).toMatchObject({status: 'ok', operation: 'delete'});
    expect(account.mutate).toHaveBeenCalledTimes(2);
    for (const call of account.mutate.mock.calls) {
      const variables = call[1].variables;
      expect(variables.addressId).toBe(ADDRESS_GID);
      expect(JSON.stringify(variables)).not.toContain(
        'gid://shopify/Customer/1',
      );
      expect(Object.keys(variables)).not.toContain('customerId');
    }
  });

  it('answers a Shopify user error with a fixed message, not Shopify text (P-L8)', async () => {
    const logs = logSpies();
    const account = fakeCustomerAccount({
      mutate: () => ({
        data: {
          customerAddressCreate: {
            customerAddress: null,
            userErrors: [{code: 'INVALID', field: ['zip'], message: LEAK}],
          },
        },
      }),
    });
    const result = await unwrap(
      await addressesAction(args(formRequest('POST', NEW_FORM), account)),
    );
    expect(result.status).toBe(400);
    expect(result.body).toEqual({
      status: 'error',
      code: 'rejected',
      message: ACCOUNT_ERROR_MESSAGES.rejected,
      addressId: 'NEW_ADDRESS_ID',
    });
    expect(JSON.stringify(result.body)).not.toContain('LEAK');
    expect(logs.text()).not.toContain('LEAK');
    expect(logs.text()).toContain('account.address_rejected');
  });

  it('answers GraphQL errors and exceptions with a fixed message and logs the class name only', async () => {
    const logs = logSpies();
    const graphql = fakeCustomerAccount({
      mutate: () => ({errors: [{message: LEAK}]}),
    });
    const first = await unwrap(
      await addressesAction(args(formRequest('PUT', ADDRESS_FIELDS), graphql)),
    );
    expect(first.body).toMatchObject({
      status: 'error',
      code: 'failed',
      message: ACCOUNT_ERROR_MESSAGES.failed,
    });

    const throwing = fakeCustomerAccount({
      mutate: () => {
        throw new TypeError(`fetch failed for ${LEAK}`);
      },
    });
    const second = await unwrap(
      await addressesAction(
        args(formRequest('DELETE', {addressId: ADDRESS_GID}), throwing),
      ),
    );
    expect(second.status).toBe(400);
    expect(second.body).toMatchObject({
      code: 'failed',
      message: ACCOUNT_ERROR_MESSAGES.failed,
    });

    expect(JSON.stringify([first.body, second.body])).not.toContain('LEAK');
    expect(logs.text()).not.toContain('LEAK');
    expect(logs.text()).toContain('"errorName":"TypeError"');
  });

  it('answers a session that ends during the call as signed out', async () => {
    const account = fakeCustomerAccount({
      mutate: () => {
        throw new Response(null, {status: 302});
      },
    });
    const result = await unwrap(
      await addressesAction(args(formRequest('PUT', ADDRESS_FIELDS), account)),
    );
    expect(result.status).toBe(401);
    expect(result.body).toMatchObject({code: 'signed-out'});
  });

  it('does not mutate when signed out, cross-site, malformed, oversized or unsupported', async () => {
    const out = fakeCustomerAccount({loggedIn: false});
    const signedOut = await unwrap(
      await addressesAction(args(formRequest('PUT', ADDRESS_FIELDS), out)),
    );
    expect(signedOut.status).toBe(401);

    const account = fakeCustomerAccount();
    const run = async (request: Request) =>
      unwrap(await addressesAction(args(request, account)));

    const cross = await run(
      formRequest('PUT', ADDRESS_FIELDS, '/account/addresses', {
        Origin: 'https://evil.example',
      }),
    );
    expect(cross.status).toBe(403);
    expect(cross.body).toMatchObject({code: 'forbidden', addressId: null});

    const badId = await run(
      formRequest('PUT', {...ADDRESS_FIELDS, addressId: 'javascript:alert(1)'}),
    );
    expect(badId.status).toBe(400);
    expect(badId.body).toMatchObject({
      code: 'invalid-request',
      addressId: null,
    });

    expect((await run(formRequest('PUT', {city: 'x'}))).body).toMatchObject({
      code: 'invalid-request',
    });
    // The "new address" form id names no address, so an update or a delete of it is refused.
    expect((await run(formRequest('PUT', NEW_FORM))).body).toMatchObject({
      code: 'invalid-request',
    });
    expect(
      (await run(formRequest('POST', {...NEW_FORM, city: 'c'.repeat(256)})))
        .body,
    ).toMatchObject({code: 'invalid-request'});
    expect(
      (
        await run(
          formRequest('POST', {...NEW_FORM, company: 'c'.repeat(20000)}),
        )
      ).body,
    ).toMatchObject({code: 'invalid-request'});

    const patch = await run(formRequest('PATCH', ADDRESS_FIELDS));
    expect(patch.status).toBe(405);
    expect(patch.body).toMatchObject({code: 'method-not-allowed'});

    expect(
      (await run(new Request(`${ORIGIN}/account/addresses`, {method: 'POST'})))
        .body,
    ).toMatchObject({code: 'invalid-request'});

    expect(out.mutate).not.toHaveBeenCalled();
    expect(account.mutate).not.toHaveBeenCalled();
  });

  it('checks the session in the loader and returns nothing about the customer', async () => {
    const account = fakeCustomerAccount();
    const request = () => new Request(`${ORIGIN}/account/addresses`);
    expect(await addressesLoader(args(request(), account))).toEqual({});
    expect(account.handleAuthStatus).toHaveBeenCalledTimes(1);

    const out = fakeCustomerAccount({loggedIn: false});
    const error = await thrown(() => addressesLoader(args(request(), out)));
    expect(error).toBeInstanceOf(Response);
  });
});

describe('account profile action', () => {
  const okUpdate = {
    data: {
      customerUpdate: {
        customer: {
          firstName: 'Jane',
          lastName: 'Doe',
          emailAddress: {emailAddress: 'jane.doe@example.com'},
          phoneNumber: {phoneNumber: '+13125550100'},
        },
        userErrors: [],
      },
    },
  };
  const profile = (
    method: string,
    fields: Record<string, string>,
    headers: Record<string, string> = {},
  ) => formRequest(method, fields, '/account/profile', headers);

  it('returns only the two names, no-store, and sends only the allowed fields', async () => {
    const account = fakeCustomerAccount({mutate: () => okUpdate});
    const result = await unwrap(
      await profileAction(
        args(
          profile('PUT', {
            firstName: 'Jane',
            lastName: 'Doe',
            email: 'x@y.z',
            id: 'gid://shopify/Customer/2',
          }),
          account,
        ),
      ),
    );
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      status: 'ok',
      customer: {firstName: 'Jane', lastName: 'Doe'},
    });
    expect(result.headers.get('Cache-Control')).toBe('private, no-store');
    expect(account.mutate.mock.calls[0]?.[1].variables.customer).toEqual({
      firstName: 'Jane',
      lastName: 'Doe',
    });
  });

  it('answers errors, user errors and exceptions with fixed messages and no leaked text', async () => {
    const logs = logSpies();
    const cases: Array<[Responder, 'failed' | 'rejected']> = [
      [() => ({errors: [{message: LEAK}]}), 'failed'],
      [
        () => ({
          data: {
            customerUpdate: {
              customer: null,
              userErrors: [
                {code: 'TOO_LONG', field: ['firstName'], message: LEAK},
              ],
            },
          },
        }),
        'rejected',
      ],
      [
        () => ({data: {customerUpdate: {customer: null, userErrors: []}}}),
        'failed',
      ],
      [
        () => {
          throw new Error(LEAK);
        },
        'failed',
      ],
    ];
    for (const [mutate, code] of cases) {
      const account = fakeCustomerAccount({mutate});
      const result = await unwrap(
        await profileAction(args(profile('PUT', {firstName: 'Jane'}), account)),
      );
      expect(result.status).toBe(400);
      expect(result.body).toEqual({
        status: 'error',
        code,
        message: ACCOUNT_ERROR_MESSAGES[code],
      });
      expect(JSON.stringify(result.body)).not.toContain('LEAK');
    }
    expect(logs.text()).not.toContain('LEAK');
    expect(logs.text()).toContain('account.profile_failed');
  });

  it('refuses other methods, other origins, long values and signed-out requests before any mutation', async () => {
    const account = fakeCustomerAccount();
    const out = fakeCustomerAccount({loggedIn: false});
    const run = async (request: Request, target = account) =>
      unwrap(await profileAction(args(request, target)));

    expect((await run(profile('POST', {firstName: 'Jane'}))).status).toBe(405);
    expect(
      (
        await run(
          profile('PUT', {firstName: 'Jane'}, {Origin: 'https://evil.example'}),
        )
      ).status,
    ).toBe(403);
    expect((await run(profile('PUT', {firstName: 'Jane'}), out)).status).toBe(
      401,
    );
    expect(
      (await run(profile('PUT', {firstName: 'n'.repeat(300)}))).body,
    ).toMatchObject({code: 'invalid-request'});
    expect(account.mutate).not.toHaveBeenCalled();
    expect(out.mutate).not.toHaveBeenCalled();
  });
});

describe('account layout loader', () => {
  it('returns the customer read with the session, private and no-store, and takes no id from the request', async () => {
    const account = fakeCustomerAccount({
      query: () => ({data: {customer: {firstName: 'Jane', lastName: 'Doe'}}}),
    });
    const request = new Request(
      `${ORIGIN}/account/orders?customerId=gid://shopify/Customer/999`,
    );
    const result = await unwrap(await accountLoader(args(request, account)));
    expect(result.body).toEqual({
      customer: {firstName: 'Jane', lastName: 'Doe'},
    });
    expect(result.headers.get('Cache-Control')).toBe('private, no-store');
    expect(JSON.stringify(account.query.mock.calls[0]?.[1])).not.toContain(
      '999',
    );
  });

  it('exports route headers that replace the root cache policy with private, no-store', () => {
    const headers = accountHeaders();
    expect(headers.get('Cache-Control')).toBe('private, no-store');
    expect(headers.get('Vary')).toBe('Cookie');
  });

  it('lets the login redirect through, and turns every other failure into a fixed 500 with a class-name log', async () => {
    const logs = logSpies();
    const request = () => new Request(`${ORIGIN}/account`);
    const out = fakeCustomerAccount({loggedIn: false});
    expect(
      await thrown(() => accountLoader(args(request(), out))),
    ).toBeInstanceOf(Response);

    const failing: Responder[] = [
      () => ({errors: [{message: LEAK}]}),
      () => ({data: {customer: null}}),
      () => {
        throw new Error(LEAK);
      },
    ];
    for (const query of failing) {
      const account = fakeCustomerAccount({query});
      const error = (await thrown(() =>
        accountLoader(args(request(), account)),
      )) as Thrown;
      expect(error.init.status).toBe(500);
      expect(error.data).toMatchObject({status: 'error', code: 'failed'});
      expect(JSON.stringify(error.data)).not.toContain('LEAK');
      expect(new Headers(error.init.headers).get('Cache-Control')).toBe(
        'private, no-store',
      );
    }
    expect(logs.text()).not.toContain('LEAK');
    expect(logs.text()).toContain('account.customer_read_failed');
  });
});

describe('account order routes (T-11)', () => {
  const orderResponse = {
    data: {
      order: {
        id: ORDER_GID,
        name: '#4242',
        processedAt: '2026-10-01T00:00:00Z',
        confirmationNumber: 'C1',
        statusPageUrl: 'https://shop.example/status',
        subtotal: {amount: '10.0', currencyCode: 'USD'},
        totalTax: {amount: '1.0', currencyCode: 'USD'},
        totalPrice: {amount: '11.0', currencyCode: 'USD'},
        lineItems: {nodes: []},
        discountApplications: {nodes: []},
        fulfillments: {nodes: []},
        shippingAddress: null,
      },
    },
  };
  const orderRequest = (id: string) =>
    new Request(`${ORIGIN}/account/orders/${encodeURIComponent(id)}`);

  it('reads the order named by a valid route id, after checking the session', async () => {
    const account = fakeCustomerAccount({query: () => orderResponse});
    const id = btoa(ORDER_GID);
    const result = (await orderLoader(
      args(orderRequest(id), account, {id}),
    )) as {order: {name: string}};
    expect(result.order.name).toBe('#4242');
    expect(account.query.mock.calls[0]?.[1].variables).toEqual({
      orderId: ORDER_GID,
      language: 'EN',
    });
    expect(account.handleAuthStatus.mock.invocationCallOrder[0]).toBeLessThan(
      account.query.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('answers a malformed id, a missing order and a foreign order with the same 404, with no read for the malformed ones', async () => {
    const malformed = fakeCustomerAccount();
    // Shopify answers an order that is not the signed-in customer's exactly like a missing one.
    const noOrder = fakeCustomerAccount({
      query: () => ({data: {order: null}}),
    });
    const bodies: unknown[] = [];
    const cases: Array<[FakeAccount, string]> = [
      [malformed, 'not-base64!!'],
      [malformed, btoa('gid://shopify/Customer/1')],
      [noOrder, btoa('gid://shopify/Order/1')],
      [noOrder, btoa('gid://shopify/Order/2?key=zz')],
    ];
    for (const [account, id] of cases) {
      const error = (await thrown(() =>
        orderLoader(args(orderRequest(id), account, {id})),
      )) as Thrown;
      expect(error.init.status).toBe(404);
      bodies.push(error.data);
    }
    expect(new Set(bodies.map((body) => JSON.stringify(body))).size).toBe(1);
    expect(malformed.query).not.toHaveBeenCalled();
    expect(noOrder.query).toHaveBeenCalledTimes(2);
  });

  it('does not report a failed read as a missing order, and leaks nothing', async () => {
    const logs = logSpies();
    const failing: Responder[] = [
      () => ({errors: [{message: LEAK}]}),
      () => {
        throw new Error(LEAK);
      },
    ];
    const id = btoa(ORDER_GID);
    for (const query of failing) {
      const account = fakeCustomerAccount({query});
      const error = (await thrown(() =>
        orderLoader(args(orderRequest(id), account, {id})),
      )) as Thrown;
      expect(error.init.status).toBe(500);
      expect(JSON.stringify(error.data)).not.toContain('LEAK');
    }
    expect(logs.text()).not.toContain('LEAK');
  });

  it('redirects to the login, with no read and private, no-store, when signed out', async () => {
    const out = fakeCustomerAccount({loggedIn: false});
    const id = btoa(ORDER_GID);
    const error = await thrown(() =>
      orderLoader(args(orderRequest(id), out, {id})),
    );
    expect(error).toBeInstanceOf(Response);
    expect((error as Response).headers.get('Location')).toBe('/account/login');
    expect((error as Response).headers.get('Cache-Control')).toBe(
      'private, no-store',
    );
    expect(out.query).not.toHaveBeenCalled();
  });

  it('every account loader that checks the session answers a signed-out visitor with a no-store login redirect', async () => {
    const loaders = [
      () =>
        addressesLoader(
          args(
            new Request(`${ORIGIN}/account/addresses`),
            fakeCustomerAccount({loggedIn: false}),
          ),
        ),
      () =>
        ordersLoader(
          args(
            new Request(`${ORIGIN}/account/orders`),
            fakeCustomerAccount({loggedIn: false}),
          ),
        ),
      () =>
        wildcardLoader(
          args(
            new Request(`${ORIGIN}/account/other`),
            fakeCustomerAccount({loggedIn: false}),
          ),
        ),
      () =>
        accountLoader(
          args(
            new Request(`${ORIGIN}/account`),
            fakeCustomerAccount({loggedIn: false}),
          ),
        ),
    ];
    for (const load of loaders) {
      const error = (await thrown(load)) as Response;
      expect(error).toBeInstanceOf(Response);
      expect(error.headers.get('Cache-Control')).toBe('private, no-store');
    }
  });

  it('the redirect for a missing order id is private, no-store', async () => {
    const account = fakeCustomerAccount();
    const result = (await orderLoader(
      args(new Request(`${ORIGIN}/account/orders/`), account, {}),
    )) as Response;
    expect(result.status).toBe(302);
    expect(result.headers.get('Location')).toBe('/account/orders');
    expect(result.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('lists orders with the session check first and builds the search from the sanitised filters only', async () => {
    const account = fakeCustomerAccount({
      query: () => ({data: {customer: {orders: {nodes: [], pageInfo: {}}}}}),
    });
    const request = new Request(
      `${ORIGIN}/account/orders?name=${encodeURIComponent('1001 OR email:a@b.c')}`,
    );
    await ordersLoader(args(request, account));
    expect(account.handleAuthStatus).toHaveBeenCalled();
    expect(account.query.mock.calls[0]?.[1].variables.query).toBe(
      'name:1001ORemailabc',
    );
  });

  it('turns a failed list read into a fixed 500', async () => {
    const logs = logSpies();
    const account = fakeCustomerAccount({
      query: () => ({errors: [{message: LEAK}]}),
    });
    const error = (await thrown(() =>
      ordersLoader(args(new Request(`${ORIGIN}/account/orders`), account)),
    )) as Thrown;
    expect(error.init.status).toBe(500);
    expect(JSON.stringify(error.data)).not.toContain('LEAK');
    expect(logs.text()).not.toContain('LEAK');
  });
});

describe('account redirects and session routes carry private, no-store', () => {
  it('sets it on the index and wildcard redirects', async () => {
    const index = await accountIndexLoader();
    expect(index.headers.get('Cache-Control')).toBe('private, no-store');
    expect(index.headers.get('Location')).toBe('/account/orders');
    const wildcard = await wildcardLoader(
      args(new Request(`${ORIGIN}/account/unknown`), fakeCustomerAccount()),
    );
    expect(wildcard.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('wraps login, authorize and logout without losing the redirect or the cookies', async () => {
    const account = fakeCustomerAccount();
    const login = await loginLoader(
      args(new Request(`${ORIGIN}/account/login`), account),
    );
    expect(login.headers.get('Cache-Control')).toBe('private, no-store');
    expect(login.headers.get('Location')).toBe('https://shopify.example/login');
    expect(login.headers.getSetCookie()).toEqual(['state=1; HttpOnly']);

    const authorize = await authorizeLoader(
      args(new Request(`${ORIGIN}/account/authorize`), account),
    );
    expect(authorize.headers.get('Cache-Control')).toBe('private, no-store');
    expect(authorize.headers.getSetCookie()).toEqual(['session=1; HttpOnly']);

    const logout = await logoutAction(
      args(new Request(`${ORIGIN}/account/logout`, {method: 'POST'}), account),
    );
    expect(logout.headers.get('Cache-Control')).toBe('private, no-store');
    expect(logout.headers.get('Location')).toBe('/');

    const crossSite = await logoutAction(
      args(
        new Request(`${ORIGIN}/account/logout`, {
          method: 'POST',
          headers: {Origin: 'https://evil.example'},
        }),
        account,
      ),
    );
    expect(crossSite.status).toBe(403);
    expect(crossSite.headers.get('Cache-Control')).toBe('private, no-store');
    expect(account.logout).toHaveBeenCalledTimes(1);

    const noOriginCrossSite = await logoutAction(
      args(
        new Request(`${ORIGIN}/account/logout`, {
          method: 'POST',
          headers: {'Sec-Fetch-Site': 'cross-site'},
        }),
        account,
      ),
    );
    expect(noOriginCrossSite.status).toBe(403);
    expect(account.logout).toHaveBeenCalledTimes(1);

    const logoutGet = await logoutLoader();
    expect(logoutGet.headers.get('Cache-Control')).toBe('private, no-store');
  });
});
