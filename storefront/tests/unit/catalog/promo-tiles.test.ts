import {describe, expect, it} from 'vitest';
import {fakeStorefront} from './fake-storefront';
import {
  PROMO_TILES_QUERY,
  loadPromoTiles,
  mapPromoTiles,
} from '~/lib/shopify/promo-data';
import {
  placePromoTiles,
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

  it('returns no tiles when the read fails', async () => {
    const {storefront} = fakeStorefront(() => {
      throw new Error('down');
    });
    expect(await loadPromoTiles(storefront, 'm')).toEqual([]);
  });
});

function view(id: string, position: number): PromoTileView {
  return {id, heading: id, image: null, link: null, position};
}

const labels = (items: ReturnType<typeof placePromoTiles<string>>) =>
  items.map((item) =>
    item.kind === 'tile' ? `[${item.tile.id}]` : item.product,
  );

describe('placePromoTiles', () => {
  const products = ['p1', 'p2', 'p3', 'p4', 'p5'];

  it('puts a tile in the Nth cell, counting products and tiles together', () => {
    expect(labels(placePromoTiles(products, [view('t', 3)]))).toEqual([
      'p1',
      'p2',
      '[t]',
      'p3',
      'p4',
      'p5',
    ]);
    expect(labels(placePromoTiles(products, [view('t', 1)]))[0]).toBe('[t]');
  });

  it('allows a tile right after the last product but never leaves a gap', () => {
    expect(labels(placePromoTiles(products, [view('t', 6)])).at(-1)).toBe(
      '[t]',
    );
    expect(labels(placePromoTiles(products, [view('t', 7)]))).toEqual(products);
  });

  it('holds a tile back until Load more brings enough products, without moving earlier cells', () => {
    const tile = view('t', 8);
    expect(labels(placePromoTiles(products, [tile]))).toEqual(products);
    const more = [...products, 'p6', 'p7', 'p8'];
    const placed = labels(placePromoTiles(more, [tile]));
    expect(placed.indexOf('[t]')).toBe(7);
    expect(placed.slice(0, 5)).toEqual(products);
  });

  it('gives tiles at the same position consecutive cells in the order received', () => {
    expect(
      labels(placePromoTiles(products, [view('a', 2), view('b', 2)])),
    ).toEqual(['p1', '[a]', '[b]', 'p2', 'p3', 'p4', 'p5']);
  });

  it('orders tiles by position whatever order they arrive in', () => {
    expect(
      labels(placePromoTiles(products, [view('late', 5), view('early', 2)])),
    ).toEqual(['p1', '[early]', 'p2', 'p3', '[late]', 'p4', 'p5']);
  });

  it('works with no products and no tiles', () => {
    expect(placePromoTiles([], [])).toEqual([]);
    expect(labels(placePromoTiles([], [view('t', 1)]))).toEqual(['[t]']);
  });

  it('numbers product cells without counting tiles (used for Load more focus)', () => {
    const items = placePromoTiles(products, [view('t', 1)]);
    const indices = items.flatMap((i) =>
      i.kind === 'product' ? [i.productIndex] : [],
    );
    expect(indices).toEqual([0, 1, 2, 3, 4]);
  });
});
