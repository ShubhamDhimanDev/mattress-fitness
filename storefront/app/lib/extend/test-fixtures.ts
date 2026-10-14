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

// ------------------------------------------------------------ webhook and Admin API builders

/** A synthetic app client secret for signing test webhooks. It is not a credential for anything. */
export const WEBHOOK_SECRET = 'fixture-app-client-secret-not-real';

const encoder = new TextEncoder();

export async function signBody(body: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    {name: 'HMAC', hash: 'SHA-256'},
    false,
    ['sign'],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, encoder.encode(body)),
  );
  let binary = '';
  for (const byte of signature) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export type WebhookRequestOptions = {
  body?: string;
  secret?: string;
  topic?: string;
  webhookId?: string;
  /** null omits the header. */
  triggeredAt?: string | null;
  /** null omits the header; a string replaces the computed signature. */
  signature?: string | null;
  method?: string;
  headers?: Record<string, string>;
  url?: string;
};

/** A correctly signed Shopify webhook request unless `signature`, `body` or `secret` are bent by the test. */
export async function webhookRequest(
  options: WebhookRequestOptions = {},
): Promise<Request> {
  const body = options.body ?? JSON.stringify({id: 7001});
  const headers = new Headers({
    'Content-Type': 'application/json',
    'X-Shopify-Topic': options.topic ?? 'orders/paid',
    'X-Shopify-Webhook-Id': options.webhookId ?? 'wh-00000001-aaaa',
    ...options.headers,
  });
  if (options.triggeredAt !== null) {
    headers.set(
      'X-Shopify-Triggered-At',
      options.triggeredAt ?? new Date().toISOString(),
    );
  }
  const signature =
    options.signature === undefined
      ? await signBody(body, options.secret ?? WEBHOOK_SECRET)
      : options.signature;
  if (signature !== null) headers.set('X-Shopify-Hmac-Sha256', signature);
  const method = options.method ?? 'POST';
  return new Request(
    options.url ?? 'https://shop.example.test/webhooks/shopify',
    {
      method,
      headers,
      ...(method === 'GET' || method === 'HEAD' ? {} : {body}),
    },
  );
}

const money = (amount: string) => ({
  shopMoney: {amount, currencyCode: 'USD'},
});

/** An Admin GraphQL line item node for a mattress, in the shape `parseAdminOrder` reads. */
export function adminMattressNode(overrides: Record<string, unknown> = {}) {
  return {
    id: 'gid://shopify/LineItem/1001',
    title: 'Test Hybrid Mattress',
    variantTitle: 'Queen',
    sku: 'MATT-QUEEN',
    quantity: 1,
    currentQuantity: 1,
    unfulfilledQuantity: 1,
    originalUnitPriceSet: money('1299.00'),
    discountedUnitPriceSet: money('1299.00'),
    customAttributes: [],
    product: {
      id: 'gid://shopify/Product/501',
      metafield: {value: 'mattress'},
    },
    variant: {id: 'gid://shopify/ProductVariant/601'},
    ...overrides,
  };
}

/** An Admin GraphQL line item node for the 79.99 coverage price point, linked to product 501. */
export function adminCoverageNode(overrides: Record<string, unknown> = {}) {
  return {
    id: 'gid://shopify/LineItem/1002',
    title: 'Extend Protection Plan',
    variantTitle: 'Extend-Protection-Plan-79.99',
    sku: 'Extend-Protection-Plan-79.99',
    quantity: 1,
    currentQuantity: 1,
    unfulfilledQuantity: 1,
    originalUnitPriceSet: money('79.99'),
    discountedUnitPriceSet: money('79.99'),
    customAttributes: [
      {key: '_extend_plan_id', value: GOOD_PLAN_ID},
      {key: '_extend_covered_product_id', value: '501'},
      {key: '_extend_term', value: '36'},
    ],
    product: {id: 'gid://shopify/Product/9001', metafield: null},
    variant: {id: 'gid://shopify/ProductVariant/9100000006'},
    ...overrides,
  };
}

/** An Admin GraphQL `order` node. Invented customer data only. */
export function adminOrderNode(
  lines: readonly unknown[] = [adminMattressNode(), adminCoverageNode()],
  overrides: Record<string, unknown> = {},
) {
  const address = (street: string) => ({
    name: SYNTHETIC_PII.name,
    phone: SYNTHETIC_PII.phone,
    address1: street,
    address2: null,
    city: SYNTHETIC_PII.city,
    countryCodeV2: 'US',
    zip: SYNTHETIC_PII.postalCode,
    province: 'California',
    provinceCode: 'CA',
  });
  return {
    id: 'gid://shopify/Order/7001',
    name: '#1001',
    createdAt: '2026-10-01T12:00:00Z',
    cancelledAt: null,
    currencyCode: 'USD',
    displayFinancialStatus: 'PAID',
    email: SYNTHETIC_PII.email,
    phone: null,
    totalPriceSet: money('1378.99'),
    billingAddress: address(SYNTHETIC_PII.billingStreet),
    shippingAddress: address(SYNTHETIC_PII.shippingStreet),
    lineItems: {pageInfo: {hasNextPage: false}, nodes: [...lines]},
    ...overrides,
  };
}
