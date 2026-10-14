// Where promotional tiles go in a collection grid (REQ-COL-003). Pure: no Shopify and no React, so the rules
// that keep the grid intact are unit-tested. Types are kept apart from the query module so the listing
// component can import them without pulling the GraphQL document into the browser bundle.

import type {AdminLink} from '~/lib/shopify/admin-link';
import type {ImageView} from '~/lib/shopify/types';

export type PromoTileView = {
  readonly id: string;
  readonly heading: string;
  readonly image: ImageView | null;
  /** Null when the tile has no (valid) link; it is then shown as plain, non-interactive content. */
  readonly link: AdminLink | null;
  /** 1-based place in the grid, counting products and tiles together. */
  readonly position: number;
};

export type GridItem<P> =
  | {
      readonly kind: 'product';
      readonly product: P;
      readonly productIndex: number;
    }
  | {readonly kind: 'tile'; readonly tile: PromoTileView};

/**
 * Merges tiles into the product list. A tile with position N becomes the Nth cell. A tile whose position is
 * beyond the end of what is loaded is not shown yet: it appears once "Load more" has brought enough
 * products, and is never pushed to a lonely spot after the last product. Tiles at the same position keep
 * the order they came in and take consecutive cells. Loading more products never moves a tile that is
 * already placed, because tiles only depend on positions before their own.
 */
export function placePromoTiles<P>(
  products: readonly P[],
  tiles: readonly PromoTileView[],
): GridItem<P>[] {
  const items: GridItem<P>[] = products.map((product, productIndex) => ({
    kind: 'product',
    product,
    productIndex,
  }));
  const ordered = tiles
    .map((tile, order) => ({tile, order}))
    .sort((a, b) => a.tile.position - b.tile.position || a.order - b.order);

  let lastInserted = -1;
  for (const {tile} of ordered) {
    const index = Math.max(tile.position - 1, lastInserted + 1);
    if (index > items.length) continue;
    items.splice(index, 0, {kind: 'tile', tile});
    lastInserted = index;
  }
  return items;
}
