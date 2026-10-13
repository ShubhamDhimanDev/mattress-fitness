// Order snapshot builder for Extend's Orders API (REQ-EXT-003, T-03, T-06, ADR-0009 decisions 3 and 7).
// Pure: a Shopify order in, a full-snapshot PUT /orders body out. No I/O.
//
// Documented semantics used here (docs/integrations/EXTEND.md section 2):
// - PUT /orders is idempotent and every request is a FULL snapshot keyed by `transactionId`.
// - A contract is issued only when a line's `fulfilledQuantity` goes from 0 to a positive number.
// - Category Orders: a `category_contract` line carries a `plan` and `coveredProducts`.
// - Full refund: order `status: "refunded"`. Partial refund: reduce `quantity` and the matching `coveredProducts`.
//   Removal: omit the line. Never send partial updates.
//
// Everything not in that list is an ASSUMPTION(V-11), tagged where it is used and collected in EXTEND.md.

import {isPlausiblePlanId, normalizeShopifyId} from '~/lib/extend/ids';
import {EXTEND_LINE_ATTRIBUTES} from '~/lib/extend/linking';
import {parsePricePointName} from '~/lib/extend/price-points';
import type {PlanQuote} from '~/lib/extend/types';

// ------------------------------------------------------------ Shopify side

export type ShopifyAddressLike = {
  address1: string | null;
  address2: string | null;
  city: string | null;
  countryCode: string | null;
  postalCode: string | null;
  province: string | null;
};

export type ShopifyCustomerLike = {
  name: string | null;
  email: string | null;
  phone: string | null;
  billingAddress: ShopifyAddressLike | null;
  shippingAddress: ShopifyAddressLike | null;
};

export type ShopifyOrderLineLike = {
  /** Shopify line item id (GID or number). The Extend `lineItemTransactionId` is derived from it. */
  id: string;
  productId: string | null;
  variantId: string | null;
  sku: string | null;
  title: string;
  variantTitle: string | null;
  /** Quantity originally ordered. */
  quantity: number;
  /** Units cancelled, refunded or removed after the order was placed. */
  refundedQuantity: number;
  fulfilledQuantity: number;
  /** Price per unit before discounts: the variant price. Compared with the quoted plan price for coverage lines. */
  unitPriceCents: number;
  /** Price per unit actually paid after line discounts. */
  paidUnitPriceCents: number;
  /** Extend category for the product, resolved by the Shopify read layer; null when the product is not eligible. */
  category: string | null;
  attributes: Readonly<Record<string, string>>;
  /** Parent line item id when Shopify preserved the nested-line relationship on the order (unknown, V-16); else null. */
  parentLineItemId: string | null;
};

export type ShopifyOrderLike = {
  id: string;
  name: string;
  currency: string;
  /** ISO 8601. */
  createdAt: string;
  totalCents: number;
  cancelledAt: string | null;
  refundState: 'none' | 'partial' | 'full';
  customer: ShopifyCustomerLike;
  lineItems: readonly ShopifyOrderLineLike[];
};

// -------------------------------------------------------------- Extend side

export type ExtendAddress = {
  address1?: string;
  address2?: string;
  city?: string;
  countryCode?: string;
  postalCode?: string;
  province?: string;
};

export type ExtendCustomer = {
  name?: string;
  email?: string;
  phone?: string;
  billingAddress?: ExtendAddress;
  shippingAddress?: ExtendAddress;
};

export type ExtendProductLine = {
  lineItemTransactionId: string;
  product: {
    id: string;
    title: string;
    category: string;
    listPrice: number;
    purchasePrice: number;
    purchaseDate: number;
  };
  quantity: number;
  fulfilledQuantity: number;
};

export type ExtendContractLine = {
  type: 'category_contract';
  lineItemTransactionId: string;
  quantity: 1;
  fulfilledQuantity: 0 | 1;
  plan: {id: string; purchasePrice: number; purchaseDate: number};
  coveredProducts: Array<{
    lineItemTransactionId: string;
    productId: string;
    quantity: number;
  }>;
};

export type ExtendLineItem = ExtendProductLine | ExtendContractLine;

export type ExtendOrderSnapshot = {
  transactionId: string;
  storeId: string;
  currency: 'USD';
  transactionDate: number;
  total: number;
  customer: ExtendCustomer;
  status?: 'refunded';
  lineItems: ExtendLineItem[];
};

// ------------------------------------------------------------ cross-check

export type FlagReason =
  | 'invalid_plan_id'
  | 'invalid_covered_product_id'
  | 'covered_product_missing'
  | 'covered_product_mismatch'
  | 'covered_product_ambiguous'
  | 'covered_product_ineligible'
  | 'duplicate_coverage'
  | 'unknown_plan'
  | 'price_mismatch';

