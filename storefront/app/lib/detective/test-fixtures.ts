// TEST ONLY. Synthetic orders and rules for the detective tests (P5B-05). Never imported by application code.
// Ids are Shopify-shaped GIDs because that is what the Admin API returns and what OFFER_CONFIG_JSON validates. All
// personal data below is invented; the tests assert that none of it, and no ZIP, ever appears in a result.

import type {DetectiveFacts, DetectiveOrder} from '~/lib/detective/types';
import type {
  ShopifyAddressLike,
  ShopifyOrderLike,
  ShopifyOrderLineLike,
} from '~/lib/extend/orders';
import type {GiftRule, OfferRules} from '~/lib/offers/types';
import {EMPTY_OFFER_RULES} from '~/lib/offers/types';
import type {DeliveryZone} from '~/lib/delivery/zone';

export const product = (n: number) => `gid://shopify/Product/${n}`;
export const variant = (n: number) => `gid://shopify/ProductVariant/${n}`;
export const lineGid = (n: number) => `gid://shopify/LineItem/${n}`;

export const P = {
  mattress: product(501),
  otherMattress: product(502),
  protector: product(510),
  haul: product(520),
  gift: product(530),
  pillow: product(540),
  coverage: product(9001),
} as const;

export const V = {
  queen: variant(601),
  king: variant(602),
  protQueen: variant(611),
  protKing: variant(612),
  haul: variant(621),
  giftStandard: variant(631),
  giftByCollection: variant(632),
  pillow: variant(641),
  coverage: variant(9100000006),
} as const;

export const ZONE: DeliveryZone = {
  name: 'Test metro',
  postalCodes: ['606*', '60007'],
  feeCents: 14900,
  freeOverCents: 99900,
  promise: {inHome: 'In-home.', parcel: 'Parcel.', pickup: 'Pickup.'},
};

export const IN_ZONE = '60645';
export const OUT_OF_ZONE = '90210';

export const GIFT_BY_PRODUCT: GiftRule = {
  id: 'gift-pillows',
  name: 'Free pillow',
  qualifyingProductIds: [P.mattress],
  qualifyingCollectionIds: [],
  giftVariantIdsBySize: {Standard: V.giftStandard},
  maxQuantity: 1,
};

export const GIFT_BY_COLLECTION: GiftRule = {
  id: 'gift-collection',
  name: 'Collection gift',
  qualifyingProductIds: [],
  qualifyingCollectionIds: ['gid://shopify/Collection/77'],
  giftVariantIdsBySize: {Standard: V.giftByCollection},
  maxQuantity: 1,
};

export const RULES: OfferRules = {
  ...EMPTY_OFFER_RULES,
  gifts: [GIFT_BY_PRODUCT],
  comfortGuarantee: {
    qualifyingProductIds: [P.mattress],
    protectorVariantIdBySize: {Queen: V.protQueen, King: V.protKing},
  },
  haulAway: {variantId: V.haul, maxPieces: 3},
};

export const SYNTHETIC_PII = {
  name: 'Jane Q. Testwell',
  email: 'jane.testwell@example.test',
  street: '1 Fixture Way',
} as const;

export type LineSpec = {
  id: number;
  productId?: string | null;
  variantId?: string | null;
  quantity?: number;
  refunded?: number;
  /** Value of the Size option; null = no Size option. */
  size?: string | null;
  title?: string;
  sku?: string | null;
  variantTitle?: string | null;
  category?: string | null;
  attributes?: Record<string, string>;
};

export function orderLine(spec: LineSpec): ShopifyOrderLineLike {
  return {
    id: lineGid(spec.id),
    productId: spec.productId === undefined ? P.otherMattress : spec.productId,
    variantId: spec.variantId === undefined ? V.king : spec.variantId,
    sku: spec.sku ?? null,
    title: spec.title ?? 'Test item',
    variantTitle: spec.variantTitle ?? null,
    quantity: spec.quantity ?? 1,
    refundedQuantity: spec.refunded ?? 0,
    fulfilledQuantity: 0,
    unitPriceCents: 129_900,
    paidUnitPriceCents: 129_900,
    category: spec.category ?? null,
    attributes: spec.attributes ?? {},
    parentLineItemId: null,
  };
}

export const mattress = (id: number, size: string | null = 'Queen') =>
  orderLine({
    id,
    productId: P.mattress,
    variantId: size === 'King' ? V.king : V.queen,
    size,
    category: 'mattress',
  });

export const protector = (id: number, variantId: string, quantity = 1) =>
  orderLine({id, productId: P.protector, variantId, quantity});

export const haulAway = (id: number, quantity: number) =>
  orderLine({id, productId: P.haul, variantId: V.haul, quantity});

export const gift = (id: number, variantId = V.giftStandard, quantity = 1) =>
  orderLine({id, productId: P.gift, variantId, quantity});

