// Which shop policies exist (P7-04, REQ-SEO-001), so the sitemap lists a policy page only when it has content.
// Shopify's Storefront sitemap does not include policies, and `/policies/:handle` answers 404 for one the shop
// has not written, so the extras sitemap needs this small read.
//
// The URL handle comes from a closed list keyed by the Shop field, never from the handle Shopify returns: the
// route `policies.$handle.tsx` matches the same four handles, so a listed URL always resolves. The subscription
// policy is not routed (the route answers 404 for it), so it is neither queried nor listed.

import type {Storefront} from '@shopify/hydrogen';
import type {ShopPolicyHandlesQuery} from 'storefrontapi.generated';
import {errorFields, logError} from '~/lib/logging/logger';
import {catalogCache} from '~/lib/shopify/cache';

type PolicyField =
  'privacyPolicy' | 'shippingPolicy' | 'termsOfService' | 'refundPolicy';

/**
 * Shop field to URL handle, in the order the pages are listed. Must stay equal to the list in
 * `routes/policies.$handle.tsx` (the route is owned elsewhere; a test pins the handles).
 */
export const POLICY_URL_HANDLES: Readonly<Record<PolicyField, string>> = {
  privacyPolicy: 'privacy-policy',
  shippingPolicy: 'shipping-policy',
  termsOfService: 'terms-of-service',
  refundPolicy: 'refund-policy',
};

const POLICY_FIELDS: readonly PolicyField[] = [
  'privacyPolicy',
  'shippingPolicy',
  'termsOfService',
  'refundPolicy',
];

// NOTE: https://shopify.dev/docs/api/storefront/latest/objects/Shop
export const SHOP_POLICY_HANDLES_QUERY = `#graphql
  query ShopPolicyHandles {
    shop {
      privacyPolicy {
        handle
      }
      shippingPolicy {
        handle
      }
      termsOfService {
        handle
      }
      refundPolicy {
        handle
      }
    }
  }
` as const;

/** Page paths (`/policies/<handle>`) of the policies the shop has written; none for a missing or empty answer. */
export function policyPathsFrom(
  data: ShopPolicyHandlesQuery | null | undefined,
): string[] {
  const shop = data?.shop;
  if (!shop) return [];
  return POLICY_FIELDS.filter((field) => shop[field] != null).map(
    (field) => `/policies/${POLICY_URL_HANDLES[field]}`,
  );
}

/**
 * The policy page paths that exist. A failed read lists none (a missing sitemap entry is harmless, a 404 entry is
 * not) and is logged by class name only.
 */
export async function loadPolicyPaths(
  storefront: Storefront,
): Promise<string[]> {
  try {
    const data = await storefront.query(SHOP_POLICY_HANDLES_QUERY, {
      cache: catalogCache(storefront),
    });
    return policyPathsFrom(data);
  } catch (error) {
    logError('catalog.shop_policies_read_failed', errorFields(error));
    return [];
  }
}
