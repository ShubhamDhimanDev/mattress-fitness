import {afterEach, describe, expect, it, vi} from 'vitest';
import {loader as reviewsLoader} from '~/routes/api.reviews';
import {parseReviewsQuery, parseReviewsApiResponse} from '~/lib/reviews/api';
import {parseReviewsConfig} from '~/lib/reviews/config';
import {loadReviewsPageState} from '~/lib/reviews/page';
import {
  AGGREGATE_MAX_PAGES,
  createJudgeMeProvider,
  type JudgeMeFetch,
} from '~/lib/reviews/providers/judgeme';
import {createFakeProvider} from '~/lib/reviews/providers/fake';
import {resetReviewsRuntimeForTests} from '~/lib/reviews/runtime';
import {displayAuthor, plainText} from '~/lib/reviews/sanitize';
import {createReviewsService} from '~/lib/reviews/service';
import {buildProductJsonLd} from '~/lib/shopify/jsonld';
import type {ProductPageView} from '~/lib/shopify/types';

// P3B-12, REQ-PDP-005, NFR-013, T-05, T-07, T-13. Everything runs against fakes; the real Judge.me has never been called
// (no account, Q-011), so the Judge.me response shape here is the documented-or-assumed one in docs/integrations/REVIEWS.md.

afterEach(() => {
  resetReviewsRuntimeForTests();
  vi.restoreAllMocks();
});

const TOKEN = 'fixture-token-not-real';
const DOMAIN = 'example-shop.myshopify.com';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {'Content-Type': 'application/json'},
  });
}

function review(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    rating: 5,
    title: 'Great',
    body: 'Slept well.',
    created_at: '2026-09-01T10:00:00Z',
    reviewer: {name: 'Sam Brown'},
    ...overrides,
  };
}

function adapter(handler: (url: URL) => Response | Promise<Response>) {
  const urls: URL[] = [];
  const fetchFake: JudgeMeFetch = (url) => {
    const parsed = new URL(url);
    urls.push(parsed);
    return Promise.resolve(handler(parsed));
  };
  const logs: Array<[string, Record<string, string | number>]> = [];
  const provider = createJudgeMeProvider({
    token: TOKEN,
    shopDomain: DOMAIN,
    fetch: fetchFake,
    log: (event, fields) => logs.push([event, fields]),
    timeoutMs: 50,
  });
  return {provider, urls, logs};
}

describe('REQ-PDP-005 reviews configuration', () => {
  it.each([
    [{}, 'unset'],
    [{REVIEWS_PROVIDER: 'nope'}, 'provider_unknown'],
    [{REVIEWS_PROVIDER: 'judgeme'}, 'judgeme_not_configured'],
    [
      {
        REVIEWS_PROVIDER: 'judgeme',
        JUDGEME_PRIVATE_API_TOKEN: 'a token with spaces',
        JUDGEME_SHOP_DOMAIN: DOMAIN,
      },
      'judgeme_not_configured',
    ],
    [
      {
        REVIEWS_PROVIDER: 'judgeme',
        JUDGEME_PRIVATE_API_TOKEN: TOKEN,
        JUDGEME_SHOP_DOMAIN: 'evil.example.com',
      },
      'judgeme_not_configured',
    ],
    [{REVIEWS_PROVIDER: 'fake'}, 'fake_outside_development'],
  ])('is off for %j (%s)', (env, reason) => {
    expect(parseReviewsConfig(env, {development: false})).toEqual({
      status: 'off',
      reason,
    });
  });

  it('turns on for a complete Judge.me configuration and for the fake in development only', () => {
    expect(
      parseReviewsConfig(
        {
          REVIEWS_PROVIDER: ' JudgeMe ',
          JUDGEME_PRIVATE_API_TOKEN: TOKEN,
          JUDGEME_SHOP_DOMAIN: DOMAIN,
        },
        {development: false},
      ).status,
    ).toBe('on');
    expect(
      parseReviewsConfig({REVIEWS_PROVIDER: 'fake'}, {development: true})
        .status,
    ).toBe('on');
  });
});

