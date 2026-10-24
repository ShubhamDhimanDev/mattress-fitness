import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {fakeStorefront, type RecordedCall} from '../catalog/fake-storefront';
import {resetContentPagesLogMemory} from '~/lib/shopify/content-pages-data';
import {loader as articleLoader} from '~/routes/blogs.$blogHandle.$articleHandle';
import {loader as blogLoader} from '~/routes/blogs.$blogHandle._index';
import {loader as blogsLoader} from '~/routes/blogs._index';
import {loader as pageLoader} from '~/routes/pages.$handle';
import {loader as policyLoader} from '~/routes/policies.$handle';

// REQ-CNT-001, REQ-CNT-002: the page, policy and blog loaders. The route argument types are framework-generated;
// the helper builds them from plain parts (test-only narrowing, as in seo-routes.test.ts).

const SITE = 'https://www.example.com';

function args(path: string, params: object, storefront: object) {
  return {
    request: new Request(`${SITE}${path}`),
    params,
    context: {storefront, env: {PUBLIC_SITE_URL: SITE}},
  } as never;
}

async function thrown(run: () => unknown): Promise<Response> {
  try {
    await run();
  } catch (error) {
    if (error instanceof Response) return error;
    throw error;
  }
  throw new Error('Expected a thrown Response');
}

function isQuery(call: RecordedCall, name: string) {
  return call.query.includes(`query ${name}(`);
}

const FAQ_BODY =
  '<h2>How long?</h2><p>Two days.</p><h2>Can I return it?</h2><p>Yes.</p>';

function page(overrides: Record<string, unknown> = {}) {
  return {
    handle: 'faq',
    id: 'gid://shopify/Page/1',
    title: 'FAQ',
    body: FAQ_BODY,
    updatedAt: '2026-10-05T10:00:00Z',
    seo: {title: null, description: null},
    ...overrides,
  };
}

beforeEach(() => resetContentPagesLogMemory());
afterEach(() => vi.restoreAllMocks());

