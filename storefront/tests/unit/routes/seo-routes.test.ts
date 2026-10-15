import {afterEach, describe, expect, it, vi} from 'vitest';
import {fakeStorefront} from '../catalog/fake-storefront';
import {loader as robotsLoader} from '~/routes/[robots.txt]';
import {loader as indexLoader} from '~/routes/[sitemap.xml]';
import {loader as pageLoader} from '~/routes/sitemap.$type.$page[.xml]';
import {loader as extrasLoader} from '~/routes/sitemap.extras[.xml]';

// REQ-SEO-001 (P7-04): robots.txt and the sitemap routes. The route argument types are framework-generated; the
// helper below builds them from plain parts (test-only narrowing, as in cart-routes.test.ts).

const SITE = 'https://www.example.com';
const FORGED = 'https://evil.example';

function args(
  url: string,
  context: object,
  params: object = {},
  headers: HeadersInit = {},
) {
  return {request: new Request(url, {headers}), context, params} as never;
}

function envOf(extra: Record<string, string> = {}) {
  return {PUBLIC_SITE_URL: SITE, ...extra};
}

async function bodyOf(result: unknown): Promise<string> {
  if (!(result instanceof Response)) throw new Error('not a Response');
  return result.text();
}

async function thrownStatus(run: () => unknown): Promise<number> {
  try {
    await run();
  } catch (error) {
    if (error instanceof Response) return error.status;
    throw error;
  }
  throw new Error('Expected a thrown Response');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('robots.txt route', () => {
  it('names the sitemap from PUBLIC_SITE_URL, never from the Host a caller chooses (P-L2)', async () => {
    const result = robotsLoader(
      args(`${FORGED}/robots.txt`, {env: envOf()}, {}, {host: 'evil.example'}),
    );
    const body = await result.text();
    expect(body).toContain(`Sitemap: ${SITE}/sitemap.xml`);
    expect(body).not.toContain('evil.example');
  });

  it('sets a charset, a day of caching and the nosniff header', () => {
    const result = robotsLoader(args(`${SITE}/robots.txt`, {env: envOf()}));
    expect(result.headers.get('content-type')).toBe(
      'text/plain; charset=utf-8',
    );
    expect(result.headers.get('cache-control')).toBe('public, max-age=86400');
    expect(result.headers.get('x-content-type-options')).toBe('nosniff');
    expect(result.headers.get('strict-transport-security')).toMatch(
      /^max-age=/,
    );
  });

  it('leaves the Sitemap line out in production without a configured origin', async () => {
    vi.stubEnv('DEV', false);
    const body = await robotsLoader(
      args(`${FORGED}/robots.txt`, {env: {}}),
    ).text();
    expect(body).not.toContain('Sitemap:');
    expect(body).not.toContain('evil.example');
    expect(body).toContain('Disallow: /cart');
  });
});

describe('sitemap index route', () => {
  const counts = {
    products: {pagesCount: {count: 2}},
    collections: {pagesCount: {count: 1}},
    pages: {pagesCount: {count: 1}},
    blogs: {pagesCount: {count: 1}},
    articles: {pagesCount: {count: 1}},
    metaObjects: {pagesCount: {count: 3}},
  };

  it('lists the Shopify resource sitemaps and ours on the configured origin, and no metaobjects', async () => {
    const {storefront} = fakeStorefront(() => counts);
    const xml = await bodyOf(
      await indexLoader(
        args(`${FORGED}/sitemap.xml`, {storefront, env: envOf()}),
      ),
    );
    for (const path of [
      '/sitemap/products/1.xml',
      '/sitemap/products/2.xml',
      '/sitemap/collections/1.xml',
      '/sitemap/pages/1.xml',
      '/sitemap/blogs/1.xml',
      '/sitemap/articles/1.xml',
      '/sitemap/extras.xml',
    ]) {
      expect(xml).toContain(`<loc>${SITE}${path}</loc>`);
    }
    expect(xml).not.toContain('metaObjects');
    expect(xml).not.toContain('evil.example');
  });

  it('answers 404 outside development when no site origin is configured', async () => {
    vi.stubEnv('DEV', false);
    const {storefront} = fakeStorefront(() => counts);
    const result = await indexLoader(
      args(`${SITE}/sitemap.xml`, {storefront, env: {}}),
    );
    expect(result.status).toBe(404);
  });

  it('sends XML with a charset and the nosniff header', async () => {
    const {storefront} = fakeStorefront(() => counts);
    const result = await indexLoader(
      args(`${SITE}/sitemap.xml`, {storefront, env: envOf()}),
    );
    expect(result.headers.get('content-type')).toBe(
      'application/xml; charset=utf-8',
    );
    expect(result.headers.get('x-content-type-options')).toBe('nosniff');
  });
});

describe('sitemap page route', () => {
  const items = {
    sitemap: {
      resources: {
        items: [
          {handle: 'queen-hybrid', updatedAt: '2026-10-01T10:00:00Z'},
          {handle: '<script>x</script>', updatedAt: '2026-10-01T10:00:00Z'},
          {handle: 'a b', updatedAt: '2026-10-01T10:00:00Z'},
        ],
      },
    },
  };

  it('builds product links on the configured origin and replaces an unusable handle with the home page', async () => {
    const {storefront} = fakeStorefront(() => items);
    const xml = await bodyOf(
      await pageLoader(
        args(
          `${FORGED}/sitemap/products/1.xml`,
          {storefront, env: envOf()},
          {type: 'products', page: '1'},
        ),
      ),
    );
    expect(xml).toContain(`<loc>${SITE}/products/queen-hybrid</loc>`);
    expect(xml).not.toMatch(/<script|evil\.example|a b/);
    expect(
      xml.match(/<loc>https:\/\/www\.example\.com\/<\/loc>/g),
    ).toHaveLength(2);
    // English only, no locale alternates (NFR-008).
    expect(xml).not.toContain('hreflang');
  });

  it('links articles under their blog', async () => {
    const {storefront} = fakeStorefront(() => ({
      sitemap: {
        resources: {
          items: [
            {handle: 'news/how-to-choose', updatedAt: '2026-10-01T10:00:00Z'},
          ],
        },
      },
    }));
    const xml = await bodyOf(
      await pageLoader(
        args(
          `${SITE}/sitemap/articles/1.xml`,
          {storefront, env: envOf()},
          {type: 'articles', page: '1'},
        ),
      ),
    );
    expect(xml).toContain(`<loc>${SITE}/blogs/news/how-to-choose</loc>`);
  });

  it.each([
    ['constructor', '1'],
    ['__proto__', '1'],
    ['metaObjects', '1'],
    ['products', 'abc'],
    ['products', '0'],
    ['products', '1000'],
    ['products', '1.5'],
    ['products', '1e2'],
  ])(
    'answers 404 for type %s page %s without calling Shopify',
    async (type, page) => {
      const {storefront, calls} = fakeStorefront(() => items);
      const status = await thrownStatus(() =>
        pageLoader(
          args(
            `${SITE}/sitemap/${type}/${page}.xml`,
            {storefront, env: envOf()},
            {type, page},
          ),
        ),
      );
      expect(status).toBe(404);
      expect(calls).toHaveLength(0);
    },
  );
});

describe('extra sitemap route: brands and stores only when real', () => {
  const brandNode = (handle: string, name: string) => ({
    id: `gid://shopify/Metaobject/${handle}`,
    handle,
    fields: [
      {key: 'name', value: name, reference: null},
      {key: 'slug', value: handle, reference: null},
    ],
  });

  it('lists real brands, and never the sample brands or the fixture stores', async () => {
    const {storefront} = fakeStorefront(() => ({
      brands: {nodes: [brandNode('acme-sleep', 'Acme Sleep')]},
    }));
    const xml = await bodyOf(
      await extrasLoader(
        args(`${FORGED}/sitemap/extras.xml`, {storefront, env: envOf()}),
      ),
    );
    expect(xml).toContain(`<loc>${SITE}/</loc>`);
    expect(xml).toContain(`<loc>${SITE}/collections</loc>`);
    expect(xml).toContain(`<loc>${SITE}/brands</loc>`);
    expect(xml).toContain(`<loc>${SITE}/brands/acme-sleep</loc>`);
    // Store pages are still fixture-backed (DEC-023) and noindex: not advertised.
    expect(xml).not.toContain('/stores');
    expect(xml).not.toContain('evil.example');
  });

  it('lists no brand when the store has none or the read fails, and does not invent sample ones', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const respond of [
      () => ({brands: {nodes: []}}),
      () => {
        throw new Error('down');
      },
    ]) {
      const {storefront} = fakeStorefront(respond);
      const xml = await bodyOf(
        await extrasLoader(
          args(`${SITE}/sitemap/extras.xml`, {storefront, env: envOf()}),
        ),
      );
      expect(xml).not.toContain('/brands');
      expect(xml).toContain(`<loc>${SITE}/collections</loc>`);
    }
  });

  it('lists the shop policies that exist, under the routed handles, and none that do not', async () => {
    const {storefront} = fakeStorefront((call) =>
      call.query.includes('query ShopPolicyHandles')
        ? {
            shop: {
              privacyPolicy: {handle: 'privacy-policy'},
              shippingPolicy: null,
              termsOfService: null,
              refundPolicy: {handle: 'refund-policy'},
            },
          }
        : {brands: {nodes: []}},
    );
    const xml = await bodyOf(
      await extrasLoader(
        args(`${SITE}/sitemap/extras.xml`, {storefront, env: envOf()}),
      ),
    );
    expect(xml).toContain(`<loc>${SITE}/policies/privacy-policy</loc>`);
    expect(xml).toContain(`<loc>${SITE}/policies/refund-policy</loc>`);
    expect(xml).not.toContain('shipping-policy');
    expect(xml).not.toContain('terms-of-service');
  });

  it('lists no policy when that read fails, and the rest of the sitemap is unaffected', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const {storefront} = fakeStorefront((call) => {
      if (call.query.includes('query ShopPolicyHandles')) {
        throw new Error('down');
      }
      return {brands: {nodes: []}};
    });
    const xml = await bodyOf(
      await extrasLoader(
        args(`${SITE}/sitemap/extras.xml`, {storefront, env: envOf()}),
      ),
    );
    expect(xml).not.toContain('/policies');
    expect(xml).toContain(`<loc>${SITE}/collections</loc>`);
  });
});

