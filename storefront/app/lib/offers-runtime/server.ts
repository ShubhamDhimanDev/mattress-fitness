// SERVER ONLY. Ties the pure offer engine to a real Shopify cart (P4-03, P4-04, P4-07, P4-09, P4-11).
//
// `revalidateCartOffers` runs after every cart mutation, on every cart page load and before the hand-off.
// It evaluates, repairs through the cart handler, and returns the final cart with the view the UI renders.
//
// Nothing here trusts the browser. Rules and the delivery zone come from server configuration, roles come
// from server-side variant lists (offers/roles.ts), the delivery ZIP is the signed cookie the route read
// (absent = haul-away fails closed, zip-missing), and the cart's own attributes are read only through the
// strict parser.

import type {Storefront} from '@shopify/hydrogen';
import type {CartApiQueryFragment} from 'storefrontapi.generated';
import {
  deliveryChoiceState,
  type DeliveryChoiceState,
} from '~/lib/delivery/choice-step';
import type {DeliveryZone} from '~/lib/delivery/zone';
import {buildRuleIndex, classifyLine} from '~/lib/offers/lines';
import {
  clearDeclineAttribute,
  declineAttribute,
  parseOfferAttributes,
} from '~/lib/offers/attributes';
import type {CartLike, OfferRules} from '~/lib/offers/types';
import {toCartLike} from '~/lib/shopify/cart-mapper';
import {isSizeSwap, swapChoicesFor} from './sizes';
import {withAttribute} from './step-attributes';
import {
  readOfferConfig,
  rulesNeedCollections,
  EMPTY_OFFER_CONFIG,
  type OfferConfig,
} from './config';
import {buildOfferContext} from './context';
import {
  loadOfferedVariants,
  loadSwapTarget,
  loadProductFacts,
  type ProductFacts,
} from './facts';
import type {CoveragePlan} from '~/lib/extend/offers-service';
import {
  DELIVERY_STEP_FAILURE_TEXT,
  OFFERS_UNAVAILABLE_REASON,
  PROTECTION_STEP_FAILURE_TEXT,
  type DeliveryStepFailure,
  type ProtectionStepFailure,
} from './messages';
import {
  applyServerRoles,
  extendMakesCartUnverifiable,
  loadExtendCartInputs,
  unitPricesByLineId,
  withUnitPrices,
  type ExtendCartInputs,
  type ExtendInputsOutcome,
} from './extend-seam';
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
  unverifiedView,
  type CartOffersView,
  type SizeChoice,
} from './view';

export type CartMutationResult = {
  readonly cart?: CartApiQueryFragment | null;
  readonly errors?: readonly unknown[] | null;
  readonly userErrors?: readonly unknown[] | null;
  readonly warnings?: readonly unknown[] | null;
};

/**
 * One line of a cart add. `parent` nests the line under another (Shopify nested lines, ADR-0009): by `merchandiseId` when
 * the parent is added in the SAME request, by `lineId` when it is already in the cart (Shopify refuses a variant
 * reference to an existing line: PARENT_LINE_INVALID_REFERENCE). Only server code builds `attributes` and `parent`.
 */
export type CartLineAddInput = {
  merchandiseId: string;
  quantity: number;
  attributes?: Array<{key: string; value: string}>;
  parent?: {lineId: string} | {merchandiseId: string};
};

/** The slice of Hydrogen's cart handler this module uses (structural, so tests pass a fake). */
export type CartHandlerLike = {
  get(): Promise<CartApiQueryFragment | null>;
  removeLines(lineIds: string[]): Promise<CartMutationResult>;
  updateLines(
    lines: Array<{id: string; quantity: number; merchandiseId?: string}>,
  ): Promise<CartMutationResult>;
  addLines(lines: CartLineAddInput[]): Promise<CartMutationResult>;
  updateAttributes(
    attributes: Array<{key: string; value: string}>,
  ): Promise<CartMutationResult>;
};

export type OfferRuntime = {
  readonly storefront: Storefront;
  readonly cart: CartHandlerLike;
  /** The request-context env (ADR-0004); only OFFER_CONFIG_JSON is read. */
  readonly env: object;
  /** Production fails closed when the offer rules are missing; dev and mock stores run with offers off. */
  readonly production: boolean;
  /**
   * The shopper's saved delivery ZIP, read by the route from the signed cookie (delivery-runtime/zip-cookie).
   * Absent or null reads as "no ZIP": haul-away then fails closed (zip-missing) and no delivery question is asked.
   */
  readonly zip?: string | null;
};

/**
 * What the accept-protection actions need from the pass that just judged the cart: the plans Extend quoted per eligible
 * line and the price-point variant for each price. Server data; it is never serialised into a response.
 */
