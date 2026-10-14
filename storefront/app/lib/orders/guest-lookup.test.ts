import {Kind, parse} from 'graphql';
import {describe, expect, it} from 'vitest';
import {mulberry32} from '~/lib/catalog/test-helpers';
import {hasControlCharacter} from '~/lib/catalog/text';
import type {GuestOrderCandidate} from '~/lib/orders/guest-lookup';
import {
  GUEST_LOOKUP_FAILURE_MESSAGE,
  GUEST_LOOKUP_LIMITS,
  GUEST_LOOKUP_WINDOW_DAYS,
  GUEST_ORDER_LOOKUP_QUERY,
  buildGuestOrderLookupRequest,
  constantTimeEqual,
  createGuestLookupGuard,
  createRateLimiter,
  deriveGuestOrderStatus,
  isWithinLookupWindow,
  matchGuestOrder,
  matchGuestOrderFromList,
  normalizeEmail,
  normalizeOrderNumber,
  parseGuestOrderResponse,
  redactLogFields,
  shopifyOrderName,
  validateGuestLookupInput,
} from '~/lib/orders/guest-lookup';

// All identities here are fictional; example.com is reserved for documentation.
const NOW = Date.UTC(2026, 9, 12, 12, 0, 0);
const DAY = 86_400_000;
const MINUTE = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();

function candidate(
  overrides: Partial<GuestOrderCandidate> = {},
): GuestOrderCandidate {
  return {
    name: '#1001',
    email: 'Shopper@Example.com',
    createdAt: iso(NOW - 10 * DAY),
    cancelledAt: null,
    displayFulfillmentStatus: 'FULFILLED',
    lineItems: [
      {title: 'Larkmoor Cedar Medium Hybrid Mattress - Queen', quantity: 1},
    ],
    fulfillments: [
      {
        displayStatus: 'IN_TRANSIT',
        tracking: [
          {
            company: 'Example Freight',
            number: 'TRK123456789',
            url: 'https://tracking.example.com/TRK123456789',
          },
        ],
      },
    ],
    ...overrides,
  };
}

const RIGHT = {orderNumber: '#1001', email: 'shopper@example.com'};

describe('normalising the order number (REQ-ACC-003)', () => {
  it.each([
    ['#1001', '1001'],
    ['1001', '1001'],
    [' 1001 ', '1001'],
    ['\t#1001\n', '1001'],
    ['ORDER-1001', '1001'],
    ['order-1001', '1001'],
    ['Order #1001', '1001'],
    ['order no. 1001', '1001'],
    ['Order Number: 1001', '1001'],
    ['order_1001', '1001'],
    ['Order 1001', '1001'],
    ['#1001-a', '1001-A'],
    ['1001-B', '1001-B'],
    ['mf1001', 'MF1001'],
    ['MF-1001', 'MF-1001'],
    ['１００１', '1001'],
    ['10​01', '1001'],
  ])('%j -> %j', (raw, expected) => {
    expect(normalizeOrderNumber(raw)).toEqual({status: 'ok', number: expected});
  });

  it.each([
    [''],
    ['   '],
    ['#'],
    ['ORDER'],
    ['ORDER-'],
    ['##1001'],
    ['10 01'],
    ['1001; DROP TABLE'],
    ['1001 OR email:*'],
    ['name:1001'],
    ['"1001"'],
    ["1001'"],
    ['1001*'],
    ['(1001)'],
    ['1001\\'],
    ['<script>1001</script>'],
    ['1001-'],
    ['-1001'],
    ['1001-ABCDEFGH'],
    ['1001--A'],
    ['A'.repeat(21)],
    ['1'.repeat(100)],
    [null],
    [undefined],
    [1001],
    [{}],
    [['1001']],
  ])('rejects %j', (raw) => {
    expect(normalizeOrderNumber(raw)).toEqual({status: 'invalid'});
  });

  it('builds the Shopify name', () => {
    expect(shopifyOrderName('1001')).toBe('#1001');
    expect(shopifyOrderName('1001', 'MF-')).toBe('MF-1001');
  });
});