/** An Extend price-point coverage line (its SKU names the price) covering product 501 by default. */
export const coverage = (
  id: number,
  overrides: Partial<LineSpec> & {
    coveredProductId?: string;
    planId?: string;
  } = {},
) =>
  orderLine({
    id,
    productId: P.coverage,
    variantId: V.coverage,
    sku: 'Extend-Protection-Plan-79.99',
    variantTitle: 'Extend-Protection-Plan-79.99',
    title: 'Extend Protection Plan',
    attributes: {
      _extend_plan_id: overrides.planId ?? 'MOCK-MATT-ADH-3Y-C',
      _extend_covered_product_id: overrides.coveredProductId ?? '501',
    },
    ...overrides,
  });

export function address(
  postalCode: string | null,
  countryCode: string | null = 'US',
): ShopifyAddressLike {
  return {
    address1: SYNTHETIC_PII.street,
    address2: null,
    city: 'Testville',
    countryCode,
    postalCode,
    province: 'IL',
  };
}

export type OrderSpec = {
  /** A ZIP, or null for "no shipping address" (a pickup order). Default: an in-zone ZIP. */
  zip?: string | null;
  country?: string | null;
  attributes?: Record<string, string>;
  refundState?: ShopifyOrderLike['refundState'];
  cancelledAt?: string | null;
  id?: string;
  currency?: string;
};

/** Lines and facts built together, so the size map always matches the lines. */
export function detectiveOrder(
  specs: ReadonlyArray<
    ShopifyOrderLineLike | [ShopifyOrderLineLike, string | null]
  >,
  options: OrderSpec = {},
): DetectiveOrder {
  const lines: ShopifyOrderLineLike[] = [];
  const sizeByLineId = new Map<string, string | null>();
  for (const entry of specs) {
    const [line, size] = Array.isArray(entry)
      ? entry
      : [entry, defaultSizeOf(entry)];
    lines.push(line);
    sizeByLineId.set(line.id, size);
  }
  const zip = options.zip === undefined ? IN_ZONE : options.zip;
  const facts: DetectiveFacts = {
    attributes: options.attributes ?? {delivery_choice: 'in-home'},
    sizeByLineId,
  };
  return {
    order: {
      id: options.id ?? 'gid://shopify/Order/7001',
      name: '#1001',
      currency: options.currency ?? 'USD',
      createdAt: '2026-10-10T12:00:00Z',
      totalCents: 500_000,
      cancelledAt: options.cancelledAt ?? null,
      refundState: options.refundState ?? 'none',
      customer: {
        name: SYNTHETIC_PII.name,
        email: SYNTHETIC_PII.email,
        phone: null,
        billingAddress: null,
        shippingAddress:
          zip === null
            ? null
            : address(
                zip,
                options.country === undefined ? 'US' : options.country,
              ),
      },
      lineItems: lines,
    },
    facts,
  };
}

/** Variant 601 is the Queen mattress, 602 the King; everything else has no Size option. */
function defaultSizeOf(line: ShopifyOrderLineLike): string | null {
  if (line.variantId === V.queen && line.productId === P.mattress)
    return 'Queen';
  if (line.variantId === V.king && line.productId === P.mattress) return 'King';
  return null;
}

/** Deep-freezes a value so any mutation by the code under test throws in strict mode. */
export function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

// ------------------------------------------------------------ Admin GraphQL nodes (the DetectiveOrderFields shape)

const money = (amount: string) => ({shopMoney: {amount, currencyCode: 'USD'}});

/** A line item node as `DETECTIVE_ORDER_BY_ID_QUERY` returns it. */
export function adminDetectiveLineNode(
  overrides: Record<string, unknown> = {},
) {
  return {
    id: 'gid://shopify/LineItem/1',
    title: 'Test Hybrid Mattress',
    variantTitle: 'Queen',
    sku: 'MATT-QUEEN',
    quantity: 1,
    currentQuantity: 1,
    originalUnitPriceSet: money('1299.00'),
    customAttributes: [],
    product: {id: P.mattress, metafield: {value: 'mattress'}},
    variant: {
      id: V.queen,
      selectedOptions: [
        {name: 'Firmness', value: 'Medium'},
        {name: 'size', value: 'Queen'},
      ],
    },
    ...overrides,
  };
}

/** A haul-away line node for `quantity` pieces. */
export function adminDetectiveHaulNode(id: number, quantity: number) {
  return adminDetectiveLineNode({
    id: lineGid(id),
    title: 'Recycle and disposal service',
    variantTitle: null,
    sku: null,
    quantity,
    currentQuantity: quantity,
    product: {id: P.haul, metafield: null},
    variant: {id: V.haul, selectedOptions: []},
  });
}

/** An order node as `DETECTIVE_ORDER_BY_ID_QUERY` returns it. Invented data only. */
export function adminDetectiveOrderNode(
  lines: readonly unknown[] = [adminDetectiveLineNode()],
  overrides: Record<string, unknown> = {},
) {
  return {
    id: 'gid://shopify/Order/7001',
    name: '#1001',
    createdAt: '2026-10-10T12:00:00Z',
    cancelledAt: null,
    currencyCode: 'USD',
    displayFinancialStatus: 'PAID',
    totalPriceSet: money('1299.00'),
    customAttributes: [{key: 'delivery_choice', value: 'in-home'}],
    shippingAddress: {countryCodeV2: 'US', zip: IN_ZONE},
    lineItems: {pageInfo: {hasNextPage: false}, nodes: [...lines]},
    ...overrides,
  };
}
