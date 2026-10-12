import {describe, expect, it} from 'vitest';
import {createCircuitBreaker} from '~/lib/extend/circuit-breaker';
import {parseExtendConfig, type ExtendConfigResult} from '~/lib/extend/config';
import type {ExtendLogEvent} from '~/lib/extend/log';
import {
  buildOffersBody,
  createOffersQuoteLookup,
  fetchOffers,
  filterEligibleItems,
  parseOffersResponse,
  quotesFromOffers,
  type OfferItem,
} from '~/lib/extend/offers';
import type {FetchInit, FetchLike} from '~/lib/extend/types';

const TOKEN = 'tok_fixture_offers_0001';
const STORE = 'store-fixture-1';

function configResult(
  overrides: Record<string, unknown> = {},
): ExtendConfigResult {
  return parseExtendConfig({
    PUBLIC_EXTEND_ENABLED: 'true',
    EXTEND_API_HOST: 'https://api-demo.helloextend.com',
    EXTEND_STORE_ID: STORE,
    EXTEND_ACCESS_TOKEN: TOKEN,
    ...overrides,
  });
}

const item: OfferItem = {
  category: 'mattress',
  productId: '501',
  purchasePriceCents: 129_900,
  quantity: 1,
};

function plan(overrides: Record<string, unknown> = {}) {
  return {
    id: 'MOCK-MATT-ADH-3Y-C',
    price: 7999,
    title: '3 Year Mattress Protection',
    contract: {
      category: 'mattress',
      coverageIncludes: 'adh',
      coverageStarts: 'immediate',
      deductible: 0,
      termLength: 36,
    },
    url: 'https://example.invalid/terms/1',
    offerPlanId: 'ERN:OFP:1',
    imageUrl: 'https://example.invalid/icon.png',
    ...overrides,
  };
}

function offerJson(overrides: Record<string, unknown> = {}) {
  return {
    offerId: 'offer-1',
    marketing: {adh: {pdp: {headline: 'ignored'}}},
    plans: {adh: [plan()], base: [], recommended: 'adh'},
    coveredProducts: [{productId: '501', quantity: 1, purchasePrice: 129_900}],
    ...overrides,
  };
}

function bodyJson(overrides: Record<string, unknown> = {}) {
  return {
    offerCartId: 'cart-1',
    storeId: STORE,
    currency: 'USD',
    locale: 'en_US',
    offers: [offerJson()],
    surfaceVersion: {},
    ...overrides,
  };
}

const networkDown: FetchLike = () =>
  Promise.reject(new TypeError('fetch failed'));
const htmlBody: FetchLike = () =>
  Promise.resolve(new Response('<html>', {status: 200}));

function jsonFetch(body: unknown, status = 200): FetchLike {
  return () => Promise.resolve(new Response(JSON.stringify(body), {status}));
}

describe('Offers request builder (REQ-EXT-001)', () => {
  it('builds the documented body: storeId, currency USD, items with integer cents', () => {
    expect(buildOffersBody(STORE, [item])).toEqual({
      status: 'ok',
      body: {
        storeId: STORE,
        currency: 'USD',
        items: [
          {
            category: 'mattress',
            productId: '501',
            purchasePrice: 129_900,
            quantity: 1,
          },
        ],
      },
    });
  });

  it.each([
    ['no items', []],
    ['zero price', [{...item, purchasePriceCents: 0}]],
    ['negative price', [{...item, purchasePriceCents: -1}]],
    [
      'fractional price (floats are not cents)',
      [{...item, purchasePriceCents: 1299.5}],
    ],
    ['NaN price', [{...item, purchasePriceCents: Number.NaN}]],
    ['absurd price', [{...item, purchasePriceCents: 10 ** 12}]],
    ['zero quantity', [{...item, quantity: 0}]],
    ['huge quantity', [{...item, quantity: 10_000}]],
    ['fractional quantity', [{...item, quantity: 1.5}]],
    ['empty product id', [{...item, productId: ''}]],
    ['injected product id', [{...item, productId: '501"}],"currency":"EUR'}]],
    ['empty category', [{...item, category: ''}]],
    ['category with markup', [{...item, category: '<b>mattress</b>'}]],
    ['too many items', Array.from({length: 51}, () => item)],
  ])('rejects %s before any request is made', (_label, items) => {
    expect(buildOffersBody(STORE, items)).toEqual({
      status: 'error',
      reason: 'invalid_request',
    });
  });
});