describe('normalising the email (REQ-ACC-003)', () => {
  it.each([
    ['Shopper@Example.com', 'shopper@example.com'],
    ['  shopper@example.com  ', 'shopper@example.com'],
    ['first.last+tag@sub.example.com', 'first.last+tag@sub.example.com'],
    ["o'brien@example.com", "o'brien@example.com"],
    ['a@b.co', 'a@b.co'],
    ['user@xn--mnchen-3ya.de', 'user@xn--mnchen-3ya.de'],
  ])('%j -> %j', (raw, expected) => {
    expect(normalizeEmail(raw)).toEqual({status: 'ok', email: expected});
  });

  it('keeps dots and plus tags, so one shopper cannot match another', () => {
    const plain = normalizeEmail('shopper@example.com');
    const dotted = normalizeEmail('shop.per@example.com');
    const tagged = normalizeEmail('shopper+x@example.com');
    expect(plain).not.toEqual(dotted);
    expect(plain).not.toEqual(tagged);
  });

  it.each([
    [''],
    ['plain'],
    ['@example.com'],
    ['a@'],
    ['a@b'],
    ['a@b.c'],
    ['a@example.123'],
    ['a b@example.com'],
    ['a@exam ple.com'],
    ['a@@example.com'],
    ['a@b@example.com'],
    ['a..b@example.com'],
    ['.a@example.com'],
    ['a.@example.com'],
    ['a@-example.com'],
    ['a@example-.com'],
    ['a@example..com'],
    ['a\n@example.com'],
    ['"a"@example.com'],
    ['<script>@example.com'],
    ['müller@example.com'],
    ['a@münchen.de'],
    [`${'x'.repeat(65)}@example.com`],
    [`a@${'x'.repeat(250)}.com`],
    [`${'x'.repeat(400)}@example.com`],
    [null],
    [undefined],
    [42],
    [{}],
  ])('rejects %j', (raw) => {
    expect(normalizeEmail(raw)).toEqual({status: 'invalid'});
  });

  it('validates the pair for the form without revealing anything about orders', () => {
    expect(
      validateGuestLookupInput({
        orderNumber: '#1001',
        email: ' Shopper@Example.com ',
      }),
    ).toEqual({
      status: 'ok',
      orderNumber: '1001',
      email: 'shopper@example.com',
    });
    expect(
      validateGuestLookupInput({
        orderNumber: 'x y',
        email: 'shopper@example.com',
      }),
    ).toEqual({status: 'invalid_format'});
    expect(
      validateGuestLookupInput({orderNumber: '1001', email: 'nope'}),
    ).toEqual({status: 'invalid_format'});
  });
});

describe('constant-time comparison (T-09)', () => {
  it.each([
    ['abc', 'abc', true],
    ['', '', true],
    ['abc', 'abd', false],
    ['abc', 'ab', false],
    ['ab', 'abc', false],
    ['abc', '', false],
    ['', 'abc', false],
    ['abc', 'ABC', false],
    ['a\u0000', 'a', false],
    ['a', 'a\u0000', false],
    ['é', 'e', false],
    ['x'.repeat(1000), 'x'.repeat(1000), true],
    ['x'.repeat(1000), `${'x'.repeat(999)}y`, false],
  ])('%j vs %j -> %s', (a, b, expected) => {
    expect(constantTimeEqual(a, b)).toBe(expected);
  });

  it('agrees with === on 500 random pairs, including near misses', () => {
    const random = mulberry32(2468);
    const alphabet = 'ab1@.é';
    const make = (length: number) =>
      Array.from(
        {length},
        () => alphabet[Math.floor(random() * alphabet.length)],
      ).join('');
    for (let i = 0; i < 500; i += 1) {
      const a = make(Math.floor(random() * 8));
      const b =
        random() < 0.4
          ? a
          : random() < 0.5
            ? `${a}${make(1)}`
            : make(Math.floor(random() * 8));
      expect(constantTimeEqual(a, b)).toBe(a === b);
    }
  });
});

describe('the 60-day window (REQ-ACC-003)', () => {
  it('is 60 days', () => {
    expect(GUEST_LOOKUP_WINDOW_DAYS).toBe(60);
  });

  it.each([
    ['just placed', NOW, true],
    ['yesterday', NOW - DAY, true],
    ['59 days ago', NOW - 59 * DAY, true],
    ['exactly 60 days ago', NOW - 60 * DAY, true],
    ['60 days and 1 ms ago', NOW - 60 * DAY - 1, false],
    ['61 days ago', NOW - 61 * DAY, false],
    ['a year ago', NOW - 365 * DAY, false],
    ['4 minutes ahead (clock skew)', NOW + 4 * MINUTE, true],
    ['6 minutes ahead', NOW + 6 * MINUTE, false],
    ['a day ahead', NOW + DAY, false],
  ])('an order placed %s', (_name, createdMs, expected) => {
    expect(isWithinLookupWindow(iso(createdMs), NOW)).toBe(expected);
  });

  it.each([[''], ['yesterday'], ['2026-13-45T00:00:00Z'], ['NaN']])(
    'rejects the date %j',
    (createdAt) => {
      expect(isWithinLookupWindow(createdAt, NOW)).toBe(false);
    },
  );

  it('is false for an unusable clock', () => {
    expect(isWithinLookupWindow(iso(NOW), Number.NaN)).toBe(false);
    expect(isWithinLookupWindow(iso(NOW), Number.POSITIVE_INFINITY)).toBe(
      false,
    );
  });

  it('uses the injected clock, not the real one', () => {
    const placed = iso(NOW - 10 * DAY);
    expect(isWithinLookupWindow(placed, NOW)).toBe(true);
    expect(isWithinLookupWindow(placed, NOW + 100 * DAY)).toBe(false);
  });
});