describe('REQ-CNT-001 /pages/:handle loader', () => {
  it('returns the page with a view built from it (canonical, FAQ markup, last updated)', async () => {
    const {storefront, calls} = fakeStorefront(() => ({page: page()}));
    const data = await pageLoader(
      args('/pages/faq', {handle: 'faq'}, storefront),
    );
    expect(data.page.body).toBe(FAQ_BODY);
    expect(data.view.title).toBe('FAQ');
    expect(data.view.updated?.text).toBe('October 5, 2026');
    expect(data.view.empty).toBe(false);
    expect(
      data.head.some(
        (tag) => 'href' in tag && tag.href === `${SITE}/pages/faq`,
      ),
    ).toBe(true);
    expect(
      data.head.flatMap((entry) =>
        'script:ld+json' in entry ? [entry['script:ld+json']['@type']] : [],
      ),
    ).toEqual(['BreadcrumbList', 'FAQPage']);
    // Content has no price or shopper data: long cache, one request.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.cache).toEqual({mode: 'long'});
    expect(calls[0]?.variables).toEqual({handle: 'faq'});
  });

  it('marks an empty page noindex and still serves it', async () => {
    const {storefront} = fakeStorefront(() => ({
      page: page({handle: 'about', title: 'About', body: ''}),
    }));
    const data = await pageLoader(
      args('/pages/about', {handle: 'about'}, storefront),
    );
    expect(data.view.empty).toBe(true);
    expect(
      data.head.some(
        (tag) => 'content' in tag && tag.content === 'noindex,follow',
      ),
    ).toBe(true);
  });

  it('gives FAQPage markup only on the FAQ page', async () => {
    const {storefront} = fakeStorefront(() => ({
      page: page({handle: 'about', title: 'About'}),
    }));
    const data = await pageLoader(
      args('/pages/about', {handle: 'about'}, storefront),
    );
    expect(
      data.head.flatMap((entry) =>
        'script:ld+json' in entry ? [entry['script:ld+json']['@type']] : [],
      ),
    ).toEqual(['BreadcrumbList']);
  });

  it('answers 404 for an unknown handle', async () => {
    const {storefront} = fakeStorefront(() => ({page: null}));
    const response = await thrown(() =>
      pageLoader(args('/pages/nope', {handle: 'nope'}, storefront)),
    );
    expect(response.status).toBe(404);
  });

  it.each(['', '../etc', 'a b', 'A/B', 'x'.repeat(300), undefined])(
    'answers 404 for an invalid handle %j without asking Shopify',
    async (handle) => {
      const {storefront, calls} = fakeStorefront(() => ({page: null}));
      const response = await thrown(() =>
        pageLoader(args('/pages/x', {handle}, storefront)),
      );
      expect(response.status).toBe(404);
      expect(calls).toHaveLength(0);
    },
  );

  it.each([
    ['privacy-policy', 'privacyPolicy', '/policies/privacy-policy'],
    ['terms', 'termsOfService', '/policies/terms-of-service'],
  ])(
    'redirects /pages/%s with a 302 (never cached) to the Shopify policy when no page has that handle',
    async (handle, field, target) => {
      const {storefront} = fakeStorefront((call) =>
        isQuery(call, 'Page')
          ? {page: null}
          : {shop: {[field]: {id: 'gid://shopify/ShopPolicy/1'}}},
      );
      const response = await thrown(() =>
        pageLoader(args(`/pages/${handle}`, {handle}, storefront)),
      );
      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toBe(target);
      expect(response.headers.get('cache-control')).toBe('no-store');
    },
  );

  it.each([
    ['', 'an empty body'],
    ['<p>&nbsp;</p>', 'only a non-breaking space'],
    ['<p><br></p>', 'only a line break'],
  ])(
    'redirects /pages/terms to the policy when a page with that handle is empty (%j: %s)',
    async (body) => {
      const {storefront} = fakeStorefront((call) =>
        isQuery(call, 'Page')
          ? {page: page({handle: 'terms', title: 'Terms', body})}
          : {shop: {termsOfService: {id: 'gid://shopify/ShopPolicy/2'}}},
      );
      const response = await thrown(() =>
        pageLoader(args('/pages/terms', {handle: 'terms'}, storefront)),
      );
      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toBe(
        '/policies/terms-of-service',
      );
    },
  );

  it('serves an empty legal page (noindex) when there is no policy to send the shopper to', async () => {
    const {storefront} = fakeStorefront((call) =>
      isQuery(call, 'Page')
        ? {page: page({handle: 'terms', title: 'Terms', body: ''})}
        : {shop: {termsOfService: null}},
    );
    const data = await pageLoader(
      args('/pages/terms', {handle: 'terms'}, storefront),
    );
    expect(data.view.empty).toBe(true);
  });

  it('serves an image-only page as content (the footer counts it too)', async () => {
    const {storefront} = fakeStorefront(() => ({
      page: page({
        handle: 'about',
        title: 'About',
        body: '<img src="https://cdn.shopify.com/a.png" alt="">',
      }),
    }));
    const data = await pageLoader(
      args('/pages/about', {handle: 'about'}, storefront),
    );
    expect(data.view.empty).toBe(false);
  });

  it('answers 404 for the legal handles when the policy does not exist either', async () => {
    const {storefront} = fakeStorefront((call) =>
      isQuery(call, 'Page')
        ? {page: null}
        : {shop: {privacyPolicy: null, termsOfService: null}},
    );
    const response = await thrown(() =>
      pageLoader(args('/pages/terms', {handle: 'terms'}, storefront)),
    );
    expect(response.status).toBe(404);
  });

  it('answers 404 (not a redirect) for the legal handles when the availability read fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const {storefront} = fakeStorefront((call) => {
      if (isQuery(call, 'Page')) return {page: null};
      throw new Error('down');
    });
    const response = await thrown(() =>
      pageLoader(args('/pages/terms', {handle: 'terms'}, storefront)),
    );
    expect(response.status).toBe(404);
  });

  it('serves the page, not a redirect, when a page with a legal handle exists', async () => {
    const {storefront, calls} = fakeStorefront(() => ({
      page: page({handle: 'terms', title: 'Terms', body: '<p>Our terms.</p>'}),
    }));
    const data = await pageLoader(
      args('/pages/terms', {handle: 'terms'}, storefront),
    );
    expect(data.view.title).toBe('Terms');
    expect(calls).toHaveLength(1);
  });

  it('does not look up policies for a handle that is not a legal page', async () => {
    const {storefront, calls} = fakeStorefront(() => ({page: null}));
    await thrown(() =>
      pageLoader(args('/pages/faq', {handle: 'faq'}, storefront)),
    );
    expect(calls).toHaveLength(1);
  });
});

