// SERVER ONLY. The cart pickers' accept actions (P4-04 gift, P4-05 add-on, P4-06 bundle; REQ-CART-002, REQ-CART-003,
// REQ-ADD-002, T-01, T-02). Same shape as protection-steps.ts: nothing but the shopper's intent comes from the browser.
//  - GIFT: a rule id and a variant id. Both must be in what the engine offers THIS cart right now (a qualifying line is in
//    the cart, the allowance is not used up, the variant is in stock) and the variant must belong to that rule. The
//    quantity is always one and never read from the request. The gift's price is Shopify's discount: if the line is not
//    priced at 0 afterwards, the cart gate pauses checkout (cart-gate.ts).
//  - ADD-ON: a variant id. It must be one the rules offer for a mattress line in THIS cart (so the size match in the
//    rules holds), in stock. Quantity is one; the shopper changes it with the cart's own stepper (add-ons are ordinary
//    lines the engine never limits, addons.ts). From the PRODUCT PAGE (P4-03) the request also names the mattress
//    variant being viewed, because the mattress may not be in the cart yet: the pair is proved against the rules and
//    Shopify (the mattress's product and size are read from Shopify, never from the request) and the mattress is added
//    with the item when it is missing.
//  - BUNDLE: a bundle id and an anchor line id. The lines to add are derived again from the rule and the cart (the
//    companions still missing, in the anchor's size), added in ONE call, and the result is reconciled against the cart
//    read back from Shopify, so a partial add is reported instead of looking like success.
// A refusal is a fixed text and changes nothing; the route's gate then repairs whatever is left.

import type {CartApiQueryFragment} from 'storefrontapi.generated';
import {
  bundleCompletions,
  reconcileAddAll,
  type BundleLine,
} from '~/lib/offers/bundles';
import {
  addOnRelationsFor,
  matchingAddOnOffers,
  relationFitsSize,
} from '~/lib/offers/addons';
import {giftSizeOptions} from '~/lib/offers/gifts';
import {buildRuleIndex, prepareCart} from '~/lib/offers/lines';
import type {CartLike, OfferRules} from '~/lib/offers/types';
import {toCartLike} from '~/lib/shopify/cart-mapper';
import {
  revalidateCartGate,
  type GateOptions,
  type GateResult,
} from './cart-gate';
import {loadOfferedVariants, loadSwapTarget} from './facts';
import {PICKER_STEP_FAILURE_TEXT, type PickerStepFailure} from './messages';
import type {CartCreator} from './protection-steps';
import {
  failed,
  loadConfig,
  stepFailureText,
  type CartLineAddInput,
  type CartMutationResult,
  type OfferRuntime,
  type StepFailure,
} from './server';
import {sizeOf} from './sizes';
import type {CartOffersView} from './view';

type SharedFailure = Extract<
  StepFailure,
  'cart-gone' | 'unverified' | 'add-failed'
>;
export type PickerFailure = PickerStepFailure | SharedFailure;

export type PickerResult =
  | {
      readonly status: 'ok';
      readonly result: CartMutationResult;
      /** The change went through in part (a known code, shown as fixed text). */
      readonly warning?: PickerStepFailure;
    }
  | {
      readonly status: 'rejected';
      readonly code: PickerFailure;
      readonly reason: string;
    };

type Rejected = Extract<PickerResult, {status: 'rejected'}>;

function isPickerFailure(code: PickerFailure): code is PickerStepFailure {
  return code in PICKER_STEP_FAILURE_TEXT;
}

function rejection(code: PickerFailure): Rejected {
  return {
    status: 'rejected',
    code,
    reason: isPickerFailure(code)
      ? PICKER_STEP_FAILURE_TEXT[code]
      : stepFailureText(code),
  };
}

/** The fixed text of a partial-success warning, for the route's `warnings`. */
export function pickerWarningText(code: PickerStepFailure): string {
  return PICKER_STEP_FAILURE_TEXT[code];
}

