import {afterEach, describe, expect, it, vi} from 'vitest';
import productJson from '../../fixtures/shopify/product.json';
import availabilityJson from '../../fixtures/shopify/product-availability.json';
import {fakeStorefront, type RecordedCall} from '../catalog/fake-storefront';
import {PRODUCT_QUERY} from '~/lib/shopify/queries';
import {loader} from '~/routes/products.$handle';

// P7-06 groundwork (review m7) and P7-04 (REQ-SEO-001): the product loader starts its three Storefront reads
// together, and emits no absolute URL in structured data when no site origin is configured.

const HANDLE = productJson.product.handle;
const SITE = 'https://www.example.com';
const EXTEND_ENV = {
  PUBLIC_EXTEND_ENABLED: 'true',
  EXTEND_API_HOST: 'https://api-demo.helloextend.com',
  EXTEND_STORE_ID: 'store-1',
  EXTEND_ACCESS_TOKEN: 'fixture-token-not-real',
};

function answer(call: RecordedCall, category: {value: string} | null) {
  if (call.query === PRODUCT_QUERY) return productJson;
  if (call.query.includes('query CatalogProductAvailability')) {
    return availabilityJson;
  }
  if (call.query.includes('query ExtendProductCategoryByHandle')) {
    return {product: {id: productJson.product.id, metafield: category}};
  }
  if (call.query.includes('query OfferOnlyProductHandles')) {
    return {products: {nodes: []}};
  }
  throw new Error(`unexpected query: ${call.query.slice(0, 60)}`);
}

function run(
  storefront: object,
  env: Record<string, string>,
  url = `${SITE}/products/${HANDLE}`,
  headers: HeadersInit = {},
) {
  return loader({
    request: new Request(url, {headers}),
    context: {storefront, env},
    params: {handle: HANDLE},
  } as never);
}