/** A coverage line that is NEVER sent to Extend; staff must look at it. */
export type FlaggedLine = {lineId: string; reason: FlagReason};

/** A coverage line that is sent but looks wrong. */
export type CoverageWarning = {lineId: string; reason: 'quantity_mismatch'};

/** What the quote lookup needs to decide whether a plan id is legitimately offered for the covered item. */
export type QuoteQuery = {
  planId: string;
  coveredProductId: string;
  category: string;
  coveredUnitPriceCents: number;
};

export type CrossCheckResult =
  | {ok: true; warnings: CoverageWarning[]}
  | {ok: false; flagged: FlaggedLine[]; warnings: CoverageWarning[]}
  | {
      ok: false;
      flagged: readonly [];
      warnings: readonly [];
      invalidOrder: string;
    };

export type SnapshotBuild =
  | {
      status: 'ok';
      snapshot: ExtendOrderSnapshot;
      flagged: FlaggedLine[];
      warnings: CoverageWarning[];
      /** Coverage lines present on the order (any quantity). Zero means there is nothing for Extend. */
      coverageLineCount: number;
      /** Contract lines in the snapshot. */
      contractLineCount: number;
      planIds: string[];
    }
  | {
      status: 'error';
      reason: 'invalid_order' | 'unsupported_currency';
      detail: string;
    };

// ---------------------------------------------------------------- internals

const MAX_LINES = 500;
const MAX_COUNT = 100_000;
const MAX_CENTS = 1_000_000_000;

type LineView = {
  index: number;
  line: ShopifyOrderLineLike;
  /** Normalised Shopify line id. */
  key: string;
  isCoverage: boolean;
  /** Quantity that still stands: ordered minus refunded, or the ordered quantity once the whole order is refunded. */
  effectiveQuantity: number;
  fulfilledQuantity: number;
};

type Prepared = {
  orderKey: string;
  purchasedAt: number;
  terminal: boolean;
  views: LineView[];
};

type Prepare =
  | {status: 'ok'; prepared: Prepared}
  | {
      status: 'error';
      reason: 'invalid_order' | 'unsupported_currency';
      detail: string;
    };

function isCount(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_COUNT;
}

function isCents(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_CENTS;
}

/**
 * A coverage line is a price-point SKU (by sku, variant title or title). A plan-id attribute alone does NOT make a line
 * coverage: a direct-API cart could attach that property to a mattress line and make it vanish from the report.
 */
export function isCoverageOrderLine(line: ShopifyOrderLineLike): boolean {
  return [line.sku, line.variantTitle, line.title].some(
    (name) => name !== null && parsePricePointName(name).status === 'ok',
  );
}

function prepareOrder(order: ShopifyOrderLike): Prepare {
  const fail = (
    detail: string,
    reason: 'invalid_order' | 'unsupported_currency' = 'invalid_order',
  ): Prepare => ({status: 'error', reason, detail});

  const orderKey = normalizeShopifyId(order.id);
  if (orderKey === null) return fail('order id');
  if (order.currency !== 'USD') {
    return fail('currency must be USD', 'unsupported_currency');
  }
  const purchasedAt = Date.parse(order.createdAt);
  if (!Number.isFinite(purchasedAt)) return fail('createdAt');
  if (!isCents(order.totalCents)) return fail('total');
  if (!Array.isArray(order.lineItems) || order.lineItems.length > MAX_LINES) {
    return fail('line items');
  }

  const terminal =
    order.refundState === 'full' ||
    (order.cancelledAt !== null && order.cancelledAt !== '');
  const seen = new Set<string>();
  const views: LineView[] = [];

  for (const [index, line] of order.lineItems.entries()) {
    const key = normalizeShopifyId(line.id);
    if (key === null) return fail(`line ${index}: id`);
    if (seen.has(key)) return fail(`line ${key}: duplicate id`);
    seen.add(key);
    if (
      !isCount(line.quantity) ||
      !isCount(line.refundedQuantity) ||
      !isCount(line.fulfilledQuantity)
    ) {
      return fail(`line ${key}: quantity`);
    }
    if (!isCents(line.unitPriceCents) || !isCents(line.paidUnitPriceCents)) {
      return fail(`line ${key}: price`);
    }
    const isCoverage = isCoverageOrderLine(line);
    if (
      !isCoverage &&
      line.category !== null &&
      normalizeShopifyId(line.productId) === null
    ) {
      return fail(`line ${key}: product id`);
    }
    const effectiveQuantity = terminal
      ? line.quantity
      : Math.max(0, line.quantity - line.refundedQuantity);
    views.push({
      index,
      line,
      key,
      isCoverage,
      effectiveQuantity,
      fulfilledQuantity: Math.min(line.fulfilledQuantity, effectiveQuantity),
    });
  }
  return {
    status: 'ok',
    prepared: {orderKey, purchasedAt, terminal, views},
  };
}

