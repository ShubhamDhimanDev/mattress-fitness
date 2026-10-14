// Shopify Admin API order read for the Extend sync (REQ-EXT-003, P5A-08, T-03). Pure: the GraphQL documents and the
// defensive mapper from an Admin `order` node to `ShopifyOrderLike`. The webhook route and the reconcile script
// both use it, so the two always build the same snapshot from the same order.
//
// The webhook body is only a trigger; the order content always comes from this read (webhook.ts header).
//
// Fields and types below were checked against shopify.dev (Admin GraphQL, latest) on 2026-10-13:
// Order.{id,name,createdAt,cancelledAt,currencyCode,totalPriceSet,displayFinancialStatus,email,phone,
// billingAddress,shippingAddress,lineItems}; LineItem.{id,title,variantTitle,sku,quantity,currentQuantity,
// unfulfilledQuantity,originalUnitPriceSet,discountedUnitPriceSet,customAttributes,product,variant};
// MailingAddress.{name,phone,address1,address2,city,countryCodeV2,zip,province,provinceCode}.
// The Admin documents are deliberately NOT tagged `#graphql`: Hydrogen's codegen validates tagged documents against
// the Storefront schema and would reject them.

import {SIZE_OPTION_NAME, toSlug} from '~/lib/catalog/attributes';
import type {DetectiveFacts, DetectiveOrder} from '~/lib/detective/types';
import type {
  ShopifyAddressLike,
  ShopifyCustomerLike,
  ShopifyOrderLike,
  ShopifyOrderLineLike,
} from '~/lib/extend/orders';
import {toCents} from '~/lib/money';

/** Latest stable Admin API version on 2026-10-13, the one scripts/lib/shopify-admin.mjs also uses. */
export const ADMIN_API_VERSION = '2026-10';

/** One page of line items per order. A bigger order is refused rather than synced partially (never partial snapshots). */
export const ORDER_LINE_PAGE_SIZE = 100;

/** The product metafield that holds the Extend category (docs/architecture/SHOPIFY_DATA_MODEL.md, REQ-EXT-005). */
const CATEGORY_NAMESPACE = 'custom';
const CATEGORY_KEY = 'extend_category';

const FRAGMENTS = `
fragment ExtendOrderAddress on MailingAddress {
  name
  phone
  address1
  address2
  city
  countryCodeV2
  zip
  province
  provinceCode
}
fragment ExtendOrder on Order {
  id
  name
  createdAt
  cancelledAt
  currencyCode
  displayFinancialStatus
  email
  phone
  totalPriceSet { shopMoney { amount currencyCode } }
  billingAddress { ...ExtendOrderAddress }
  shippingAddress { ...ExtendOrderAddress }
  lineItems(first: ${ORDER_LINE_PAGE_SIZE}) {
    pageInfo { hasNextPage }
    nodes {
      id
      title
      variantTitle
      sku
      quantity
      currentQuantity
      unfulfilledQuantity
      originalUnitPriceSet { shopMoney { amount currencyCode } }
      discountedUnitPriceSet { shopMoney { amount currencyCode } }
      customAttributes { key value }
      product { id metafield(namespace: "${CATEGORY_NAMESPACE}", key: "${CATEGORY_KEY}") { value } }
      variant { id }
    }
  }
}`;

export const EXTEND_ORDER_BY_ID_QUERY = `query ExtendOrderById($id: ID!) {
  order(id: $id) { ...ExtendOrder }
}
${FRAGMENTS}`;

export const EXTEND_ORDERS_PAGE_QUERY = `query ExtendOrdersPage($first: Int!, $after: String, $query: String) {
  orders(first: $first, after: $after, query: $query, sortKey: CREATED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes { ...ExtendOrder }
  }
}
${FRAGMENTS}`;

export type ParseOrderFailure = 'malformed' | 'truncated';

export type ParseOrderResult =
  | {status: 'ok'; order: ShopifyOrderLike}
  | {status: 'error'; reason: ParseOrderFailure; detail: string};

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown, max = 500): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed.slice(0, max);
}

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

/** MoneyBag -> integer cents in the shop currency. The decimal string is parsed, never turned into a float. */
function moneyCents(bag: unknown): number | null {
  if (!isRecord(bag) || !isRecord(bag.shopMoney)) return null;
  const amount = bag.shopMoney.amount;
  if (typeof amount !== 'string') return null;
  try {
    return toCents(amount);
  } catch {
    return null;
  }
}

function addressOf(value: unknown): ShopifyAddressLike | null {
  if (!isRecord(value)) return null;
  return {
    address1: text(value.address1, 200),
    address2: text(value.address2, 200),
    city: text(value.city, 100),
    countryCode: text(value.countryCodeV2, 2),
    postalCode: text(value.zip, 20),
    province: text(value.provinceCode, 50) ?? text(value.province, 50),
  };
}