describe('matching a guest order: one generic failure (REQ-ACC-003, T-09)', () => {
  it('matches the right number and email', () => {
    const result = matchGuestOrder(candidate(), RIGHT, NOW);
    expect(result.status).toBe('match');
  });

  it.each([['#1001'], ['1001'], [' 1001 '], ['ORDER-1001'], ['order #1001']])(
    'matches the order number typed as %j',
    (orderNumber) => {
      expect(
        matchGuestOrder(
          candidate(),
          {orderNumber, email: 'shopper@example.com'},
          NOW,
        ).status,
      ).toBe('match');
    },
  );

  it.each([
    ['SHOPPER@EXAMPLE.COM'],
    ['  Shopper@example.com '],
    ['shopper@example.com'],
  ])(
    'matches the email typed as %j (stored as Shopper@Example.com)',
    (email) => {
      expect(
        matchGuestOrder(candidate(), {orderNumber: '1001', email}, NOW).status,
      ).toBe('match');
    },
  );

  const failures: readonly (readonly [
    string,
    GuestOrderCandidate | null,
    {orderNumber: unknown; email: unknown},
  ])[] = [
    [
      'the wrong order number',
      candidate(),
      {orderNumber: '1002', email: 'shopper@example.com'},
    ],
    [
      'the wrong email',
      candidate(),
      {orderNumber: '1001', email: 'other@example.com'},
    ],
    [
      'both wrong',
      candidate(),
      {orderNumber: '9999', email: 'other@example.com'},
    ],
    [
      'an email that only starts the same',
      candidate(),
      {orderNumber: '1001', email: 'shopper@example.com.evil.test'},
    ],
    [
      'an email that only ends the same',
      candidate(),
      {orderNumber: '1001', email: 'xshopper@example.com'},
    ],
    [
      'a different plus tag',
      candidate(),
      {orderNumber: '1001', email: 'shopper+1@example.com'},
    ],
    [
      'a longer order number',
      candidate(),
      {orderNumber: '10010', email: 'shopper@example.com'},
    ],
    [
      'a split order suffix that is not the order',
      candidate(),
      {orderNumber: '1001-A', email: 'shopper@example.com'},
    ],
    [
      'an order older than 60 days',
      candidate({createdAt: iso(NOW - 61 * DAY)}),
      RIGHT,
    ],
    [
      'an order dated in the future',
      candidate({createdAt: iso(NOW + 2 * DAY)}),
      RIGHT,
    ],
    ['an unreadable order date', candidate({createdAt: 'last week'}), RIGHT],
    ['no order found', null, RIGHT],
    ['an order with no email', candidate({email: null}), RIGHT],
    [
      'an order with an unusable email',
      candidate({email: 'not an email'}),
      RIGHT,
    ],
    ['an order with an unusable name', candidate({name: 'two words'}), RIGHT],
    [
      'a malformed email from the shopper',
      candidate(),
      {orderNumber: '1001', email: 'shopper'},
    ],
    [
      'a malformed number from the shopper',
      candidate(),
      {orderNumber: '1001 OR 1002', email: 'shopper@example.com'},
    ],
    ['missing input', candidate(), {orderNumber: undefined, email: undefined}],
    [
      'hostile input',
      candidate(),
      {orderNumber: {toString: () => '1001'}, email: ['shopper@example.com']},
    ],
    [
      'both unusable on both sides',
      candidate({name: '??', email: '??'}),
      {orderNumber: '??', email: '??'},
    ],
  ];

  it.each(failures)('fails for %s', (_name, order, input) => {
    expect(matchGuestOrder(order, input, NOW)).toEqual({status: 'no_match'});
  });

  it('every failure is exactly the same value, so no field can be told apart', () => {
    const results = failures.map(([, order, input]) =>
      JSON.stringify(matchGuestOrder(order, input, NOW)),
    );
    expect(new Set(results)).toEqual(new Set(['{"status":"no_match"}']));
  });

  it('the failure message names no field and no reason', () => {
    const message = GUEST_LOOKUP_FAILURE_MESSAGE.toLowerCase();
    expect(message).not.toMatch(
      /email (is|was|does)|number (is|was|does)|wrong|incorrect|not found|no such|does not exist|invalid/,
    );
    expect(message).toContain('60 days');
    expect(message).toContain('sign in');
    expect(message).toContain('confirmation email');
  });

  it('an old order and a missing order are indistinguishable', () => {
    expect(
      matchGuestOrder(candidate({createdAt: iso(NOW - 90 * DAY)}), RIGHT, NOW),
    ).toEqual(matchGuestOrder(null, RIGHT, NOW));
  });

  describe('what a matched guest may see', () => {
    const result = matchGuestOrder(candidate(), RIGHT, NOW);
    const order = result.status === 'match' ? result.order : null;

    it('is a minimal view', () => {
      expect(order).toEqual({
        orderName: '#1001',
        placedAt: iso(NOW - 10 * DAY),
        status: 'fulfilled',
        statusLabel: 'Fulfilled',
        items: [
          {title: 'Larkmoor Cedar Medium Hybrid Mattress - Queen', quantity: 1},
        ],
        shipments: [
          {
            statusLabel: 'In transit',
            trackingCompany: 'Example Freight',
            trackingNumber: 'TRK123456789',
            trackingUrl: 'https://tracking.example.com/TRK123456789',
          },
        ],
      });
    });

    it('carries no email, address, phone or customer data', () => {
      const text = JSON.stringify(order).toLowerCase();
      expect(text).not.toContain('shopper@example.com');
      expect(text).not.toContain('email');
      expect(Object.keys(order ?? {}).sort()).toEqual([
        'items',
        'orderName',
        'placedAt',
        'shipments',
        'status',
        'statusLabel',
      ]);
    });
  });

  describe('status', () => {
    it.each([
      [
        {cancelledAt: iso(NOW), displayFulfillmentStatus: 'FULFILLED'},
        'cancelled',
      ],
      [{cancelledAt: null, displayFulfillmentStatus: 'FULFILLED'}, 'fulfilled'],
      [
        {cancelledAt: null, displayFulfillmentStatus: 'PARTIALLY_FULFILLED'},
        'partially_fulfilled',
      ],
      [
        {cancelledAt: null, displayFulfillmentStatus: 'UNFULFILLED'},
        'processing',
      ],
      [
        {cancelledAt: null, displayFulfillmentStatus: 'IN_PROGRESS'},
        'processing',
      ],
      [{cancelledAt: null, displayFulfillmentStatus: 'ON_HOLD'}, 'on_hold'],
      [{cancelledAt: null, displayFulfillmentStatus: 'SCHEDULED'}, 'scheduled'],
      [{cancelledAt: null, displayFulfillmentStatus: 'RESTOCKED'}, 'returned'],
      [
        {cancelledAt: null, displayFulfillmentStatus: 'SOMETHING_NEW'},
        'processing',
      ],
      [{cancelledAt: null, displayFulfillmentStatus: null}, 'processing'],
      [
        {cancelledAt: null, displayFulfillmentStatus: 'fulfilled'},
        'processing',
      ],
    ])('%j -> %s', (input, expected) => {
      expect(deriveGuestOrderStatus(input)).toBe(expected);
    });
  });

  describe('shipments and content', () => {
    function view(overrides: Partial<GuestOrderCandidate>) {
      const result = matchGuestOrder(candidate(overrides), RIGHT, NOW);
      if (result.status !== 'match') throw new Error('expected a match');
      return result.order;
    }

    it('keeps only https tracking links', () => {
      const tracking = (url: string | null) => ({
        company: 'Carrier',
        number: '1',
        url,
      });
      for (const [url, expected] of [
        ['https://track.example.com/1', 'https://track.example.com/1'],
        ['http://track.example.com/1', null],
        ['javascript:alert(1)', null],
        ['data:text/html,x', null],
        ['//evil.example', null],
        ['not a url', null],
        [null, null],
        [`https://x.example/${'a'.repeat(3000)}`, null],
      ] as const) {
        const shipment = view({
          fulfillments: [
            {displayStatus: 'FULFILLED', tracking: [tracking(url)]},
          ],
        }).shipments[0];
        expect(shipment?.trackingUrl).toBe(expected);
      }
    });

    it('lists a shipment without tracking once, and no shipments when none exist', () => {
      expect(
        view({fulfillments: [{displayStatus: 'DELIVERED', tracking: []}]})
          .shipments,
      ).toEqual([
        {
          statusLabel: 'Delivered',
          trackingCompany: null,
          trackingNumber: null,
          trackingUrl: null,
        },
      ]);
      expect(view({fulfillments: []}).shipments).toEqual([]);
    });

    it('gives no label for an unknown shipment status', () => {
      expect(
        view({fulfillments: [{displayStatus: 'BRAND_NEW', tracking: []}]})
          .shipments[0]?.statusLabel,
      ).toBeNull();
    });

    it('strips markup and control characters from text', () => {
      const order = view({
        lineItems: [
          {
            title: '<img src=x onerror=alert(1)>Mattress\u0000 <b>Queen</b>',
            quantity: 1,
          },
        ],
        fulfillments: [
          {
            displayStatus: 'FULFILLED',
            tracking: [
              {company: '<script>x</script>Carrier', number: '1\n2', url: null},
            ],
          },
        ],
      });
      expect(order.items[0]?.title).toBe('Mattress Queen');
      // Tags are removed; the text between them stays and is escaped on render.
      expect(order.shipments[0]?.trackingCompany).toBe('xCarrier');
      expect(order.shipments[0]?.trackingNumber).toBe('1 2');
    });
  });

  describe('several candidates from one name search', () => {
    const mine = candidate();
    const sibling = candidate({name: '#1001-B'});
    const someoneElse = candidate({email: 'other@example.com'});

    it('picks the one that matches', () => {
      expect(
        matchGuestOrderFromList([someoneElse, sibling, mine], RIGHT, NOW)
          .status,
      ).toBe('match');
      expect(
        matchGuestOrderFromList(
          [sibling],
          {orderNumber: '1001-B', email: 'shopper@example.com'},
          NOW,
        ).status,
      ).toBe('match');
    });

    it('fails the same generic way for an empty list or no match', () => {
      expect(matchGuestOrderFromList([], RIGHT, NOW)).toEqual({
        status: 'no_match',
      });
      expect(
        matchGuestOrderFromList([someoneElse, sibling], RIGHT, NOW),
      ).toEqual({status: 'no_match'});
    });

    it('returns the first match when more than one qualifies', () => {
      const first = candidate({lineItems: [{title: 'First', quantity: 1}]});
      const second = candidate({lineItems: [{title: 'Second', quantity: 1}]});
      const result = matchGuestOrderFromList([first, second], RIGHT, NOW);
      expect(result.status === 'match' && result.order.items[0]?.title).toBe(
        'First',
      );
    });
  });
});

