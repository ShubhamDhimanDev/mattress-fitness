// SERVER ONLY. Ties the pure offer engine to a real Shopify cart (P4-03, P4-04, P4-07, P4-09, P4-11).
//
// `revalidateCartOffers` runs after every cart mutation, on every cart page load and before the hand-off.
// It evaluates, repairs through the cart handler, and returns the final cart with the view the UI renders.
//
// Nothing here trusts the browser. Rules and the delivery zone come from server configuration, roles come
// from server-side variant lists (offers/roles.ts), the delivery ZIP has no server-side store yet so
// haul-away fails closed, and the cart's own attributes are read only through the strict parser.

import type {Storefront} from '@shopify/hydrogen';
import type {CartApiQueryFragment} from 'storefrontapi.generated';
import {buildRuleIndex, classifyLine} from '~/lib/offers/lines';
import {clearDeclineAttribute, declineAttribute} from '~/lib/offers/attributes';
import type {CartLike} from '~/lib/offers/types';
import {toCartLike} from '~/lib/shopify/cart-mapper';
import {isSizeSwap, swapChoicesFor} from './sizes';
import {withAttribute} from './step-attributes';
import {readOfferConfig, rulesNeedCollections} from './config';
import {buildOfferContext} from './context';
import {
  loadOfferedVariants,
  loadSwapTarget,
  loadProductFacts,
  type ProductFacts,
} from './facts';
import {applyServerRoles, NO_EXTEND_INPUTS} from './extend-seam';
import {
  revalidateCart,
  type CartCheck,
  type CartPort,
  type MutationOutcome,
  type RevalidationDeps,
} from './revalidate';
import {
  buildOffersView,
  offeredVariantIds,
  type CartOffersView,
  type SizeChoice,
} from './view';

export type CartMutationResult = {
  readonly cart?: CartApiQueryFragment | null;
  readonly errors?: readonly unknown[] | null;
  readonly userErrors?: readonly unknown[] | null;
  readonly warnings?: readonly unknown[] | null;
};

/** The slice of Hydrogen's cart handler this module uses (structural, so tests pass a fake). */
export type CartHandlerLike = {
  get(): Promise<CartApiQueryFragment | null>;
  removeLines(lineIds: string[]): Promise<CartMutationResult>;
  updateLines(
    lines: Array<{id: string; quantity: number; merchandiseId?: string}>,
  ): Promise<CartMutationResult>;
  addLines(
    lines: Array<{merchandiseId: string; quantity: number}>,
  ): Promise<CartMutationResult>;
  updateAttributes(
    attributes: Array<{key: string; value: string}>,
  ): Promise<CartMutationResult>;
};

export type OfferRuntime = {
  readonly storefront: Storefront;
  readonly cart: CartHandlerLike;
  /** The request-context env (ADR-0004); only OFFER_CONFIG_JSON is read. */
  readonly env: object;
};

export type OffersResult = {
  readonly cart: CartApiQueryFragment | null;
  readonly check: CartCheck<CartApiQueryFragment> | null;
  readonly view: CartOffersView | null;
};

function failed(result: CartMutationResult): boolean {
  return Boolean(result.errors?.length || result.userErrors?.length);
}

function portFor(runtime: OfferRuntime): CartPort<CartApiQueryFragment> {
  // A mutation answers with Hydrogen's minimal cart (id, quantity, checkout URL; no lines), not the full
  // query fragment the engine needs, so after a successful change the whole cart is read again.
  const outcome = async (
    result: CartMutationResult,
  ): Promise<MutationOutcome<CartApiQueryFragment>> =>
    failed(result)
      ? {cart: null, failed: true}
      : {cart: await runtime.cart.get(), failed: false};
  return {
    removeLines: async (lineIds) =>
      outcome(await runtime.cart.removeLines(lineIds)),
    updateLines: async (lines) =>
      outcome(await runtime.cart.updateLines(lines)),
    refresh: () => runtime.cart.get(),
  };
}

function productIdsOf(cart: CartApiQueryFragment): string[] {
  return cart.lines.nodes.flatMap((line) =>
    line.merchandise?.product?.id ? [line.merchandise.product.id] : [],
  );
}

function withCollections(cart: CartLike, facts: ProductFacts): CartLike {
  return {
    ...cart,
    lines: cart.lines.map((line) => {
      const ids = facts.collectionIds.get(line.productId);
      return ids ? {...line, collectionIds: ids} : line;
    }),
  };
}

function swapChoices(
  cart: CartApiQueryFragment,
  facts: ProductFacts,
  regular: (lineId: string) => boolean,
): Record<string, readonly SizeChoice[]> {
  const result: Record<string, readonly SizeChoice[]> = {};
  for (const line of cart.lines.nodes) {
    const productId = line.merchandise?.product?.id;
    const variants = productId ? facts.variants.get(productId) : undefined;
    if (!variants || !regular(line.id)) continue;
    const choices = swapChoicesFor(line.merchandise.selectedOptions, variants);
    if (choices.length > 0) result[line.id] = choices;
  }
  return result;
}

