import {afterEach, describe, expect, it, vi} from 'vitest';
import {fakeStorefront} from './fake-storefront';
import {
  PROMO_TILES_QUERY,
  PROMO_TILE_READ_CAP,
  loadPromoTiles,
  mapPromoTiles,
} from '~/lib/shopify/promo-data';
import {emptyFilterState, withSort} from '~/lib/filters';
import {
  placePromoTiles,
  showsPromoTiles,
  type PromoTileView,
} from '~/lib/shopify/promo-placement';

// REQ-COL-003 / P3B-05: promotional tiles in the collection grid.

type Nodes = Parameters<typeof mapPromoTiles>[0];

function tile(
  id: string,
  collection: string | null,
  fields: Record<string, string> = {},
): NonNullable<Nodes>[number] {
  const all: Record<string, string> = {
    heading: `Tile ${id}`,
    position: '3',
    enabled: 'true',
    ...fields,
  };
  return {
    id,
    fields: [
      ...Object.entries(all).map(([key, value]) => ({
        key,
        value,
        reference: null,
      })),
      {
        key: 'collection',
        value: 'gid://shopify/Collection/1',
        reference: collection === null ? null : {handle: collection},
      },
    ],
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('mapPromoTiles', () => {
  it('keeps the enabled tiles of this collection only', () => {
    const tiles = mapPromoTiles(
      [
        tile('a', 'mattresses'),
        tile('b', 'pillows'),
        tile('c', 'mattresses', {enabled: 'false'}),
        tile('d', null),
      ],
      'mattresses',
    );
    expect(tiles.map((t) => t.id)).toEqual(['a']);
  });

  it('needs a heading and a whole position of at least 1', () => {
    const tiles = mapPromoTiles(
      [
        tile('a', 'm', {heading: ' '}),
        tile('b', 'm', {position: '0'}),
        tile('c', 'm', {position: '2.5'}),
        tile('d', 'm', {position: '-1'}),
        tile('e', 'm', {position: '1000'}),
        tile('f', 'm', {position: 'x'}),
        tile('g', 'm', {position: '4'}),
      ],
      'm',
    );
    expect(tiles.map((t) => t.id)).toEqual(['g']);
  });

  it('validates the link and the image', () => {
    const [shown] = mapPromoTiles(
      [tile('a', 'm', {link: 'javascript:alert(1)'})],
      'm',
    );
    expect(shown.link).toBeNull();
    const [good] = mapPromoTiles(
      [tile('b', 'm', {link: '/pages/finder'})],
      'm',
    );
    expect(good.link).toEqual({href: '/pages/finder', external: false});
  });

  // CR31-13: the optional tone field; only a known tone is ever used, the rest is red.
  it.each([
    ['dark', 'dark'],
    [' Light ', 'light'],
    ['red', 'red'],
    ['', 'red'],
    ['purple', 'red'],
    ['red" onclick="x', 'red'],
    ['<script>', 'red'],
  ])('reads the tone %j as %s', (raw, expected) => {
    const [shown] = mapPromoTiles([tile('a', 'm', {tone: raw})], 'm');
    expect(shown.tone).toBe(expected);
  });

  it('defaults to red when the tone field is missing', () => {
    const [shown] = mapPromoTiles([tile('a', 'm')], 'm');
    expect(shown.tone).toBe('red');
  });

  it('omits everything when there are no tiles (the grid is products only)', () => {
    expect(mapPromoTiles([], 'm')).toEqual([]);
    expect(mapPromoTiles(null, 'm')).toEqual([]);
  });
});

describe('loadPromoTiles', () => {
  it('uses the long cache and filters in memory', async () => {
    const {storefront, calls} = fakeStorefront(() => ({
      tiles: {nodes: [tile('a', 'm'), tile('b', 'other')]},
    }));
    const tiles = await loadPromoTiles(storefront, 'm');
    expect(calls[0].query).toBe(PROMO_TILES_QUERY);
    expect(calls[0].cache).toEqual({mode: 'long'});
    expect(tiles.map((t) => t.id)).toEqual(['a']);
  });

  it('logs the count, never the content, when the read cap is reached', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const nodes = Array.from({length: PROMO_TILE_READ_CAP}, (_, n) =>
      tile(`t${n}`, 'm', {heading: 'Secret heading'}),
    );
    const {storefront} = fakeStorefront(() => ({tiles: {nodes}}));
    await loadPromoTiles(storefront, 'm');
    expect(error).toHaveBeenCalledTimes(1);
    const message = String(error.mock.calls[0][0]);
    expect(message).toContain(String(PROMO_TILE_READ_CAP));
    expect(message).not.toContain('Secret heading');

    error.mockClear();
    const few = fakeStorefront(() => ({tiles: {nodes: nodes.slice(0, 3)}}));
    await loadPromoTiles(few.storefront, 'm');
    expect(error).not.toHaveBeenCalled();
  });

  it('returns no tiles when the read fails', async () => {
    const {storefront} = fakeStorefront(() => {
      throw new Error('down');
    });
    expect(await loadPromoTiles(storefront, 'm')).toEqual([]);
  });
});

function view(id: string, position: number): PromoTileView {
  return {id, heading: id, tone: 'red', image: null, link: null, position};
}

const labels = (items: ReturnType<typeof placePromoTiles<string>>) =>
  items.map((item) =>
    item.kind === 'tile' ? `[${item.tile.id}]` : item.product,
  );

describe('placePromoTiles', () => {
  const products = ['p1', 'p2', 'p3', 'p4', 'p5'];

  it('puts a tile in the Nth cell, counting products and tiles together', () => {
    expect(labels(placePromoTiles(products, [view('t', 3)], false))).toEqual([
      'p1',
      'p2',
      '[t]',
      'p3',
      'p4',
      'p5',
    ]);
    expect(labels(placePromoTiles(products, [view('t', 1)], false))[0]).toBe(
      '[t]',
    );
  });

  it('never leaves a lone tile after the last product when there are no more pages', () => {
    // Position n+1 with nothing following would be a trailing, orphaned cell.
    expect(labels(placePromoTiles(products, [view('t', 6)], false))).toEqual(
      products,
    );
    expect(labels(placePromoTiles(products, [view('t', 7)], false))).toEqual(
      products,
    );
  });

  it('shows a tile at position n+1 only while another page follows', () => {
    expect(labels(placePromoTiles(products, [view('t', 6)], true)).at(-1)).toBe(
      '[t]',
    );
    // Still no gap: two cells past the end is never placed.
    expect(labels(placePromoTiles(products, [view('t', 7)], true))).toEqual(
      products,
    );
  });

  it('counts an earlier tile when deciding what is trailing', () => {
    // After t1 takes cell 3 the list has 6 cells, so position 7 is the trailing cell.
    const tiles = [view('t1', 3), view('t2', 7)];
    expect(labels(placePromoTiles(products, tiles, false))).toEqual([
      'p1',
      'p2',
      '[t1]',
      'p3',
      'p4',
      'p5',
    ]);
    expect(labels(placePromoTiles(products, tiles, true)).at(-1)).toBe('[t2]');
  });

  it('holds a tile back until Load more brings enough products, without moving earlier cells', () => {
    const tile = view('t', 8);
    expect(labels(placePromoTiles(products, [tile], true))).toEqual(products);
    const more = [...products, 'p6', 'p7', 'p8'];
    // With 8 products the 8th cell is inside the grid, so it is placed whether or not more pages follow.
    const placed = labels(placePromoTiles(more, [tile], false));
    expect(placed.indexOf('[t]')).toBe(7);
    expect(placed.slice(0, 5)).toEqual(products);
    const placedMore = labels(placePromoTiles(more, [tile], true));
    expect(placedMore.indexOf('[t]')).toBe(7);
    expect(placedMore.slice(0, 5)).toEqual(products);
  });

  it('gives tiles at the same position consecutive cells in the order received', () => {
    expect(
      labels(placePromoTiles(products, [view('a', 2), view('b', 2)], false)),
    ).toEqual(['p1', '[a]', '[b]', 'p2', 'p3', 'p4', 'p5']);
  });

  it('orders tiles by position whatever order they arrive in', () => {
    expect(
      labels(
        placePromoTiles(products, [view('late', 5), view('early', 2)], false),
      ),
    ).toEqual(['p1', '[early]', 'p2', 'p3', '[late]', 'p4', 'p5']);
  });

  it('places nothing without products unless more pages follow', () => {
    expect(placePromoTiles([], [], false)).toEqual([]);
    expect(labels(placePromoTiles([], [view('t', 1)], false))).toEqual([]);
    expect(labels(placePromoTiles([], [view('t', 1)], true))).toEqual(['[t]']);
  });

  it('numbers product cells without counting tiles (used for Load more focus)', () => {
    const items = placePromoTiles(products, [view('t', 1)], false);
    const indices = items.flatMap((i) =>
      i.kind === 'product' ? [i.productIndex] : [],
    );
    expect(indices).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('showsPromoTiles (positions only mean something in the default view)', () => {
  const base = emptyFilterState();

  it('is true for the unfiltered, default-sorted first view', () => {
    expect(showsPromoTiles(base)).toBe(true);
  });

  it.each([
    [
      'an active filter',
      {...base, selected: {...base.selected, size: ['Queen']}},
    ],
    ['a price range', {...base, priceMinCents: 10000}],
    ['another sort', withSort(base, 'price-asc')],
    ['a cursor (deep link past the first page)', {...base, cursor: 'abc'}],
  ])('is false with %s', (_label, state) => {
    expect(showsPromoTiles(state)).toBe(false);
  });
});
