// TEST ONLY. Synthetic builders shared by the Extend unit and integration tests. Never imported by application
// code, so bundlers drop it. All personal data below is invented (".test" addresses, reserved 555 numbers).

import type {
  ShopifyCustomerLike,
  ShopifyOrderLike,
  ShopifyOrderLineLike,
} from '~/lib/extend/orders';
import type {PlanQuote} from '~/lib/extend/types';

export const SYNTHETIC_PII = {
  name: 'Jane Q. Testwell',
  email: 'jane.testwell@example.test',
  phone: '+1-555-010-0199',
  billingStreet: '1 Fixture Way',
  shippingStreet: '2 Sample Road',
  city: 'Testville',
  postalCode: '99999',
} as const;

export const SYNTHETIC_CUSTOMER: ShopifyCustomerLike = {
  name: SYNTHETIC_PII.name,
  email: SYNTHETIC_PII.email,
  phone: SYNTHETIC_PII.phone,
  billingAddress: {
    address1: SYNTHETIC_PII.billingStreet,
    address2: null,
    city: SYNTHETIC_PII.city,
    countryCode: 'US',
    postalCode: SYNTHETIC_PII.postalCode,
    province: 'CA',
  },
  shippingAddress: {
    address1: SYNTHETIC_PII.shippingStreet,
    address2: 'Unit 4',
    city: SYNTHETIC_PII.city,
    countryCode: 'US',
    postalCode: SYNTHETIC_PII.postalCode,
    province: 'CA',
  },
};

/** Mattress priced in the mock's 1000.00 to 1999.99 band, so the mock offers MOCK-MATT-ADH-3Y-C at 79.99. */
export function mattressLine(
  overrides: Partial<ShopifyOrderLineLike> = {},
): ShopifyOrderLineLike {
  return {
    id: 'gid://shopify/LineItem/1001',
    productId: 'gid://shopify/Product/501',
    variantId: 'gid://shopify/ProductVariant/601',
    sku: 'MATT-QUEEN',
    title: 'Test Hybrid Mattress',
    variantTitle: 'Queen',
    quantity: 1,
    refundedQuantity: 0,
    fulfilledQuantity: 0,
    unitPriceCents: 129_900,
    paidUnitPriceCents: 129_900,
    category: 'mattress',
    attributes: {},
    parentLineItemId: null,
    ...overrides,
  };
}

export function coverageLine(
  overrides: Partial<ShopifyOrderLineLike> = {},
): ShopifyOrderLineLike {
  return {
    id: 'gid://shopify/LineItem/1002',
    productId: 'gid://shopify/Product/9001',
    variantId: 'gid://shopify/ProductVariant/9100000006',
    sku: 'Extend-Protection-Plan-79.99',
    title: 'Extend Protection Plan',
    variantTitle: 'Extend-Protection-Plan-79.99',
    quantity: 1,
    refundedQuantity: 0,
    fulfilledQuantity: 0,
    unitPriceCents: 7999,
    paidUnitPriceCents: 7999,
    category: null,
    attributes: {
      _extend_plan_id: 'MOCK-MATT-ADH-3Y-C',
      _extend_covered_product_id: '501',
      _extend_term: '36',
    },
    parentLineItemId: 'gid://shopify/LineItem/1001',
    ...overrides,
  };
}

export function makeOrder(
  overrides: Partial<ShopifyOrderLike> = {},
): ShopifyOrderLike {
  return {
    id: 'gid://shopify/Order/7001',
    name: '#1001',
    currency: 'USD',
    createdAt: '2026-10-01T12:00:00Z',
    totalCents: 137_899,
    cancelledAt: null,
    refundState: 'none',
    customer: SYNTHETIC_CUSTOMER,
    lineItems: [mattressLine(), coverageLine()],
    ...overrides,
  };
}

export const GOOD_PLAN_ID = 'MOCK-MATT-ADH-3Y-C';

/** Quotes that legitimise the default coverage line (id 1002). */
export function goodQuotes(
  lineId = '1002',
  quote: PlanQuote | null = {planId: GOOD_PLAN_ID, priceCents: 7999},
): Map<string, PlanQuote | null> {
  return new Map([[lineId, quote]]);
}