type Candidate = {
  coverage: LineView;
  covered: LineView;
  planId: string;
  coveredProductId: string;
};

type Structural = {
  candidates: Candidate[];
  flagged: FlaggedLine[];
  coverageLineCount: number;
};

type CoveredResolution =
  {status: 'found'; covered: LineView} | {status: 'flag'; reason: FlagReason};

function resolveCovered(
  coverage: LineView,
  coveredProductId: string,
  productViews: readonly LineView[],
): CoveredResolution {
  const parentKey = normalizeShopifyId(coverage.line.parentLineItemId);
  let covered: LineView | undefined;

  if (coverage.line.parentLineItemId !== null) {
    covered = productViews.find((view) => view.key === parentKey);
    if (covered === undefined) {
      return {status: 'flag', reason: 'covered_product_missing'};
    }
    if (normalizeShopifyId(covered.line.productId) !== coveredProductId) {
      return {status: 'flag', reason: 'covered_product_mismatch'};
    }
  } else {
    // ASSUMPTION(V-11): Shopify may not preserve the nested-line parent on the order (EXTEND.md section 3, item 6),
    // so without it we fall back to the covered product id and refuse to guess when two lines share a product.
    const matches = productViews.filter(
      (view) => normalizeShopifyId(view.line.productId) === coveredProductId,
    );
    if (matches.length === 0) {
      return {status: 'flag', reason: 'covered_product_missing'};
    }
    if (matches.length > 1) {
      return {status: 'flag', reason: 'covered_product_ambiguous'};
    }
    covered = matches[0];
  }

  if (covered === undefined) {
    return {status: 'flag', reason: 'covered_product_missing'};
  }
  if (covered.line.category === null) {
    return {status: 'flag', reason: 'covered_product_ineligible'};
  }
  if (covered.effectiveQuantity === 0) {
    return {status: 'flag', reason: 'covered_product_missing'};
  }
  return {status: 'found', covered};
}

function structuralAnalysis(prepared: Prepared): Structural {
  const productViews = prepared.views.filter((view) => !view.isCoverage);
  const coverageViews = prepared.views.filter((view) => view.isCoverage);
  const candidates: Candidate[] = [];
  const flagged: FlaggedLine[] = [];
  const claimed = new Set<string>();

  for (const coverage of coverageViews) {
    // A coverage line that has been refunded or removed away entirely is a removal, not an anomaly.
    if (coverage.effectiveQuantity === 0) continue;

    const planId = coverage.line.attributes[EXTEND_LINE_ATTRIBUTES.planId];
    if (!isPlausiblePlanId(planId)) {
      flagged.push({lineId: coverage.key, reason: 'invalid_plan_id'});
      continue;
    }
    const coveredProductId = normalizeShopifyId(
      coverage.line.attributes[EXTEND_LINE_ATTRIBUTES.coveredProductId],
    );
    if (coveredProductId === null) {
      flagged.push({
        lineId: coverage.key,
        reason: 'invalid_covered_product_id',
      });
      continue;
    }
    const resolution = resolveCovered(coverage, coveredProductId, productViews);
    if (resolution.status === 'flag') {
      flagged.push({lineId: coverage.key, reason: resolution.reason});
      continue;
    }
    // One coverage line per covered line: a second paid coverage on the same item is a customer-service case.
    if (claimed.has(resolution.covered.key)) {
      flagged.push({lineId: coverage.key, reason: 'duplicate_coverage'});
      continue;
    }
    claimed.add(resolution.covered.key);
    candidates.push({
      coverage,
      covered: resolution.covered,
      planId,
      coveredProductId,
    });
  }
  return {candidates, flagged, coverageLineCount: coverageViews.length};
}

type Verified = Candidate & {quote: PlanQuote};

