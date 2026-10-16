import {describe, expect, it} from 'vitest';
import {
  MAX_SUGGESTIONS,
  buildSuggestionGroups,
  flattenOptions,
  moveActive,
  optionDomId,
  searchHref,
  suggestionAnnouncement,
  suggestionCount,
  type PredictiveItems,
} from '~/components/layout/searchCombobox';

// REQ-SRCH-001: the pure part of the header search combobox (option list, keyboard movement, announcement).

const EMPTY: PredictiveItems = {
  queries: [],
  products: [],
  collections: [],
  pages: [],
  articles: [],
};

const ITEMS: PredictiveItems = {
  queries: [{text: 'queen mattress', trackingParameters: '_pos=1&_ss=e'}],
  products: [
    {
      id: 'p1',
      title: 'Cloud Queen',
      handle: 'cloud-queen',
      trackingParameters: '_pos=1&_psq=queen&_ss=e&_v=1.0',
      selectedOrFirstAvailableVariant: {
        image: {url: 'https://cdn.shopify.com/a.jpg', width: 10, height: 10},
        price: {amount: '499.00', currencyCode: 'USD'},
      },
    },
    {
      id: 'p2',
      title: 'No variant',
      handle: 'no variant/../x',
      selectedOrFirstAvailableVariant: null,
    },
  ],
  collections: [{id: 'c1', title: 'Queen mattresses', handle: 'queen'}],
  pages: [{id: 'g1', title: 'Size guide', handle: 'size-guide'}],
  articles: [
    {id: 'a1', title: 'Sleep tips', handle: 'tips', blog: {handle: 'journal'}},
  ],
};