describe('eligible categories (REQ-EXT-005)', () => {
  const items: OfferItem[] = [
    item,
    {...item, productId: '502', category: 'Pillow'},
    {...item, productId: '503', category: 'furniture'},
  ];

  it('keeps only products in the client list, ignoring case and spaces', () => {
    const {eligible, ineligible} = filterEligibleItems(items, [
      ' MATTRESS ',
      'pillow',
    ]);
    expect(eligible.map((i) => i.productId)).toEqual(['501', '502']);
    expect(ineligible.map((i) => i.productId)).toEqual(['503']);
  });

  it('treats an empty list as nothing eligible', () => {
    expect(filterEligibleItems(items, []).eligible).toEqual([]);
  });
});

describe('Offers response validation (REQ-EXT-001; Extend replies are untrusted)', () => {
  const expected = {storeId: STORE};

  it('parses the documented shape into typed offers with cents', () => {
    const parsed = parseOffersResponse(bodyJson(), [item], expected);
    expect(parsed).toEqual({
      status: 'ok',
      offerCartId: 'cart-1',
      droppedCount: 0,
      offers: [
        {
          offerId: 'offer-1',
          plans: {
            adh: [
              {
                id: 'MOCK-MATT-ADH-3Y-C',
                priceCents: 7999,
                title: '3 Year Mattress Protection',
                contract: {
                  category: 'mattress',
                  coverageIncludes: 'adh',
                  coverageStarts: 'immediate',
                  deductible: 0,
                  termLength: 36,
                },
                url: 'https://example.invalid/terms/1',
                offerPlanId: 'ERN:OFP:1',
                imageUrl: 'https://example.invalid/icon.png',
              },
            ],
            base: [],
            recommended: 'adh',
          },
          coveredProducts: [
            {productId: '501', quantity: 1, purchasePriceCents: 129_900},
          ],
        },
      ],
    });
  });

  it('accepts an empty offers array (nothing to offer is a valid answer)', () => {
    expect(
      parseOffersResponse(bodyJson({offers: []}), [item], expected),
    ).toMatchObject({
      status: 'ok',
      offers: [],
    });
  });

  it.each([
    ['null', null],
    ['an array', []],
    ['a string', 'offers'],
    ['no offers key', {offerCartId: 'x'}],
    ['offers not an array', bodyJson({offers: {a: 1}})],
    ['wrong currency', bodyJson({currency: 'EUR'})],
    ["someone else's store", bodyJson({storeId: 'other-store'})],
    [
      'too many offers',
      bodyJson({offers: Array.from({length: 101}, () => offerJson())}),
    ],
  ])('is malformed: %s', (_label, body) => {
    expect(parseOffersResponse(body, [item], expected)).toEqual({
      status: 'error',
      reason: 'malformed',
    });
  });

  it.each([
    ['plans missing', offerJson({plans: undefined})],
    ['plans not an object', offerJson({plans: []})],
    ['adh not an array', offerJson({plans: {adh: plan(), base: []}})],
    ['no offerId', offerJson({offerId: ''})],
    ['coveredProducts missing', offerJson({coveredProducts: undefined})],
    ['coveredProducts empty', offerJson({coveredProducts: []})],
    [
      'covered product with string quantity',
      offerJson({
        coveredProducts: [{productId: '501', quantity: '1', purchasePrice: 1}],
      }),
    ],
    [
      'covers a product we never asked about',
      offerJson({
        coveredProducts: [{productId: '999', quantity: 1, purchasePrice: 1}],
      }),
    ],
  ])('drops a bad offer (%s) but keeps the good one', (_label, bad) => {
    const parsed = parseOffersResponse(
      bodyJson({offers: [bad, offerJson({offerId: 'good'})]}),
      [item],
      expected,
    );
    expect(parsed).toMatchObject({status: 'ok', droppedCount: 1});
    if (parsed.status === 'ok')
      expect(parsed.offers.map((o) => o.offerId)).toEqual(['good']);
  });

  it('reports malformed (a contract break) when every offer in a response is invalid', () => {
    expect(
      parseOffersResponse(
        bodyJson({offers: [offerJson({offerId: ''})]}),
        [item],
        expected,
      ),
    ).toEqual({status: 'error', reason: 'malformed'});
  });

  it.each([
    ['price as a string', {price: '79.99'}],
    ['fractional price', {price: 79.99}],
    ['zero price', {price: 0}],
    ['negative price', {price: -5}],
    ['price over the sanity ceiling', {price: 10 ** 12}],
    ['missing title', {title: ''}],
    ['title too long', {title: 'x'.repeat(201)}],
    ['bad plan id (spaces)', {id: 'PLAN 1'}],
    ['bad plan id (markup)', {id: '<script>alert(1)</script>'}],
    ['no terms link (REQ-EXT-004)', {url: undefined}],
    ['http terms link', {url: 'http://example.invalid/terms'}],
    ['javascript: terms link', {url: 'javascript:alert(1)'}],
    [
      'terms link with credentials',
      {url: 'https://user:pw@example.invalid/terms'},
    ],
    ['data: terms link', {url: 'data:text/html,hi'}],
  ])(
    'drops a plan with %s, and reports malformed if no plan survives',
    (_label, override) => {
      expect(
        parseOffersResponse(
          bodyJson({
            offers: [
              offerJson({
                plans: {adh: [plan(override)], base: [], recommended: 'adh'},
              }),
            ],
          }),
          [item],
          expected,
        ),
      ).toEqual({status: 'error', reason: 'malformed'});
    },
  );

  it('keeps a good plan beside a dropped one', () => {
    const parsed = parseOffersResponse(
      bodyJson({
        offers: [
          offerJson({
            plans: {
              adh: [plan({price: 'free'}), plan({id: 'GOOD', price: 4999})],
              base: [],
              recommended: 'adh',
            },
          }),
        ],
      }),
      [item],
      expected,
    );
    expect(parsed.status).toBe('ok');
    if (parsed.status === 'ok') {
      expect(parsed.offers[0]?.plans.adh.map((p) => p.id)).toEqual(['GOOD']);
    }
  });

  it('nulls an unsafe image link and optional fields instead of trusting them', () => {
    const parsed = parseOffersResponse(
      bodyJson({
        offers: [
          offerJson({
            plans: {
              adh: [
                plan({
                  imageUrl: 'javascript:alert(1)',
                  offerPlanId: 7,
                  contract: 'oops',
                }),
              ],
              base: [],
              recommended: 'adh',
            },
          }),
        ],
      }),
      [item],
      expected,
    );
    if (parsed.status !== 'ok') throw new Error('expected ok');
    expect(parsed.offers[0]?.plans.adh[0]).toMatchObject({
      imageUrl: null,
      offerPlanId: null,
      contract: {
        category: null,
        coverageIncludes: null,
        deductible: null,
        termLength: null,
      },
    });
  });

  it('ignores an undocumented recommended value and de-duplicates plan ids', () => {
    const parsed = parseOffersResponse(
      bodyJson({
        offers: [
          offerJson({
            plans: {
              adh: [plan(), plan({price: 1})],
              base: [],
              recommended: 'premium',
            },
          }),
        ],
      }),
      [item],
      expected,
    );
    if (parsed.status !== 'ok') throw new Error('expected ok');
    expect(parsed.offers[0]?.plans.recommended).toBeNull();
    expect(parsed.offers[0]?.plans.adh).toHaveLength(1);
    expect(parsed.offers[0]?.plans.adh[0]?.priceCents).toBe(7999);
  });

  it('does not pass through undocumented or script-bearing marketing content', () => {
    const parsed = parseOffersResponse(
      bodyJson({
        offers: [offerJson({marketing: {adh: '<img src=x onerror=alert(1)>'}})],
      }),
      [item],
      expected,
    );
    expect(JSON.stringify(parsed)).not.toContain('onerror');
  });
});

