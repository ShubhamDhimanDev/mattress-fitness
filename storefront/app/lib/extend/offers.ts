// SERVER ONLY. Extend Offers API client (REQ-EXT-001, REQ-EXT-005, NFR-013, T-13).
//
// Request and response shapes are the ones Extend documents (docs/integrations/EXTEND.md section 2, re-read
// 2026-10-12). The response is parsed defensively: Extend's reply is untrusted data, a failure hides the offer
// and logs, and nothing here ever blocks the page.

import type {ExtendConfigResult} from '~/lib/extend/config';
import {
  isUnhealthyHttpStatus,
  type CircuitBreaker,
} from '~/lib/extend/circuit-breaker';
import {callExtend} from '~/lib/extend/http';
import {isPlausiblePlanId} from '~/lib/extend/ids';
import {noopLogger, type ExtendLogger} from '~/lib/extend/log';
import type {
  ExtendCoveredProduct,
  ExtendOffer,
  ExtendPlan,
  ExtendPlanType,
  FetchLike,
  PlanQuote,
} from '~/lib/extend/types';

export const DEFAULT_OFFERS_TIMEOUT_MS = 3000;
const MAX_OFFER_ITEMS = 50;
const MAX_ITEM_QUANTITY = 99;
const MAX_PRICE_CENTS = 100_000_000;
const MAX_OFFERS_IN_RESPONSE = 100;

// ---------------------------------------------------------------- request

export type OfferItem = {
  /** Extend category for the covered product (the client's eligible list, CLR-018). */
  category: string;
  /** Opaque product identifier sent to Extend; the same value is stored as `_extend_covered_product_id`. */
  productId: string;
  /** Shopify's price for the covered item, in integer cents. */
  purchasePriceCents: number;
  quantity: number;
};

export type OffersRequestBody = {
  storeId: string;
  currency: 'USD';
  items: Array<{
    category: string;
    productId: string;
    purchasePrice: number;
    quantity: number;
  }>;
};

function isValidItem(item: OfferItem): boolean {
  return (
    /^[A-Za-z0-9][A-Za-z0-9 _&/-]{0,63}$/.test(item.category) &&
    /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(item.productId) &&
    Number.isSafeInteger(item.purchasePriceCents) &&
    item.purchasePriceCents > 0 &&
    item.purchasePriceCents <= MAX_PRICE_CENTS &&
    Number.isSafeInteger(item.quantity) &&
    item.quantity >= 1 &&
    item.quantity <= MAX_ITEM_QUANTITY
  );
}

/** The documented POST /offers body. `locale` is optional in Extend's docs and is not sent (US English only). */
export function buildOffersBody(
  storeId: string,
  items: readonly OfferItem[],
):
  | {status: 'ok'; body: OffersRequestBody}
  | {status: 'error'; reason: 'invalid_request'} {
  if (
    items.length === 0 ||
    items.length > MAX_OFFER_ITEMS ||
    !items.every(isValidItem)
  ) {
    return {status: 'error', reason: 'invalid_request'};
  }
  return {
    status: 'ok',
    body: {
      storeId,
      currency: 'USD',
      items: items.map((item) => ({
        category: item.category,
        productId: item.productId,
        purchasePrice: item.purchasePriceCents,
        quantity: item.quantity,
      })),
    },
  };
}

/** REQ-EXT-005: products outside the client's category list never reach Extend and never show an offer. */
export function filterEligibleItems(
  items: readonly OfferItem[],
  eligibleCategories: Iterable<string>,
): {eligible: OfferItem[]; ineligible: OfferItem[]} {
  const allowed = new Set<string>();
  for (const category of eligibleCategories) {
    allowed.add(category.trim().toLowerCase());
  }
  const eligible: OfferItem[] = [];
  const ineligible: OfferItem[] = [];
  for (const item of items) {
    (allowed.has(item.category.trim().toLowerCase())
      ? eligible
      : ineligible
    ).push(item);
  }
  return {eligible, ineligible};
}

// --------------------------------------------------------------- response

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' || trimmed.length > max ? null : trimmed;
}

