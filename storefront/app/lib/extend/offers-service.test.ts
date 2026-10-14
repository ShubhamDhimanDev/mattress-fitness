import {describe, expect, it} from 'vitest';
import {createCircuitBreaker} from '~/lib/extend/circuit-breaker';
import {parseExtendConfig, type ExtendConfigResult} from '~/lib/extend/config';
import {
  createOffersMemo,
  quoteCoverage,
  type CoverageItem,
  type QuoteDeps,
} from '~/lib/extend/offers-service';
import {buildPricePointIndex} from '~/lib/extend/price-points';
import type {FetchInit, FetchLike} from '~/lib/extend/types';

// REQ-EXT-001 / REQ-EXT-002 / REQ-EXT-005 / NFR-013 / T-13: cart items in, sellable plans out; failure hides the offer.

const STORE = 'store-fixture-1';
const clock = {t: 0};

function config(over: Record<string, unknown> = {}): ExtendConfigResult {
  return parseExtendConfig({
    PUBLIC_EXTEND_ENABLED: 'true',
    EXTEND_API_HOST: 'https://api-demo.helloextend.com',
    EXTEND_STORE_ID: STORE,
    EXTEND_ACCESS_TOKEN: 'fixture-token-not-real',
    ...over,
  });
}

const index = buildPricePointIndex([
  {variantId: 'v-1499', name: 'Extend-Protection-Plan-14.99', priceCents: 1499},
  {variantId: 'v-7999', name: 'Extend-Protection-Plan-79.99', priceCents: 7999},
]);

function plan(id: string, price: number, over: Record<string, unknown> = {}) {
  return {
    id,
    price,
    title: `Plan ${id}`,
    contract: {termLength: 36},
    url: 'https://extend.example/terms',
    imageUrl: 'https://extend.example/i.png',
    ...over,
  };
}

function offer(productId: string, plans: unknown[], recommended = 'adh') {
  return {
    offerId: `offer-${productId}`,
    plans: {adh: plans, base: [], recommended},
    coveredProducts: [{productId, quantity: 1, purchasePrice: 129_900}],
  };
}

function offersFetch(offers: unknown[]) {
  const calls: FetchInit[] = [];
  const fetchFn: FetchLike = (_url, init) => {
    calls.push(init);
    return Promise.resolve(
      new Response(JSON.stringify({offerCartId: 'c', storeId: STORE, offers})),
    );
  };
  return {fetchFn, calls};
}

const item = (
  key: string,
  productId: string,
  over: Partial<CoverageItem> = {},
): CoverageItem => ({
  key,
  productId: `gid://shopify/Product/${productId}`,
  category: 'mattress',
  unitPriceCents: 129_900,
  quantity: 1,
  ...over,
});

function deps(fetchFn: FetchLike, over: Partial<QuoteDeps> = {}): QuoteDeps {
  return {
    config: config(),
    fetch: fetchFn,
    index,
    memo: createOffersMemo({now: () => clock.t}),
    ...over,
  };
}

