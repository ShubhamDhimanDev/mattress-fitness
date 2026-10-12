// Pins the behaviour of the MOCK itself, so the lifecycle tests that rely on it mean something. Each assertion
// here restates a documented Extend rule (docs/integrations/EXTEND.md section 2) or is labelled mock-only.

import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import type {ExtendMock} from '../../../../scripts/mocks/extend-mock.mjs';
import {STORE_ID, TOKEN, startTestMock} from './support';

let mock: ExtendMock;
beforeEach(async () => {
  mock = await startTestMock();
});
afterEach(async () => {
  await mock.close();
});

const HEADERS = {
  'X-Extend-Access-Token': TOKEN,
  Accept: 'application/json;version=2022-02-01',
  'Content-Type': 'application/json',
};

function call(
  path: string,
  method: string,
  body?: unknown,
  headers: Record<string, string> = HEADERS,
) {
  return fetch(`${mock.url}${path}`, {
    method,
    headers,
    // fetch refuses a body on GET; the mock's GET /offers reads the query string only.
    ...(body === undefined || method === 'GET'
      ? {}
      : {body: JSON.stringify(body)}),
  });
}

/** Prices of every ADH plan in an Offers response, narrowed from unknown (the mock is a separate process). */
function adhPrices(body: unknown): number[] {
  if (
    typeof body !== 'object' ||
    body === null ||
    !('offers' in body) ||
    !Array.isArray(body.offers)
  ) {
    throw new Error('not an offers response');
  }
  return body.offers.flatMap((offer: unknown) => {
    if (typeof offer !== 'object' || offer === null || !('plans' in offer))
      return [];
    const plans = offer.plans;
    if (
      typeof plans !== 'object' ||
      plans === null ||
      !('adh' in plans) ||
      !Array.isArray(plans.adh)
    )
      return [];
    return plans.adh.flatMap((plan: unknown) =>
      typeof plan === 'object' &&
      plan !== null &&
      'price' in plan &&
      typeof plan.price === 'number'
        ? [plan.price]
        : [],
    );
  });
}

/** Same data, every object's keys in reverse order: a different byte sequence for the same snapshot. */
function reverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .reverse()
        .map(([key, inner]) => [key, reverseKeys(inner)]),
    );
  }
  return value;
}

function productLine(id: string, overrides: Record<string, unknown> = {}) {
  return {
    lineItemTransactionId: id,
    product: {
      id: `p-${id}`,
      category: 'mattress',
      listPrice: 129900,
      purchasePrice: 129900,
      purchaseDate: 1_790_000_000_000,
    },
    quantity: 1,
    fulfilledQuantity: 0,
    ...overrides,
  };
}

function contractLine(
  id: string,
  covers: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    type: 'category_contract',
    lineItemTransactionId: id,
    quantity: 1,
    fulfilledQuantity: 0,
    plan: {
      id: 'MOCK-MATT-ADH-3Y-C',
      purchasePrice: 7999,
      purchaseDate: 1_790_000_000_000,
    },
    coveredProducts: [
      {lineItemTransactionId: covers, productId: `p-${covers}`, quantity: 1},
    ],
    ...overrides,
  };
}

function order(overrides: Record<string, unknown> = {}) {
  return {
    transactionId: 'T-1',
    storeId: STORE_ID,
    currency: 'USD',
    total: 137_899,
    customer: {},
    lineItems: [productLine('A'), contractLine('A-contract', 'A')],
    ...overrides,
  };
}