function customerOf(order: Json): ShopifyCustomerLike {
  const billing = isRecord(order.billingAddress) ? order.billingAddress : null;
  const shipping = isRecord(order.shippingAddress)
    ? order.shippingAddress
    : null;
  return {
    name: text(shipping?.name, 200) ?? text(billing?.name, 200),
    email: text(order.email, 320),
    phone:
      text(order.phone, 50) ??
      text(shipping?.phone, 50) ??
      text(billing?.phone, 50),
    billingAddress: addressOf(billing),
    shippingAddress: addressOf(shipping),
  };
}

function attributesOf(value: unknown): Record<string, string> | null {
  if (!Array.isArray(value)) return null;
  const entries: Array<[string, string]> = [];
  for (const entry of value.slice(0, 100)) {
    if (!isRecord(entry)) return null;
    const key = text(entry.key, 100);
    if (key === null) continue;
    entries.push([
      key,
      typeof entry.value === 'string' ? entry.value.slice(0, 500) : '',
    ]);
  }
  // fromEntries creates own properties, so a hostile key such as "__proto__" cannot reach the prototype.
  return Object.fromEntries(entries);
}

function lineOf(value: unknown): ShopifyOrderLineLike | null {
  if (!isRecord(value)) return null;
  const id = text(value.id, 100);
  const title = text(value.title, 500);
  const quantity = count(value.quantity);
  const current = count(value.currentQuantity);
  const unfulfilled = count(value.unfulfilledQuantity);
  const unitPriceCents = moneyCents(value.originalUnitPriceSet);
  const paidUnitPriceCents = moneyCents(value.discountedUnitPriceSet);
  const attributes = attributesOf(value.customAttributes);
  if (
    id === null ||
    title === null ||
    quantity === null ||
    current === null ||
    unfulfilled === null ||
    unitPriceCents === null ||
    paidUnitPriceCents === null ||
    attributes === null
  ) {
    return null;
  }
  const product = isRecord(value.product) ? value.product : null;
  const variant = isRecord(value.variant) ? value.variant : null;
  const metafield = isRecord(product?.metafield) ? product.metafield : null;
  // ASSUMPTION(V-20): "Units ordered, excluding refunded and removed units" (currentQuantity) and "units not yet
  // fulfilled" (unfulfilledQuantity) are read as disjoint, so fulfilled = current - unfulfilled. If Shopify counts a
  // refunded unit as unfulfilled the result is LOWER than the truth, which only delays a contract (safe direction).
  return {
    id,
    productId: text(product?.id, 100),
    variantId: text(variant?.id, 100),
    sku: text(value.sku, 200),
    title,
    variantTitle: text(value.variantTitle, 200),
    quantity,
    refundedQuantity: Math.max(0, quantity - current),
    fulfilledQuantity: Math.max(0, current - Math.min(unfulfilled, current)),
    unitPriceCents,
    paidUnitPriceCents,
    category: text(metafield?.value, 64),
    attributes,
    // Shopify documents no parent-line field on an order's LineItem (only `lineItemGroup`, described for bundles), so
    // nested-line relationships are not read. orders.ts then falls back to the covered product id and flags
    // ambiguity (V-16, V-20, EXTEND.md section 3 item 6).
    parentLineItemId: null,
  };
}

function refundStateOf(status: unknown): ShopifyOrderLike['refundState'] {
  if (status === 'REFUNDED') return 'full';
  if (status === 'PARTIALLY_REFUNDED') return 'partial';
  return 'none';
}

