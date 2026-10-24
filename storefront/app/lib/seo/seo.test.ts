import {describe, expect, it} from 'vitest';
import {MANAGED_FILTER_PARAMS} from '~/lib/filters';
import {
  NON_INDEXABLE_PREFIXES,
  ROBOTS_DISALLOWED_PREFIXES,
  canonicalLinkHeader,
  canonicalMeta,
  canonicalUrl,
  isIndexablePath,
} from '~/lib/seo/canonical';
import {buildRobotsTxt} from '~/lib/seo/robots';
import {
  SITEMAP_TYPES,
  extraSitemapEntries,
  escapeXml,
  isSitemapType,
  parseSitemapPage,
  renderSitemapIndex,
  renderUrlset,
  sitemapLink,
} from '~/lib/seo/sitemap';

// REQ-SEO-001 (P7-04): canonical policy, robots.txt and sitemap rules. Policy text: docs/architecture/SEO_POLICY.md.

const ORIGIN = 'https://www.example.com';

describe('canonical URL (REQ-SEO-001, DEC-044)', () => {
  it.each([
    ['/collections/mattresses', `${ORIGIN}/collections/mattresses`],
    ['/collections/mattresses/', `${ORIGIN}/collections/mattresses`],
    ['/products/queen-hybrid', `${ORIGIN}/products/queen-hybrid`],
    ['/', `${ORIGIN}/`],
    ['/brands/acme-sleep', `${ORIGIN}/brands/acme-sleep`],
  ])('%s -> %s', (path, expected) => {
    expect(canonicalUrl(ORIGIN, path)).toBe(expected);
  });

  it('is the path only: a query string or fragment never reaches it', () => {
    // The caller passes pathname, but a caller that passes more still gets no query or fragment.
    expect(
      canonicalUrl(ORIGIN, '/collections/x?size=queen&sort=price-asc'),
    ).toBe(`${ORIGIN}/collections/x`);
    expect(canonicalUrl(ORIGIN, '/products/x#reviews')).toBe(
      `${ORIGIN}/products/x`,
    );
  });

  it('is null without a configured origin: a missing canonical is harmless, a forged one is not', () => {
    expect(canonicalUrl(null, '/collections/x')).toBeNull();
  });

  it.each([
    '//evil.example/collections/x',
    '/\\evil.example/x',
    'collections/x',
    '',
    'https://evil.example/x',
  ])('refuses the path %j (it could leave the origin)', (path) => {
    expect(canonicalUrl(ORIGIN, path)).toBeNull();
  });

  it.each([
    '/cart',
    '/cart/c/1',
    '/account',
    '/account/orders',
    '/checkout-steps',
    '/delivery',
    '/api/extend/offers',
    '/webhooks/shopify',
    '/discount/SAVE10',
    '/search',
    '/compare',
    '/track-order',
    '/Track-Order',
    '/sitemap.xml',
    '/sitemap/products/1.xml',
    '/robots.txt',
    // Routes match case-insensitively and decode the path.
    '/CART',
    '/Account/Orders',
    '/%63art',
  ])('%s has no canonical and is not indexable', (path) => {
    expect(isIndexablePath(path)).toBe(false);
    expect(canonicalUrl(ORIGIN, path)).toBeNull();
  });

  it('gives the trust pages a canonical (they are indexed, review m7)', () => {
    expect(canonicalUrl(ORIGIN, '/policies/refund-policy')).toBe(
      `${ORIGIN}/policies/refund-policy`,
    );
    expect(canonicalUrl(ORIGIN, '/policies')).toBe(`${ORIGIN}/policies`);
  });

  it('matches whole path segments, not string prefixes', () => {
    expect(isIndexablePath('/cartridge-mattress')).toBe(true);
    expect(isIndexablePath('/accounting')).toBe(true);
    expect(isIndexablePath('/pages/delivery')).toBe(true);
  });

  it('renders the Link header and the meta descriptor from the same URL', () => {
    const url = `${ORIGIN}/collections/x`;
    expect(canonicalLinkHeader(url)).toBe(`<${url}>; rel="canonical"`);
    expect(canonicalMeta(url)).toEqual([
      {tagName: 'link', rel: 'canonical', href: url},
    ]);
    expect(canonicalMeta(null)).toEqual([]);
  });

  it('keeps /track-order out of the indexable set but not in the robots block (L-6, REQ-ACC-003)', () => {
    expect(NON_INDEXABLE_PREFIXES).toContain('/track-order');
    expect(ROBOTS_DISALLOWED_PREFIXES).not.toContain('/track-order');
  });

  it('keeps every robots-blocked path out of the indexable set', () => {
    for (const prefix of ROBOTS_DISALLOWED_PREFIXES) {
      expect(NON_INDEXABLE_PREFIXES).toContain(prefix);
    }
  });
});