describe('plan quotes from offers (feeds REQ-EXT-003 cross-check)', () => {
  it('maps plan id to price and excludes a plan id quoted at two prices', () => {
    const base = parseOffersResponse(bodyJson(), [item], {storeId: STORE});
    if (base.status !== 'ok') throw new Error('expected ok');
    const conflicting = parseOffersResponse(
      bodyJson({
        offers: [
          offerJson({
            plans: {
              adh: [
                plan({id: 'DUP', price: 1000}),
                plan({id: 'OK', price: 2000}),
              ],
              base: [],
              recommended: 'adh',
            },
          }),
          offerJson({
            offerId: 'o2',
            plans: {
              adh: [plan({id: 'DUP', price: 1500})],
              base: [],
              recommended: 'adh',
            },
          }),
        ],
      }),
      [item],
      {storeId: STORE},
    );
    if (conflicting.status !== 'ok') throw new Error('expected ok');
    const result = quotesFromOffers([...base.offers, ...conflicting.offers]);
    expect(result.quotes.get('MOCK-MATT-ADH-3Y-C')).toEqual({
      planId: 'MOCK-MATT-ADH-3Y-C',
      priceCents: 7999,
    });
    expect(result.quotes.get('OK')?.priceCents).toBe(2000);
    expect(result.quotes.has('DUP')).toBe(false);
    expect(result.conflictingPlanIds).toEqual(['DUP']);
  });
});

