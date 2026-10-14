// Where Extend plugs into cart revalidation (P5A-06, P5A-07, security review O-M2). Extend stays behind
// PUBLIC_EXTEND_ENABLED and the local mock (ADR-0009).
//
// `loadExtendCartInputs` answers the two questions the cart gate cannot answer from the cart itself:
//   1. WHICH variants are Extend coverage: the server's price-point variant list (extend/coverage-catalog.ts) plus any
//      cart line whose Shopify-supplied name follows `Extend-Protection-Plan-<price>`. Never a role or attribute that
//      arrived with the cart, because a direct-API cart can attach anything to any line (ADR-0006).
//   2. WHICH cart lines CAN be covered: those Extend's Offers API quotes at least one sellable plan for.
//
// Wired in offers-runtime/server.ts (`prepareRuntime`): the result's `inputs` go to `applyServerRoles` and into the
// offer context (eligible lines and the plan prices quoted for them). It covers our storefront path only; direct
// Storefront API carts are detective (ADR-0006).
//
// Failure of EXTEND never blocks the cart (NFR-013): a failed Offers call degrades to the outage rule and is logged by
// reason. A failed read of the coverage CATALOG is different: without it the gate cannot tell coverage from other lines,
// so server.ts treats it (and an empty price-point list while the cart holds coverage) as unverified and pauses checkout
// (security review O-M2, fail closed).

import type {Storefront} from '@shopify/hydrogen';
import {
  loadCoverageCatalog,
  type CoverageCatalogResult,
} from '~/lib/extend/coverage-catalog';
import {
  loadProductCategories,
  type FactsResult,
} from '~/lib/extend/coverage-facts';
import {
  parsePricePointName,
  type PricePointIndex,
} from '~/lib/extend/price-points';
import {
  quoteCoverage,
  type CoverageItem,
  type CoverageQuote,
} from '~/lib/extend/offers-service';
import {
  consoleLogger,
  getExtendShared,
  offersConfigOf,
  realFetch,
} from '~/lib/extend/runtime';
import {toCents} from '~/lib/money';
import type {CartLike} from '~/lib/offers/types';
import {withCoverageRoles} from '~/lib/offers/roles';

export type ExtendCartInputs = {
  /** Variant ids of the Extend price-point products, from server data (never from the cart). */
  readonly coverageVariantIds: ReadonlySet<string>;
  readonly protectionEligibleLineIds: readonly string[];
  /** Eligible line id -> the plan prices Extend quoted for it (cents). A coverage line must cost one of them. */
  readonly coveragePlanPricesByLineId: ReadonlyMap<string, readonly number[]>;
};

export const NO_EXTEND_INPUTS: ExtendCartInputs = {
  coverageVariantIds: new Set<string>(),
  protectionEligibleLineIds: [],
  coveragePlanPricesByLineId: new Map<string, readonly number[]>(),
};

/**
 * Roles are assigned from the server's variant list only. A 'coverage' role or any role-like attribute
 * that arrived with the cart is cleared by `withCoverageRoles`; no other role is ever read from the cart.
 */
export function applyServerRoles(
  cart: CartLike,
  extend: ExtendCartInputs,
): CartLike {
  return withCoverageRoles(cart, extend.coverageVariantIds);
}

/**
 * "Extend answered, and nothing in this cart can be covered." The engine reads an EMPTY eligibility list as "Extend
 * could not tell us" and keeps coverage on regular parents during an outage (offers/protection.ts). A healthy,
 * definite "none" must instead remove coverage hanging off an item that cannot be covered, so it is expressed as a
 * non-empty list that matches no cart line. The id is not a Shopify id, so it cannot collide with a real line.
 */
export const NOTHING_ELIGIBLE: readonly string[] = ['extend:none-eligible'];

// ---------------------------------------------------------------------------------------------------

export type ExtendDegradation =
  | 'catalog-unavailable'
  | 'catalog-incomplete'
  | 'categories-unavailable'
  | 'offers-unavailable'
  | 'no-price-points';

export type ExtendInputsOutcome =
  | {
      readonly status: 'disabled';
      readonly inputs: ExtendCartInputs;
      readonly coverageLinesInCart: boolean;
    }
  | {
      readonly status: 'ok';
      readonly inputs: ExtendCartInputs;
      readonly coverageLinesInCart: boolean;
    }
  | {
      readonly status: 'degraded';
      readonly inputs: ExtendCartInputs;
      readonly degraded: readonly ExtendDegradation[];
      /** True when at least one cart line is a coverage variant (by the catalog or by its Shopify-supplied name). */
      readonly coverageLinesInCart: boolean;
    };