type Judged = {
  readonly status: 'ok';
  readonly gate: GateResult;
  readonly cart: CartApiQueryFragment;
  readonly view: CartOffersView;
};

/** Judges the cart as it is now. A cart that could not be verified offers nothing, like the protection step. */
async function judge(
  runtime: OfferRuntime,
  current: CartApiQueryFragment | null,
  options: GateOptions = {},
): Promise<Judged | Rejected> {
  const gate = await revalidateCartGate(runtime, current, options);
  const {cart, view} = gate;
  if (!cart || cart.lines.nodes.length === 0) return rejection('cart-gone');
  if (!view || view.blocked.some((reason) => reason.code === 'unverified')) {
    return rejection('unverified');
  }
  return {status: 'ok', gate, cart, view};
}

/**
 * Two tabs can post at once, and both judged the same cart. The cart is read again right before the add and the add is
 * abandoned if Shopify's version of it moved on, so a paid add-on or bundle is not added twice (K-L5). A request that
 * lands in the few milliseconds between this read and the add is still possible; the cart gate repairs what it can and
 * the shopper sees the lines.
 *
 * Narrowed, not closed: this is a compare-then-act on `updatedAt`, not an atomic step, and Shopify offers no
 * conditional cart mutation. Whether `Cart.updatedAt` has a fine enough resolution (it could be whole seconds, so two
 * writes in the same tick would compare equal) and whether every cart change moves it are UNVERIFIED (V-27: a
 * development-store check, not yet listed there as its own item). Until that is checked, treat this as best effort and
 * rely on the gate and the detective check for the rest.
 */
async function cartUnchanged(
  runtime: OfferRuntime,
  judged: CartApiQueryFragment,
): Promise<boolean> {
  const fresh = await runtime.cart.get();
  return fresh !== null && fresh.updatedAt === judged.updatedAt;
}

export type AddGiftInput = {
  readonly ruleId: string;
  readonly variantId: string;
};

export async function addGift(
  runtime: OfferRuntime,
  current: CartApiQueryFragment | null,
  input: AddGiftInput,
): Promise<PickerResult> {
  const judged = await judge(runtime, current, {bundles: false});
  if (judged.status === 'rejected') return judged;
  const {gate, view} = judged;

  const offered = view.gifts.find((gift) => gift.ruleId === input.ruleId);
  if (!offered) return rejection('gift-not-offered');
  // Twice on purpose: the view proves the variant is in stock for this cart, the rule proves it belongs to this gift.
  const rule = gate.rules.gifts.find((gift) => gift.id === input.ruleId);
  const inRule =
    rule !== undefined &&
    giftSizeOptions(rule).some((size) => size.variantId === input.variantId);
  const inView = offered.sizes.some(
    (size) => size.variant.variantId === input.variantId,
  );
  if (!inRule || !inView) return rejection('gift-choice-invalid');
  if (!(await cartUnchanged(runtime, judged.cart))) {
    return rejection('cart-changed');
  }

  const added = await runtime.cart.addLines([
    {merchandiseId: input.variantId, quantity: 1},
  ]);
  return failed(added)
    ? rejection('add-failed')
    : {status: 'ok', result: added};
}

export type AddAddOnInput = {
  readonly variantId: string;
  /** Product page only (P4-03): the mattress variant the shopper is viewing. Absent = the cart picker. */
  readonly mattressVariantId?: string;
};

/**
 * Accepts an add-on. Two entry points share one rule (the admin's size-matched relations) and one fixed quantity (one):
 *  - the cart picker (no `mattressVariantId`): the mattress is a line of the cart;
 *  - the product page (`mattressVariantId`): the mattress is the one being viewed, in the cart or not.
 *
 * Neither runs the full cart gate before the add. The route runs it once AFTER the change, and that pass is the one that
 * repairs the cart and builds the view. The cart picker used to judge the whole cart first (product facts, Extend inputs,
 * repairs, view lookups) to answer one question, "does a rule offer this variant for a mattress line of this cart",
 * which `matchingAddOnOffers` answers on its own. Roles that only the full pass assigns (Extend coverage lines) cannot
 * matter here: an add-on relation is keyed by a mattress PRODUCT and a coverage line is never one. A cart the gate would
 * call unverified (the coverage catalog unreadable) still gets the add, since an ordinary add-on cannot make it worse
 * and the route's gate pass still withholds checkout.
 */