describe('REQ-PDP-005 sanitising (T-07, T-05)', () => {
  it('reduces review text to capped plain text', () => {
    expect(plainText('<b>Hi</b> <script>alert(1)</script>there', 100)).toBe(
      'Hi alert(1) there',
    );
    expect(plainText('x'.repeat(50), 10)).toHaveLength(10);
    expect(plainText('a‮b\u0000c', 10)).toBe('abc');
    expect(plainText(42, 10)).toBe('');
  });

  it.each([
    ['Sam Brown', 'Sam B.'],
    ['Sam', 'Sam'],
    ['  mary   ann  lee ', 'mary L.'],
    ['sam@example.com', 'Customer'],
    ['', 'Customer'],
    [null, 'Customer'],
    ['Sam <i>X</i>', 'Sam X.'],
  ])('shows %j as %j', (input, expected) => {
    expect(displayAuthor(input)).toBe(expected);
  });
});

describe('REQ-PDP-005 Judge.me adapter (unverified against the real service)', () => {
  it('looks the product up by handle, then reads reviews by the internal id, on the documented host only', async () => {
    const {provider, urls} = adapter((url) =>
      url.pathname.endsWith('/products/-1')
        ? jsonResponse({product: {id: 777}})
        : jsonResponse({reviews: [review(1), review(2, {hidden: true})]}),
    );
    const result = await provider.fetchProductReviews('queen-mattress', {
      page: 2,
      limit: 5,
    });
    expect(urls.every((url) => url.hostname === 'api.judge.me')).toBe(true);
    expect(urls[0]?.searchParams.get('handle')).toBe('queen-mattress');
    expect(urls[1]?.searchParams.get('product_id')).toBe('777');
    expect(urls[1]?.searchParams.get('per_page')).toBe('5');
    expect(urls[1]?.searchParams.get('page')).toBe('2');
    expect(result).toEqual({
      status: 'ok',
      reviews: [
        {
          id: '1',
          rating: 5,
          title: 'Great',
          body: 'Slept well.',
          author: 'Sam B.',
          date: '2026-09-01',
        },
      ],
      hasMore: false,
    });
  });

  it('never passes a product id it did not get from the lookup (an unknown id would return every review)', async () => {
    const {provider, urls} = adapter(() => jsonResponse({product: {}}));
    const result = await provider.fetchProductReviews('x', {page: 1, limit: 5});
    expect(result).toEqual({status: 'ok', reviews: [], hasMore: false});
    expect(urls.some((url) => url.pathname.endsWith('/reviews'))).toBe(false);
  });

  it('treats a 404 lookup as no reviews, and other failures as unavailable without logging secrets', async () => {
    expect(
      await adapter(() => new Response('', {status: 404})).provider.fetchAggregate(
        'x',
      ),
    ).toEqual({status: 'ok', aggregate: null});
    const down = adapter(() => new Response('', {status: 500}));
    expect(await down.provider.fetchAggregate('x')).toEqual({
      status: 'unavailable',
    });
    expect(JSON.stringify(down.logs)).not.toContain(TOKEN);
    expect(JSON.stringify(down.logs)).not.toContain(DOMAIN);
  });

  it('is unavailable for a timeout, malformed JSON and an unexpected shape', async () => {
    const logs: string[] = [];
    const slow = createJudgeMeProvider({
      token: TOKEN,
      shopDomain: DOMAIN,
      timeoutMs: 20,
      log: (_event, fields) => logs.push(String(fields['reason'])),
      fetch: (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    });
    expect(await slow.fetchAggregate('x')).toEqual({status: 'unavailable'});
    expect(logs).toEqual(['timeout']);
    expect(
      await adapter(() => new Response('<html>', {status: 200})).provider.fetchAggregate('x'),
    ).toEqual({status: 'unavailable'});
    const shape = adapter((url) =>
      url.pathname.endsWith('/products/-1')
        ? jsonResponse({product: {id: 1}})
        : jsonResponse({data: []}),
    );
    expect(
      await shape.provider.fetchProductReviews('x', {page: 1, limit: 5}),
    ).toEqual({status: 'unavailable'});
  });

  it('skips unpublished, hidden and out-of-range ratings, and never shows a full name', async () => {
    const {provider} = adapter((url) =>
      url.pathname.endsWith('/products/-1')
        ? jsonResponse({product: {id: 1}})
        : jsonResponse({
            reviews: [
              review(1, {published: false}),
              review(2, {rating: 9}),
              review(3, {reviewer: {name: 'Pat Q Public'}, body: '<i>ok</i>'}),
            ],
          }),
    );
    const result = await provider.fetchProductReviews('x', {page: 1, limit: 5});
    expect(result.status === 'ok' && result.reviews.map((r) => r.author)).toEqual(
      ['Pat P.'],
    );
  });

  it('computes an exact aggregate, and marks it inexact when it stopped reading', async () => {
    const small = adapter((url) =>
      url.pathname.endsWith('/products/-1')
        ? jsonResponse({product: {id: 1}})
        : jsonResponse({reviews: [review(1), review(2, {rating: 4})]}),
    );
    expect(await small.provider.fetchAggregate('x')).toEqual({
      status: 'ok',
      aggregate: {average: 4.5, count: 2, exact: true},
    });
    const full = Array.from({length: 100}, (_, i) => review(i + 1));
    const big = adapter((url) =>
      url.pathname.endsWith('/products/-1')
        ? jsonResponse({product: {id: 1}})
        : jsonResponse({reviews: full}),
    );
    const answer = await big.provider.fetchAggregate('x');
    expect(answer).toEqual({
      status: 'ok',
      aggregate: {average: 5, count: AGGREGATE_MAX_PAGES * 100, exact: false},
    });
  });
});

describe('REQ-PDP-005 service (cost control, T-13)', () => {
  it('makes one upstream read for repeated requests and remembers a failure briefly', async () => {
    let now = 0;
    const fetchAggregate = vi
      .fn()
      .mockResolvedValueOnce({status: 'unavailable'})
      .mockResolvedValue({status: 'ok', aggregate: null});
    const service = createReviewsService(
      {id: 'fake', fetchAggregate, fetchProductReviews: vi.fn()},
      {now: () => now},
    );
    await service.summary('a');
    await service.summary('a');
    expect(fetchAggregate).toHaveBeenCalledTimes(1);
    now = 31_000;
    expect(await service.summary('a')).toEqual({status: 'ok', aggregate: null});
    await service.summary('a');
    expect(fetchAggregate).toHaveBeenCalledTimes(2);
  });

  it('answers unavailable past the per-minute call ceiling and when the provider throws', async () => {
    const fetchAggregate = vi.fn().mockResolvedValue({status: 'ok', aggregate: null});
    const service = createReviewsService(
      {id: 'fake', fetchAggregate, fetchProductReviews: vi.fn()},
      {callsPerMinute: 2, now: () => 0},
    );
    await service.summary('a');
    await service.summary('b');
    expect(await service.summary('c')).toEqual({status: 'unavailable'});
    const throwing = createReviewsService({
      id: 'fake',
      fetchAggregate: () => Promise.reject(new Error('boom')),
      fetchProductReviews: vi.fn(),
    });
    expect(await throwing.summary('a')).toEqual({status: 'unavailable'});
  });

  it('gives up waiting for the summary after the deadline', async () => {
    const service = createReviewsService({
      id: 'fake',
      fetchAggregate: () => new Promise(() => undefined),
      fetchProductReviews: vi.fn(),
    });
    expect(await service.summaryWithin('a', 5)).toEqual({status: 'unavailable'});
  });
});

describe('REQ-PDP-005 request validation', () => {
  const parse = (query: string) =>
    parseReviewsQuery(new URL(`https://s.test/api/reviews?${query}`));

  it('accepts a valid handle with defaults and bounds', () => {
    expect(parse('handle=queen-mattress')).toEqual({
      handle: 'queen-mattress',
      page: 1,
      limit: 5,
    });
    expect(parse('handle=a&page=20&limit=20')).not.toBeNull();
  });

  it.each([
    'handle=',
    'handle=A',
    'handle=../etc',
    'handle=a&page=0',
    'handle=a&page=21',
    'handle=a&limit=21',
    'handle=a&limit=-1',
    'handle=a&page=1e2',
    '',
  ])('rejects %j', (query) => {
    expect(parse(query)).toBeNull();
  });

  it('treats any answer that does not fit as unavailable in the browser', () => {
    expect(parseReviewsApiResponse({status: 'ok'})).toEqual({
      status: 'unavailable',
    });
    expect(parseReviewsApiResponse('x')).toEqual({status: 'unavailable'});
    expect(
      parseReviewsApiResponse({
        status: 'ok',
        page: 1,
        reviews: [{id: 1}, FAKE],
        aggregate: {average: 4},
        hasMore: true,
      }),
    ).toEqual({
      status: 'ok',
      page: 1,
      aggregate: null,
      reviews: [FAKE],
      hasMore: true,
    });
  });
});

const FAKE = {
  id: 'r1',
  rating: 4,
  title: null,
  body: 'ok',
  author: 'Sam B.',
  date: null,
};

describe('REQ-PDP-005 /api/reviews route', () => {
  function call(path: string, env: object, headers: HeadersInit = {}) {
    const request = new Request(`https://shop.example.test${path}`, {headers});
    return reviewsLoader({request, context: {env}, params: {}} as never);
  }

  it('is a 404 with reviews off, and makes no provider call', async () => {
    const response = await call('/api/reviews?handle=a', {});
    expect(response.status).toBe(404);
  });

  it('refuses a cross-site request', async () => {
    const response = await call(
      '/api/reviews?handle=a',
      {REVIEWS_PROVIDER: 'fake'},
      {'Sec-Fetch-Site': 'cross-site'},
    );
    expect(response.status).toBe(403);
  });

  it('answers 400 for a bad handle', async () => {
    const response = await call('/api/reviews?handle=Bad%20Handle', {
      REVIEWS_PROVIDER: 'fake',
    });
    expect(response.status).toBe(400);
  });

  it('returns the first page with the aggregate, then later pages without it, with a short cache', async () => {
    const env = {REVIEWS_PROVIDER: 'fake'};
    const first = await call('/api/reviews?handle=queen&page=1&limit=5', env);
    expect(first.headers.get('Cache-Control')).toContain('s-maxage=300');
    const body = parseReviewsApiResponse(await first.json());
    expect(body.status === 'ok' && body.aggregate?.count).toBe(12);
    expect(body.status === 'ok' && body.reviews).toHaveLength(5);
    const third = parseReviewsApiResponse(
      await (await call('/api/reviews?handle=queen&page=3&limit=5', env)).json(),
    );
    expect(third.status === 'ok' && [third.aggregate, third.reviews.length, third.hasMore]).toEqual([null, 2, false]);
  });

  it('turns a provider failure into a 200 unavailable that is not cached', async () => {
    const response = await call('/api/reviews?handle=bed-down', {
      REVIEWS_PROVIDER: 'fake',
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual({status: 'unavailable'});
  });
});

describe('REQ-PDP-005 product page state and rating markup', () => {
  it('is free and empty when reviews are off', async () => {
    expect(await loadReviewsPageState({}, 'a', true)).toEqual({
      enabled: false,
      aggregate: null,
    });
  });

  it('carries the aggregate when on, and none for a product without reviews or a failing provider', async () => {
    const env = {REVIEWS_PROVIDER: 'fake'};
    expect((await loadReviewsPageState(env, 'a', true)).aggregate?.count).toBe(12);
    expect(await loadReviewsPageState(env, 'a-none', true)).toEqual({
      enabled: true,
      aggregate: null,
    });
    expect((await loadReviewsPageState(env, 'a-down', true)).aggregate).toBeNull();
  });

  const product = {
    id: 'gid://shopify/Product/1',
    handle: 'queen',
    title: 'Queen',
    vendor: 'Acme',
    description: [],
    seoDescription: null,
    images: [],
    variants: [],
    brand: null,
  } as unknown as ProductPageView;

  it('emits aggregateRating only from exact, real data', () => {
    const none = buildProductJsonLd(product, null);
    expect('aggregateRating' in none).toBe(false);
    const real = buildProductJsonLd(product, null, {
      average: 4.2,
      count: 12,
      exact: true,
    });
    expect(real['aggregateRating']).toEqual({
      '@type': 'AggregateRating',
      ratingValue: 4.2,
      reviewCount: 12,
      bestRating: 5,
      worstRating: 1,
    });
    for (const rating of [
      {average: 4.2, count: 300, exact: false},
      {average: 4.2, count: 0, exact: true},
      {average: 0, count: 3, exact: true},
      {average: 6, count: 3, exact: true},
    ]) {
      expect('aggregateRating' in buildProductJsonLd(product, null, rating)).toBe(
        false,
      );
    }
  });

  it('the fake provider is typed like the real one', async () => {
    const fake = createFakeProvider();
    expect((await fake.fetchProductReviews('a', {page: 1, limit: 3})).status).toBe(
      'ok',
    );
  });
});