describe('REQ-EXT-002 quoteCoverage', () => {
  it('returns only plans whose price equals a price-point variant, in a UI-only shape', async () => {
    const {fetchFn} = offersFetch([
      offer('501', [
        plan('P-79', 7999),
        plan('P-14', 1499),
        plan('P-177', 17_777),
      ]),
    ]);
    const result = await quoteCoverage(deps(fetchFn), [item('line-1', '501')]);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    const plans = result.plansByKey.get('line-1') ?? [];
    expect(plans.map((p) => p.planId)).toEqual(['P-14', 'P-79']);
    expect(plans[0]).toEqual({
      planId: 'P-14',
      title: 'Plan P-14',
      priceCents: 1499,
      termMonths: 36,
      termsUrl: 'https://extend.example/terms',
      imageUrl: 'https://extend.example/i.png',
      recommended: true,
    });
    expect(JSON.stringify(plans)).not.toMatch(/variant|v-1499|offerId|offer-/);
  });

  it('sends the product id, category and Shopify price, never anything from the caller beyond them', async () => {
    const {fetchFn, calls} = offersFetch([offer('501', [plan('P-79', 7999)])]);
    await quoteCoverage(deps(fetchFn), [item('line-1', '501', {quantity: 2})]);
    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({
      storeId: STORE,
      currency: 'USD',
      items: [
        {
          category: 'mattress',
          productId: '501',
          purchasePrice: 129_900,
          quantity: 2,
        },
      ],
    });
    expect(calls[0]?.headers['X-Extend-Access-Token']).toBe(
      'fixture-token-not-real',
    );
  });

  it('leaves out items without a category and never contacts Extend for an ineligible cart (REQ-EXT-005)', async () => {
    const {fetchFn, calls} = offersFetch([]);
    const result = await quoteCoverage(deps(fetchFn), [
      item('line-1', '501', {category: null}),
    ]);
    expect(result).toEqual({status: 'ok', plansByKey: new Map()});
    expect(calls).toHaveLength(0);
  });

  it('quotes the first line of a product and gives later lines of the same product no offer', async () => {
    const {fetchFn, calls} = offersFetch([offer('501', [plan('P-79', 7999)])]);
    const result = await quoteCoverage(deps(fetchFn), [
      item('queen', '501'),
      item('king', '501', {unitPriceCents: 159_900}),
    ]);
    expect(JSON.parse(calls[0]?.body ?? '{}')).toMatchObject({
      items: [{productId: '501'}],
    });
    if (result.status !== 'ok') throw new Error('expected ok');
    expect([...result.plansByKey.keys()]).toEqual(['queen']);
  });

  it('ignores Extend plans for a product nobody asked about', async () => {
    const {fetchFn} = offersFetch([
      offer('501', [plan('P-79', 7999)]),
      offer('999', [plan('P-14', 1499)]),
    ]);
    const result = await quoteCoverage(deps(fetchFn), [item('line-1', '501')]);
    if (result.status !== 'ok') throw new Error('expected ok');
    expect([...result.plansByKey.keys()]).toEqual(['line-1']);
  });

  it('is unavailable without any call when Extend is off or no price point exists', async () => {
    const {fetchFn, calls} = offersFetch([]);
    expect(
      await quoteCoverage(
        deps(fetchFn, {config: config({PUBLIC_EXTEND_ENABLED: 'false'})}),
        [item('a', '501')],
      ),
    ).toEqual({status: 'unavailable', reason: 'disabled'});
    expect(
      await quoteCoverage(deps(fetchFn, {index: buildPricePointIndex([])}), [
        item('a', '501'),
      ]),
    ).toEqual({status: 'unavailable', reason: 'no_price_points'});
    expect(calls).toHaveLength(0);
  });

  it('reports Extend failures as unavailable (never throws) and logs the reason only', async () => {
    const logs: unknown[] = [];
    const down: FetchLike = () =>
      Promise.resolve(new Response('x', {status: 503}));
    const result = await quoteCoverage(deps(down, {log: (e) => logs.push(e)}), [
      item('a', '501'),
    ]);
    expect(result).toEqual({status: 'unavailable', reason: 'http'});
    expect(JSON.stringify(logs)).not.toContain('fixture-token-not-real');

    const broken: FetchLike = () => Promise.reject(new TypeError('network'));
    expect((await quoteCoverage(deps(broken), [item('a', '501')])).status).toBe(
      'unavailable',
    );
  });
});

describe('T-13 repeated questions and outages', () => {
  it('answers a repeated identical question from memory, and a changed price asks again', async () => {
    const {fetchFn, calls} = offersFetch([offer('501', [plan('P-79', 7999)])]);
    const d = deps(fetchFn);
    await quoteCoverage(d, [item('a', '501')]);
    await quoteCoverage(d, [item('b', '501')]);
    expect(calls).toHaveLength(1);
    await quoteCoverage(d, [item('a', '501', {unitPriceCents: 139_900})]);
    expect(calls).toHaveLength(2);
    clock.t += 6 * 60_000;
    await quoteCoverage(d, [item('a', '501')]);
    expect(calls).toHaveLength(3);
  });

  it('remembers an outage briefly, so every page load does not wait for the timeout again', async () => {
    let calls = 0;
    const down: FetchLike = () => {
      calls += 1;
      return Promise.resolve(new Response('x', {status: 503}));
    };
    const d = deps(down);
    await quoteCoverage(d, [item('a', '501')]);
    await quoteCoverage(d, [item('a', '501')]);
    expect(calls).toBe(1);
    clock.t += 31_000;
    await quoteCoverage(d, [item('a', '501')]);
    expect(calls).toBe(2);
  });

  it('a circuit breaker stops calls after repeated failures', async () => {
    let calls = 0;
    const down: FetchLike = () => {
      calls += 1;
      return Promise.resolve(new Response('x', {status: 503}));
    };
    const breaker = createCircuitBreaker({
      now: () => clock.t,
      failureThreshold: 2,
      openMs: 60_000,
    });
    const d = deps(down, {
      breaker,
      memo: createOffersMemo({now: () => clock.t, failureTtlMs: 1}),
    });
    for (let i = 0; i < 6; i += 1) {
      clock.t += 5;
      const result = await quoteCoverage(d, [item('a', String(500 + i))]);
      expect(result.status).toBe('unavailable');
    }
    expect(calls).toBe(2);
  });

  it('bounds its memory', async () => {
    const memo = createOffersMemo({now: () => clock.t, maxEntries: 2});
    for (const key of ['a', 'b', 'c']) {
      memo.set(key, {status: 'unavailable', reason: 'timeout'});
    }
    expect(memo.get('a')).toBeUndefined();
    expect(memo.get('c')).toBeDefined();
  });
});