function verifyCandidates(
  candidates: readonly Candidate[],
  quotesByLineId: ReadonlyMap<string, PlanQuote | null>,
): {verified: Verified[]; flagged: FlaggedLine[]; warnings: CoverageWarning[]} {
  const verified: Verified[] = [];
  const flagged: FlaggedLine[] = [];
  const warnings: CoverageWarning[] = [];

  for (const candidate of candidates) {
    const quote = quotesByLineId.get(candidate.coverage.key);
    // A missing lookup is "unknown", never "fine": an unverifiable price must not be reported.
    if (
      quote === undefined ||
      quote === null ||
      quote.planId !== candidate.planId
    ) {
      flagged.push({lineId: candidate.coverage.key, reason: 'unknown_plan'});
      continue;
    }
    if (quote.priceCents !== candidate.coverage.line.unitPriceCents) {
      flagged.push({lineId: candidate.coverage.key, reason: 'price_mismatch'});
      continue;
    }
    if (
      candidate.coverage.effectiveQuantity !==
      candidate.covered.effectiveQuantity
    ) {
      warnings.push({
        lineId: candidate.coverage.key,
        reason: 'quantity_mismatch',
      });
    }
    verified.push({...candidate, quote});
  }
  return {verified, flagged, warnings};
}

function byLineIndex(prepared: Prepared) {
  const order = new Map(prepared.views.map((view) => [view.key, view.index]));
  return (a: {lineId: string}, b: {lineId: string}) =>
    (order.get(a.lineId) ?? 0) - (order.get(b.lineId) ?? 0);
}

// ---------------------------------------------------------------- public API

/**
 * The lookups the sync must run before building: one per coverage line that passed the structural checks.
 * The lookup should confirm the plan id is genuinely offered for that covered product and price (for example by
 * asking the Offers API again), not merely that the id exists.
 */
export function listQuoteQueries(
  order: ShopifyOrderLike,
): Array<{lineId: string; query: QuoteQuery}> {
  const prepared = prepareOrder(order);
  if (prepared.status === 'error') return [];
  return structuralAnalysis(prepared.prepared).candidates.flatMap(
    (candidate) => {
      const category = candidate.covered.line.category;
      // Structural analysis flags ineligible covered lines, so a candidate always has a category.
      if (category === null) return [];
      return [
        {
          lineId: candidate.coverage.key,
          query: {
            planId: candidate.planId,
            coveredProductId: candidate.coveredProductId,
            category,
            coveredUnitPriceCents: candidate.covered.line.unitPriceCents,
          },
        },
      ];
    },
  );
}

/**
 * ADR-0009 decision 7. A direct-API cart can add a cheap price-point SKU alone, or attach any plan id as an
 * attribute. So before anything is reported, each coverage line must (a) have a plan id whose quoted price equals
 * the price actually charged for the line, and (b) cover a product that is in the same order. Failures are
 * returned as `flagged` and are never sent to Extend.
 */
export function crossCheckCoverage(
  order: ShopifyOrderLike,
  quotesByLineId: ReadonlyMap<string, PlanQuote | null>,
): CrossCheckResult {
  const prepared = prepareOrder(order);
  if (prepared.status === 'error') {
    return {
      ok: false,
      flagged: [],
      warnings: [],
      invalidOrder: prepared.detail,
    };
  }
  const structural = structuralAnalysis(prepared.prepared);
  const quoted = verifyCandidates(structural.candidates, quotesByLineId);
  const sort = byLineIndex(prepared.prepared);
  const flagged = [...structural.flagged, ...quoted.flagged].sort(sort);
  return flagged.length === 0
    ? {ok: true, warnings: quoted.warnings}
    : {ok: false, flagged, warnings: quoted.warnings};
}

function cleanText(value: string | null, max: number): string | undefined {
  if (value === null) return undefined;
  const trimmed = value.trim().slice(0, max);
  return trimmed === '' ? undefined : trimmed;
}

function buildAddress(
  address: ShopifyAddressLike | null,
): ExtendAddress | undefined {
  if (address === null) return undefined;
  const address1 = cleanText(address.address1, 200);
  const address2 = cleanText(address.address2, 200);
  const city = cleanText(address.city, 100);
  const countryCode = cleanText(address.countryCode, 2);
  const postalCode = cleanText(address.postalCode, 20);
  const province = cleanText(address.province, 50);
  const result: ExtendAddress = {
    ...(address1 === undefined ? {} : {address1}),
    ...(address2 === undefined ? {} : {address2}),
    ...(city === undefined ? {} : {city}),
    ...(countryCode === undefined ? {} : {countryCode}),
    ...(postalCode === undefined ? {} : {postalCode}),
    ...(province === undefined ? {} : {province}),
  };
  return Object.keys(result).length === 0 ? undefined : result;
}