/** Maps one Admin `order` node. Anything missing or malformed is an error, never a guess. */
export function parseAdminOrder(node: unknown): ParseOrderResult {
  const malformed = (detail: string): ParseOrderResult => ({
    status: 'error',
    reason: 'malformed',
    detail,
  });
  if (!isRecord(node)) return malformed('order');
  const id = text(node.id, 100);
  const name = text(node.name, 50);
  const createdAt = text(node.createdAt, 40);
  const currency = text(node.currencyCode, 3);
  const totalCents = moneyCents(node.totalPriceSet);
  if (
    id === null ||
    name === null ||
    createdAt === null ||
    currency === null ||
    totalCents === null
  ) {
    return malformed('order fields');
  }
  const lineItems = node.lineItems;
  if (!isRecord(lineItems) || !Array.isArray(lineItems.nodes)) {
    return malformed('line items');
  }
  const page = isRecord(lineItems.pageInfo) ? lineItems.pageInfo : null;
  if (page === null || typeof page.hasNextPage !== 'boolean') {
    return malformed('line item page info');
  }
  if (page.hasNextPage || lineItems.nodes.length > ORDER_LINE_PAGE_SIZE) {
    // An order with more lines than one page cannot be summarised completely, and Extend wants full snapshots only.
    return {status: 'error', reason: 'truncated', detail: 'line items'};
  }
  const lines: ShopifyOrderLineLike[] = [];
  for (const [index, entry] of lineItems.nodes.entries()) {
    const line = lineOf(entry);
    if (line === null) return malformed(`line ${index}`);
    lines.push(line);
  }
  return {
    status: 'ok',
    order: {
      id,
      name,
      currency,
      createdAt,
      totalCents,
      cancelledAt: text(node.cancelledAt, 40),
      refundState: refundStateOf(node.displayFinancialStatus),
      customer: customerOf(node),
      lineItems: lines,
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Detective read (P5B-05). A SEPARATE, leaner document, on purpose:
// - Query cost. Shopify rejects a query whose requested cost is over 1,000 points, and requested cost is counted from the
//   `first:` arguments, not from what comes back. The Extend document above is already close to that limit with 100
//   line items, so adding the fields below to it could push the order read the Extend sync depends on over the limit.
//   ASSUMPTION(V-20): Shopify's rule is roughly one point per object and none per scalar; the figures here are
//   estimates to be confirmed against the extensions.cost of a real response on the development store.
// - Personal data. The detective needs only the shipping ZIP and country, never a name, email, phone or street, so those
//   fields are not requested at all.
// Fields checked against shopify.dev (Admin GraphQL, latest) on 2026-10-14: Order.customAttributes ([Attribute!]!),
// Order.shippingAddress (MailingAddress, null when no shipping is needed), ProductVariant.selectedOptions
// ([SelectedOption!]!). UNVERIFIED(V-20) until a development-store order shows them: that cart attributes (delivery_choice)
// are copied to Order.customAttributes, and that a local-pickup order has a null shippingAddress.
// ---------------------------------------------------------------------------------------------------------------------

/** Lines read per order. A bigger order is unjudgeable (truncated), never judged on a sample. */
export const DETECTIVE_LINE_PAGE_SIZE = 50;

/** Orders per page for the report script: 2 x (50 lines x about 8 objects) stays under the 1,000 point limit (estimate, V-20). */
export const DETECTIVE_ORDERS_PAGE_SIZE = 2;

const DETECTIVE_FRAGMENT = `
fragment DetectiveOrderFields on Order {
  id
  name
  createdAt
  cancelledAt
  currencyCode
  displayFinancialStatus
  totalPriceSet { shopMoney { amount currencyCode } }
  customAttributes { key value }
  shippingAddress { countryCodeV2 zip }
  lineItems(first: ${DETECTIVE_LINE_PAGE_SIZE}) {
    pageInfo { hasNextPage }
    nodes {
      id
      title
      variantTitle
      sku
      quantity
      currentQuantity
      originalUnitPriceSet { shopMoney { amount currencyCode } }
      customAttributes { key value }
      product { id metafield(namespace: "${CATEGORY_NAMESPACE}", key: "${CATEGORY_KEY}") { value } }
      variant { id selectedOptions { name value } }
    }
  }
}`;

export const DETECTIVE_ORDER_BY_ID_QUERY = `query DetectiveOrderById($id: ID!) {
  order(id: $id) { ...DetectiveOrderFields }
}
${DETECTIVE_FRAGMENT}`;

// reverse: true is load-bearing. The report stops at --limit, and Shopify's default direction is oldest first, so without
// it a truncated run would drop the NEWEST orders, the ones most likely to still be actionable. With it the run keeps the
// newest `limit` orders and drops the oldest.
export const DETECTIVE_ORDERS_PAGE_QUERY = `query DetectiveOrdersPage($first: Int!, $after: String, $query: String) {
  orders(first: $first, after: $after, query: $query, sortKey: CREATED_AT, reverse: true) {
    pageInfo { hasNextPage endCursor }
    nodes { ...DetectiveOrderFields }
  }
}
${DETECTIVE_FRAGMENT}`;

export type ParseDetectiveResult =
  | {status: 'ok'; order: DetectiveOrder}
  | {status: 'error'; reason: ParseOrderFailure; detail: string};

const SIZE_KEY = toSlug(SIZE_OPTION_NAME);

/** The Size option of a variant node: undefined when the shape is wrong, null when there is simply no Size option. */
function sizeOfVariant(variant: unknown): string | null | undefined {
  if (variant === null) return null;
  if (!isRecord(variant) || !Array.isArray(variant.selectedOptions)) {
    return undefined;
  }
  const options: readonly unknown[] = variant.selectedOptions;
  for (const option of options) {
    if (!isRecord(option)) return undefined;
    const name = text(option.name, 100);
    if (name !== null && toSlug(name) === SIZE_KEY) {
      return text(option.value, 100);
    }
  }
  return null;
}

function detectiveLineOf(
  value: unknown,
): {line: ShopifyOrderLineLike; size: string | null} | null {
  if (!isRecord(value)) return null;
  const id = text(value.id, 100);
  const title = text(value.title, 500);
  const quantity = count(value.quantity);
  const current = count(value.currentQuantity);
  const unitPriceCents = moneyCents(value.originalUnitPriceSet);
  const attributes = attributesOf(value.customAttributes);
  const size = sizeOfVariant(value.variant ?? null);
  if (
    id === null ||
    title === null ||
    quantity === null ||
    current === null ||
    unitPriceCents === null ||
    attributes === null ||
    size === undefined
  ) {
    return null;
  }
  const product = isRecord(value.product) ? value.product : null;
  const variant = isRecord(value.variant) ? value.variant : null;
  const metafield = isRecord(product?.metafield) ? product.metafield : null;
  return {
    size,
    line: {
      id,
      productId: text(product?.id, 100),
      variantId: text(variant?.id, 100),
      sku: text(value.sku, 200),
      title,
      variantTitle: text(value.variantTitle, 200),
      quantity,
      refundedQuantity: Math.max(0, quantity - current),
      // Not read: the detective never looks at fulfilment or at the discounted price, and asking for them would raise the
      // query cost. Neutral values keep the shared order type satisfied; nothing in app/lib/detective reads them.
      fulfilledQuantity: 0,
      unitPriceCents,
      paidUnitPriceCents: unitPriceCents,
      category: text(metafield?.value, 64),
      attributes,
      parentLineItemId: null,
    },
  };
}

function shippingOf(value: unknown): ShopifyAddressLike | null | undefined {
  if (value === null) return null;
  if (!isRecord(value)) return undefined;
  return {
    address1: null,
    address2: null,
    city: null,
    countryCode: text(value.countryCodeV2, 2),
    postalCode: text(value.zip, 20),
    province: null,
  };
}

/** Maps one Admin order node read with the detective document. Anything missing or malformed is an error, never a guess. */
export function parseDetectiveOrder(node: unknown): ParseDetectiveResult {
  const malformed = (detail: string): ParseDetectiveResult => ({
    status: 'error',
    reason: 'malformed',
    detail,
  });
  if (!isRecord(node)) return malformed('order');
  const id = text(node.id, 100);
  const name = text(node.name, 50);
  const createdAt = text(node.createdAt, 40);
  const currency = text(node.currencyCode, 3);
  const totalCents = moneyCents(node.totalPriceSet);
  const orderAttributes = attributesOf(node.customAttributes);
  const shipping = shippingOf(node.shippingAddress ?? null);
  if (
    id === null ||
    name === null ||
    createdAt === null ||
    currency === null ||
    totalCents === null ||
    orderAttributes === null ||
    shipping === undefined
  ) {
    return malformed('order fields');
  }
  const lineItems = node.lineItems;
  if (!isRecord(lineItems) || !Array.isArray(lineItems.nodes)) {
    return malformed('line items');
  }
  const page = isRecord(lineItems.pageInfo) ? lineItems.pageInfo : null;
  if (page === null || typeof page.hasNextPage !== 'boolean') {
    return malformed('line item page info');
  }
  if (page.hasNextPage || lineItems.nodes.length > DETECTIVE_LINE_PAGE_SIZE) {
    return {status: 'error', reason: 'truncated', detail: 'line items'};
  }
  const lines: ShopifyOrderLineLike[] = [];
  const sizeByLineId = new Map<string, string | null>();
  for (const [index, entry] of lineItems.nodes.entries()) {
    const mapped = detectiveLineOf(entry);
    if (mapped === null) return malformed(`line ${index}`);
    lines.push(mapped.line);
    sizeByLineId.set(mapped.line.id, mapped.size);
  }
  const facts: DetectiveFacts = {attributes: orderAttributes, sizeByLineId};
  return {
    status: 'ok',
    order: {
      order: {
        id,
        name,
        currency,
        createdAt,
        totalCents,
        cancelledAt: text(node.cancelledAt, 40),
        refundState: refundStateOf(node.displayFinancialStatus),
        // No name, email, phone or street is requested; only the shipping ZIP and country (see above).
        customer: {
          name: null,
          email: null,
          phone: null,
          billingAddress: null,
          shippingAddress: shipping,
        },
        lineItems: lines,
      },
      facts,
    },
  };
}
