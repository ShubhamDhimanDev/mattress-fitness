// "Show this group first" ordering for listings reached from a header menu or an offer (owner request 2026-11-11).
// Pure: no Shopify client, no framework. Shopify cannot sort by product type, so the collection loader reads the whole
// collection and orders it with `leadFirst`. The product types are the ones the catalog uses and that
// scripts/shopify/create-collections.mjs groups into the header's collections.

import type {LeadSortKey} from '~/lib/filters';

const LEAD_TYPES: Readonly<Record<LeadSortKey, readonly string[]>> = {
  'mattress-first': ['mattress'],
  'foundations-first': ['foundation', 'adjustable base'],
  'furniture-first': ['bed frame & furniture'],
  'bedding-first': [
    'bedding',
    'sheets',
    'pillow',
    'mattress protector',
    'mattress topper',
  ],
};

/** The products of the lead group first; each part keeps the order it came in (Array.prototype.sort is stable). */
export function leadFirst<T extends {readonly productType: string}>(
  nodes: readonly T[],
  sort: LeadSortKey,
): T[] {
  const types = LEAD_TYPES[sort];
  const leads = (node: T) =>
    types.includes(node.productType.trim().toLowerCase());
  return [...nodes].sort((a, b) => Number(leads(b)) - Number(leads(a)));
}

/**
 * The sort for the links under one header menu, from the menu's own label and link: Mattresses lists mattresses first,
 * the accessory menus list their own products first. A menu that is none of these (Brands, Sale) lists mattresses first.
 */
export function leadSortForMenu(
  label: string,
  to: string | undefined,
): LeadSortKey {
  const text = `${label} ${to ?? ''}`.toLowerCase();
  if (/adjustable|box[ -]?spring|foundation|\bbases?\b/.test(text)) {
    return 'foundations-first';
  }
  if (/furniture|bed[ -]frame|headboard|dresser|nightstand/.test(text)) {
    return 'furniture-first';
  }
  if (/bedding|pillow|sheet|comforter|protector|topper/.test(text)) {
    return 'bedding-first';
  }
  return 'mattress-first';
}
