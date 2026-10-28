// Promotional tiles inside a collection grid (REQ-COL-003, P3B-05). Each `promo_tile` metaobject names the
// collection it belongs to, its place in the grid, an image, a heading and a link; the client edits them in
// Shopify admin. Entries are untrusted text (T-07, T-08, T-15): bad ones are skipped, never rendered.
// ASSUMPTION(V-05): the `promo_tile` definition from scripts/shopify/definitions.json exists on the store.

import type {Storefront} from '~/lib/hydrogen/storefront';
import type {CatalogPromoTilesQuery} from 'storefrontapi.generated';
import {cleanText} from '~/lib/catalog/text';
import {parseAdminLink} from '~/lib/shopify/admin-link';
import {catalogCache} from '~/lib/shopify/cache';
import {fieldRecord, mapImage} from '~/lib/shopify/common';
import {
  parsePromoTone,
  type PromoTileView,
} from '~/lib/shopify/promo-placement';
import {logError} from '~/lib/logging/logger';

export const PROMO_FIELDS = {
  collection: 'collection',
  position: 'position',
  image: 'image',
  heading: 'heading',
  link: 'link',
  enabled: 'enabled',
  tone: 'tone',
} as const;

/** How many `promo_tile` entries one read returns (the query is not paged). */
export const PROMO_TILE_READ_CAP = 100;

const MAX_HEADING_LENGTH = 80;
/** Positions beyond this are not a realistic grid cell; they are ignored. */
const MAX_POSITION = 200;

/**
 * All tiles are read once and matched to the collection in memory: tiles carry no price or availability, so
 * the long cache applies and the cache key does not depend on the collection being viewed.
 */
export const PROMO_TILES_QUERY = `#graphql
  query CatalogPromoTiles($country: CountryCode, $language: LanguageCode)
  @inContext(country: $country, language: $language) {
    tiles: metaobjects(type: "promo_tile", first: 100) {
      nodes {
        id
        fields {
          key
          value
          reference {
            ... on MediaImage {
              image {
                url
                altText
                width
                height
              }
            }
            ... on Collection {
              handle
            }
          }
        }
      }
    }
  }
` as const;

type TileNode = CatalogPromoTilesQuery['tiles']['nodes'][number];

function collectionHandleOf(node: TileNode): string | null {
  const field = node.fields.find((f) => f.key === PROMO_FIELDS.collection);
  const reference = field?.reference;
  return reference && 'handle' in reference ? reference.handle : null;
}

function imageOf(node: TileNode) {
  const field = node.fields.find((f) => f.key === PROMO_FIELDS.image);
  const reference = field?.reference;
  return reference && 'image' in reference ? mapImage(reference.image) : null;
}

/**
 * The enabled tiles that belong to `collectionHandle`, in admin order. A tile needs a heading and a whole
 * position of at least 1; only an explicit "true" in `enabled` shows it.
 */
export function mapPromoTiles(
  nodes: readonly TileNode[] | null | undefined,
  collectionHandle: string,
): PromoTileView[] {
  const tiles: PromoTileView[] = [];
  for (const node of nodes ?? []) {
    const fields = fieldRecord(node.fields);
    if (fields[PROMO_FIELDS.enabled]?.trim().toLowerCase() !== 'true') continue;
    if (collectionHandleOf(node) !== collectionHandle) continue;

    const heading = cleanText(fields[PROMO_FIELDS.heading] ?? '').slice(
      0,
      MAX_HEADING_LENGTH,
    );
    const rawPosition = (fields[PROMO_FIELDS.position] ?? '').trim();
    if (heading === '' || !/^\d{1,3}$/.test(rawPosition)) continue;
    const position = Number(rawPosition);
    if (position < 1 || position > MAX_POSITION) continue;

    tiles.push({
      id: node.id,
      heading,
      tone: parsePromoTone(fields[PROMO_FIELDS.tone]),
      image: imageOf(node),
      link: parseAdminLink(fields[PROMO_FIELDS.link]),
      position,
    });
  }
  return tiles;
}

/** Tiles are decoration: a failed read leaves the grid as products only and never blocks the page (NFR-013). */
export async function loadPromoTiles(
  storefront: Storefront,
  collectionHandle: string,
): Promise<PromoTileView[]> {
  try {
    const {tiles} = await storefront.query(PROMO_TILES_QUERY, {
      cache: catalogCache(storefront),
    });
    // A full page may mean more entries exist than were read. Tiles are decoration, so the grid still
    // renders, but the count is logged so the cap is noticed before a tile silently disappears.
    if (tiles.nodes.length >= PROMO_TILE_READ_CAP) {
      logError('collection.promo_tiles_cap_reached', {
        cap: PROMO_TILE_READ_CAP,
      });
    }
    return mapPromoTiles(tiles.nodes, collectionHandle);
  } catch {
    // No error text is logged: it can quote the request (T-05).
    logError('collection.promo_tiles_read_failed');
    return [];
  }
}