describe('REQ-CNT-001 /policies/:handle loader', () => {
  it('builds the policy view under Policies with a canonical on the policy URL', async () => {
    const {storefront} = fakeStorefront(() => ({
      shop: {
        privacyPolicy: {
          id: '1',
          handle: 'privacy-policy',
          title: 'Privacy policy',
          url: 'https://x',
          body: '<p>We keep little.</p>',
        },
      },
    }));
    const data = await policyLoader(
      args('/policies/privacy-policy', {handle: 'privacy-policy'}, storefront),
    );
    expect(data.view.breadcrumb.map((crumb) => crumb.label)).toEqual([
      'Home',
      'Policies',
      'Privacy policy',
    ]);
    expect(
      data.head.some(
        (tag) =>
          'href' in tag && tag.href === `${SITE}/policies/privacy-policy`,
      ),
    ).toBe(true);
    expect(data.view.updated).toBeNull();
  });

  it.each(['subscription-policy', 'nope', '../x', undefined])(
    'answers 404 for the unrouted policy handle %j',
    async (handle) => {
      const {storefront} = fakeStorefront(() => ({shop: {}}));
      const response = await thrown(() =>
        policyLoader(args('/policies/x', {handle}, storefront)),
      );
      expect(response.status).toBe(404);
    },
  );

  it('answers 404 when the policy has not been written', async () => {
    const {storefront} = fakeStorefront(() => ({shop: {termsOfService: null}}));
    const response = await thrown(() =>
      policyLoader(
        args(
          '/policies/terms-of-service',
          {handle: 'terms-of-service'},
          storefront,
        ),
      ),
    );
    expect(response.status).toBe(404);
  });
});

const NODE = {
  id: 'gid://shopify/Article/1',
  handle: 'choosing',
  title: 'Choosing a mattress',
  excerpt: '<b>A short</b> guide.',
  publishedAt: '2026-10-05T10:00:00Z',
  author: {name: 'Sam Sleeper'},
  image: null,
  blog: {handle: 'journal'},
};