async function prepareRuntime(
  runtime: OfferRuntime,
  cart: CartApiQueryFragment,
) {
  const loaded = readOfferConfig(runtime.env);
  if (loaded.status === 'invalid' || loaded.warnings.length > 0) {
    // Names of dropped entries only, never values (T-05).
    console.warn('Offer config:', loaded.status, loaded.warnings.join('; '));
  }
  const {rules, zone} = loaded.config;
  const facts = await loadProductFacts(
    runtime.storefront,
    productIdsOf(cart),
    rulesNeedCollections(rules),
  );
  const deps: RevalidationDeps = {
    rules,
    // The server adds what only it knows; roles on the incoming cart are never believed.
    prepare: async (mapped) =>
      applyServerRoles(withCollections(mapped, facts), NO_EXTEND_INPUTS),
    contextFor: (mapped) =>
      buildOfferContext(mapped, {
        zip: null,
        zone,
        protectionEligibleLineIds: NO_EXTEND_INPUTS.protectionEligibleLineIds,
      }),
  };
  return {deps, facts, rules};
}

async function viewOf(
  runtime: OfferRuntime,
  check: CartCheck<CartApiQueryFragment>,
  facts: ProductFacts,
  index: ReturnType<typeof buildRuleIndex>,
): Promise<CartOffersView> {
  const variants = await loadOfferedVariants(
    runtime.storefront,
    offeredVariantIds(check.evaluation),
  );
  const regularIds = new Set(
    toCartLike(check.cart)
      .lines.filter((line) => classifyLine(line, index) === 'regular')
      .map((line) => line.id),
  );
  return buildOffersView({
    evaluation: check.evaluation,
    variants,
    updatedAt: check.cart.updatedAt ?? null,
    lineSizes: swapChoices(check.cart, facts, (lineId) =>
      regularIds.has(lineId),
    ),
    blocked: check.blocked,
    notices: check.notices,
  });
}

/** Evaluate, repair through the cart handler until the engine is satisfied, and build the UI view. */
export async function revalidateCartOffers(
  runtime: OfferRuntime,
  current: CartApiQueryFragment | null,
): Promise<OffersResult> {
  if (!current || current.lines.nodes.length === 0) {
    return {cart: current, check: null, view: null};
  }
  const {deps, facts, rules} = await prepareRuntime(runtime, current);
  const check = await revalidateCart(current, portFor(runtime), deps);
  const view = await viewOf(runtime, check, facts, buildRuleIndex(rules));
  return {cart: check.cart, check, view};
}

export type StepChangeResult =
  | {readonly status: 'ok'; readonly result: CartMutationResult}
  | {readonly status: 'rejected'; readonly reason: string};

/**
 * Swaps a regular line to another size of the SAME product (REQ-CART-001). The browser names the line and the
 * variant; the quantity is the cart's own, the variant must belong to the line's product and be in stock,
 * and offer-only lines (gifts, protectors, haul-away, coverage) cannot be swapped. The caller revalidates.
 */
export async function swapLineSize(
  runtime: OfferRuntime,
  current: CartApiQueryFragment | null,
  change: {readonly lineId: string; readonly merchandiseId: string},
): Promise<StepChangeResult> {
  const line = current?.lines.nodes.find((node) => node.id === change.lineId);
  const productId = line?.merchandise?.product?.id;
  if (!current || !line || !productId) {
    return {status: 'rejected', reason: 'That item is no longer in your cart.'};
  }
  const {rules} = readOfferConfig(runtime.env).config;
  const mapped = toCartLike(current).lines.find((node) => node.id === line.id);
  if (!mapped || classifyLine(mapped, buildRuleIndex(rules)) !== 'regular') {
    return {
      status: 'rejected',
      reason: 'The size of this item cannot be changed.',
    };
  }
  const target = await loadSwapTarget(runtime.storefront, change.merchandiseId);
  if (
    target.status !== 'ok' ||
    target.productId !== productId ||
    !isSizeSwap(line.merchandise.selectedOptions, target.options)
  ) {
    return {status: 'rejected', reason: 'That size is not available.'};
  }
  return {
    status: 'ok',
    result: await runtime.cart.updateLines([
      {
        id: line.id,
        quantity: line.quantity,
        merchandiseId: change.merchandiseId,
      },
    ]),
  };
}

/**
 * Accepting the comfort guarantee adds exactly what the engine says is missing: no variant id or quantity comes
 * from the browser. The decline attribute is reset so the order no longer shows a decline (REQ-PRE-005).
 */
export async function acceptComfortGuarantee(
  runtime: OfferRuntime,
  current: CartApiQueryFragment | null,
): Promise<StepChangeResult> {
  const offers = await revalidateCartOffers(runtime, current);
  const options = offers.view?.comfortGuarantee?.options ?? [];
  if (!offers.cart || options.length === 0) {
    return {status: 'rejected', reason: 'There is nothing to add right now.'};
  }
  const added = await runtime.cart.addLines(
    options.map((option) => ({
      merchandiseId: option.variant.variantId,
      quantity: option.quantityMissing,
    })),
  );
  if (failed(added)) return {status: 'ok', result: added};
  return {
    status: 'ok',
    result: await runtime.cart.updateAttributes(
      withAttribute(
        offers.cart.attributes,
        clearDeclineAttribute('comfort-guarantee'),
      ),
    ),
  };
}

/** Declining is recorded as a cart attribute that becomes an order note attribute (REQ-PRE-005). */
export async function declineComfortGuarantee(
  runtime: OfferRuntime,
  current: CartApiQueryFragment | null,
): Promise<StepChangeResult> {
  if (!current || current.lines.nodes.length === 0) {
    return {status: 'rejected', reason: 'Your cart is empty.'};
  }
  return {
    status: 'ok',
    result: await runtime.cart.updateAttributes(
      withAttribute(current.attributes, declineAttribute('comfort-guarantee')),
    ),
  };
}