describe('fetchOffers (REQ-EXT-001, REQ-EXT-005, NFR-013)', () => {
  it('returns disabled without any network call when the feature is off', async () => {
    let calls = 0;
    const result = await fetchOffers(
      {
        config: configResult({PUBLIC_EXTEND_ENABLED: 'false'}),
        fetch: () => {
          calls += 1;
          return Promise.reject(new Error('no'));
        },
      },
      [item],
      ['mattress'],
    );
    expect(result).toEqual({status: 'error', reason: 'disabled'});
    expect(calls).toBe(0);
  });

  it('posts the documented request and returns typed offers', async () => {
    const seen: Array<{url: string; init: FetchInit}> = [];
    const result = await fetchOffers(
      {
        config: configResult(),
        fetch: (url, init) => {
          seen.push({url, init});
          return jsonFetch(bodyJson())(url, init);
        },
      },
      [item],
      ['mattress'],
    );
    expect(result.status).toBe('ok');
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe('https://api-demo.helloextend.com/offers');
    expect(seen[0]?.init.method).toBe('POST');
    expect(seen[0]?.init.headers['X-Extend-Access-Token']).toBe(TOKEN);
    expect(seen[0]?.init.headers.Accept).toBe(
      'application/json;version=2022-02-01',
    );
    expect(JSON.parse(seen[0]?.init.body ?? '{}')).toEqual({
      storeId: STORE,
      currency: 'USD',
      items: [
        {
          category: 'mattress',
          productId: '501',
          purchasePrice: 129_900,
          quantity: 1,
        },
      ],
    });
  });

  it('does not call Extend for products outside the eligible categories', async () => {
    let calls = 0;
    const result = await fetchOffers(
      {
        config: configResult(),
        fetch: () => {
          calls += 1;
          return Promise.reject(new Error('no'));
        },
      },
      [{...item, category: 'furniture', productId: '777'}],
      ['mattress'],
    );
    expect(calls).toBe(0);
    expect(result).toEqual({
      status: 'ok',
      offerCartId: null,
      offers: [],
      droppedCount: 0,
      ineligibleProductIds: ['777'],
    });
  });

  it('sends only the eligible items of a mixed cart', async () => {
    let sent: unknown;
    await fetchOffers(
      {
        config: configResult(),
        fetch: (url, init) => {
          sent = JSON.parse(init.body ?? '{}');
          return jsonFetch(bodyJson())(url, init);
        },
      },
      [item, {...item, category: 'furniture', productId: '777'}],
      ['mattress'],
    );
    expect(sent).toMatchObject({items: [{productId: '501'}]});
  });

  it('rejects an invalid item set without a request', async () => {
    const result = await fetchOffers(
      {config: configResult(), fetch: () => Promise.reject(new Error('no'))},
      [{...item, purchasePriceCents: -5}],
      ['mattress'],
    );
    expect(result).toEqual({status: 'error', reason: 'invalid_request'});
  });

  it.each([
    ['server error', jsonFetch({}, 503), 'http', 503],
    ['rate limited', jsonFetch({}, 429), 'http', 429],
    ['unauthorised', jsonFetch({}, 401), 'http', 401],
    ['network down', networkDown, 'network', undefined],
    ['non-JSON body', htmlBody, 'malformed', undefined],
    ['wrong shape', jsonFetch({offers: 'none'}), 'malformed', undefined],
  ])(
    'hides the offer on %s and logs the reason only',
    async (_label, fetchFn, reason, httpStatus) => {
      const logged: ExtendLogEvent[] = [];
      const result = await fetchOffers(
        {
          config: configResult(),
          fetch: fetchFn,
          log: (event) => logged.push(event),
        },
        [item],
        ['mattress'],
      );
      expect(result).toMatchObject({status: 'error', reason});
      expect(logged[0]).toMatchObject({event: 'offers.request_failed', reason});
      expect(JSON.stringify(logged)).not.toContain(TOKEN);
      if (httpStatus !== undefined)
        expect(logged[0]?.httpStatus).toBe(httpStatus);
    },
  );

  it('times out slow responses', async () => {
    const result = await fetchOffers(
      {
        config: configResult(),
        fetch: () => new Promise<Response>(() => {}),
        timeoutMs: 25,
      },
      [item],
      ['mattress'],
    );
    expect(result).toMatchObject({status: 'error', reason: 'timeout'});
  });

  it('opens the circuit after repeated failures, then recovers on a successful probe', async () => {
    const clock = {t: 0};
    const breaker = createCircuitBreaker({
      now: () => clock.t,
      failureThreshold: 3,
      openMs: 10_000,
    });
    const logged: ExtendLogEvent[] = [];
    let calls = 0;
    let healthy = false;
    const fetchFn: FetchLike = (url, init) => {
      calls += 1;
      return healthy
        ? jsonFetch(bodyJson())(url, init)
        : jsonFetch({}, 503)(url, init);
    };
    const deps = {
      config: configResult(),
      fetch: fetchFn,
      breaker,
      log: (e: ExtendLogEvent) => logged.push(e),
    };

    for (let i = 0; i < 3; i += 1) {
      expect(await fetchOffers(deps, [item], ['mattress'])).toMatchObject({
        reason: 'http',
      });
    }
    expect(calls).toBe(3);
    expect(
      logged.filter((e) => e.event === 'offers.circuit_open'),
    ).toHaveLength(1);

    expect(await fetchOffers(deps, [item], ['mattress'])).toEqual({
      status: 'error',
      reason: 'circuit_open',
      retryAfterMs: 10_000,
    });
    expect(calls).toBe(3); // no request while open

    clock.t += 10_000;
    healthy = true;
    expect((await fetchOffers(deps, [item], ['mattress'])).status).toBe('ok');
    expect(calls).toBe(4);
    expect((await fetchOffers(deps, [item], ['mattress'])).status).toBe('ok');
    expect(breaker.snapshot().state).toBe('closed');
  });

  it('does not count a 4xx about our own request as provider ill-health', async () => {
    const breaker = createCircuitBreaker({now: () => 0, failureThreshold: 2});
    const deps = {config: configResult(), fetch: jsonFetch({}, 422), breaker};
    for (let i = 0; i < 5; i += 1) {
      expect(await fetchOffers(deps, [item], ['mattress'])).toMatchObject({
        reason: 'http',
        httpStatus: 422,
      });
    }
    expect(breaker.snapshot().state).toBe('closed');
  });

  it('logs when offers were dropped from a partly bad response', async () => {
    const logged: ExtendLogEvent[] = [];
    const result = await fetchOffers(
      {
        config: configResult(),
        fetch: jsonFetch(
          bodyJson({offers: [offerJson({offerId: ''}), offerJson()]}),
        ),
        log: (e) => logged.push(e),
      },
      [item],
      ['mattress'],
    );
    expect(result).toMatchObject({status: 'ok', droppedCount: 1});
    expect(logged).toEqual([
      {level: 'warn', event: 'offers.response_dropped_items', count: 1},
    ]);
  });
});