export async function addAddOn(
  runtime: OfferRuntime,
  current: CartApiQueryFragment | null,
  input: AddAddOnInput,
  create?: CartCreator,
): Promise<PickerResult> {
  const config = loadConfig(runtime);
  // Without the rules a gift or protector would look like an ordinary line: nothing is offered (fail closed).
  if (config.unverified) return rejection('unverified');
  const {rules} = config.config;
  return input.mattressVariantId === undefined
    ? addForCartMattress(runtime, current, rules, input.variantId)
    : addWithMattress(
        runtime,
        current,
        rules,
        {
          variantId: input.variantId,
          mattressVariantId: input.mattressVariantId,
        },
        create,
      );
}

function oneOf(variantId: string): CartLineAddInput {
  return {merchandiseId: variantId, quantity: 1};
}

async function inStock(
  runtime: OfferRuntime,
  variantId: string,
): Promise<boolean> {
  const found = await loadOfferedVariants(runtime.storefront, [variantId]);
  return found.has(variantId);
}

async function addForCartMattress(
  runtime: OfferRuntime,
  current: CartApiQueryFragment | null,
  rules: OfferRules,
  variantId: string,
): Promise<PickerResult> {
  if (!current || current.lines.nodes.length === 0) {
    return rejection('cart-gone');
  }
  const offered = matchingAddOnOffers(
    prepareCart(toCartLike(current), rules),
    rules.matchingAddOns,
  ).some((offer) => offer.variantId === variantId);
  if (!offered || !(await inStock(runtime, variantId))) {
    return rejection('addon-not-offered');
  }
  if (!(await cartUnchanged(runtime, current))) {
    return rejection('cart-changed');
  }
  const added = await runtime.cart.addLines([oneOf(variantId)]);
  return failed(added)
    ? rejection('add-failed')
    : {status: 'ok', result: added};
}

type MattressFacts = {
  readonly productId: string;
  readonly size: string | null;
};

/**
 * The mattress being viewed, as Shopify describes it: the cart line when it is already there, otherwise a fresh read of
 * the variant (which also proves it can be bought now). Null = not something an add-on can be offered for.
 */
async function mattressFacts(
  runtime: OfferRuntime,
  mapped: CartLike | null,
  mattressVariantId: string,
): Promise<MattressFacts | null> {
  const line = mapped?.lines.find(
    (candidate) =>
      candidate.variantId === mattressVariantId &&
      candidate.parentLineId === null,
  );
  if (line) return {productId: line.productId, size: line.size};
  const target = await loadSwapTarget(runtime.storefront, mattressVariantId);
  return target.status === 'ok'
    ? {productId: target.productId, size: sizeOf(target.options)}
    : null;
}

