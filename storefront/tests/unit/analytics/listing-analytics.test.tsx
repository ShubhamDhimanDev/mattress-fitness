// @vitest-environment jsdom
import {cleanup, fireEvent, render, screen} from '@testing-library/react';
import {useState} from 'react';
import {createMemoryRouter, RouterProvider} from 'react-router';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {AnalyticsBridge} from '~/components/consent/AnalyticsBridge';
import {ProductListing} from '~/components/collection/ProductListing';
import {FeaturedProducts} from '~/components/home/CatalogSections';
import {ProductItem} from '~/components/ProductItem';
import {setTrackSink, type AnalyticsEvent} from '~/lib/analytics';
import {SELECT_ITEM_ATTRIBUTE} from '~/lib/analytics/hydrogen-events';
import {
  buildItemListEvents,
  cardSelectItemAttributes,
  listIdForPath,
  listingReportsItems,
} from '~/lib/listing-analytics';
import {SEARCH_SORT_KEYS} from '~/lib/filters';
import type {ProductCardView} from '~/lib/shopify/types';

// The bridge reads Hydrogen's analytics context, which needs a real shop. The click listener under test does not,
// so the hook is replaced by an inert one and everything else in the package stays real.
vi.mock('@shopify/hydrogen', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shopify/hydrogen')>()),
  useAnalytics: () => ({subscribe: () => {}, cart: null}),
}));

// REQ-ANL-001: product cards report select_item on a click and listings report view_item_list with their items,
// from data the page already holds. Fake runtime = the `track()` sink, which is what the consent-aware runtime is.

function product(
  n: number,
  overrides: Partial<ProductCardView> = {},
): ProductCardView {
  return {
    id: `gid://shopify/Product/${1000 + n}`,
    handle: `mattress-${n}`,
    title: `Mattress ${n}`,
    vendor: 'Acme Sleep',
    image: null,
    price: {amount: '1999.99', currencyCode: 'USD'},
    compareAt: null,
    priceIsFrom: false,
    soldOut: false,
    sizes: [],
    comfortLevel: null,
    mattressType: null,
    benefits: [],
    productLine: null,
    rating: null,
    ...overrides,
  };
}

let events: AnalyticsEvent[];
beforeEach(() => {
  events = [];
  setTrackSink((event) => {
    events.push(event);
  });
});
afterEach(() => {
  cleanup();
  setTrackSink(null);
});

const named = (name: AnalyticsEvent['name']) =>
  events.filter((event) => event.name === name);

describe('listIdForPath', () => {
  it.each([
    ['/search', 'search'],
    ['/collections/all', 'all'],
    ['/collections/firm-mattresses', 'firm-mattresses'],
    ['/brands/acme', 'brand-acme'],
    ['/', undefined],
    ['/products/x', undefined],
    ['/collections', undefined],
    ['/collections/a/b', undefined],
    // A hostile or encoded handle is not an id we send.
    ['/collections/Bad%20Handle', undefined],
    ['/collections/<script>', undefined],
    [`/collections/${'a'.repeat(101)}`, undefined],
  ])('%s -> %s', (path, expected) => {
    expect(listIdForPath(path)).toBe(expected);
  });
});

describe('listingReportsItems', () => {
  it('is quiet on a collection page only while Hydrogen mapper already sends an empty view_item_list there', () => {
    // Today the mapper sends one (empty), so ours would double it; this fails on purpose the day the mapper stops,
    // so the expectation is revisited together with the docs.
    expect(listingReportsItems('/collections/mattresses')).toBe(false);
    expect(listingReportsItems('/collections/all')).toBe(true);
    expect(listingReportsItems('/search')).toBe(true);
    expect(listingReportsItems('/brands/acme')).toBe(true);
  });
});