describe('createOffersQuoteLookup (REQ-EXT-003, ADR-0009 decision 7)', () => {
  const query = {
    planId: 'MOCK-MATT-ADH-3Y-C',
    coveredProductId: '501',
    category: 'mattress',
    coveredUnitPriceCents: 129_900,
  };
  const lookupWith = (fetchFn: FetchLike, eligibleCategories = ['mattress']) =>
    createOffersQuoteLookup({
      config: configResult(),
      fetch: fetchFn,
      eligibleCategories,
    });

  it('answers with the quoted price for the plan id the order claims', async () => {
    expect(await lookupWith(jsonFetch(bodyJson()))(query)).toEqual({
      planId: 'MOCK-MATT-ADH-3Y-C',
      priceCents: 7999,
    });
  });

  it('asks Extend about the covered item at its list price, quantity 1', async () => {
    let sent: unknown;
    await lookupWith((url, init) => {
      sent = JSON.parse(init.body ?? '{}');
      return jsonFetch(bodyJson())(url, init);
    })(query);
    expect(sent).toMatchObject({
      items: [
        {
          category: 'mattress',
          productId: '501',
          purchasePrice: 129_900,
          quantity: 1,
        },
      ],
    });
  });

  it('answers null when Extend does not offer that plan for the product (a claimed plan id is not enough)', async () => {
    expect(
      await lookupWith(jsonFetch(bodyJson()))({
        ...query,
        planId: 'MOCK-MATT-ADH-5Y-D',
      }),
    ).toBeNull();
  });

  it('answers null for an ineligible category without calling Extend', async () => {
    let calls = 0;
    const lookup = lookupWith(() => {
      calls += 1;
      return Promise.reject(new Error('no'));
    }, ['pillow']);
    expect(await lookup(query)).toBeNull();
    expect(calls).toBe(0);
  });

  it.each([
    ['server error', jsonFetch({}, 503)],
    ['network failure', networkDown],
    ['malformed body', jsonFetch({offers: 'none'})],
  ])(
    'throws, rather than answering, when Extend cannot be asked: %s',
    async (_label, fetchFn) => {
      await expect(lookupWith(fetchFn)(query)).rejects.toThrow(
        /quote lookup unavailable/,
      );
    },
  );

  it('throws when Extend is disabled', async () => {
    const lookup = createOffersQuoteLookup({
      config: configResult({PUBLIC_EXTEND_ENABLED: 'false'}),
      fetch: jsonFetch(bodyJson()),
      eligibleCategories: ['mattress'],
    });
    await expect(lookup(query)).rejects.toThrow(/disabled/);
  });
});
