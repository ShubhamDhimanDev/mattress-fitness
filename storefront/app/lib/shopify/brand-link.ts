// Which brand page, if any, a product's brand or vendor name links to (REQ-COL-005, REQ-PDP-002). A pure
// function: the loader supplies the product's brand entry and the (cached) brand list, and gets back an address
// that is known to exist, or null, in which case the page shows the name as plain text. Nothing is guessed from
// the vendor string alone: a link needs a brand entry behind it.

import {brandPath, normalizeBrandSlug} from '~/lib/shopify/brand-path';
import type {BrandSummary} from '~/lib/shopify/brand-data';
import type {BrandView} from '~/lib/shopify/types';

export type BrandLink = {
  readonly name: string;
  /** `/brands/<handle>`. */
  readonly to: string;
};

const comparable = (name: string) =>
  name.trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * 1. The product's own `brand` entry wins: it is the metaobject the brand page is served from, so its handle
 *    (or, failing that, its slug field) is a page that exists.
 * 2. Otherwise the vendor name is matched, ignoring case and spacing, against the brand list. The brand page
 *    lists products by vendor name, so a match means the page will list this product.
 * 3. Otherwise null.
 */
export function resolveBrandLink(input: {
  vendor: string | null | undefined;
  brand: Pick<BrandView, 'name' | 'handle' | 'slug'> | null;
  /** The brand list; fixtures must already be excluded by the caller when the page is public. */
  index: readonly BrandSummary[];
}): BrandLink | null {
  const own = input.brand
    ? (normalizeBrandSlug(input.brand.handle) ??
      normalizeBrandSlug(input.brand.slug))
    : null;
  if (input.brand && own) {
    return {name: input.brand.name, to: brandPath(own)};
  }

  const vendor = comparable(input.vendor ?? '');
  if (vendor === '') return null;
  const match = input.index.find((entry) => comparable(entry.name) === vendor);
  return match ? {name: match.name, to: match.to} : null;
}