async function addWithMattress(
  runtime: OfferRuntime,
  current: CartApiQueryFragment | null,
  rules: OfferRules,
  input: {readonly variantId: string; readonly mattressVariantId: string},
  create?: CartCreator,
): Promise<PickerResult> {
  const {variantId, mattressVariantId} = input;
  const index = buildRuleIndex(rules);
  // A gift, protector or service variant is never "the mattress", whatever product a forged request says it is in.
  if (
    index.giftVariantIds.has(mattressVariantId) ||
    index.comfortProtectorVariantIds.has(mattressVariantId) ||
    index.haulAwayVariantId === mattressVariantId
  ) {
    return rejection('addon-not-offered');
  }
  const mapped =
    current && current.lines.nodes.length > 0 ? toCartLike(current) : null;
  const facts = await mattressFacts(runtime, mapped, mattressVariantId);
  if (!facts) return rejection('addon-not-offered');
  // The same relations and the same size comparison as the cart engine (matchingAddOnOffers).
  const related = addOnRelationsFor(rules.matchingAddOns, facts.productId).some(
    ({relation}) =>
      relation.variantId === variantId &&
      relationFitsSize(relation, facts.size),
  );
  if (!related || !(await inStock(runtime, variantId))) {
    return rejection('addon-not-offered');
  }

  const held = new Set(mapped?.lines.map((line) => line.variantId));
  const lines: CartLineAddInput[] = [
    ...(held.has(mattressVariantId) ? [] : [oneOf(mattressVariantId)]),
    ...(held.has(variantId) ? [] : [oneOf(variantId)]),
  ];
  if (lines.length === 0) return rejection('addon-already-in-cart');
  if (current && !(await cartUnchanged(runtime, current))) {
    return rejection('cart-changed');
  }

  let added = await runtime.cart.addLines(lines);
  // A stale or unknown cart cookie answers with no cart and no error: start a fresh cart with the same lines.
  if (!added.cart?.id && !failed(added) && create) {
    added = await create({lines});
  }
  return failed(added)
    ? rejection('add-failed')
    : {status: 'ok', result: added};
}

function quantitiesByVariant(cart: CartApiQueryFragment): Map<string, number> {
  const quantities = new Map<string, number>();
  for (const node of cart.lines.nodes) {
    const id = node.merchandise?.id;
    if (id) quantities.set(id, (quantities.get(id) ?? 0) + node.quantity);
  }
  return quantities;
}

export type AddBundleInput = {
  readonly bundleId: string;
  readonly anchorLineId: string;
};

export async function addBundle(
  runtime: OfferRuntime,
  current: CartApiQueryFragment | null,
  input: AddBundleInput,
): Promise<PickerResult> {
  const judged = await judge(runtime, current);
  if (judged.status === 'rejected') return judged;
  const {gate, cart, view} = judged;

  // Offered now (all companions in stock), and re-derived from the rule and the cart, never from the view's list.
  const offered = view.bundles.some(
    (bundle) =>
      bundle.bundleId === input.bundleId &&
      bundle.anchorLineId === input.anchorLineId &&
      bundle.status === 'incomplete',
  );
  const rule = gate.rules.bundles.find(
    (bundle) => bundle.id === input.bundleId,
  );
  const completion = rule
    ? bundleCompletions(rule, toCartLike(cart), gate.rules).find(
        (candidate) => candidate.anchorLineId === input.anchorLineId,
      )
    : undefined;
  if (!offered || !completion || completion.state !== 'incomplete') {
    return rejection('bundle-not-offered');
  }
  if (!(await cartUnchanged(runtime, cart))) return rejection('cart-changed');

  const requested: readonly BundleLine[] = completion.missing;
  const result = await runtime.cart.addLines(
    requested.map((line) => ({
      merchandiseId: line.variantId,
      quantity: line.quantity,
    })),
  );

  // What Shopify really holds decides, not what the mutation said (a partial add can still return userErrors).
  const before = quantitiesByVariant(cart);
  const after = await runtime.cart.get();
  if (!after) {
    return failed(result)
      ? rejection('bundle-add-failed')
      : {status: 'ok', result};
  }
  const now = quantitiesByVariant(after);
  const added = requested.map((line) => ({
    variantId: line.variantId,
    quantity:
      (now.get(line.variantId) ?? 0) - (before.get(line.variantId) ?? 0),
  }));
  const reconciled = reconcileAddAll(requested, added);
  switch (reconciled.status) {
    case 'complete':
      return {status: 'ok', result};
    case 'partial':
      return {status: 'ok', result, warning: 'bundle-partial'};
    case 'failed':
      return rejection('bundle-add-failed');
    default: {
      const unreachable: never = reconciled;
      return unreachable;
    }
  }
}