describe('robots.txt (REQ-SEO-001)', () => {
  const text = buildRobotsTxt({
    origin: ORIGIN,
    facetParams: MANAGED_FILTER_PARAMS,
  });
  const lines = text.split('\n');

  /** A small robots.txt matcher: `*` spans any characters, a trailing `$` ends the URL, the rest is a prefix. */
  function blockedBy(rules: readonly string[], url: string): boolean {
    return rules.some((rule) => {
      const anchored = rule.endsWith('$');
      const body = (anchored ? rule.slice(0, -1) : rule)
        .split('*')
        .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
        .join('.*');
      return new RegExp(`^${body}${anchored ? '$' : ''}`).test(url);
    });
  }
  const starGroup = text.split('\n\n')[0] ?? '';
  const starRules = starGroup
    .split('\n')
    .filter((line) => line.startsWith('Disallow: '))
    .map((line) => line.slice('Disallow: '.length));

  it.each([
    '/cart',
    '/cart/c/c1-abc',
    '/cart?x=1',
    '/account',
    '/account/orders',
    '/checkout-steps',
    '/delivery',
    '/api/extend/offers',
    '/webhooks/shopify',
    '/discount/SAVE10',
    '/quiz?step=results',
    '/collections/firm?size=queen',
    '/collections/firm?brand=acme&sort=price-asc',
    '/collections/firm?cursor=abc',
    '/brands/acme?comfort=firm',
  ])('blocks %s for the default crawler', (url) => {
    expect(blockedBy(starRules, url)).toBe(true);
  });

  it.each([
    '/cartridge-mattress',
    '/accounting-tips',
    '/apiary',
    '/discounts-and-deals',
    '/deliveryman-story',
    '/pages/delivery',
    '/collections/firm',
    '/collections/firm?utm_source=mail',
    '/products/resize-pad',
    '/products/x?resize=1',
    '/products/queen-hybrid',
    '/quiz',
    // Internal search is noindex,follow: it must stay fetchable so the noindex can be read (SEO_POLICY).
    '/search',
    '/search?q=firm',
    // Trust pages are indexed.
    '/policies',
    '/policies/refund-policy',
    '/policies/shipping-policy',
    '/pages/about',
    '/blogs/news/sleep-tips',
    '/sitemap.xml',
    '/',
  ])('leaves %s crawlable', (url) => {
    expect(blockedBy(starRules, url)).toBe(false);
  });

  it('repeats the rules in every named crawler group except the one that is shut out', () => {
    const groups = text
      .split('\n\n')
      .filter(
        (g) =>
          g.startsWith('User-agent') && !g.split('\n').includes('Disallow: /'),
      );
    expect(groups.length).toBeGreaterThan(3);
    for (const group of groups) {
      expect(group.split('\n')).toEqual(
        expect.arrayContaining(['Disallow: /cart$', 'Disallow: /quiz?']),
      );
    }
  });

  it('keeps the cart blocked for a crawler that ignores the $ end anchor', () => {
    // Every named group carries all three forms, so the cart stays blocked whether or not `$` is understood.
    const groups = text
      .split('\n\n')
      .filter(
        (g) =>
          g.startsWith('User-agent') && !g.split('\n').includes('Disallow: /'),
      );
    for (const group of groups) {
      expect(group.split('\n')).toEqual(
        expect.arrayContaining([
          'Disallow: /cart$',
          'Disallow: /cart/',
          'Disallow: /cart?',
        ]),
      );
    }
    // A crawler that cannot use the `$` rule (it never matches) still blocks everything below and after the path.
    const withoutAnchored = starRules.filter((rule) => !rule.endsWith('$'));
    for (const url of ['/cart/c/c1-abc', '/cart/', '/cart?x=1', '/cart?']) {
      expect(blockedBy(withoutAnchored, url)).toBe(true);
    }
    // Segment-safe: the extra forms must not block look-alike paths.
    for (const url of ['/cartridge-mattress', '/carts', '/cart-liner']) {
      expect(blockedBy(starRules, url)).toBe(false);
    }
  });

  it('blocks every filter and sort parameter of the codec after ? and after &', () => {
    for (const param of MANAGED_FILTER_PARAMS) {
      expect(lines).toContain(`Disallow: /*?${param}=`);
      expect(lines).toContain(`Disallow: /*&${param}=`);
    }
    expect(MANAGED_FILTER_PARAMS).toEqual(
      expect.arrayContaining(['size', 'sort', 'cursor', 'price_min']),
    );
  });

  it('names the sitemap from the configured origin only', () => {
    expect(lines).toContain(`Sitemap: ${ORIGIN}/sitemap.xml`);
    expect(
      buildRobotsTxt({origin: null, facetParams: MANAGED_FILTER_PARAMS}),
    ).not.toContain('Sitemap:');
  });

  it('shuts out one bulk crawler entirely and keeps the file newline-terminated', () => {
    expect(text).toContain('User-agent: Nutch\nDisallow: /');
    expect(text.endsWith('\n')).toBe(true);
  });
});

