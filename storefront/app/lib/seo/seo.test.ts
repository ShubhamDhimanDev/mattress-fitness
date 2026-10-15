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
    '/policies/refund-policy',
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

  it.each([
    '/cart',
    '/account',
    '/checkout-steps',
    '/delivery',
    '/api',
    '/webhooks',
    '/discount',
    '/search',
    '/quiz?',
  ])('blocks %s for every crawler group', (path) => {
    const groups = text
      .split('\n\n')
      .filter(
        (g) =>
          g.startsWith('User-agent') && !g.split('\n').includes('Disallow: /'),
      );
    expect(groups.length).toBeGreaterThan(3);
    for (const group of groups) {
      expect(group.split('\n')).toContain(`Disallow: ${path}`);
    }
  });

  it('blocks every filter and sort parameter of the codec, in any position of the query string', () => {
    for (const param of MANAGED_FILTER_PARAMS) {
      expect(lines).toContain(`Disallow: /*?*${param}=`);
    }
    expect(MANAGED_FILTER_PARAMS).toEqual(
      expect.arrayContaining(['size', 'sort', 'cursor', 'price_min']),
    );
  });

  it('never blocks the pages and the sitemap that should be crawled', () => {
    const disallowed = lines
      .filter((line) => line.startsWith('Disallow: '))
      .map((line) => line.slice('Disallow: '.length));
    for (const open of [
      '/',
      '/collections/mattresses',
      '/products/queen-hybrid',
      '/brands/acme',
      '/stores/new-york',
      '/pages/about',
      '/blogs/news/sleep-tips',
      '/sitemap.xml',
      '/quiz',
    ]) {
      const blocked = disallowed.some(
        (rule) => !rule.includes('*') && rule !== '/' && open.startsWith(rule),
      );
      expect(blocked, open).toBe(false);
    }
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
