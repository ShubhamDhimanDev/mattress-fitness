// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import {useState} from 'react';
import {createMemoryRouter, RouterProvider} from 'react-router';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {AnalyticsBridge} from '~/components/consent/AnalyticsBridge';
import {ProductListing} from '~/components/collection/ProductListing';
import {FeaturedProducts} from '~/components/home/CatalogSections';
import {ProductItem} from '~/components/ProductItem';
import {setTrackSink, type AnalyticsEvent} from '~/lib/analytics';
import {
  SELECT_ITEM_ATTRIBUTE,
  mapSelectItem,
  selectItemValue,
} from '~/lib/analytics/hydrogen-events';
import {cardSelectItemAttributes} from '~/lib/listing-analytics';
import {listIdForPath} from '~/lib/listing-path';
import {buildItemListEvents, reportListing} from '~/lib/listing-events';
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
  ])('%s -> %s', (path, expected) => {
    expect(listIdForPath(path)).toBe(expected);
  });
});

describe('cardSelectItemAttributes', () => {
  it('is one short attribute: product gid, price in cents, zero-based position, list', () => {
    expect(cardSelectItemAttributes(product(1), 3, 'search')).toEqual({
      [SELECT_ITEM_ATTRIBUTE]: 'gid://shopify/Product/1001|199999|3|search',
    });
    expect(SELECT_ITEM_ATTRIBUTE).toBe('data-si');
  });

  it('has an empty list part when the card has no list', () => {
    expect(cardSelectItemAttributes(product(1), 0, undefined)).toEqual({
      [SELECT_ITEM_ATTRIBUTE]: 'gid://shopify/Product/1001|199999|0|',
    });
  });

  // The card writes the value itself (it must not pull the analytics module into every route), so this pins it to
  // what the click mapper reads: the card and the analytics module give the same event for the same product.
  it('is read back by the click mapper into the same event as the analytics module value gives', () => {
    const fromCard = cardSelectItemAttributes(product(2), 0, 'all');
    const fromModule = selectItemValue({
      productId: 'gid://shopify/Product/1002',
      priceCents: 199999,
      listId: 'all',
      index: 0,
    });
    expect(fromCard[SELECT_ITEM_ATTRIBUTE]).toBe(fromModule);
    const event = mapSelectItem(fromModule, 'Mattress 2');
    expect(event).not.toBeNull();
    expect(event?.ecommerce?.items[0]).toMatchObject({
      id: '1002',
      name: 'Mattress 2',
      priceCents: 199999,
      index: 0,
    });
  });

  it('gives nothing for a sold-out card (no price), a foreign currency or no position', () => {
    expect(
      cardSelectItemAttributes(
        product(1, {price: null, soldOut: true}),
        0,
        'search',
      ),
    ).toEqual({});
    expect(
      cardSelectItemAttributes(
        product(1, {price: {amount: '10.00', currencyCode: 'EUR'}}),
        0,
        'search',
      ),
    ).toEqual({});
    expect(cardSelectItemAttributes(product(1), undefined, 'search')).toEqual(
      {},
    );
  });

  // The card does not check what it writes; the click mapper does, and drops or ignores what is wrong.
  const clicked = (
    overrides: Partial<ProductCardView>,
    position: number,
    listId?: string,
  ) => {
    const attributes = cardSelectItemAttributes(
      product(1, overrides),
      position,
      listId,
    );
    return mapSelectItem(
      attributes[SELECT_ITEM_ATTRIBUTE] ?? null,
      'Mattress 1',
    );
  };

  it('a malformed product id gives no event on click', () => {
    expect(clicked({id: 'not-a-gid'}, 0)).toBeNull();
  });

  it('a hostile list id is left out of the event on click, the item is kept', () => {
    const event = clicked({}, 0, '<script>');
    expect(event?.ecommerce?.listId).toBeUndefined();
    expect(event?.ecommerce?.items[0]?.id).toBe('1001');
  });

  it('a hostile position is left out of the event on click, the item is kept', () => {
    const event = clicked({}, -1, 'search');
    expect(event?.ecommerce?.items[0]?.index).toBeUndefined();
    expect(event?.ecommerce?.listId).toBe('search');
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

describe('reportListing', () => {
  it.each([['Bad%20Handle'], ['<script>'], ['a'.repeat(101)], ['UPPER']])(
    'sends a hostile or malformed list id (%s) without a list',
    (listId) => {
      reportListing({current: null}, 'k', [product(1)], listId);
      expect(named('view_item_list')).toHaveLength(1);
      expect(named('view_item_list')[0]?.ecommerce?.listId).toBeUndefined();
      expect(named('view_item_list')[0]?.ecommerce?.listName).toBeUndefined();
    },
  );

  it('counts a product once: a repeated call, a new key and a longer list', () => {
    const reported = {current: null};
    const three = [product(1), product(2), product(3)];
    reportListing(reported, 'a', three, 'search');
    reportListing(reported, 'a', three, 'search');
    expect(named('view_item_list')).toHaveLength(1);
    reportListing(reported, 'a', [...three, product(4)], 'search');
    expect(named('view_item_list')[1]?.ecommerce?.items).toEqual([
      expect.objectContaining({id: '1004', index: 3}),
    ]);
    reportListing(reported, 'b', three, 'search');
    expect(named('view_item_list')).toHaveLength(3);
    expect(named('view_item_list')[2]?.ecommerce?.items[0]?.index).toBe(0);
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

// What the consent chunk hands the bridge; none of it matters to these tests.
const BRIDGE_PROPS = {
  takeEarlyViews: () => [],
  resetEarlyViews: () => {},
  setNavigationTarget: () => {},
};

describe('select_item on a card click (fake runtime)', () => {
  it('fires the mapped event once, with price, list and position (no brand), for a click on the title link', () => {
    renderRoutes(
      <>
        <AnalyticsBridge {...BRIDGE_PROPS} />
        <ProductItem product={product(7)} index={5} listId="firm-mattresses" />
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
      <ProductItem key="a" product={product(1)} index={0} listId="search" />,
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
        index={2}
        listId="search"
      />,
      {name: 'Mattress 3'},
    ],
  ])('does not fire for %s', (_label, card, link) => {
    renderRoutes(
      <>
        <AnalyticsBridge {...BRIDGE_PROPS} />
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
        <AnalyticsBridge {...BRIDGE_PROPS} />
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
  // The event is built by a module fetched with import() in the effect, so it arrives a tick after render.
  it('reports the visible products once, then only the products a "Load more" adds, numbered on', async () => {
    renderRoutes(<Listing initial={3} />, '/search?q=linen', '/search');
    await waitFor(() => expect(named('view_item_list')).toHaveLength(1));
    expect(
      named('view_item_list')[0]?.ecommerce?.items.map((item) => item.index),
    ).toEqual([0, 1, 2]);
    expect(named('view_item_list')[0]?.ecommerce?.listId).toBe('search');

    fireEvent.click(screen.getByRole('button', {name: 'grow'}));
    await waitFor(() => expect(named('view_item_list')).toHaveLength(2));
    expect(
      named('view_item_list')[1]?.ecommerce?.items.map((item) => item.index),
    ).toEqual([3, 4]);
  });

  it.each([
    ['/collections/all', '/collections/:handle', 'all'],
    ['/brands/acme', '/brands/:handle', 'brand-acme'],
  ])('reports on %s with list %s', async (url, path, listId) => {
    renderRoutes(<Listing initial={2} />, url, path);
    await waitFor(() => expect(named('view_item_list')).toHaveLength(1));
    expect(named('view_item_list')[0]?.ecommerce?.listId).toBe(listId);
  });

  it("reports the items on a collection page too, exactly once (Hydrogen's collection view no longer sends an empty list)", async () => {
    renderRoutes(
      <Listing initial={2} />,
      '/collections/mattresses',
      '/collections/:handle',
    );
    await waitFor(() => expect(named('view_item_list')).toHaveLength(1));
    // Give any second (duplicate) send the chance to arrive before asserting there is none.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(named('view_item_list')).toHaveLength(1);
    expect(named('view_item_list')[0]?.ecommerce?.listId).toBe('mattresses');
    expect(named('view_item_list')[0]?.ecommerce?.items).toHaveLength(2);
  });

  it('puts the select_item value on every card link in the listing, with its position and list', () => {
    renderRoutes(<Listing initial={3} />, '/search?q=linen', '/search');
    const marked = document.querySelectorAll(`a[${SELECT_ITEM_ATTRIBUTE}]`);
    expect(
      [...marked].map((a) =>
        a.getAttribute(SELECT_ITEM_ATTRIBUTE)?.split('|').slice(2).join('|'),
      ),
    ).toEqual(['0|search', '1|search', '2|search']);
  });
});