describe('sitemap links (REQ-SEO-001)', () => {
  it.each([
    ['products', 'queen-hybrid', `${ORIGIN}/products/queen-hybrid`],
    ['collections', 'firm-mattresses', `${ORIGIN}/collections/firm-mattresses`],
    ['pages', 'about-us', `${ORIGIN}/pages/about-us`],
    ['blogs', 'news', `${ORIGIN}/blogs/news`],
    // Article handles arrive as blog/article, the shape of the /blogs/:blog/:article route.
    ['articles', 'news/how-to-choose', `${ORIGIN}/blogs/news/how-to-choose`],
  ])('%s %s', (type, handle, expected) => {
    expect(sitemapLink(type, ORIGIN, handle)).toBe(expected);
  });

  it('percent-encodes non-ASCII handles per segment', () => {
    expect(sitemapLink('products', ORIGIN, 'matelas-été')).toBe(
      `${ORIGIN}/products/matelas-%C3%A9t%C3%A9`,
    );
  });

  it.each([
    '',
    'a b',
    'a?x=1',
    'a#b',
    'a/../b/%2e%2e',
    '<script>',
    'a&b',
    "a'b",
    'a"b',
    'a\nb',
    '/',
    'news//x',
    'x'.repeat(256),
  ])('drops the hostile or empty handle %j', (handle) => {
    expect(sitemapLink('products', ORIGIN, handle)).toBeNull();
  });

  it('has no link for a type that is not listed (metaobjects have no page)', () => {
    expect(sitemapLink('metaObjects', ORIGIN, 'brand/acme')).toBeNull();
    expect(isSitemapType('metaObjects')).toBe(false);
    expect(isSitemapType('constructor')).toBe(false);
    expect(SITEMAP_TYPES.every((type) => isSitemapType(type))).toBe(true);
  });

  it.each([
    ['1', 1],
    ['2', 2],
    ['100', 100],
    ['101', null],
    ['0', null],
    ['01', null],
    ['-1', null],
    ['1.5', null],
    ['1e2', null],
    ['', null],
    [undefined, null],
    ['9'.repeat(30), null],
  ])('reads the sitemap page %j as %j', (raw, expected) => {
    expect(parseSitemapPage(raw)).toBe(expected);
  });
});