describe('sitemap hardening (security review K-L3, K-L9)', () => {
  const entry = (handle: string) => ({
    handle,
    updatedAt: '2026-10-01T10:00:00Z',
  });

  it('answers 404 for a page with no items instead of a sitemap that lists the home page', async () => {
    const {storefront} = fakeStorefront(() => ({
      sitemap: {resources: {items: []}},
    }));
    const status = await thrownStatus(() =>
      pageLoader(
        args(
          `${SITE}/sitemap/products/99.xml`,
          {storefront, env: envOf()},
          {type: 'products', page: '99'},
        ),
      ),
    );
    expect(status).toBe(404);
  });

  it('redirects a query string to the bare URL, relative, without calling Shopify', async () => {
    const {storefront, calls} = fakeStorefront(() => ({}));
    for (const [loader, path, params] of [
      [pageLoader, '/sitemap/products/1.xml', {type: 'products', page: '1'}],
      [indexLoader, '/sitemap.xml', {}],
      [extrasLoader, '/sitemap/extras.xml', {}],
    ] as const) {
      const result = await loader(
        args(`${FORGED}${path}?x=1&y=2`, {storefront, env: envOf()}, params),
      );
      expect(result.status).toBe(301);
      expect(result.headers.get('location')).toBe(path);
    }
    const robots = robotsLoader(
      args(`${FORGED}/robots.txt?x=1`, {env: envOf()}),
    );
    expect(robots.status).toBe(301);
    expect(robots.headers.get('location')).toBe('/robots.txt');
    expect(calls).toHaveLength(0);
  });

  it('leaves offer-only products (tagged extend-coverage or offer-only) out of the product sitemap', async () => {
    const {storefront, calls} = fakeStorefront((call) =>
      call.query.includes('OfferOnlyProductHandles')
        ? {
            products: {
              nodes: [
                {handle: 'extend-protection-plan'},
                {handle: 'haul-away'},
              ],
            },
          }
        : {
            sitemap: {
              resources: {
                items: [
                  entry('queen-hybrid'),
                  entry('extend-protection-plan'),
                  entry('haul-away'),
                  entry('haul-away-extra'),
                ],
              },
            },
          },
    );
    const xml = await bodyOf(
      await pageLoader(
        args(
          `${SITE}/sitemap/products/1.xml`,
          {storefront, env: envOf()},
          {type: 'products', page: '1'},
        ),
      ),
    );
    expect(xml).toContain(`${SITE}/products/queen-hybrid</loc>`);
    expect(xml).toContain(`${SITE}/products/haul-away-extra</loc>`);
    expect(xml).not.toContain('extend-protection-plan');
    expect(xml).not.toContain(`${SITE}/products/haul-away</loc>`);
    const query = calls.find((call) =>
      call.query.includes('OfferOnlyProductHandles'),
    );
    expect(query?.variables.query).toBe(
      'tag:extend-coverage OR tag:offer-only',
    );
    expect(query?.cache).toEqual({mode: 'long'});
  });

  it('keeps every product when the offer-only read fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const {storefront} = fakeStorefront((call) => {
      if (call.query.includes('OfferOnlyProductHandles'))
        throw new Error('down');
      return {sitemap: {resources: {items: [entry('a'), entry('b')]}}};
    });
    const xml = await bodyOf(
      await pageLoader(
        args(
          `${SITE}/sitemap/products/1.xml`,
          {storefront, env: envOf()},
          {type: 'products', page: '1'},
        ),
      ),
    );
    expect(xml).toContain(`${SITE}/products/a</loc>`);
    expect(xml).toContain(`${SITE}/products/b</loc>`);
  });
});