describe('Extend MOCK: contract with the library (REQ-EXT-001, REQ-EXT-003)', () => {
  it('labels every response as a mock', async () => {
    for (const response of [
      await call('/offers', 'POST', {
        storeId: STORE_ID,
        currency: 'USD',
        items: [
          {
            category: 'mattress',
            productId: '1',
            purchasePrice: 129900,
            quantity: 1,
          },
        ],
      }),
      await call(
        '/offers',
        'POST',
        {},
        {...HEADERS, 'X-Extend-Access-Token': 'wrong'},
      ),
      await call('/nowhere', 'GET'),
    ]) {
      expect(response.headers.get('x-extend-mock')).toBe('true');
    }
  });

  it.each([
    ['POST', '/offers'],
    [
      'GET',
      '/offers?storeId=x&productId=1&category=mattress&purchasePrice=100',
    ],
    ['PUT', '/orders'],
  ])(
    'rejects %s %s without the access token or with a wrong one (401)',
    async (method, path) => {
      const {'X-Extend-Access-Token': _removed, ...withoutToken} = HEADERS;
      expect((await call(path, method, {}, withoutToken)).status).toBe(401);
      expect(
        (
          await call(
            path,
            method,
            {},
            {...HEADERS, 'X-Extend-Access-Token': 'wrong'},
          )
        ).status,
      ).toBe(401);
      expect(
        (
          await call(
            path,
            method,
            {},
            {...HEADERS, 'X-Extend-Access-Token': ''},
          )
        ).status,
      ).toBe(401);
      expect(mock.state.orders.size).toBe(0);
    },
  );

  it('answers only the two documented paths', async () => {
    expect((await call('/contracts', 'GET')).status).toBe(404);
    expect((await call('/orders', 'DELETE')).status).toBe(405);
  });

  it('(mock-only) requires the documented Accept version', async () => {
    const response = await call('/orders', 'PUT', order(), {
      ...HEADERS,
      Accept: 'application/json',
    });
    expect(response.status).toBe(400);
  });

  it('GET /offers answers the same shape as POST /offers', async () => {
    const response = await call(
      '/offers?storeId=' +
        STORE_ID +
        '&productId=501&category=mattress&purchasePrice=129900',
      'GET',
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      offers: [
        {
          plans: {
            adh: expect.arrayContaining([
              expect.objectContaining({id: 'MOCK-MATT-ADH-3Y-C', price: 7999}),
            ]),
            recommended: 'adh',
          },
        },
      ],
    });
  });

  it('offers vary by category and price band, and unknown categories get no offer', async () => {
    const ask = async (category: string, purchasePrice: number) => {
      const response = await call('/offers', 'POST', {
        storeId: STORE_ID,
        currency: 'USD',
        items: [{category, productId: '9', purchasePrice, quantity: 1}],
      });
      return adhPrices(await response.json());
    };
    expect(await ask('mattress', 29_900)).toEqual([2999, 4999]);
    expect(await ask('mattress', 129_900)).toEqual([7999, 9999]);
    expect(await ask('mattress', 250_000)).toEqual([12_999, 14_999, 17_777]);
    expect(await ask('bedding', 5000)).toEqual([1499, 2499]);
    expect(await ask('furniture', 129_900)).toEqual([]);
  });

  it.each([
    ['wrong store id', {storeId: 'someone-else'}],
    ['no items', {items: []}],
    [
      'item with a float price',
      {
        items: [
          {
            category: 'mattress',
            productId: '1',
            purchasePrice: 99.5,
            quantity: 1,
          },
        ],
      },
    ],
    [
      'item with zero quantity',
      {
        items: [
          {
            category: 'mattress',
            productId: '1',
            purchasePrice: 100,
            quantity: 0,
          },
        ],
      },
    ],
    [
      'item without a product id',
      {items: [{category: 'mattress', purchasePrice: 100, quantity: 1}]},
    ],
  ])(
    'rejects an invalid offers request: %s (400)',
    async (_label, override) => {
      const body = {
        storeId: STORE_ID,
        currency: 'USD',
        items: [
          {
            category: 'mattress',
            productId: '1',
            purchasePrice: 100,
            quantity: 1,
          },
        ],
        ...override,
      };
      expect((await call('/offers', 'POST', body)).status).toBe(400);
    },
  );

  it('rejects non-JSON bodies (400)', async () => {
    const response = await fetch(`${mock.url}/orders`, {
      method: 'PUT',
      headers: HEADERS,
      body: 'not json',
    });
    expect(response.status).toBe(400);
  });

  describe('PUT /orders validation (400, nothing stored)', () => {
    const cases: Array<[string, Record<string, unknown>]> = [
      ['no transactionId', {transactionId: ''}],
      ["someone else's store", {storeId: 'other'}],
      ['float total', {total: 10.5}],
      ['status other than refunded', {status: 'cancelled'}],
      ['lineItems not an array', {lineItems: 'none'}],
      [
        'duplicate lineItemTransactionId',
        {lineItems: [productLine('A'), productLine('A')]},
      ],
      [
        'fulfilledQuantity above quantity',
        {lineItems: [productLine('A', {fulfilledQuantity: 2})]},
      ],
      [
        'product line without product details',
        {lineItems: [productLine('A', {product: {}})]},
      ],
      [
        'category_contract without coveredProducts',
        {
          lineItems: [
            productLine('A'),
            {...contractLine('C', 'A'), coveredProducts: undefined},
          ],
        },
      ],
      [
        'contract covering a line not in the order',
        {lineItems: [productLine('A'), contractLine('C', 'Z')]},
      ],
      [
        'contract covering more units than the line has',
        {
          lineItems: [
            productLine('A'),
            contractLine('C', 'A', {
              coveredProducts: [
                {lineItemTransactionId: 'A', productId: 'p-A', quantity: 5},
              ],
            }),
          ],
        },
      ],
    ];

    it.each(cases)('%s', async (_label, override) => {
      const response = await call('/orders', 'PUT', order(override));
      expect(response.status).toBe(400);
      expect(mock.state.orders.size).toBe(0);
    });
  });

  describe('PUT /orders semantics (documented: idempotent full snapshot; contracts only on 0 -> positive fulfilment)', () => {
    it('creates an order without a contract while nothing is fulfilled', async () => {
      expect((await call('/orders', 'PUT', order())).status).toBe(200);
      expect(mock.state.eventTypes()).toEqual(['order_created']);
      expect(mock.state.contracts('T-1')).toEqual([]);
    });

    it('issues exactly one contract when fulfilledQuantity goes from 0 to positive, and never a second', async () => {
      await call('/orders', 'PUT', order());
      const fulfilled = order({
        lineItems: [
          productLine('A', {fulfilledQuantity: 1}),
          contractLine('A-contract', 'A', {fulfilledQuantity: 1}),
        ],
      });
      await call('/orders', 'PUT', fulfilled);
      expect(mock.state.contracts('T-1')).toHaveLength(1);
      expect(mock.state.contracts('T-1')[0]).toMatchObject({
        contractId: 'MOCK-CONTRACT-0001',
        status: 'active',
        planId: 'MOCK-MATT-ADH-3Y-C',
      });
      // A different but still fulfilled snapshot does not mint another contract.
      await call('/orders', 'PUT', {...fulfilled, total: 140_000});
      expect(mock.state.contracts('T-1')).toHaveLength(1);
    });

    it('does not issue a contract for an order first created already refunded', async () => {
      await call(
        '/orders',
        'PUT',
        order({
          status: 'refunded',
          lineItems: [
            productLine('A', {fulfilledQuantity: 1}),
            contractLine('A-contract', 'A', {fulfilledQuantity: 1}),
          ],
        }),
      );
      expect(mock.state.contracts('T-1')).toEqual([]);
    });

    it('treats an identical snapshot as a no-op, regardless of key order', async () => {
      await call('/orders', 'PUT', order());
      expect(JSON.stringify(reverseKeys(order()))).not.toBe(
        JSON.stringify(order()),
      );
      await call('/orders', 'PUT', order());
      await call('/orders', 'PUT', reverseKeys(order()));
      const puts = mock.state.requests.filter((r) => r.method === 'PUT');
      expect(puts.map((r) => r.noop)).toEqual([false, true, true]);
      expect(mock.state.eventTypes()).toEqual(['order_created']);
    });

    it('updates the contract when coveredProducts is reduced (partial refund)', async () => {
      const two = order({
        lineItems: [
          productLine('A', {quantity: 2, fulfilledQuantity: 2}),
          contractLine('A-contract', 'A', {
            fulfilledQuantity: 1,
            coveredProducts: [
              {lineItemTransactionId: 'A', productId: 'p-A', quantity: 2},
            ],
          }),
        ],
      });
      await call('/orders', 'PUT', {
        ...two,
        lineItems: [
          productLine('A', {quantity: 2}),
          contractLine('A-contract', 'A', {
            coveredProducts: [
              {lineItemTransactionId: 'A', productId: 'p-A', quantity: 2},
            ],
          }),
        ],
      });
      await call('/orders', 'PUT', two);
      await call(
        '/orders',
        'PUT',
        order({
          lineItems: [
            productLine('A', {quantity: 1, fulfilledQuantity: 1}),
            contractLine('A-contract', 'A', {fulfilledQuantity: 1}),
          ],
        }),
      );
      expect(mock.state.eventTypes()).toEqual([
        'order_created',
        'order_updated',
        'contract_created',
        'order_updated',
        'contract_updated',
      ]);
      expect(mock.state.contracts('T-1')[0]).toMatchObject({
        status: 'active',
        coveredProducts: [{quantity: 1}],
      });
    });

    it('cancels a contract when its line is omitted from the snapshot (removal)', async () => {
      await call(
        '/orders',
        'PUT',
        order({
          lineItems: [
            productLine('A', {fulfilledQuantity: 1}),
            contractLine('A-contract', 'A', {fulfilledQuantity: 1}),
          ],
        }),
      );
      await call(
        '/orders',
        'PUT',
        order({lineItems: [productLine('A', {fulfilledQuantity: 1})]}),
      );
      expect(mock.state.contracts('T-1')[0]).toMatchObject({
        status: 'cancelled',
      });
    });

    it('refunds every contract of the order on status "refunded", and refunded is terminal', async () => {
      const fulfilled = order({
        lineItems: [
          productLine('A', {fulfilledQuantity: 1}),
          contractLine('A-contract', 'A', {fulfilledQuantity: 1}),
        ],
      });
      await call('/orders', 'PUT', fulfilled);
      await call('/orders', 'PUT', {...fulfilled, status: 'refunded'});
      expect(mock.state.contracts('T-1')[0]).toMatchObject({
        status: 'refunded',
      });
      // Re-sending the original (un-refunded) snapshot does not resurrect the contract.
      await call('/orders', 'PUT', fulfilled);
      expect(mock.state.contracts('T-1')[0]).toMatchObject({
        status: 'refunded',
      });
    });

    it('never records bodies, headers or tokens in the request log', async () => {
      await call('/orders', 'PUT', order());
      expect(JSON.stringify(mock.state.requests)).not.toContain(TOKEN);
      expect(Object.keys(mock.state.requests[0] ?? {}).sort()).toEqual([
        'method',
        'noop',
        'path',
        'status',
      ]);
    });
  });
});