describe('the Admin API request (REQ-ACC-003, T-09)', () => {
  it('is a valid single query with one variable', () => {
    const document = parse(GUEST_ORDER_LOOKUP_QUERY);
    expect(document.definitions).toHaveLength(1);
    const operation = document.definitions[0];
    expect(operation?.kind).toBe(Kind.OPERATION_DEFINITION);
    if (operation?.kind !== Kind.OPERATION_DEFINITION) return;
    expect(operation.operation).toBe('query');
    expect(operation.name?.value).toBe('GuestOrderLookup');
    expect(
      operation.variableDefinitions?.map((v) => v.variable.name.value),
    ).toEqual(['query']);
  });

  it('asks only for fields a guest may see, and for no customer, address or payment data', () => {
    for (const field of [
      'name',
      'email',
      'createdAt',
      'cancelledAt',
      'displayFulfillmentStatus',
      'lineItems',
      'fulfillments',
      'trackingInfo',
    ]) {
      expect(GUEST_ORDER_LOOKUP_QUERY).toContain(field);
    }
    for (const forbidden of [
      'shippingAddress',
      'billingAddress',
      'phone',
      'customer',
      'totalPrice',
      'paymentGateway',
      'note',
      'transactions',
    ]) {
      expect(GUEST_ORDER_LOOKUP_QUERY).not.toContain(forbidden);
    }
    expect(GUEST_ORDER_LOOKUP_QUERY).toMatch(/orders\(first: 5,/);
  });

  it('puts the order number in a variable and leaves the query text untouched', () => {
    const result = buildGuestOrderLookupRequest('#1001');
    expect(result).toEqual({
      status: 'ok',
      request: {
        operationName: 'GuestOrderLookup',
        query: GUEST_ORDER_LOOKUP_QUERY,
        variables: {query: 'name:1001'},
      },
    });
    expect(GUEST_ORDER_LOOKUP_QUERY).not.toContain('1001');
  });

  it('normalises before building', () => {
    for (const raw of ['#1001', 'ORDER-1001', ' 1001 ']) {
      expect(buildGuestOrderLookupRequest(raw)).toMatchObject({
        status: 'ok',
        request: {variables: {query: 'name:1001'}},
      });
    }
    expect(buildGuestOrderLookupRequest('#1001-a')).toMatchObject({
      request: {variables: {query: 'name:1001-A'}},
    });
  });

  it.each([
    ['a search operator'],
    ['1001 OR email:*'],
    ['1001) OR (name:*'],
    ['"1001"'],
    ['1001*'],
    ['1001\n2002'],
    ['}} mutation { x'],
    ['$query'],
    ['#'],
    [''],
    [null],
    [{}],
  ])('refuses %j', (raw) => {
    expect(buildGuestOrderLookupRequest(raw)).toEqual({status: 'invalid'});
  });

  it('property: no input ever changes the query text or adds search syntax (500 random inputs)', () => {
    const random = mulberry32(13579);
    const pieces = [
      '1',
      '0',
      'A',
      'z',
      '-',
      '#',
      ' ',
      '"',
      "'",
      ':',
      '*',
      '(',
      ')',
      '{',
      '}',
      '$',
      '\\',
      '\n',
      '\u0000',
      'OR',
      'AND',
      'name:',
      'email:',
      'order',
      '--',
    ];
    for (let i = 0; i < 500; i += 1) {
      const raw = Array.from(
        {length: 1 + Math.floor(random() * 8)},
        () => pieces[Math.floor(random() * pieces.length)],
      ).join('');
      const result = buildGuestOrderLookupRequest(raw);
      if (result.status === 'ok') {
        expect(result.request.query).toBe(GUEST_ORDER_LOOKUP_QUERY);
        expect(result.request.variables.query).toMatch(
          /^name:[A-Z0-9]{1,20}(?:-[A-Z0-9]{1,6})?$/,
        );
      }
    }
  });
});

describe('reading the Admin API response', () => {
  const node = {
    name: '#1001',
    email: 'shopper@example.com',
    createdAt: iso(NOW - DAY),
    cancelledAt: null,
    displayFulfillmentStatus: 'UNFULFILLED',
    lineItems: {nodes: [{title: 'Mattress', quantity: 2}]},
    fulfillments: [
      {
        displayStatus: 'IN_TRANSIT',
        trackingInfo: [
          {company: 'C', number: '1', url: 'https://t.example.com/1'},
        ],
      },
    ],
  };

  it('reads orders into candidates that match', () => {
    const parsed = parseGuestOrderResponse({data: {orders: {nodes: [node]}}});
    expect(parsed.status).toBe('ok');
    const candidates = parsed.status === 'ok' ? parsed.candidates : [];
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      name: '#1001',
      lineItems: [{title: 'Mattress', quantity: 2}],
      fulfillments: [
        {
          displayStatus: 'IN_TRANSIT',
          tracking: [
            {company: 'C', number: '1', url: 'https://t.example.com/1'},
          ],
        },
      ],
    });
    expect(matchGuestOrderFromList(candidates, RIGHT, NOW).status).toBe(
      'match',
    );
  });

  it('an empty result is ok, with no candidates', () => {
    expect(parseGuestOrderResponse({data: {orders: {nodes: []}}})).toEqual({
      status: 'ok',
      candidates: [],
    });
  });

  it.each([
    ['not an object', 'oops'],
    ['null', null],
    [
      'GraphQL errors',
      {errors: [{message: 'Throttled'}], data: {orders: {nodes: []}}},
    ],
    ['no data', {}],
    ['null data', {data: null}],
    ['no orders', {data: {}}],
    ['nodes not a list', {data: {orders: {nodes: 'x'}}}],
  ])('treats %s as an upstream error, not as "no match"', (_name, json) => {
    expect(parseGuestOrderResponse(json)).toEqual({status: 'upstream_error'});
  });

  it('drops malformed nodes and bad line items instead of failing', () => {
    const parsed = parseGuestOrderResponse({
      data: {
        orders: {
          nodes: [
            null,
            'text',
            {name: 5, createdAt: iso(NOW)},
            {name: '#1', createdAt: null},
            {
              ...node,
              lineItems: {
                nodes: [
                  {title: 'ok', quantity: 1},
                  {title: 'bad', quantity: -1},
                  {title: 'frac', quantity: 1.5},
                  {title: 7, quantity: 1},
                  null,
                ],
              },
              fulfillments: 'x',
            },
          ],
        },
      },
    });
    const candidates = parsed.status === 'ok' ? parsed.candidates : [];
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.lineItems).toEqual([{title: 'ok', quantity: 1}]);
    expect(candidates[0]?.fulfillments).toEqual([]);
  });

  it('reads at most 10 orders and 50 items', () => {
    const many = Array.from({length: 40}, () => ({
      ...node,
      lineItems: {
        nodes: Array.from({length: 200}, () => ({title: 't', quantity: 1})),
      },
    }));
    const parsed = parseGuestOrderResponse({data: {orders: {nodes: many}}});
    const candidates = parsed.status === 'ok' ? parsed.candidates : [];
    expect(candidates).toHaveLength(10);
    expect(candidates[0]?.lineItems).toHaveLength(50);
  });
});