function buildCustomer(customer: ShopifyCustomerLike): ExtendCustomer {
  const result: ExtendCustomer = {};
  const name = cleanText(customer.name, 200);
  const email = cleanText(customer.email, 320);
  const phone = cleanText(customer.phone, 50);
  const billing = buildAddress(customer.billingAddress);
  const shipping = buildAddress(customer.shippingAddress);
  if (name !== undefined) result.name = name;
  if (email !== undefined) result.email = email;
  if (phone !== undefined) result.phone = phone;
  if (billing !== undefined) result.billingAddress = billing;
  if (shipping !== undefined) result.shippingAddress = shipping;
  return result;
}

function productLine(
  view: LineView,
  purchasedAt: number,
): ExtendProductLine | null {
  const productId = normalizeShopifyId(view.line.productId);
  // prepareOrder already required both; narrowing here keeps the builder free of assertions.
  if (view.line.category === null || productId === null) return null;
  return {
    lineItemTransactionId: view.key,
    product: {
      id: productId,
      title: view.line.title.trim().slice(0, 200),
      category: view.line.category,
      listPrice: view.line.unitPriceCents,
      purchasePrice: view.line.paidUnitPriceCents,
      purchaseDate: purchasedAt,
    },
    quantity: view.effectiveQuantity,
    fulfilledQuantity: view.fulfilledQuantity,
  };
}

/**
 * Builds the full PUT /orders snapshot. The same Shopify order always yields the same snapshot (stable ids, stable
 * order, no clocks), which is what makes retries and webhook replays safe.
 *
 * Lines that do not stand any more are omitted (the documented way to remove a line). A fully refunded or cancelled
 * order keeps its original quantities and carries `status: "refunded"`.
 * ASSUMPTION(V-11): Extend documents no "cancelled" status, so a cancelled order is reported as refunded.
 */
export function buildOrderSnapshot(
  order: ShopifyOrderLike,
  options: {
    storeId: string;
    quotesByLineId: ReadonlyMap<string, PlanQuote | null>;
  },
): SnapshotBuild {
  const preparedResult = prepareOrder(order);
  if (preparedResult.status === 'error') return preparedResult;
  const {prepared} = preparedResult;

  const structural = structuralAnalysis(prepared);
  const quoted = verifyCandidates(
    structural.candidates,
    options.quotesByLineId,
  );
  const sort = byLineIndex(prepared);
  const flagged = [...structural.flagged, ...quoted.flagged].sort(sort);
  const warnings = [...quoted.warnings].sort(sort);

  const lineItems: ExtendLineItem[] = [];
  for (const view of prepared.views) {
    if (view.isCoverage || view.effectiveQuantity === 0) continue;
    const line = productLine(view, prepared.purchasedAt);
    if (line !== null) lineItems.push(line);
  }

  for (const entry of quoted.verified) {
    const coveredQuantity = Math.min(
      entry.coverage.effectiveQuantity,
      entry.covered.effectiveQuantity,
    );
    const coveredProductId = normalizeShopifyId(entry.covered.line.productId);
    if (coveredProductId === null) continue;
    lineItems.push({
      type: 'category_contract',
      // Derived from the immutable Shopify line id, so it never changes between snapshots (docs: ids are immutable).
      // ASSUMPTION(V-11): Extend documents only "unique within the order and immutable", so the "-contract" suffix
      // is our own format. Category Orders (not Product Protection) and the category value are open questions
      // (EXTEND.md section 3, item 3); the category sent is whatever the Shopify read layer resolved.
      lineItemTransactionId: `${entry.coverage.key}-contract`,
      quantity: 1,
      // Docs: set the contract line's fulfilledQuantity to 1 once its first covered product is fulfilled.
      fulfilledQuantity: entry.covered.fulfilledQuantity > 0 ? 1 : 0,
      plan: {
        id: entry.planId,
        // ASSUMPTION(V-11): plan.purchasePrice is the total for the covered quantity ("total cost of the category
        // plan"); we report quoted unit price times covered quantity.
        purchasePrice: entry.quote.priceCents * coveredQuantity,
        purchaseDate: prepared.purchasedAt,
      },
      coveredProducts: [
        {
          lineItemTransactionId: entry.covered.key,
          productId: coveredProductId,
          quantity: coveredQuantity,
        },
      ],
    });
  }

  const contractLineCount = quoted.verified.length;
  return {
    status: 'ok',
    snapshot: {
      transactionId: prepared.orderKey,
      storeId: options.storeId,
      currency: 'USD',
      transactionDate: prepared.purchasedAt,
      total: order.totalCents,
      customer: buildCustomer(order.customer),
      ...(prepared.terminal ? {status: 'refunded' as const} : {}),
      lineItems,
    },
    flagged,
    warnings,
    coverageLineCount: structural.coverageLineCount,
    contractLineCount,
    planIds: quoted.verified.map((entry) => entry.planId),
  };
}
