// SERVER ONLY. Cart items in, sellable coverage plans out (P5A-04, REQ-EXT-001, REQ-EXT-002, REQ-EXT-005, NFR-013, T-13).
// Shared by the offers route (product page, one variant) and the cart gate seam (every cart line), so the two can
// never disagree about what is offerable.
//
// A plan is offered only when its price equals an existing price-point variant (price-points.ts): we never charge a
// price other than the one quoted. Nothing in the result carries a credential, a variant id or a raw Extend payload.
// Failure of any kind (flag off, Extend slow or down, malformed answer) is `unavailable` and hides the offer; it never
// throws and never blocks the page.

import type {CircuitBreaker} from '~/lib/extend/circuit-breaker';
import type {ExtendConfigResult} from '~/lib/extend/config';
import {normalizeShopifyId} from '~/lib/extend/ids';
import type {ExtendLogger} from '~/lib/extend/log';
import {noopLogger} from '~/lib/extend/log';
import {
  fetchOffers,
  type OfferItem,
  type OffersFailureReason,
} from '~/lib/extend/offers';
import {
  matchPlansToPricePoints,
  type PricePointIndex,
} from '~/lib/extend/price-points';
import type {FetchLike, NowFn} from '~/lib/extend/types';

/** One cart line or one product-page variant. `key` is the caller's own handle and is echoed back untouched. */
export type CoverageItem = {
  key: string;
  /** Shopify product GID of the item to be covered. */
  productId: string;
  /** From the product's `custom.extend_category` metafield; null means not eligible. */
  category: string | null;
  /** Shopify's list price per unit, in cents. */
  unitPriceCents: number;
  quantity: number;
};

/** Only what a shopper-facing offer needs: no variant id, no offer id, no raw payload. */
export type CoveragePlan = {
  planId: string;
  title: string;
  priceCents: number;
  termMonths: number | null;
  /** https link to the plan's details and terms (REQ-EXT-004). */
  termsUrl: string;
  imageUrl: string | null;
  recommended: boolean;
};

export type CoverageUnavailableReason =
  'disabled' | 'no_price_points' | OffersFailureReason;

export type CoverageQuote =
  | {
      status: 'ok';
      /** Items that can be covered, with at least one sellable plan. An item missing here has no offer. */
      plansByKey: ReadonlyMap<string, readonly CoveragePlan[]>;
    }
  | {status: 'unavailable'; reason: CoverageUnavailableReason};

type MemoValue =
  | {
      status: 'ok';
      plansByProductId: ReadonlyMap<string, readonly CoveragePlan[]>;
    }
  | {status: 'unavailable'; reason: CoverageUnavailableReason};

/**
 * Short-lived memory of Extend's answers, keyed by the request (product, category, price, quantity: no personal data).
 * It spares Extend repeated identical questions from cart reloads and revalidation passes (T-13) and gives an outage a
 * short negative memory so every page load does not wait for the timeout again (NFR-013). Per isolate, best effort.
 */
export type OffersMemo = {
  get: (key: string) => MemoValue | undefined;
  set: (key: string, value: MemoValue) => void;
};

export function createOffersMemo(options: {
  now: NowFn;
  okTtlMs?: number;
  failureTtlMs?: number;
  maxEntries?: number;
}): OffersMemo {
  const okTtl = options.okTtlMs ?? 5 * 60_000;
  const failureTtl = options.failureTtlMs ?? 30_000;
  const maxEntries = options.maxEntries ?? 200;
  const entries = new Map<string, {value: MemoValue; expiresAt: number}>();
  return {
    get(key) {
      const entry = entries.get(key);
      if (entry === undefined) return undefined;
      if (options.now() >= entry.expiresAt) {
        entries.delete(key);
        return undefined;
      }
      return entry.value;
    },
    set(key, value) {
      entries.delete(key);
      entries.set(key, {
        value,
        expiresAt: options.now() + (value.status === 'ok' ? okTtl : failureTtl),
      });
      while (entries.size > maxEntries) {
        const oldest = entries.keys().next();
        if (oldest.done) break;
        entries.delete(oldest.value);
      }
    },
  };
}

export type QuoteDeps = {
  config: ExtendConfigResult;
  fetch: FetchLike;
  index: PricePointIndex;
  memo: OffersMemo;
  breaker?: CircuitBreaker;
  log?: ExtendLogger;
  timeoutMs?: number;
};

