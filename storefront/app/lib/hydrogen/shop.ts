import type {Storefront} from './storefront';

/** The shop identity Shopify's scripts and analytics need (`ShopifyScripts` `shop`). */
export type ShopIdentity = {
  shopId: string;
  storefrontId: string;
  myshopifyDomain: string;
};

// Replaces `getShopAnalytics`, which 2026.10 removed. The numeric `SHOP_ID` is enough when it is set (no request);
// otherwise the shop's id is read once and cached long.
const SHOP_ID_QUERY = `#graphql
  query ShopId @inContext(country: US, language: EN) {
    shop {
      id
    }
  }
`;

export async function loadShopIdentity(
  storefront: Storefront,
  env: {
    SHOP_ID?: string;
    PUBLIC_STOREFRONT_ID?: string;
    PUBLIC_STORE_DOMAIN?: string;
  },
): Promise<ShopIdentity | null> {
  const myshopifyDomain = env.PUBLIC_STORE_DOMAIN;
  if (!myshopifyDomain) return null;
  const common = {
    storefrontId: env.PUBLIC_STOREFRONT_ID ?? '',
    myshopifyDomain,
  };
  if (env.SHOP_ID) return {shopId: env.SHOP_ID, ...common};
  try {
    const {shop} = await storefront.query(SHOP_ID_QUERY, {
      cache: storefront.CacheLong(),
    });
    return shop?.id ? {shopId: shop.id, ...common} : null;
  } catch {
    // Analytics must never fail the page (NFR-013); without an id nothing is published.
    return null;
  }
}