function safeInt(value: unknown, min: number): number | null {
  return typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= min &&
    value <= MAX_PRICE_CENTS
    ? value
    : null;
}

/** Links come from a third party and end up in an href: https only (T-07). */
function httpsUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      url.username !== '' ||
      url.password !== ''
    ) {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}

function parsePlan(value: unknown): ExtendPlan | null {
  if (!isRecord(value)) return null;
  const id = value.id;
  const priceCents = safeInt(value.price, 1);
  const title = boundedString(value.title, 200);
  // Without a terms link the offer would break Extend's branding rule (REQ-EXT-004), so the plan is dropped.
  const url = httpsUrl(value.url);
  if (
    !isPlausiblePlanId(id) ||
    priceCents === null ||
    title === null ||
    url === null
  ) {
    return null;
  }
  const contract = isRecord(value.contract) ? value.contract : {};
  return {
    id,
    priceCents,
    title,
    contract: {
      category: boundedString(contract.category, 100),
      coverageIncludes: boundedString(contract.coverageIncludes, 500),
      coverageStarts: boundedString(contract.coverageStarts, 200),
      deductible: safeInt(contract.deductible, 0),
      termLength: safeInt(contract.termLength, 1),
    },
    url,
    offerPlanId: boundedString(value.offerPlanId, 200),
    imageUrl: httpsUrl(value.imageUrl),
  };
}

type PlanList =
  {valid: true; plans: ExtendPlan[]; raw: number} | {valid: false};

function parsePlanList(value: unknown): PlanList {
  if (value === undefined) return {valid: true, plans: [], raw: 0};
  if (!Array.isArray(value)) return {valid: false};
  const seen = new Set<string>();
  const plans: ExtendPlan[] = [];
  for (const entry of value) {
    const plan = parsePlan(entry);
    if (plan !== null && !seen.has(plan.id)) {
      seen.add(plan.id);
      plans.push(plan);
    }
  }
  return {valid: true, plans, raw: value.length};
}

function parseCoveredProduct(value: unknown): ExtendCoveredProduct | null {
  if (!isRecord(value)) return null;
  const productId = boundedString(value.productId, 128);
  const quantity = safeInt(value.quantity, 1);
  const purchasePriceCents = safeInt(value.purchasePrice, 0);
  if (productId === null || quantity === null || purchasePriceCents === null) {
    return null;
  }
  return {productId, quantity, purchasePriceCents};
}

type ParsedOffer =
  {valid: true; offer: ExtendOffer; rawPlans: number} | {valid: false};

function parseOffer(value: unknown): ParsedOffer {
  if (!isRecord(value) || !isRecord(value.plans)) return {valid: false};
  const offerId = boundedString(value.offerId, 200);
  if (offerId === null || !Array.isArray(value.coveredProducts)) {
    return {valid: false};
  }
  const adh = parsePlanList(value.plans.adh);
  const base = parsePlanList(value.plans.base);
  if (!adh.valid || !base.valid) return {valid: false};

  const coveredProducts: ExtendCoveredProduct[] = [];
  for (const entry of value.coveredProducts) {
    const covered = parseCoveredProduct(entry);
    if (covered === null) return {valid: false};
    coveredProducts.push(covered);
  }
  if (coveredProducts.length === 0) return {valid: false};

  // Documented as the string "adh" or "base". Anything else is ignored rather than trusted.
  const recommendedRaw = value.plans.recommended;
  const recommended: ExtendPlanType | null =
    recommendedRaw === 'adh' || recommendedRaw === 'base'
      ? recommendedRaw
      : null;

  return {
    valid: true,
    rawPlans: adh.raw + base.raw,
    offer: {
      offerId,
      plans: {adh: adh.plans, base: base.plans, recommended},
      coveredProducts,
    },
  };
}

export type ParsedOffers =
  | {
      status: 'ok';
      offerCartId: string | null;
      offers: ExtendOffer[];
      /** Offers or plans discarded because they were malformed or referenced products we did not ask about. */
      droppedCount: number;
    }
  | {status: 'error'; reason: 'malformed'};

/**
 * Validates an Offers response against what we asked for. Extend's reply is untrusted: an offer that covers a
 * product we did not request is discarded, and a response where everything it contained failed validation is
 * reported as malformed (a contract break, not an empty result) so the circuit breaker sees it.
 */