describe('rate limiting (REQ-ACC-003, T-09)', () => {
  function limiterWith(
    limit: number,
    windowMs: number,
    start = 0,
    maxKeys?: number,
  ) {
    const clock = {now: start};
    const limiter = createRateLimiter({
      limit,
      windowMs,
      now: () => clock.now,
      ...(maxKeys !== undefined && {maxKeys}),
    });
    return {clock, limiter};
  }

  it('allows the limit, then blocks with a retry time (hand-checked)', () => {
    const {clock, limiter} = limiterWith(3, 10_000);
    expect(limiter.check('k')).toEqual({allowed: true, remaining: 2}); // t=0
    clock.now = 1000;
    expect(limiter.check('k')).toEqual({allowed: true, remaining: 1});
    clock.now = 2000;
    expect(limiter.check('k')).toEqual({allowed: true, remaining: 0});
    clock.now = 3000;
    // Oldest attempt at 0 leaves the window at 10,000: 7 seconds from now.
    expect(limiter.check('k')).toEqual({allowed: false, retryAfterSeconds: 7});
  });

  it('slides: the block lifts when the oldest attempt leaves the window, and blocked tries are not counted', () => {
    const {clock, limiter} = limiterWith(3, 10_000);
    for (const t of [0, 1000, 2000]) {
      clock.now = t;
      limiter.check('k');
    }
    for (const t of [3000, 4000, 5000, 9999]) {
      clock.now = t;
      expect(limiter.check('k').allowed).toBe(false);
    }
    clock.now = 10_000; // the attempt at t=0 is out of the window (needs time > 0)
    expect(limiter.check('k')).toEqual({allowed: true, remaining: 0});
    clock.now = 10_001;
    expect(limiter.check('k')).toEqual({allowed: false, retryAfterSeconds: 1}); // oldest is now 1000
    clock.now = 11_000;
    expect(limiter.check('k').allowed).toBe(true);
  });

  it('keeps keys independent', () => {
    const {limiter} = limiterWith(1, 10_000);
    expect(limiter.check('a').allowed).toBe(true);
    expect(limiter.check('a').allowed).toBe(false);
    expect(limiter.check('b').allowed).toBe(true);
  });

  it('rounds the retry time up and never reports less than one second', () => {
    const {clock, limiter} = limiterWith(1, 10_000);
    limiter.check('k');
    clock.now = 9_999;
    expect(limiter.check('k')).toEqual({allowed: false, retryAfterSeconds: 1});
    clock.now = 100;
    expect(limiter.check('k')).toEqual({allowed: false, retryAfterSeconds: 10});
  });

  it('fails closed when the clock is unusable', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const {clock, limiter} = limiterWith(5, 10_000);
      clock.now = bad;
      expect(limiter.check('k')).toEqual({
        allowed: false,
        retryAfterSeconds: 10,
      });
    }
  });

  it('a clock that moves backwards never blocks for longer than the window', () => {
    const {clock, limiter} = limiterWith(2, 10_000, 50_000);
    limiter.check('k');
    limiter.check('k');
    clock.now = 1_000;
    const result = limiter.check('k');
    expect(result.allowed).toBe(false);
    expect(!result.allowed && result.retryAfterSeconds).toBeLessThanOrEqual(10);
  });

  it('bounds memory: when full, the least recently used key is forgotten', () => {
    const {clock, limiter} = limiterWith(1, 100_000, 0, 3);
    for (const [index, key] of ['a', 'b', 'c', 'd'].entries()) {
      clock.now = index;
      expect(limiter.check(key).allowed).toBe(true);
    }
    clock.now = 10;
    expect(limiter.check('d').allowed).toBe(false); // recent keys are still tracked
    expect(limiter.check('a').allowed).toBe(true); // 'a' was evicted to stay within 3 keys
  });

  it('drops expired keys before evicting live ones', () => {
    const {clock, limiter} = limiterWith(1, 1000, 0, 3);
    for (const key of ['a', 'b', 'c']) limiter.check(key);
    clock.now = 5000; // everything above has expired
    limiter.check('d');
    limiter.check('e');
    limiter.check('f');
    expect(limiter.check('f').allowed).toBe(false);
    expect(limiter.check('e').allowed).toBe(false);
    expect(limiter.check('d').allowed).toBe(false);
  });

  it('survives a flood of distinct keys', () => {
    const {clock, limiter} = limiterWith(1, 100_000, 0, 100);
    for (let i = 0; i < 20_000; i += 1) {
      clock.now = i;
      expect(limiter.check(`key-${i}`).allowed).toBe(true);
    }
  });

  it('treats a very long key by its first 300 characters', () => {
    const {limiter} = limiterWith(1, 10_000);
    expect(limiter.check('x'.repeat(1000)).allowed).toBe(true);
    expect(limiter.check('x'.repeat(300)).allowed).toBe(false);
  });

  it('property: never allows more than the limit inside any window (200 random runs)', () => {
    const random = mulberry32(97531);
    for (let run = 0; run < 200; run += 1) {
      const limit = 1 + Math.floor(random() * 6);
      const windowMs = 1000 * (1 + Math.floor(random() * 20));
      const {clock, limiter} = limiterWith(limit, windowMs);
      const allowedAt: number[] = [];
      for (let step = 0; step < 60; step += 1) {
        clock.now += Math.floor(random() * windowMs * 0.6);
        if (limiter.check('k').allowed) allowedAt.push(clock.now);
        const inWindow = allowedAt.filter((t) => t > clock.now - windowMs);
        expect(inWindow.length).toBeLessThanOrEqual(limit);
      }
    }
  });
});