/**
 * Whether checkout must be paused because the gate cannot judge coverage (fail closed, O-M2): the coverage catalog
 * could not be read at all, or no price point exists while the cart holds a coverage line. A cart without coverage lines
 * and a healthy catalog is never held back by Extend problems.
 */
export function extendMakesCartUnverifiable(
  outcome: ExtendInputsOutcome,
): boolean {
  if (outcome.status !== 'degraded') return false;
  return (
    outcome.degraded.includes('catalog-unavailable') ||
    (outcome.degraded.includes('no-price-points') &&
      outcome.coverageLinesInCart)
  );
}

/**
 * Shopify's variant price per cart line, from the cart the server just read (never from the browser), in cents.
 * Lines whose price is unreadable are left out, and a coverage line without a price is removed by the gate.
 */
export function unitPricesByLineId(cart: SeamCart): Map<string, number> {
  const prices = new Map<string, number>();
  for (const line of cart.lines.nodes) {
    const price = unitPriceCents(line);
    if (price !== null) prices.set(line.id, price);
  }
  return prices;
}

export function withUnitPrices(
  cart: CartLike,
  prices: ReadonlyMap<string, number>,
): CartLike {
  return {
    ...cart,
    lines: cart.lines.map((line) => {
      const price = prices.get(line.id);
      return price === undefined ? line : {...line, unitPriceCents: price};
    }),
  };
}

type SeamLine = {
  readonly id: string;
  readonly quantity: number;
  readonly merchandise?: {
    readonly id?: string;
    readonly title?: string;
    readonly price?: {readonly amount: string; readonly currencyCode?: string};
    readonly product?: {readonly id: string; readonly title?: string};
  } | null;
};

/** The slice of Shopify's cart this module reads (structural, so the full cart fragment is accepted as is). */
export type SeamCart = {readonly lines: {readonly nodes: readonly SeamLine[]}};

export type ExtendSeamRuntime = {
  readonly storefront: Pick<
    Storefront,
    'query' | 'CacheLong' | 'CacheShort' | 'CacheNone' | 'CacheCustom'
  >;
  /** The request-context env (ADR-0004). */
  readonly env: object;
  readonly production: boolean;
};

/** Everything that touches the network, replaceable in tests. */
export type ExtendSeamDeps = {
  loadCatalog: () => Promise<CoverageCatalogResult>;
  loadCategories: (
    productIds: readonly string[],
  ) => Promise<FactsResult<Map<string, string>>>;
  quote: (
    items: readonly CoverageItem[],
    index: PricePointIndex,
  ) => Promise<CoverageQuote>;
};

function realDeps(runtime: ExtendSeamRuntime): ExtendSeamDeps {
  const config = offersConfigOf(runtime);
  const shared = getExtendShared();
  return {
    loadCatalog: () => loadCoverageCatalog(runtime.storefront),
    loadCategories: (productIds) =>
      loadProductCategories(runtime.storefront, productIds),
    quote: (items, index) =>
      quoteCoverage(
        {
          config,
          fetch: realFetch,
          index,
          memo: shared.offersMemo,
          breaker: shared.breaker,
          log: consoleLogger,
        },
        items,
      ),
  };
}

const MAX_QUANTITY = 99;

/** A line whose own Shopify-supplied name is a price point is coverage even if the catalog read missed it. */
function isPricePointByName(line: SeamLine): boolean {
  return [line.merchandise?.title, line.merchandise?.product?.title].some(
    (name) => name !== undefined && parsePricePointName(name).status === 'ok',
  );
}

function unitPriceCents(line: SeamLine): number | null {
  const price = line.merchandise?.price;
  if (price === undefined || price.currencyCode !== 'USD') return null;
  try {
    return toCents(price.amount);
  } catch {
    return null;
  }
}

const loggedOnce = new Set<string>();

function logDegradedOnce(reason: string): void {
  if (loggedOnce.has(reason)) return;
  loggedOnce.add(reason);
  consoleLogger({level: 'warn', event: 'coverage.inputs_degraded', reason});
}

/** Test hook: forget which degraded-configuration lines were already logged. */
export function resetExtendSeamLogsForTests(): void {
  loggedOnce.clear();
}