export type CoverageSource = {
  readonly plansByLineId: ReadonlyMap<string, readonly CoveragePlan[]>;
  readonly variantIdByPriceCents: ReadonlyMap<number, string>;
};

/** What the Extend adapter reported for this check, without the inputs themselves (for logs and diagnostics). */
export type ExtendSummary = {
  readonly status: ExtendInputsOutcome['status'];
  readonly degraded: readonly string[];
};

export type OffersResult = {
  readonly cart: CartApiQueryFragment | null;
  readonly check: CartCheck<CartApiQueryFragment> | null;
  readonly view: CartOffersView | null;
  /** Present when Extend is on; `degraded` names what could not be read (never values). */
  readonly extend?: ExtendSummary;
  /** Present when the cart was judged; empty maps while Extend is off or unavailable. Server use only. */
  readonly coverage?: CoverageSource;
};

export function failed(result: CartMutationResult): boolean {
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

type ConfigGate = {
  readonly unverified: boolean;
  readonly config: OfferConfig;
};

/**
 * Loads the offer configuration and decides whether the cart can be judged at all. In production a missing
 * or unreadable configuration is UNVERIFIED, not "offers off": the rules are what tell a gift, protector or
 * service line from an ordinary one, so without them nothing may be repaired and checkout is paused. Only a
 * non-production environment (dev server, mock store) may run with no configuration. Logged by name only.
 */
function loadConfig(runtime: OfferRuntime): ConfigGate {
  // "Offers off" is a decision someone makes (OFFERS_ENABLED=false), never something a broken or missing
  // setting can cause by itself. In production the default is "required".
  if (Reflect.get(runtime.env, 'OFFERS_ENABLED') === 'false') {
    return {unverified: false, config: EMPTY_OFFER_CONFIG};
  }
  const loaded = readOfferConfig(runtime.env);
  if (loaded.status !== 'ok' || loaded.warnings.length > 0) {
    // Loud, value-free: the status and the names of dropped entries only (T-05).
    console.error('Offer config:', loaded.status, loaded.warnings.join('; '));
  }
  return {
    unverified: runtime.production && loaded.status !== 'ok',
    config: loaded.config,
  };
}

type Prepared =
  | {
      readonly status: 'ready';
      readonly deps: RevalidationDeps;
      readonly facts: ProductFacts;
      readonly rules: OfferRules;
      readonly zone: DeliveryZone | null;
      readonly extend: ExtendSummary;
      readonly inputs: ExtendCartInputs;
    }
  | {readonly status: 'unverified'; readonly extend?: ExtendSummary};

async function prepareRuntime(
  runtime: OfferRuntime,
  cart: CartApiQueryFragment,
): Promise<Prepared> {
  const gate = loadConfig(runtime);
  if (gate.unverified) return {status: 'unverified'};
  const {rules, zone} = gate.config;
  const needsCollections = rulesNeedCollections(rules);
  const loadedFacts = await loadProductFacts(
    runtime.storefront,
    productIdsOf(cart),
    needsCollections,
  );
  // A collection-qualified gift is judged by its product's collections; without them it would look orphaned
  // and be removed. Make no repairs on an incomplete read (size choices alone may be missing safely).
  if (needsCollections && loadedFacts.status === 'incomplete') {
    console.error('Offer facts incomplete:', loadedFacts.reason);
    return {status: 'unverified'};
  }
  const facts = loadedFacts.facts;
  // Which variants are Extend coverage and which lines can be covered (P5A-06, review O-M2). Read once per pass set from
  // the cart as Shopify returned it; it never blocks the cart (a failure degrades to the outage rule inside the seam).
  const outcome = await loadExtendCartInputs(runtime, cart);
  const summary: ExtendSummary = {
    status: outcome.status,
    degraded: outcome.status === 'degraded' ? outcome.degraded : [],
  };
  // Without the coverage catalog (or with no price point while the cart holds coverage) coverage lines cannot be told
  // from ordinary ones, and a coverage-only cart would reach checkout. Pause it, like a missing offer configuration.
  if (extendMakesCartUnverifiable(outcome)) {
    console.error(
      'Extend coverage inputs unavailable:',
      summary.degraded.join(','),
    );
    return {status: 'unverified', extend: summary};
  }
  const extend = outcome.inputs;
  // Shopify's own unit prices from the cart just read; a coverage line is judged against the plans quoted for its parent.
  const prices = unitPricesByLineId(cart);
  const deps: RevalidationDeps = {
    rules,
    // The server adds what only it knows; roles on the incoming cart are never believed.
    prepare: async (mapped) =>
      applyServerRoles(
        withUnitPrices(withCollections(mapped, facts), prices),
        extend,
      ),
    contextFor: (mapped) => ({
      ...buildOfferContext(mapped, {
        zip: runtime.zip ?? null,
        zone,
        protectionEligibleLineIds: extend.protectionEligibleLineIds,
      }),
      coveragePlanPricesByLineId: extend.coveragePlanPricesByLineId,
    }),
  };
  return {
    status: 'ready',
    deps,
    facts,
    rules,
    zone,
    extend: summary,
    inputs: extend,
  };
}

function approvedText(value: string | undefined): string | null {
  const text = value?.trim();
  return text ? text : null;
}

/** "Default Title" is Shopify's placeholder for a product with one variant; it is not worth showing. */
function variantTitleOf(title: string | undefined): string | null {
  const text = title?.trim();
  return text && text !== 'Default Title' ? text : null;
}

function protectionTitles(
  cart: CartApiQueryFragment,
): Map<string, {productTitle: string; variantTitle: string | null}> {
  const titles = new Map<
    string,
    {productTitle: string; variantTitle: string | null}
  >();
  for (const line of cart.lines.nodes) {
    const productTitle = line.merchandise?.product?.title;
    if (productTitle) {
      titles.set(line.id, {
        productTitle,
        variantTitle: variantTitleOf(line.merchandise?.title),
      });
    }
  }
  return titles;
}

async function viewOf(
  runtime: OfferRuntime,
  check: CartCheck<CartApiQueryFragment>,
  prepared: {
    readonly facts: ProductFacts;
    readonly rules: OfferRules;
    readonly zone: DeliveryZone | null;
    readonly inputs: ExtendCartInputs;
  },
): Promise<CartOffersView> {
  const {facts, rules, zone, inputs} = prepared;
  const index = buildRuleIndex(rules);
  // The haul-away service is looked up before in-home is chosen too: the delivery question is asked only
  // when there is a service that can be bought afterwards.
  const haulVariantId = rules.haulAway?.variantId;
  const variants = await loadOfferedVariants(
    runtime.storefront,
    offeredVariantIds(check.evaluation, haulVariantId ? [haulVariantId] : []),
  );
  const deliveryChoice: DeliveryChoiceState = deliveryChoiceState({
    haulAwayOffered: haulVariantId !== undefined && variants.has(haulVariantId),
    zone,
    zip: runtime.zip ?? null,
    choice: parseOfferAttributes(check.cart.attributes).deliveryChoice,
  });
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
    deliveryChoice,
    promises: {
      inHome: approvedText(zone?.promise.inHome),
      pickup: approvedText(zone?.promise.pickup),
    },
    ...(inputs.plansByLineId.size > 0
      ? {
          protection: {
            plansByLineId: inputs.plansByLineId,
            titles: protectionTitles(check.cart),
          },
        }
      : {}),
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
  const prepared = await prepareRuntime(runtime, current);
  if (prepared.status === 'unverified') {
    // No repair, no offers: the hand-off is withheld with an explanation.
    return {
      cart: current,
      check: null,
      view: unverifiedView(
        current.updatedAt ?? null,
        OFFERS_UNAVAILABLE_REASON,
      ),
      ...(prepared.extend ? {extend: prepared.extend} : {}),
    };
  }
  const {deps} = prepared;
  const check = await revalidateCart(current, portFor(runtime), deps);
  const view = await viewOf(runtime, check, prepared);
  return {
    cart: check.cart,
    check,
    view,
    extend: prepared.extend,
    coverage: {
      plansByLineId: prepared.inputs.plansByLineId,
      variantIdByPriceCents: prepared.inputs.coverageVariantIdByPriceCents,
    },
  };
}

export type StepFailure =
  | 'cart-gone'
  | 'nothing-to-add'
  | 'add-failed'
  | 'record-failed'
  | 'not-changeable'
  | 'size-unavailable'
  | 'unverified'
  | DeliveryStepFailure
  | ProtectionStepFailure;

const STEP_FAILURE_TEXT: Record<StepFailure, string> = {
  'cart-gone': 'That item is no longer in your cart.',
  'nothing-to-add': 'There is nothing to add right now.',
  'add-failed':
    'We could not add that to your cart. You can try again or continue without it.',
  'record-failed':
    'We could not save your choice. You can try again or continue to checkout.',
  'not-changeable': 'The size of this item cannot be changed.',
  'size-unavailable': 'That size is not available.',
  unverified: OFFERS_UNAVAILABLE_REASON.message,
  ...DELIVERY_STEP_FAILURE_TEXT,
  ...PROTECTION_STEP_FAILURE_TEXT,
};

export function stepFailureText(code: StepFailure): string {
  return STEP_FAILURE_TEXT[code];
}

/** Narrows a value from a URL to a known failure code (the code is shown as fixed text, never echoed). */
export function parseStepFailure(value: unknown): StepFailure | null {
  return (
    Object.keys(STEP_FAILURE_TEXT).find(
      (code): code is StepFailure => code === value,
    ) ?? null
  );
}

export type StepChangeResult =
  | {
      readonly status: 'ok';
      readonly result: CartMutationResult;
      /** The change went through but part of what the shopper asked for did not (a known code, shown as fixed text). */
      readonly warning?: StepFailure;
    }
  | {
      readonly status: 'rejected';
      readonly code: StepFailure;
      readonly reason: string;
    };

export type RejectedStep = Extract<StepChangeResult, {status: 'rejected'}>;

export function rejectedStep(code: StepFailure): RejectedStep {
  return {status: 'rejected', code, reason: STEP_FAILURE_TEXT[code]};
}

/**
 * Swaps a regular line to another size of the SAME product (REQ-CART-001). The browser names the line and the
 * variant; the quantity is the cart's own, the variant must belong to the line's product and be in stock,
 * and offer-only lines (gifts, protectors, haul-away, coverage) cannot be swapped. The caller revalidates.
 * The line is read again right before the change, so the quantity cannot come from a stale snapshot.
 */
export async function swapLineSize(
  runtime: OfferRuntime,
  current: CartApiQueryFragment | null,
  change: {readonly lineId: string; readonly merchandiseId: string},
): Promise<StepChangeResult> {
  const line = current?.lines.nodes.find((node) => node.id === change.lineId);
  const productId = line?.merchandise?.product?.id;
  if (!current || !line || !productId) return rejectedStep('cart-gone');
  const gate = loadConfig(runtime);
  // Without the rules a gift or protector would look like an ordinary line and be swapped.
  if (gate.unverified) return rejectedStep('unverified');
  const mapped = toCartLike(current).lines.find((node) => node.id === line.id);
  if (
    !mapped ||
    classifyLine(mapped, buildRuleIndex(gate.config.rules)) !== 'regular'
  ) {
    return rejectedStep('not-changeable');
  }
  const target = await loadSwapTarget(runtime.storefront, change.merchandiseId);
  if (
    target.status !== 'ok' ||
    target.productId !== productId ||
    !isSizeSwap(line.merchandise.selectedOptions, target.options)
  ) {
    return rejectedStep('size-unavailable');
  }
  const fresh = (await runtime.cart.get())?.lines.nodes.find(
    (node) => node.id === line.id,
  );
  if (!fresh) return rejectedStep('cart-gone');
  return {
    status: 'ok',
    result: await runtime.cart.updateLines([
      {
        id: fresh.id,
        quantity: fresh.quantity,
        merchandiseId: change.merchandiseId,
      },
    ]),
  };
}

/**
 * Accepting the comfort guarantee adds exactly what the engine says is missing: no variant id or quantity comes
 * from the browser. Order matters for REQ-PRE-005: the decline attribute is reset FIRST, then the lines are
 * added. If the reset fails nothing was added; if the add fails the shopper is simply "not declined" and the
 * step is still pending. Neither failure leaves a protector in the cart next to a recorded decline.
 */
export async function acceptComfortGuarantee(
  runtime: OfferRuntime,
  current: CartApiQueryFragment | null,
): Promise<StepChangeResult> {
  const offers = await revalidateCartOffers(runtime, current);
  const options = offers.view?.comfortGuarantee?.options ?? [];
  if (!offers.cart || options.length === 0) {
    return rejectedStep('nothing-to-add');
  }
  const reset = await runtime.cart.updateAttributes(
    withAttribute(
      offers.cart.attributes,
      clearDeclineAttribute('comfort-guarantee'),
    ),
  );
  if (failed(reset)) return rejectedStep('record-failed');
  const added = await runtime.cart.addLines(
    options.map((option) => ({
      merchandiseId: option.variant.variantId,
      quantity: option.quantityMissing,
    })),
  );
  if (failed(added)) return rejectedStep('add-failed');
  return {status: 'ok', result: added};
}

/** Declining is recorded as a cart attribute that becomes an order note attribute (REQ-PRE-005). */
export async function declineComfortGuarantee(
  runtime: OfferRuntime,
  current: CartApiQueryFragment | null,
): Promise<StepChangeResult> {
  if (!current || current.lines.nodes.length === 0) {
    return rejectedStep('cart-gone');
  }
  const written = await runtime.cart.updateAttributes(
    withAttribute(current.attributes, declineAttribute('comfort-guarantee')),
  );
  return failed(written)
    ? rejectedStep('record-failed')
    : {status: 'ok', result: written};
}