describe('REQ-CNT-002 blog loaders', () => {
  it('lists articles newest first with a cursor page size, the long cache and clean cards', async () => {
    const {storefront, calls} = fakeStorefront(() => ({
      blog: {
        title: 'Sleep journal',
        handle: 'journal',
        seo: {title: null, description: 'Tips.'},
        articles: {
          nodes: [NODE],
          pageInfo: {
            hasNextPage: true,
            hasPreviousPage: false,
            startCursor: 'a',
            endCursor: 'b',
          },
        },
      },
    }));
    const data = await blogLoader(
      args('/blogs/journal?cursor=abc', {blogHandle: 'journal'}, storefront),
    );
    expect(calls[0]?.query).toContain('sortKey: PUBLISHED_AT');
    expect(calls[0]?.query).toContain('reverse: true');
    expect(calls[0]?.query).not.toContain('contentHtml');
    expect(calls[0]?.variables).toMatchObject({
      blogHandle: 'journal',
      first: 12,
      endCursor: 'abc',
    });
    expect(calls[0]?.cache).toEqual({mode: 'long'});
    const [card] = data.blog.articles.nodes;
    expect(card).toMatchObject({
      title: 'Choosing a mattress',
      authorName: 'Sam Sleeper',
      excerpt: 'A short guide.',
      blogHandle: 'journal',
    });
    expect(data.blog.articles.pageInfo.hasNextPage).toBe(true);
    // Every page of the listing points at the plain blog URL.
    expect(
      data.view.metaTags.some(
        (tag) => 'href' in tag && tag.href === `${SITE}/blogs/journal`,
      ),
    ).toBe(true);
  });

  it.each([
    ['cursor=a%22%2C%20first%3A%20250'],
    ['cursor=%3Cscript%3Ealert(1)%3C%2Fscript%3E'],
    ['cursor=abc&direction=evil'],
    ['cursor=' + 'x'.repeat(600)],
    ['cursor=a%0Ab'],
  ])(
    'never lets the hostile pagination query %s reach Shopify (first page instead)',
    async (query) => {
      const {storefront, calls} = fakeStorefront(() => ({
        blog: {
          title: 'J',
          handle: 'journal',
          seo: null,
          articles: {
            nodes: [],
            pageInfo: {
              hasNextPage: false,
              hasPreviousPage: false,
              startCursor: null,
              endCursor: null,
            },
          },
        },
      }));
      await blogLoader(
        args(`/blogs/journal?${query}`, {blogHandle: 'journal'}, storefront),
      );
      expect(calls).toHaveLength(1);
      expect(calls[0]?.variables).toEqual({
        blogHandle: 'journal',
        first: 12,
        endCursor: null,
      });
    },
  );

  it('does the same for the list of blogs', async () => {
    const {storefront, calls} = fakeStorefront(() => ({
      blogs: {
        nodes: [],
        pageInfo: {
          hasNextPage: false,
          hasPreviousPage: false,
          startCursor: null,
          endCursor: null,
        },
      },
    }));
    await blogsLoader(
      args('/blogs?cursor=a%22%20x&direction=previous', {}, storefront),
    );
    expect(calls[0]?.variables).toEqual({first: 12, endCursor: null});
  });

  it('answers 404 for an unknown or invalid blog', async () => {
    const {storefront} = fakeStorefront(() => ({blog: null}));
    expect(
      (
        await thrown(() =>
          blogLoader(args('/blogs/x', {blogHandle: 'nope'}, storefront)),
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await thrown(() =>
          blogLoader(args('/blogs/x', {blogHandle: '../x'}, storefront)),
        )
      ).status,
    ).toBe(404);
  });

  it('lists the blogs with a plain canonical', async () => {
    const {storefront} = fakeStorefront(() => ({
      blogs: {
        nodes: [{title: 'Sleep journal', handle: 'journal'}],
        pageInfo: {
          hasNextPage: false,
          hasPreviousPage: false,
          startCursor: null,
          endCursor: null,
        },
      },
    }));
    const data = await blogsLoader(args('/blogs', {}, storefront));
    expect(data.blogs.nodes).toHaveLength(1);
    expect(
      data.metaTags.some(
        (tag) => 'href' in tag && tag.href === `${SITE}/blogs`,
      ),
    ).toBe(true);
  });

  describe('article loader', () => {
    function articleAnswer(handle = 'choosing') {
      return {
        blog: {
          handle: 'journal',
          title: 'Sleep journal',
          articleByHandle: {
            handle,
            title: 'Choosing a mattress',
            contentHtml: '<p>Start with how you sleep.</p>',
            excerpt: 'A short guide.',
            publishedAt: '2026-10-05T10:00:00Z',
            tags: ['sleep', 'beds'],
            author: {name: 'Sam Sleeper'},
            image: {
              id: 'i',
              altText: 'A bed',
              url: 'https://cdn.shopify.com/a.jpg',
              width: 1200,
              height: 800,
            },
            seo: {title: 'Choosing | Journal', description: null},
          },
          articles: {
            nodes: [
              {handle: 'newer', title: 'Newer'},
              {handle: 'choosing', title: 'Choosing a mattress'},
              {handle: 'older', title: 'Older'},
            ],
          },
        },
      };
    }

    it('returns the article, its neighbours, social tags and Article markup', async () => {
      const {storefront, calls} = fakeStorefront(() => articleAnswer());
      const data = await articleLoader(
        args(
          '/blogs/journal/choosing',
          {blogHandle: 'journal', articleHandle: 'choosing'},
          storefront,
        ),
      );
      expect(data.newer?.handle).toBe('newer');
      expect(data.older?.handle).toBe('older');
      expect(data.view.topics).toEqual(['sleep', 'beds']);
      expect(data.view.jsonLd.map((entry) => entry['@type'])).toEqual([
        'Article',
        'BreadcrumbList',
      ]);
      expect(
        data.view.metaTags.some(
          (tag) =>
            'property' in tag &&
            tag.property === 'og:image' &&
            tag.content === 'https://cdn.shopify.com/a.jpg',
        ),
      ).toBe(true);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.cache).toEqual({mode: 'long'});
      expect(calls[0]?.variables).toMatchObject({neighbours: 100});
    });

    it('answers 404 for a missing article or blog, and for invalid handles', async () => {
      const missing = fakeStorefront(() => ({
        blog: {
          handle: 'journal',
          title: 'J',
          articleByHandle: null,
          articles: {nodes: []},
        },
      }));
      const noBlog = fakeStorefront(() => ({blog: null}));
      const run = (storefront: object, params: object) =>
        thrown(() => articleLoader(args('/blogs/x/y', params, storefront)));
      expect(
        (
          await run(missing.storefront, {
            blogHandle: 'journal',
            articleHandle: 'x',
          })
        ).status,
      ).toBe(404);
      expect(
        (await run(noBlog.storefront, {blogHandle: 'nope', articleHandle: 'x'}))
          .status,
      ).toBe(404);
      expect(
        (await run(noBlog.storefront, {blogHandle: '../x', articleHandle: 'x'}))
          .status,
      ).toBe(404);
      expect(noBlog.calls).toHaveLength(1);
    });
  });
});