describe('sitemap XML (REQ-SEO-001)', () => {
  it('escapes the five XML characters in every location', () => {
    expect(escapeXml(`a&b<c>d"e'f`)).toBe('a&amp;b&lt;c&gt;d&quot;e&apos;f');
    const xml = renderUrlset([
      {loc: `${ORIGIN}/a?x=1&y=<2>`, lastmod: '2026-01-01'},
    ]);
    expect(xml).toContain(
      '<loc>https://www.example.com/a?x=1&amp;y=&lt;2&gt;</loc>',
    );
    expect(xml).not.toContain('&y=');
  });

  it('renders a valid urlset and index', () => {
    const urlset = renderUrlset([
      {loc: `${ORIGIN}/`},
      {loc: `${ORIGIN}/products/x`, lastmod: '2026-10-01T10:00:00Z'},
    ]);
    expect(urlset.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(
      true,
    );
    expect(urlset).toContain(
      'xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"',
    );
    expect(urlset).toContain('<lastmod>2026-10-01T10:00:00Z</lastmod>');
    expect(urlset.match(/<url>/g)).toHaveLength(2);
    const index = renderSitemapIndex([`${ORIGIN}/sitemap/products/1.xml`]);
    expect(index).toContain('<sitemapindex');
    expect(index).toContain(
      '<loc>https://www.example.com/sitemap/products/1.xml</loc>',
    );
  });

  it('stops at the protocol limit of 50,000 URLs', () => {
    const many = Array.from({length: 50_005}, (_, n) => ({
      loc: `${ORIGIN}/p/${n}`,
    }));
    expect(renderUrlset(many).match(/<url>/g)).toHaveLength(50_000);
  });
});

describe('extra sitemap entries: brands and stores only when real (REQ-SEO-001, REQ-COL-005)', () => {
  const locs = (input: Parameters<typeof extraSitemapEntries>[0]) =>
    extraSitemapEntries(input).map((entry) => entry.loc);

  it('lists the home page and collection index, and nothing about brands or stores without real data', () => {
    expect(locs({origin: ORIGIN, brandPaths: [], storePaths: []})).toEqual([
      `${ORIGIN}/`,
      `${ORIGIN}/collections`,
    ]);
  });

  it('adds the brand index and every brand page once brands exist', () => {
    expect(
      locs({
        origin: ORIGIN,
        brandPaths: ['/brands/acme-sleep', '/brands/zen-rest'],
        storePaths: [],
      }),
    ).toEqual([
      `${ORIGIN}/`,
      `${ORIGIN}/collections`,
      `${ORIGIN}/brands`,
      `${ORIGIN}/brands/acme-sleep`,
      `${ORIGIN}/brands/zen-rest`,
    ]);
  });

  it('adds stores and drops duplicates', () => {
    const result = locs({
      origin: ORIGIN,
      brandPaths: [],
      storePaths: [
        '/stores',
        '/stores/new-york',
        '/stores/new-york',
        '/stores/new-york/buffalo',
      ],
    });
    expect(result).toEqual([
      `${ORIGIN}/`,
      `${ORIGIN}/collections`,
      `${ORIGIN}/stores`,
      `${ORIGIN}/stores/new-york`,
      `${ORIGIN}/stores/new-york/buffalo`,
    ]);
  });

  it('never lists a private, tool or relative path, whatever it is given', () => {
    const result = locs({
      origin: ORIGIN,
      brandPaths: ['/cart', 'brands/relative', '/account/orders', '/brands/ok'],
      storePaths: ['/search?q=x', '/compare'],
    });
    expect(result.join(' ')).not.toMatch(
      /cart|account|compare|search|relative/,
    );
    expect(result).toContain(`${ORIGIN}/brands/ok`);
  });
});