const names = (calls: readonly RecordedCall[]) =>
  calls.map((call) => /query (\w+)/.exec(call.query)?.[1]);

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('product loader reads (review m7)', () => {
  it('starts the product, availability, Extend category and offer-only reads before any of them has answered', async () => {
    const releases: Array<() => void> = [];
    const {storefront, calls} = fakeStorefront(
      (call) =>
        new Promise((resolve) => {
          releases.push(() => resolve(answer(call, {value: 'mattress'})));
        }),
    );
    const pending = run(storefront, {...EXTEND_ENV, PUBLIC_SITE_URL: SITE});
    // Nothing has resolved yet, and every read is already in flight: no read waits for another.
    expect(names(calls).sort()).toEqual([
      'CatalogProduct',
      'CatalogProductAvailability',
      'ExtendProductCategoryByHandle',
      'OfferOnlyProductHandles',
    ]);
    for (const release of releases) release();
    const data = await pending;
    expect(data.protection).toBe('eligible');
    expect(data.product.handle).toBe(HANDLE);
    expect(data.offerOnly).toBe(false);
  });

  it('reads the category by handle with the handle as the only variable', async () => {
    const {storefront, calls} = fakeStorefront((call) =>
      answer(call, {value: 'mattress'}),
    );
    await run(storefront, {...EXTEND_ENV, PUBLIC_SITE_URL: SITE});
    const read = calls.find((call) =>
      call.query.includes('query ExtendProductCategoryByHandle'),
    );
    expect(read?.variables).toEqual({handle: HANDLE});
  });

  it.each([
    ['no category', null, 'off'],
    ['a category that is not a plain label', {value: '<script>'}, 'off'],
    ['a category', {value: 'mattress'}, 'eligible'],
  ])('protection mode with %s is %s', async (_name, category, mode) => {
    const {storefront} = fakeStorefront((call) => answer(call, category));
    const data = await run(storefront, {
      ...EXTEND_ENV,
      PUBLIC_SITE_URL: SITE,
    });
    expect(data.protection).toBe(mode);
  });

  it('a failed category read is unknown and does not fail the page', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const {storefront} = fakeStorefront((call) => {
      if (call.query.includes('query ExtendProductCategoryByHandle')) {
        throw new Error('timeout');
      }
      return answer(call, null);
    });
    const data = await run(storefront, {...EXTEND_ENV, PUBLIC_SITE_URL: SITE});
    expect(data.protection).toBe('unknown');
  });

  it('flag off: the category is never read', async () => {
    const {storefront, calls} = fakeStorefront((call) => answer(call, null));
    const data = await run(storefront, {
      ...EXTEND_ENV,
      PUBLIC_EXTEND_ENABLED: 'false',
      PUBLIC_SITE_URL: SITE,
    });
    expect(data.protection).toBe('off');
    expect(names(calls)).not.toContain('ExtendProductCategoryByHandle');
  });

  it('a missing product is a 404', async () => {
    const {storefront} = fakeStorefront((call) =>
      call.query === PRODUCT_QUERY
        ? {product: null}
        : answer(call, {value: 'mattress'}),
    );
    await expect(
      run(storefront, {...EXTEND_ENV, PUBLIC_SITE_URL: SITE}),
    ).rejects.toMatchObject({status: 404});
  });

  it('a valid-shaped unknown handle is a 404 whose reads all carry a cache strategy, so a repeat costs nothing upstream', async () => {
    const {storefront, calls} = fakeStorefront((call) => {
      if (call.query === PRODUCT_QUERY) return {product: null};
      if (call.query.includes('query CatalogProductAvailability')) {
        return {product: null};
      }
      if (call.query.includes('query ExtendProductCategoryByHandle')) {
        return {product: null};
      }
      if (call.query.includes('query OfferOnlyProductHandles')) {
        return {products: {nodes: []}};
      }
      throw new Error(`unexpected query: ${call.query.slice(0, 60)}`);
    });
    await expect(
      run(storefront, {...EXTEND_ENV, PUBLIC_SITE_URL: SITE}),
    ).rejects.toMatchObject({status: 404});
    // Bounded: no more than the four reads the page starts, none of them uncached.
    expect(calls).toHaveLength(4);
    for (const call of calls) {
      expect(call.cache, String(names([call]))).toBeDefined();
      expect(call.cache).not.toEqual({mode: 'none'});
    }
    const byHandle = calls.filter((call) => 'handle' in call.variables);
    expect(byHandle).toHaveLength(3);
    for (const call of byHandle) {
      expect(call.cache).toSatisfy(
        (cache: unknown) =>
          JSON.stringify(cache) === JSON.stringify({mode: 'long'}) ||
          (typeof cache === 'object' &&
            cache !== null &&
            'maxAge' in cache &&
            cache.maxAge === 60),
      );
    }
  });

  it('an invalid handle makes no category read', async () => {
    const {storefront, calls} = fakeStorefront((call) => answer(call, null));
    await expect(
      loader({
        request: new Request(`${SITE}/products/x`),
        context: {storefront, env: {...EXTEND_ENV, PUBLIC_SITE_URL: SITE}},
        params: {handle: '../etc'},
      } as never),
    ).rejects.toMatchObject({status: 404});
    expect(names(calls)).not.toContain('ExtendProductCategoryByHandle');
    // Nor any other per-handle read: only the shared offer-only list can be read.
    expect(calls.filter((call) => 'handle' in call.variables)).toHaveLength(0);
  });
});

describe('product loader structured data without a site origin (REQ-SEO-001)', () => {
  it('emits absolute URLs from the configured origin', async () => {
    const {storefront} = fakeStorefront((call) => answer(call, null));
    const data = await run(storefront, {PUBLIC_SITE_URL: SITE});
    expect(data.canonical).toBe(`${SITE}/products/${HANDLE}`);
    expect(JSON.stringify(data.breadcrumbJsonLd)).toContain(
      `${SITE}/products/${HANDLE}`,
    );
    expect(data.productJsonLd.url).toBe(`${SITE}/products/${HANDLE}`);
  });

  it('outside development with no origin: no breadcrumb markup, no canonical, no relative url anywhere', async () => {
    vi.stubEnv('DEV', false);
    const {storefront} = fakeStorefront((call) => answer(call, null));
    const data = await run(
      storefront,
      {},
      // A forged Host must not become an origin (P-L2).
      'https://evil.example/products/x',
      {Host: 'evil.example'},
    );
    expect(data.breadcrumbJsonLd).toBeNull();
    expect(data.canonical).toBeNull();
    const json = JSON.stringify(data.productJsonLd);
    expect(json).not.toContain('evil.example');
    expect(data.productJsonLd).not.toHaveProperty('url');
    expect(json).not.toMatch(/"url":"\//);
    expect(json).not.toMatch(/"url":"[^h]/);
    expect(data.productJsonLd.offers).toBeDefined();
  });
});