export function parseOffersResponse(
  body: unknown,
  requested: readonly OfferItem[],
  expected: {storeId: string},
): ParsedOffers {
  const malformed = {status: 'error', reason: 'malformed'} as const;
  if (!isRecord(body) || !Array.isArray(body.offers)) return malformed;
  if (body.offers.length > MAX_OFFERS_IN_RESPONSE) return malformed;
  if (body.currency !== undefined && body.currency !== 'USD') return malformed;
  if (body.storeId !== undefined && body.storeId !== expected.storeId) {
    return malformed;
  }

  const requestedIds = new Set(requested.map((item) => item.productId));
  const offers: ExtendOffer[] = [];
  let droppedCount = 0;
  let rawPlans = 0;
  let validPlans = 0;

  for (const entry of body.offers) {
    const parsed = parseOffer(entry);
    if (!parsed.valid) {
      droppedCount += 1;
      continue;
    }
    rawPlans += parsed.rawPlans;
    if (
      !parsed.offer.coveredProducts.every((product) =>
        requestedIds.has(product.productId),
      )
    ) {
      droppedCount += 1;
      continue;
    }
    validPlans +=
      parsed.offer.plans.adh.length + parsed.offer.plans.base.length;
    offers.push(parsed.offer);
  }

  if (body.offers.length > 0 && offers.length === 0) return malformed;
  if (rawPlans > 0 && validPlans === 0) return malformed;

  return {
    status: 'ok',
    offerCartId: boundedString(body.offerCartId, 200),
    offers,
    droppedCount,
  };
}

/**
 * Plan id -> price, from a fresh Offers response. Used by cart-time revalidation (linking.ts) and as the quote
 * source for the order cross-check. A plan id quoted at two different prices is ambiguous, so it is left out
 * and reported: an unverifiable price must never be treated as verified.
 */
export function quotesFromOffers(offers: readonly ExtendOffer[]): {
  quotes: Map<string, PlanQuote>;
  conflictingPlanIds: string[];
} {
  const quotes = new Map<string, PlanQuote>();
  const conflicts = new Set<string>();
  for (const offer of offers) {
    for (const plan of [...offer.plans.adh, ...offer.plans.base]) {
      const existing = quotes.get(plan.id);
      if (existing !== undefined && existing.priceCents !== plan.priceCents) {
        conflicts.add(plan.id);
      } else {
        quotes.set(plan.id, {planId: plan.id, priceCents: plan.priceCents});
      }
    }
  }
  for (const id of conflicts) quotes.delete(id);
  return {quotes, conflictingPlanIds: [...conflicts]};
}

// ------------------------------------------------------------------ fetch

export type OffersFailureReason =
  | 'disabled'
  | 'invalid_request'
  | 'circuit_open'
  | 'timeout'
  | 'network'
  | 'http'
  | 'malformed';

export type OffersResult =
  | {
      status: 'ok';
      offerCartId: string | null;
      offers: ExtendOffer[];
      droppedCount: number;
      /** Product ids that were skipped because their category is not on the eligible list. */
      ineligibleProductIds: string[];
    }
  | {
      status: 'error';
      reason: OffersFailureReason;
      httpStatus?: number;
      retryAfterMs?: number;
    };

export type OffersDeps = {
  config: ExtendConfigResult;
  fetch: FetchLike;
  breaker?: CircuitBreaker;
  log?: ExtendLogger;
  timeoutMs?: number;
};