describe('the lookup guard: address, email and overall limits (T-09)', () => {
  const LIMITS = {
    perAddress: {limit: 3, windowMs: 60_000},
    perEmail: {limit: 2, windowMs: 60_000},
    overall: {limit: 5, windowMs: 60_000},
  };

  function guardWith() {
    const clock = {now: 0};
    return {
      clock,
      guard: createGuestLookupGuard({now: () => clock.now, limits: LIMITS}),
    };
  }

  it('ships conservative defaults', () => {
    expect(GUEST_LOOKUP_LIMITS.perAddress).toEqual({
      limit: 10,
      windowMs: 900_000,
    });
    expect(GUEST_LOOKUP_LIMITS.perEmail).toEqual({limit: 5, windowMs: 900_000});
    expect(GUEST_LOOKUP_LIMITS.overall.limit).toBeGreaterThan(
      GUEST_LOOKUP_LIMITS.perAddress.limit,
    );
  });

  it('blocks one email tried from many addresses (distributed guessing)', () => {
    const {guard} = guardWith();
    expect(
      guard.check({address: '198.51.100.1', email: 'victim@example.com'}),
    ).toEqual({allowed: true});
    expect(
      guard.check({address: '198.51.100.2', email: 'victim@example.com'}),
    ).toEqual({allowed: true});
    expect(
      guard.check({address: '198.51.100.3', email: 'victim@example.com'}),
    ).toMatchObject({allowed: false, limitedBy: 'email'});
  });

  it('treats the email case-insensitively and ignores surrounding space', () => {
    const {guard} = guardWith();
    guard.check({address: 'a1', email: 'Victim@Example.com'});
    guard.check({address: 'a2', email: ' victim@example.com '});
    expect(
      guard.check({address: 'a3', email: 'VICTIM@EXAMPLE.COM'}),
    ).toMatchObject({allowed: false, limitedBy: 'email'});
  });

  it('blocks one address trying many emails', () => {
    const {guard} = guardWith();
    for (const n of [1, 2, 3]) {
      expect(
        guard.check({address: '203.0.113.9', email: `person${n}@example.com`})
          .allowed,
      ).toBe(true);
    }
    expect(
      guard.check({address: '203.0.113.9', email: 'person4@example.com'}),
    ).toMatchObject({allowed: false, limitedBy: 'address'});
  });

  it('does not count an attempt against the email when the address is already blocked', () => {
    const {guard} = guardWith();
    for (const n of [1, 2, 3])
      guard.check({address: 'attacker', email: `x${n}@example.com`});
    // The attacker is blocked by address; hammering victim@ from there must not lock the victim out.
    for (let i = 0; i < 10; i += 1) {
      expect(
        guard.check({address: 'attacker', email: 'victim@example.com'}),
      ).toMatchObject({limitedBy: 'address'});
    }
    expect(
      guard.check({address: 'someone-else', email: 'victim@example.com'}),
    ).toEqual({allowed: true});
  });

  it('a malformed email only counts against the address', () => {
    const {guard} = guardWith();
    for (let i = 0; i < 3; i += 1)
      expect(guard.check({address: 'a', email: 'not-an-email'}).allowed).toBe(
        true,
      );
    expect(guard.check({address: 'a', email: 'not-an-email'})).toMatchObject({
      allowed: false,
      limitedBy: 'address',
    });
    expect(guard.check({address: 'b', email: undefined}).allowed).toBe(true);
  });

  it('applies an overall ceiling across everyone', () => {
    const {guard} = guardWith();
    for (let n = 1; n <= 5; n += 1) {
      expect(
        guard.check({address: `addr-${n}`, email: `p${n}@example.com`}).allowed,
      ).toBe(true);
    }
    expect(
      guard.check({address: 'addr-6', email: 'p6@example.com'}),
    ).toMatchObject({allowed: false, limitedBy: 'overall'});
  });

  it('allows attempts again once the window has passed, and reports a retry time', () => {
    const {clock, guard} = guardWith();
    for (const n of [1, 2, 3])
      guard.check({address: 'a', email: `p${n}@example.com`});
    const blocked = guard.check({address: 'a', email: 'p4@example.com'});
    expect(blocked).toMatchObject({allowed: false, retryAfterSeconds: 60});
    clock.now = 60_001;
    expect(guard.check({address: 'a', email: 'p5@example.com'}).allowed).toBe(
      true,
    );
  });
});