/** The Offers API accepts a handful of items per request; the rest simply get no offer. */
export const MAX_QUOTE_ITEMS = 50;

type Requested = {item: CoverageItem; productId: string; category: string};

/**
 * One Offers request item per Extend product id. Extend identifies items by `productId`, so two lines of the same product
 * at different prices cannot be asked about separately; the FIRST line is quoted and later ones get no offer rather than
 * a quote for the wrong price band. Items without a category or a readable id are not eligible and are not sent.
 */
function requestedItems(items: readonly CoverageItem[]): Requested[] {
  const byProduct = new Map<string, Requested>();
  for (const item of items) {
    const productId = normalizeShopifyId(item.productId);
    if (
      productId === null ||
      item.category === null ||
      byProduct.has(productId)
    ) {
      continue;
    }
    byProduct.set(productId, {item, productId, category: item.category});
  }
  return [...byProduct.values()].slice(0, MAX_QUOTE_ITEMS);
}

function signature(requested: readonly Requested[]): string {
  return requested
    .map(
      ({productId, category, item}) =>
        `${productId}|${category}|${item.unitPriceCents}|${item.quantity}`,
    )
    .sort()
    .join(',');
}

export async function quoteCoverage(
  deps: QuoteDeps,
  items: readonly CoverageItem[],
): Promise<CoverageQuote> {
  if (deps.config.status !== 'enabled') {
    return {status: 'unavailable', reason: 'disabled'};
  }
  const requested = requestedItems(items);
  if (requested.length === 0) return {status: 'ok', plansByKey: new Map()};
  if (deps.index.byPriceCents.size === 0) {
    return {status: 'unavailable', reason: 'no_price_points'};
  }

  const memoKey = signature(requested);
  let value = deps.memo.get(memoKey);
  if (value === undefined) {
    value = await askExtend(deps, requested);
    deps.memo.set(memoKey, value);
  }
  if (value.status === 'unavailable') return value;

  const plansByKey = new Map<string, readonly CoveragePlan[]>();
  for (const {item, productId} of requested) {
    const plans = value.plansByProductId.get(productId);
    if (plans !== undefined && plans.length > 0)
      plansByKey.set(item.key, plans);
  }
  return {status: 'ok', plansByKey};
}

async function askExtend(
  deps: QuoteDeps,
  requested: readonly Requested[],
): Promise<MemoValue> {
  const offerItems: OfferItem[] = requested.map(
    ({item, productId, category}) => ({
      category,
      productId,
      purchasePriceCents: item.unitPriceCents,
      quantity: item.quantity,
    }),
  );
  const result = await fetchOffers(
    {
      config: deps.config,
      fetch: deps.fetch,
      ...(deps.breaker === undefined ? {} : {breaker: deps.breaker}),
      ...(deps.log === undefined ? {} : {log: deps.log}),
      ...(deps.timeoutMs === undefined ? {} : {timeoutMs: deps.timeoutMs}),
    },
    offerItems,
    // The product metafield IS the eligibility switch (REQ-EXT-005); the client's category list (CLR-018) will be
    // applied here as an extra allow-list when it exists.
    offerItems.map((item) => item.category),
  );
  if (result.status === 'error') {
    (deps.log ?? noopLogger)({
      level: 'warn',
      event: 'offers.route_unavailable',
      reason: result.reason,
    });
    return {status: 'unavailable', reason: result.reason};
  }

  const plansByProductId = new Map<string, CoveragePlan[]>();
  for (const offer of result.offers) {
    const matched = matchPlansToPricePoints(offer, deps.index).matched;
    for (const {plan, recommended} of matched) {
      for (const covered of offer.coveredProducts) {
        const list = plansByProductId.get(covered.productId) ?? [];
        if (!list.some((existing) => existing.planId === plan.id)) {
          list.push({
            planId: plan.id,
            title: plan.title,
            priceCents: plan.priceCents,
            termMonths: plan.contract.termLength,
            termsUrl: plan.url,
            imageUrl: plan.imageUrl,
            recommended,
          });
        }
        plansByProductId.set(covered.productId, list);
      }
    }
  }
  for (const list of plansByProductId.values()) {
    list.sort(
      (a, b) =>
        Number(b.recommended) - Number(a.recommended) ||
        a.priceCents - b.priceCents ||
        a.planId.localeCompare(b.planId),
    );
  }
  return {status: 'ok', plansByProductId};
}