export async function fetchOffers(
  deps: OffersDeps,
  items: readonly OfferItem[],
  eligibleCategories: Iterable<string>,
): Promise<OffersResult> {
  if (deps.config.status !== 'enabled') {
    return {status: 'error', reason: 'disabled'};
  }
  const {config} = deps.config;
  const log = deps.log ?? noopLogger;

  const {eligible, ineligible} = filterEligibleItems(items, eligibleCategories);
  const ineligibleProductIds = ineligible.map((item) => item.productId);
  if (eligible.length === 0) {
    // Nothing to ask Extend; an empty result is the correct answer for an ineligible cart (REQ-EXT-005).
    return {
      status: 'ok',
      offerCartId: null,
      offers: [],
      droppedCount: 0,
      ineligibleProductIds,
    };
  }

  const request = buildOffersBody(config.storeId, eligible);
  if (request.status === 'error') return request;

  if (deps.breaker) {
    const permit = deps.breaker.acquire();
    if (!permit.allowed) {
      return {
        status: 'error',
        reason: 'circuit_open',
        retryAfterMs: permit.retryAfterMs,
      };
    }
  }

  const result = await callExtend(config, deps.fetch, {
    method: 'POST',
    path: '/offers',
    body: request.body,
    timeoutMs: deps.timeoutMs ?? DEFAULT_OFFERS_TIMEOUT_MS,
    expectJson: true,
  });

  const fail = (
    reason: 'timeout' | 'network' | 'http' | 'malformed',
    httpStatus?: number,
    retryAfterMs?: number,
  ): OffersResult => {
    const unhealthy =
      reason !== 'http' ||
      (httpStatus !== undefined && isUnhealthyHttpStatus(httpStatus));
    if (deps.breaker) {
      if (unhealthy) {
        const before = deps.breaker.snapshot().state;
        deps.breaker.recordFailure();
        if (before !== 'open' && deps.breaker.snapshot().state === 'open') {
          log({level: 'warn', event: 'offers.circuit_open', reason});
        }
      } else {
        // A 4xx about our request still proves Extend is answering.
        deps.breaker.recordSuccess();
      }
    }
    log({
      level: 'warn',
      event: 'offers.request_failed',
      reason,
      ...(httpStatus === undefined ? {} : {httpStatus}),
    });
    return {
      status: 'error',
      reason,
      ...(httpStatus === undefined ? {} : {httpStatus}),
      ...(retryAfterMs === undefined ? {} : {retryAfterMs}),
    };
  };

  if (result.status === 'error') {
    return fail(result.reason, result.httpStatus, result.retryAfterMs);
  }

  const parsed = parseOffersResponse(result.body, eligible, {
    storeId: config.storeId,
  });
  if (parsed.status === 'error') return fail('malformed');

  deps.breaker?.recordSuccess();
  if (parsed.droppedCount > 0) {
    log({
      level: 'warn',
      event: 'offers.response_dropped_items',
      count: parsed.droppedCount,
    });
  }
  return {
    status: 'ok',
    offerCartId: parsed.offerCartId,
    offers: parsed.offers,
    droppedCount: parsed.droppedCount,
    ineligibleProductIds,
  };
}

// ------------------------------------------------------------ quote lookup

export type OffersQuoteLookupDeps = OffersDeps & {
  eligibleCategories: readonly string[];
};

/**
 * The `QuoteLookup` the order sync needs (ADR-0009 decision 7): asks the Offers API again for the covered item and
 * answers with the price Extend quotes for the plan id the order claims, or `null` when Extend does not offer that
 * plan for that product and price. It THROWS when Extend cannot answer (disabled, down, slow, malformed), so the sync
 * fails as retriable instead of flagging an order that may be perfectly valid.
 *
 * ASSUMPTION(V-11): the quote is re-derived from the covered item's current list price. If Extend quotes by price
 * band and the item's price changed after the sale, a legitimate plan can fall outside the band and be flagged for
 * staff; that is the safe direction, and Extend's behaviour for changed prices is an open question (EXTEND.md 3.5).
 */
export function createOffersQuoteLookup(deps: OffersQuoteLookupDeps) {
  return async (query: {
    planId: string;
    coveredProductId: string;
    category: string;
    coveredUnitPriceCents: number;
  }): Promise<PlanQuote | null> => {
    const result = await fetchOffers(
      deps,
      [
        {
          category: query.category,
          productId: query.coveredProductId,
          purchasePriceCents: query.coveredUnitPriceCents,
          quantity: 1,
        },
      ],
      deps.eligibleCategories,
    );
    if (result.status === 'error') {
      throw new Error(`quote lookup unavailable: ${result.reason}`);
    }
    return quotesFromOffers(result.offers).quotes.get(query.planId) ?? null;
  };
}
