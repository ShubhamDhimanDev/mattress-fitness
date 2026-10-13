// Product page read (REQ-PDP-001). Two parallel queries with different cache lifetimes: content is cached
// long, price and availability short. A missing availability read does not fail the page; the content
// query's own values are used instead.

import type {Storefront} from '@shopify/hydrogen';
import {availabilityCache, catalogCache} from '~/lib/shopify/cache';
import {isValidHandle} from '~/lib/shopify/collection-data';
import {mapProductPage} from '~/lib/shopify/product';
import {PRODUCT_AVAILABILITY_QUERY, PRODUCT_QUERY} from '~/lib/shopify/queries';
import type {ProductPageView} from '~/lib/shopify/types';

export type ProductPageResult =
  | {readonly status: 'ok'; readonly product: ProductPageView}
  | {readonly status: 'not-found'};

export async function loadProductPage(
  storefront: Storefront,
  handle: string,
): Promise<ProductPageResult> {
  if (!isValidHandle(handle)) return {status: 'not-found'};

  const [content, availability] = await Promise.all([
    storefront.query(PRODUCT_QUERY, {
      // Long: the product page's price and availability come from the availability read below, which wins.
      cache: catalogCache(storefront),
      variables: {handle},
    }),
    storefront
      .query(PRODUCT_AVAILABILITY_QUERY, {
        cache: availabilityCache(storefront),
        variables: {handle},
      })
      .catch((error: unknown) => {
        // The page still renders from the content query; log without any request data.
        console.error(
          'Product availability read failed:',
          error instanceof Error ? error.message : 'unknown error',
        );
        return null;
      }),
  ]);

  if (!content.product) return {status: 'not-found'};
  const product = mapProductPage(
    content.product,
    availability?.product ?? null,
  );
  // A product with no purchasable variant cannot be shown meaningfully.
  return product.variants.length === 0
    ? {status: 'not-found'}
    : {status: 'ok', product};
}