describe('keeping personal data out of logs (T-05, T-09)', () => {
  it('keeps allow-listed fields', () => {
    expect(
      redactLogFields({
        event: 'guest_lookup',
        outcome: 'no_match',
        durationMs: 42,
        limitedBy: 'email',
        candidateCount: 0,
        retryAfterSeconds: 5,
        httpStatus: 200,
      }),
    ).toEqual({
      event: 'guest_lookup',
      outcome: 'no_match',
      durationMs: 42,
      limitedBy: 'email',
      candidateCount: 0,
      retryAfterSeconds: 5,
      httpStatus: 200,
    });
  });

  it('redacts every field that is not on the allow-list, whatever its name', () => {
    expect(
      redactLogFields({
        email: 'shopper@example.com',
        orderNumber: '#1001',
        name: 'Jane Shopper',
        phone: '716-555-0101',
        address: '1 Main St',
        token: 'shpat_abc',
        ip: '203.0.113.9',
        anything: 'else',
      }),
    ).toEqual({
      email: '[redacted]',
      orderNumber: '[redacted]',
      name: '[redacted]',
      phone: '[redacted]',
      address: '[redacted]',
      token: '[redacted]',
      ip: '[redacted]',
      anything: '[redacted]',
    });
  });

  it('scrubs emails and long digit runs out of allowed text fields', () => {
    expect(
      redactLogFields({reason: 'no match for shopper@example.com'}),
    ).toEqual({reason: 'no match for [email]'});
    expect(redactLogFields({reason: 'order 100123 phone 7165550101'})).toEqual({
      reason: 'order [number] phone [number]',
    });
    expect(redactLogFields({reason: 'step 12 of 3'})).toEqual({
      reason: 'step 12 of 3',
    });
  });

  it('redacts values that are not plain strings, numbers or booleans', () => {
    expect(
      redactLogFields({
        event: {email: 'shopper@example.com'},
        outcome: ['shopper@example.com'],
        reason: null,
        status: undefined,
        durationMs: Number.NaN,
        httpStatus: Number.POSITIVE_INFINITY,
        upstream: true,
      }),
    ).toEqual({
      event: '[redacted]',
      outcome: '[redacted]',
      reason: '[redacted]',
      status: '[redacted]',
      durationMs: '[redacted]',
      httpStatus: '[redacted]',
      upstream: true,
    });
  });

  it('shortens long text and strips markup and control characters', () => {
    const out = redactLogFields({reason: `<b>${'x'.repeat(500)}</b>\u0000`});
    expect(String(out.reason).length).toBeLessThanOrEqual(120);
    expect(String(out.reason)).not.toContain('<');
    expect(String(out.reason)).not.toContain('>');
    expect(hasControlCharacter(String(out.reason))).toBe(false);
  });

  it('cleans odd key names and survives a "__proto__" key', () => {
    const out = redactLogFields(
      Object.fromEntries([
        ['<script>alert(1)</script>', 'x'],
        ['__proto__', 'polluted'],
      ]),
    );
    expect(Object.keys(out)).toEqual([
      '_script_alert_1___script_',
      '__proto__',
    ]);
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('reads at most 30 fields', () => {
    const fields = Object.fromEntries(
      Array.from({length: 100}, (_, i) => [`field${i}`, 'x']),
    );
    expect(Object.keys(redactLogFields(fields))).toHaveLength(30);
  });

  it('property: none of a set of personal values survives in the output (300 random field sets)', () => {
    const random = mulberry32(8642);
    // Names cannot be recognised in free text, so allow-listed fields must carry
    // codes only (see LOG_SAFE_KEYS); names are covered by the redacted-key test above.
    const personal = [
      'jane.shopper@example.com',
      '716-555-0101',
      '(716) 555-0101',
      '14201-1234',
      'order #100123456',
    ];
    const keys = [
      'event',
      'outcome',
      'reason',
      'status',
      'email',
      'orderNumber',
      'name',
      'phone',
      'message',
      'error',
      'limitedBy',
    ];
    for (let i = 0; i < 300; i += 1) {
      const fields: Record<string, unknown> = {};
      for (let k = 0; k < 6; k += 1) {
        const key = keys[Math.floor(random() * keys.length)] ?? 'event';
        const value = [
          ...Array.from(
            {length: 1 + Math.floor(random() * 3)},
            () => personal[Math.floor(random() * personal.length)],
          ),
        ].join(' ');
        fields[key] =
          random() < 0.8 ? `lookup failed for ${value}` : {nested: value};
      }
      const text = JSON.stringify(redactLogFields(fields));
      for (const value of personal) {
        expect(text).not.toContain(value);
      }
      expect(text).not.toMatch(/@example\.com|\d{4,}/);
    }
  });
});
