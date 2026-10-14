// Where Extend plugs into cart revalidation (P5A-06, P5A-07, security review O-M2). Extend stays behind
// PUBLIC_EXTEND_ENABLED and the local mock (ADR-0009).
//
// `loadExtendCartInputs` answers the two questions the cart gate cannot answer from the cart itself:
//   1. WHICH variants are Extend coverage: the server's price-point variant list (extend/coverage-catalog.ts) plus any
//      cart line whose Shopify-supplied name follows `Extend-Protection-Plan-<price>`. Never a role or attribute that
//      arrived with the cart, because a direct-API cart can attach anything to any line (ADR-0006).
//   2. WHICH cart lines CAN be covered: those Extend's Offers API quotes at least one sellable plan for.
//
// Callers (offers-runtime/server.ts, `prepareRuntime`) take the result's `inputs`, hand `inputs` to `applyServerRoles` and
// pass `inputs.protectionEligibleLineIds` into `buildOfferContext`. Until server.ts calls this function it still passes
// NO_EXTEND_INPUTS, and coverage lines are then ordinary lines to the gate (no repair, no refusal): that wiring step is
// the remaining exit criterion of P5A-06. It covers our storefront path only; direct Storefront API carts are
// detective (ADR-0006).
//
// Failure never blocks the cart (NFR-013): a failed read degrades to the safe defaults below and is logged by reason.

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
};

export const NO_EXTEND_INPUTS: ExtendCartInputs = {
  coverageVariantIds: new Set<string>(),
  protectionEligibleLineIds: [],
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
  | 'offers-unavailable';

export type ExtendInputsOutcome =
  | {readonly status: 'disabled'; readonly inputs: ExtendCartInputs}
  | {readonly status: 'ok'; readonly inputs: ExtendCartInputs}
  | {
      readonly status: 'degraded';
      readonly inputs: ExtendCartInputs;
      readonly degraded: readonly ExtendDegradation[];
    };

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

export async function loadExtendCartInputs(
  runtime: ExtendSeamRuntime,
  cart: SeamCart,
  deps: ExtendSeamDeps = realDeps(runtime),
): Promise<ExtendInputsOutcome> {
  // Flag off or not configured: no network, and the safe defaults (no coverage products exist to recognise yet).
  if (offersConfigOf(runtime).status !== 'enabled') {
    return {status: 'disabled', inputs: NO_EXTEND_INPUTS};
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
  for (const line of cart.lines.nodes) {
    const variantId = line.merchandise?.id;
    if (variantId !== undefined && isPricePointByName(line)) {
      coverageVariantIds.add(variantId);
    }
  }

  const candidates = cart.lines.nodes.filter(
    (line) =>
      line.merchandise?.id !== undefined &&
      line.merchandise.product?.id !== undefined &&
      !coverageVariantIds.has(line.merchandise.id),
  );
  const finish = (
    protectionEligibleLineIds: readonly string[],
  ): ExtendInputsOutcome => {
    const inputs: ExtendCartInputs = {
      coverageVariantIds,
      protectionEligibleLineIds,
    };
    if (degraded.length === 0) return {status: 'ok', inputs};
    consoleLogger({
      level: 'warn',
      event: 'coverage.inputs_degraded',
      reason: degraded.join(','),
    });
    return {status: 'degraded', inputs, degraded};
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
    if (quote.reason !== 'no_price_points') degraded.push('offers-unavailable');
    return finish([]);
  }
  const eligible = candidates
    .filter((line) => quote.plansByKey.has(line.id))
    .map((line) => line.id);
  return finish(eligible.length > 0 ? eligible : NOTHING_ELIGIBLE);
}