export async function loadExtendCartInputs(
  runtime: ExtendSeamRuntime,
  cart: SeamCart,
  deps: ExtendSeamDeps = realDeps(runtime),
): Promise<ExtendInputsOutcome> {
  // Coverage RECOGNITION does not depend on the flag (security review E-M1): a coverage line that exists while Extend is
  // off or misconfigured (left over from an earlier session, or added through a permalink) must still be corrected,
  // not slip through as an ordinary item. Recognition from the cart's own Shopify-supplied names needs no network.
  const byName = new Set<string>();
  for (const line of cart.lines.nodes) {
    const variantId = line.merchandise?.id;
    if (variantId !== undefined && isPricePointByName(line)) {
      byName.add(variantId);
    }
  }
  const config = offersConfigOf(runtime);
  if (config.status !== 'enabled') {
    const coverageLinesInCart = byName.size > 0;
    // Once per process: a flag that is simply off is a decision and stays silent unless coverage is in the cart;
    // anything else (flag on but credentials missing or invalid) is a misconfiguration worth one line.
    const note =
      config.reason !== 'flag_off'
        ? `config:${config.reason}`
        : coverageLinesInCart
          ? 'flag-off-with-coverage-in-cart'
          : null;
    if (note !== null) logDegradedOnce(note);
    return {
      status: 'disabled',
      // No eligible lines from Offers while Extend is off: the empty list is the outage rule, which keeps coverage on an
      // ordinary parent and removes it when alone or under a gift, a service or another coverage line.
      inputs: {
        coverageVariantIds: byName,
        protectionEligibleLineIds: [],
        coveragePlanPricesByLineId: new Map(),
      },
      coverageLinesInCart,
    };
  }
  const degraded: ExtendDegradation[] = [];

  const catalog = await deps.loadCatalog();
  const coverageVariantIds = new Set<string>();
  let index: PricePointIndex = {byPriceCents: new Map(), rejected: []};
  if (catalog.status === 'ok') {
    for (const id of catalog.catalog.coverageVariantIds) {
      coverageVariantIds.add(id);
    }
    index = catalog.catalog.index;
    if (!catalog.catalog.complete) degraded.push('catalog-incomplete');
  } else {
    degraded.push('catalog-unavailable');
  }
  for (const id of byName) coverageVariantIds.add(id);

  const candidates = cart.lines.nodes.filter(
    (line) =>
      line.merchandise?.id !== undefined &&
      line.merchandise.product?.id !== undefined &&
      !coverageVariantIds.has(line.merchandise.id),
  );
  const coverageLinesInCart = cart.lines.nodes.some(
    (line) =>
      line.merchandise?.id !== undefined &&
      coverageVariantIds.has(line.merchandise.id),
  );
  const finish = (
    protectionEligibleLineIds: readonly string[],
    coveragePlanPricesByLineId: ReadonlyMap<
      string,
      readonly number[]
    > = new Map(),
  ): ExtendInputsOutcome => {
    const inputs: ExtendCartInputs = {
      coverageVariantIds,
      protectionEligibleLineIds,
      coveragePlanPricesByLineId,
    };
    if (degraded.length === 0)
      return {status: 'ok', inputs, coverageLinesInCart};
    consoleLogger({
      level: 'warn',
      event: 'coverage.inputs_degraded',
      reason: degraded.join(','),
    });
    return {status: 'degraded', inputs, degraded, coverageLinesInCart};
  };

  if (candidates.length === 0) return finish(NOTHING_ELIGIBLE);

  const categories = await deps.loadCategories(
    candidates.flatMap((line) =>
      line.merchandise?.product?.id ? [line.merchandise.product.id] : [],
    ),
  );
  if (categories.status !== 'ok') {
    degraded.push('categories-unavailable');
    return finish([]);
  }

  const items: CoverageItem[] = candidates.flatMap((line) => {
    const productId = line.merchandise?.product?.id;
    const price = unitPriceCents(line);
    if (productId === undefined || price === null) return [];
    return [
      {
        key: line.id,
        productId,
        category: categories.facts.get(productId) ?? null,
        unitPriceCents: price,
        quantity: Math.min(Math.max(1, line.quantity), MAX_QUANTITY),
      },
    ];
  });

  const quote = await deps.quote(items, index);
  if (quote.status !== 'ok') {
    // Extend or the price-point list cannot answer: the empty list means "cannot judge", so coverage on a regular
    // parent is kept instead of stripped from shoppers during an outage. Coverage alone or on a gift is still removed.
    degraded.push(
      quote.reason === 'no_price_points'
        ? 'no-price-points'
        : 'offers-unavailable',
    );
    return finish([]);
  }
  const eligible = candidates
    .filter((line) => quote.plansByKey.has(line.id))
    .map((line) => line.id);
  const prices = new Map<string, readonly number[]>();
  for (const id of eligible) {
    prices.set(id, [
      ...new Set(
        (quote.plansByKey.get(id) ?? []).map((plan) => plan.priceCents),
      ),
    ]);
  }
  return eligible.length > 0
    ? finish(eligible, prices)
    : finish(NOTHING_ELIGIBLE);
}