describe('cardSelectItemAttributes', () => {
  it('carries the numeric id, title, price in cents, brand, list and zero-based position', () => {
    expect(
      cardSelectItemAttributes(product(1), {listId: 'search', position: 3}),
    ).toEqual({
      [SELECT_ITEM_ATTRIBUTE]: '',
      'data-analytics-id': '1001',
      'data-analytics-name': 'Mattress 1',
      'data-analytics-price-cents': '199999',
      'data-analytics-brand': 'Acme Sleep',
      'data-analytics-list': 'search',
      'data-analytics-index': '3',
    });
  });

  it('gives nothing for a sold-out card (no price), a foreign currency or a malformed id', () => {
    expect(
      cardSelectItemAttributes(product(1, {price: null, soldOut: true}), {
        position: 0,
      }),
    ).toEqual({});
    expect(
      cardSelectItemAttributes(
        product(1, {price: {amount: '10.00', currencyCode: 'EUR'}}),
        {position: 0},
      ),
    ).toEqual({});
    expect(
      cardSelectItemAttributes(product(1, {id: 'not-a-gid'}), {position: 0}),
    ).toEqual({});
  });
});

describe('buildItemListEvents', () => {
  it('lists id, name, brand, price in cents and the position, with the list name', () => {
    const [event, ...rest] = buildItemListEvents(
      [product(1), product(2)],
      'search',
      0,
    );
    expect(rest).toEqual([]);
    expect(event).toEqual({
      name: 'view_item_list',
      params: {},
      ecommerce: {
        items: [
          {
            id: '1001',
            name: 'Mattress 1',
            brand: 'Acme Sleep',
            priceCents: 199999,
            quantity: 1,
            index: 0,
          },
          {
            id: '1002',
            name: 'Mattress 2',
            brand: 'Acme Sleep',
            priceCents: 199999,
            quantity: 1,
            index: 1,
          },
        ],
        listId: 'search',
        listName: 'search',
      },
    });
  });

  it('keeps positions for skipped cards, continues numbering and omits the list when there is none', () => {
    const [event] = buildItemListEvents(
      [product(1, {price: null, soldOut: true}), product(2)],
      undefined,
      24,
    );
    expect(event?.ecommerce).toEqual({
      items: [expect.objectContaining({id: '1002', index: 25})],
    });
  });

  it('sends nothing when no card is usable, and splits more than 50 items into several events', () => {
    expect(
      buildItemListEvents([product(1, {price: null})], 'search', 0),
    ).toEqual([]);
    const many = Array.from({length: 120}, (_, i) => product(i));
    const batches = buildItemListEvents(many, 'all', 0);
    expect(batches.map((b) => b.ecommerce?.items.length)).toEqual([50, 50, 20]);
    expect(batches[2]?.ecommerce?.items[0]?.index).toBe(100);
  });
});

function renderRoutes(element: React.ReactNode, url: string, path: string) {
  const router = createMemoryRouter(
    [
      {path, element},
      {path: '/products/:handle', element: <p>product page</p>},
      {path: '/compare', element: <p>compare page</p>},
    ],
    {initialEntries: [url]},
  );
  return render(<RouterProvider router={router} />);
}

