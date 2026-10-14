// SERVER ONLY. The logic behind the offers route (P5A-04, REQ-EXT-001, REQ-EXT-005, NFR-013, T-01, T-13).
// The browser names variants and quantities and nothing else. Prices, product ids and the Extend category are read from
// Shopify, the plans from Extend (server to server, with the access token), and the answer holds only what an offer
// needs to be shown and later accepted: plan id, title, price, term, terms link and image. Everything fails to
// `{status: 'unavailable'}`, which hides the offer; the page never waits on, or breaks because of, Extend.

import type {ExtendConfigResult} from '~/lib/extend/config';
import type {CoverageCatalogResult} from '~/lib/extend/coverage-catalog';
import type {FactsResult, VariantFact} from '~/lib/extend/coverage-facts';
import type {ExtendLogger} from '~/lib/extend/log';
import {noopLogger} from '~/lib/extend/log';
import type {
  CoverageItem,
  CoveragePlan,
  CoverageQuote,
} from '~/lib/extend/offers-service';
import type {PricePointIndex} from '~/lib/extend/price-points';

export const MAX_ENDPOINT_ITEMS = 10;
export const MAX_ENDPOINT_QUANTITY = 99;
export const MAX_ENDPOINT_BODY_CHARS = 4096;

const VARIANT_GID = /^gid:\/\/shopify\/ProductVariant\/\d{1,20}$/;

export type OffersRequestItem = {variantId: string; quantity: number};

export type ParsedOffersRequest =
  {status: 'ok'; items: OffersRequestItem[]} | {status: 'invalid'};

function parseQuantity(value: unknown): number | null {
  const parsed =
    typeof value === 'string' && /^\d{1,3}$/.test(value)
      ? Number(value)
      : value;
  return typeof parsed === 'number' &&
    Number.isInteger(parsed) &&
    parsed >= 1 &&
    parsed <= MAX_ENDPOINT_QUANTITY
    ? parsed
    : null;
}

function toItems(candidates: readonly unknown[]): ParsedOffersRequest {
  if (candidates.length < 1 || candidates.length > MAX_ENDPOINT_ITEMS) {
    return {status: 'invalid'};
  }
  const items = new Map<string, OffersRequestItem>();
  for (const candidate of candidates) {
    if (typeof candidate !== 'object' || candidate === null) {
      return {status: 'invalid'};
    }
    const variantId: unknown = Reflect.get(candidate, 'variantId');
    const rawQuantity: unknown = Reflect.get(candidate, 'quantity');
    const quantity = rawQuantity === undefined ? 1 : parseQuantity(rawQuantity);
    if (
      typeof variantId !== 'string' ||
      !VARIANT_GID.test(variantId) ||
      quantity === null
    ) {
      return {status: 'invalid'};
    }
    // The same variant twice is one question, first quantity wins; unknown fields are ignored.
    if (!items.has(variantId)) items.set(variantId, {variantId, quantity});
  }
  return {status: 'ok', items: [...items.values()]};
}

/** GET ?variantId=gid://shopify/ProductVariant/1&quantity=1: one variant, as the product page asks. */
export function parseOffersQuery(url: URL): ParsedOffersRequest {
  const variantIds = url.searchParams.getAll('variantId');
  if (variantIds.length !== 1) return {status: 'invalid'};
  const quantities = url.searchParams.getAll('quantity');
  if (quantities.length > 1) return {status: 'invalid'};
  return toItems([{variantId: variantIds[0], quantity: quantities[0]}]);
}

/** POST {"items": [{"variantId": "...", "quantity": 1}]}: up to ten variants, as the cart asks. */
export async function parseOffersBody(
  request: Request,
): Promise<ParsedOffersRequest> {
  const declared = request.headers.get('content-length');
  if (declared !== null && Number(declared) > MAX_ENDPOINT_BODY_CHARS * 4) {
    return {status: 'invalid'};
  }
  let text: string;
  try {
    text = await request.text();
  } catch {
    return {status: 'invalid'};
  }
  if (text.length > MAX_ENDPOINT_BODY_CHARS) return {status: 'invalid'};
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return {status: 'invalid'};
  }
  const items: unknown =
    typeof json === 'object' && json !== null
      ? Reflect.get(json, 'items')
      : undefined;
  return Array.isArray(items) ? toItems(items) : {status: 'invalid'};
}

export type OffersResponseBody =
  | {
      status: 'ok';
      items: Array<{
        variantId: string;
        quantity: number;
        plans: readonly CoveragePlan[];
      }>;
      /** Extend's branding rule (REQ-EXT-004): the UI shows this next to the offer. */
      poweredBy: 'Extend';
    }
  | {status: 'unavailable'};

export type OffersEndpointDeps = {
  config: ExtendConfigResult;
  loadCatalog: () => Promise<CoverageCatalogResult>;
  loadFacts: (
    variantIds: readonly string[],
  ) => Promise<FactsResult<Map<string, VariantFact>>>;
  quote: (
    items: readonly CoverageItem[],
    index: PricePointIndex,
  ) => Promise<CoverageQuote>;
  log?: ExtendLogger;
};

export async function answerOffers(
  request: readonly OffersRequestItem[],
  deps: OffersEndpointDeps,
): Promise<OffersResponseBody> {
  const log = deps.log ?? noopLogger;
  const unavailable = (reason: string): OffersResponseBody => {
    log({level: 'warn', event: 'offers.route_unavailable', reason});
    return {status: 'unavailable'};
  };
  // Flag off, or not configured: no Shopify or Extend traffic at all.
  if (deps.config.status !== 'enabled') return {status: 'unavailable'};

  const catalog = await deps.loadCatalog();
  if (catalog.status !== 'ok') return unavailable('catalog_unavailable');
  const facts = await deps.loadFacts(request.map((item) => item.variantId));
  if (facts.status !== 'ok') return unavailable('facts_unavailable');

  const items: CoverageItem[] = [];
  for (const {variantId, quantity} of request) {
    const fact = facts.facts.get(variantId);
    // A coverage variant is never itself coverable, and a sold-out item is not offered coverage.
    if (
      fact === undefined ||
      !fact.available ||
      catalog.catalog.coverageVariantIds.has(variantId)
    ) {
      continue;
    }
    items.push({
      key: variantId,
      productId: fact.productId,
      category: fact.category,
      unitPriceCents: fact.unitPriceCents,
      quantity,
    });
  }

  const quote = await deps.quote(items, catalog.catalog.index);
  if (quote.status !== 'ok') return unavailable(quote.reason);

  return {
    status: 'ok',
    poweredBy: 'Extend',
    items: request.map(({variantId, quantity}) => ({
      variantId,
      quantity,
      plans: quote.plansByKey.get(variantId) ?? [],
    })),
  };
}