describe('buildSuggestionGroups', () => {
  it('orders groups queries, products, collections, pages, articles and ends with view all', () => {
    const groups = buildSuggestionGroups(ITEMS, 'queen');
    expect(groups.map((group) => group.id)).toEqual([
      'queries',
      'products',
      'collections',
      'pages',
      'articles',
      'all',
    ]);
    expect(groups.at(-1)?.heading).toBeNull();
  });

  it('numbers options continuously across groups so the DOM ids are unique', () => {
    const options = flattenOptions(buildSuggestionGroups(ITEMS, 'queen'));
    expect(options.map((option) => option.index)).toEqual([
      0, 1, 2, 3, 4, 5, 6,
    ]);
    expect(new Set(options.map((o) => optionDomId('x', o.index))).size).toBe(
      options.length,
    );
  });

  it('keeps only the view-all option when there are no suggestions', () => {
    const groups = buildSuggestionGroups(EMPTY, 'zzzz');
    expect(flattenOptions(groups)).toHaveLength(1);
    expect(flattenOptions(groups)[0]).toMatchObject({
      kind: 'all',
      href: '/search?q=zzzz',
    });
    expect(suggestionCount(groups)).toBe(0);
  });

  it('builds hrefs with encoded handles and a parsed copy of the tracking parameters', () => {
    const options = flattenOptions(buildSuggestionGroups(ITEMS, 'queen'));
    const product = options.find((o) => o.label === 'Cloud Queen');
    expect(product?.href).toBe(
      '/products/cloud-queen?q=queen&_pos=1&_psq=queen&_ss=e&_v=1.0',
    );
    const odd = options.find((o) => o.label === 'No variant');
    expect(odd?.href.startsWith('/products/no%20variant%2F..%2Fx?')).toBe(true);
    expect(options.find((o) => o.kind === 'article')?.href).toBe(
      '/blogs/journal/tips?q=queen',
    );
  });

  it('cannot be made to leave the page through the term or tracking parameters', () => {
    const hostile: PredictiveItems = {
      ...EMPTY,
      pages: [
        {
          id: 'g',
          title: 'X',
          handle: 'x',
          trackingParameters: 'q=evil&a=1#frag&b=2',
        },
      ],
    };
    const [page] = flattenOptions(
      buildSuggestionGroups(hostile, 'a&b=c#d?e'),
    ).filter((o) => o.kind === 'page');
    expect(page.href.startsWith('/pages/x?')).toBe(true);
    expect(page.href).not.toContain('#');
    // Only one q: the shopper's own term, encoded; the API's q is dropped.
    expect(page.href.match(/[?&]q=/g)).toHaveLength(1);
    expect(page.href).toContain('q=a%26b%3Dc%23d%3Fe');
  });

  it('carries the price and image of a product option and nothing for other kinds', () => {
    const options = flattenOptions(buildSuggestionGroups(ITEMS, 'queen'));
    expect(options.find((o) => o.label === 'Cloud Queen')).toMatchObject({
      price: {amount: '499.00', currencyCode: 'USD'},
      image: {url: 'https://cdn.shopify.com/a.jpg'},
    });
    expect(options.find((o) => o.kind === 'page')).toMatchObject({
      price: null,
      image: null,
    });
  });

  // A11Y-003: a long list made the panel a scroll area with nothing tabbable in it.
  it('lists at most MAX_SUGGESTIONS rows plus view all, products first, and keeps every kind represented', () => {
    const many = (prefix: string, n: number) =>
      Array.from({length: n}, (_, i) => ({
        id: `${prefix}${i}`,
        title: `${prefix} ${i}`,
        handle: `${prefix}-${i}`,
      }));
    const flood: PredictiveItems = {
      queries: Array.from({length: 5}, (_, i) => ({text: `query ${i}`})),
      products: many('product', 5),
      collections: many('collection', 5),
      pages: many('page', 5),
      articles: many('article', 5).map((a) => ({...a, blog: {handle: 'j'}})),
    };
    const groups = buildSuggestionGroups(flood, 'q');
    const options = flattenOptions(groups);
    expect(suggestionCount(groups)).toBe(MAX_SUGGESTIONS);
    expect(options).toHaveLength(MAX_SUGGESTIONS + 1);
    expect(options.at(-1)?.kind).toBe('all');
    expect(groups.map((g) => g.id)).toEqual([
      'queries',
      'products',
      'collections',
      'pages',
      'articles',
      'all',
    ]);
    expect(options.map((o) => o.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    // Products come first in the share-out, so they never get fewer rows than another kind.
    const rows = (id: string) =>
      groups.find((g) => g.id === id)?.options.length ?? 0;
    expect(rows('products')).toBeGreaterThanOrEqual(rows('queries'));
  });

  it('gives unused rows to the kinds that have more, and never drops below what exists', () => {
    const only: PredictiveItems = {
      ...EMPTY,
      products: Array.from({length: 12}, (_, i) => ({
        id: `p${i}`,
        title: `Product ${i}`,
        handle: `p-${i}`,
      })),
      pages: [{id: 'g', title: 'Guide', handle: 'guide'}],
    };
    const groups = buildSuggestionGroups(only, 'p');
    expect(groups.find((g) => g.id === 'products')?.options).toHaveLength(7);
    expect(groups.find((g) => g.id === 'pages')?.options).toHaveLength(1);
    expect(suggestionCount(groups)).toBe(MAX_SUGGESTIONS);
  });

  it('skips blank query suggestions', () => {
    const groups = buildSuggestionGroups(
      {...EMPTY, queries: [{text: '  '}]},
      'ab',
    );
    expect(groups.map((g) => g.id)).toEqual(['all']);
  });
});

describe('searchHref', () => {
  it('encodes the term and bounds its length', () => {
    expect(searchHref('queen & firm')).toBe('/search?q=queen+%26+firm');
    expect(
      new URL(searchHref('x'.repeat(500)), 'http://a').search,
    ).toHaveLength('?q='.length + 100);
  });
});

describe('moveActive (arrow, Home and End keys)', () => {
  it.each([
    // current, count, key, expected
    [-1, 3, 'ArrowDown', 0],
    [0, 3, 'ArrowDown', 1],
    [2, 3, 'ArrowDown', 0], // wraps to the first
    [-1, 3, 'ArrowUp', 2], // from the text field to the last option
    [0, 3, 'ArrowUp', 2], // wraps to the last
    [2, 3, 'ArrowUp', 1],
    [-1, 0, 'ArrowDown', -1], // nothing to move to
    [5, 0, 'ArrowUp', -1],
    [2, 5, 'Home', 0],
    [0, 5, 'Home', 0],
    [1, 5, 'End', 4],
    [4, 5, 'End', 4],
    [3, 0, 'Home', -1], // nothing to jump to
    [3, 0, 'End', -1],
  ] as const)('%i of %i with %s -> %i', (current, count, key, expected) => {
    expect(moveActive(current, count, key)).toBe(expected);
  });
});

describe('suggestionAnnouncement', () => {
  it('is silent while loading, so the old count is not read for a new term', () => {
    expect(suggestionAnnouncement({count: 4, loading: true})).toBe('');
  });
  it('says how many suggestions there are, singular and plural', () => {
    expect(suggestionAnnouncement({count: 1, loading: false})).toMatch(
      /^1 suggestion available/,
    );
    expect(suggestionAnnouncement({count: 5, loading: false})).toMatch(
      /^5 suggestions available/,
    );
  });
  it('tells the shopper what to do when there are none', () => {
    expect(suggestionAnnouncement({count: 0, loading: false})).toBe(
      'No suggestions. Press Enter to search.',
    );
  });
});
