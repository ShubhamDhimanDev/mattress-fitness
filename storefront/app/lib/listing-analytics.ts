// The part of a product list's analytics that every page showing product cards needs at once (P7-01, REQ-ANL-001):
// the `select_item` attributes of a card. It is in the initial JavaScript of the home page and every listing route,
// which has a budget (scripts/perf), so this file imports only `~/lib/format` and stays tiny. The list id is in
// `~/lib/listing-path` (only `ProductListing` needs it). The `view_item_list` event is built in
// `~/lib/listing-events`, which `ProductListing` loads with `import()` when it reports a list.
//
// Everything is read from the card data the page already holds (`ProductCardView`): no extra fetch and nothing
// personal. Prices become integer cents from Shopify's decimal strings, and a card without a buyable price (every
// variant sold out) reports nothing rather than a guess.

import {toCents} from '~/lib/format';
import type {ProductCardView} from '~/lib/shopify/types';

// One short attribute, `data-si`, holds `gid|price cents|position|list id`; `mapSelectItem` (consent chunk,
// `~/lib/analytics/hydrogen-events`) reads it back together with the link's text, which is the product title. The
// name is written out here, with no checks of its own, so the card does not pull the analytics module (about 0.8 kB
// gzip) into every listing route, and the price and title are not repeated in the markup of every card: the click
// handler reads the id from its gid, checks the price, the list id and the position again, and drops the event when
// anything is wrong (a test pins the two sides together). The brand is not sent with a click. Numbers render as
// decimal text.
export function cardSelectItemAttributes(
  product: ProductCardView,
  index: number | undefined,
  listId: string | undefined,
): Record<string, string> {
  const {price} = product;
  // No position or no USD price: nothing to report. No try/catch around `toCents`: the card's own price block
  // (`Price`) reads the same amount with the same helper, so an amount that would throw here has already failed there.
  // `join` writes an undefined list id as nothing, which is the empty last part the mapper expects.
  return index === undefined || price?.currencyCode !== 'USD'
    ? {}
    : {'data-si': [product.id, toCents(price.amount), index, listId].join('|')};
}