describe('select_item on a card click (fake runtime)', () => {
  it('fires the mapped event once, with price, brand, list and position, for a click on the title link', () => {
    renderRoutes(
      <>
        <AnalyticsBridge />
        <ProductItem
          product={product(7)}
          analytics={{listId: 'firm-mattresses', position: 5}}
        />
      </>,
      '/collections/firm-mattresses',
      '/collections/:handle',
    );
    fireEvent.click(screen.getByRole('link', {name: 'Mattress 7'}));
    expect(named('select_item')).toEqual([
      {
        name: 'select_item',
        params: {},
        ecommerce: {
          items: [
            {
              id: '1007',
              name: 'Mattress 7',
              brand: 'Acme Sleep',
              priceCents: 199999,
              quantity: 1,
              index: 5,
            },
          ],
          listId: 'firm-mattresses',
          listName: 'firm-mattresses',
        },
      },
    ]);
  });

  // One render per case: a click on a product link navigates away and unmounts the page.
  it.each([
    [
      'the compare control inside the same card',
      <ProductItem
        key="a"
        product={product(1)}
        analytics={{listId: 'search', position: 0}}
      />,
      {name: 'Add Mattress 1 to comparison'},
    ],
    [
      'a card given no analytics',
      <ProductItem key="b" product={product(2)} />,
      {name: 'Mattress 2'},
    ],
    [
      'a sold-out card (no price to report)',
      <ProductItem
        key="c"
        product={product(3, {price: null, soldOut: true})}
        analytics={{listId: 'search', position: 2}}
      />,
      {name: 'Mattress 3'},
    ],
  ])('does not fire for %s', (_label, card, link) => {
    renderRoutes(
      <>
        <AnalyticsBridge />
        {card}
      </>,
      '/search',
      '/search',
    );
    fireEvent.click(screen.getByRole('link', link));
    expect(named('select_item')).toEqual([]);
  });

  it('home featured cards carry the featured collection handle as the list and their position', () => {
    renderRoutes(
      <>
        <AnalyticsBridge />
        <FeaturedProducts
          id="featured"
          heading={null}
          featured={{
            title: 'Best sellers',
            handle: 'best-sellers',
            products: [product(1), product(2)],
          }}
        />
      </>,
      '/',
      '/',
    );
    fireEvent.click(screen.getByRole('link', {name: 'Mattress 2'}));
    const [event] = named('select_item');
    expect(event?.ecommerce?.listId).toBe('best-sellers');
    expect(event?.ecommerce?.items[0]).toMatchObject({id: '1002', index: 1});
  });
});

function Listing({initial}: {initial: number}) {
  const [count, setCount] = useState(initial);
  return (
    <>
      <button type="button" onClick={() => setCount((c) => c + 2)}>
        grow
      </button>
      <ProductListing
        products={Array.from({length: count}, (_, i) => product(i))}
        pageInfo={{hasNextPage: false, endCursor: null}}
        filterGroups={[]}
        showFilters={false}
        sortKeys={SEARCH_SORT_KEYS}
        emptyHeading="Nothing"
      />
    </>
  );
}

describe('view_item_list from a listing (fake runtime)', () => {
  it('reports the visible products once, then only the products a "Load more" adds, numbered on', () => {
    renderRoutes(<Listing initial={3} />, '/search?q=linen', '/search');
    expect(named('view_item_list')).toHaveLength(1);
    expect(
      named('view_item_list')[0]?.ecommerce?.items.map((item) => item.index),
    ).toEqual([0, 1, 2]);
    expect(named('view_item_list')[0]?.ecommerce?.listId).toBe('search');

    fireEvent.click(screen.getByRole('button', {name: 'grow'}));
    expect(named('view_item_list')).toHaveLength(2);
    expect(
      named('view_item_list')[1]?.ecommerce?.items.map((item) => item.index),
    ).toEqual([3, 4]);
  });

  it.each([
    ['/collections/all', '/collections/:handle', 'all'],
    ['/brands/acme', '/brands/:handle', 'brand-acme'],
  ])('reports on %s with list %s', (url, path, listId) => {
    renderRoutes(<Listing initial={2} />, url, path);
    expect(named('view_item_list')).toHaveLength(1);
    expect(named('view_item_list')[0]?.ecommerce?.listId).toBe(listId);
  });

  it('stays silent on a collection page, where Hydrogen view already sends the list, so it is never counted twice', () => {
    renderRoutes(
      <Listing initial={2} />,
      '/collections/mattresses',
      '/collections/:handle',
    );
    expect(named('view_item_list')).toEqual([]);
  });

  it('puts the select_item attributes on every card link in the listing, with its position', () => {
    renderRoutes(<Listing initial={3} />, '/search?q=linen', '/search');
    const marked = document.querySelectorAll(`a[${SELECT_ITEM_ATTRIBUTE}]`);
    expect(
      [...marked].map((a) => a.getAttribute('data-analytics-index')),
    ).toEqual(['0', '1', '2']);
    expect(marked[0]?.getAttribute('data-analytics-list')).toBe('search');
  });
});
