// SERVER ONLY. The accept and decline actions for Extend accident protection (P5A-05, P5A-06, P5A-07; REQ-ADD-003,
// REQ-PRE-004, REQ-EXT-002, T-01, T-06). Like acceptComfortGuarantee, nothing but the shopper's intent comes from the
// browser:
//  - a PLAN KEY (Extend's plan id) and a variant or line id. Never a coverage variant id, a price, a parent or a quantity
//    of the coverage line;
//  - the plan is looked up again in the server's own quote (the same one the cart gate uses), so a forged key is refused;
//  - the coverage variant is the price-point variant whose price EQUALS the quoted plan price (ADR-0009 decision 1);
//  - the coverage line is added nested under the covered line with the hidden attributes this server writes (linking.ts),
//    and its quantity is the covered units (quantity follows the item);
//  - the existing cart gate (revalidateCartOffers) runs after every change in the route and corrects whatever is left.
// Every refusal is a fixed code (messages.ts) and leaves the shopper able to continue without protection.

import type {CartApiQueryFragment} from 'storefrontapi.generated';
import {buildCoverageAttributes} from '~/lib/extend/linking';
import {loadVariantFacts} from '~/lib/extend/coverage-facts';
import {coverageItemFor} from '~/lib/extend/offers-endpoint';
import type {CoveragePlan} from '~/lib/extend/offers-service';
import {offersConfigOf} from '~/lib/extend/runtime';
import {
  clearDeclineAttribute,
  declineAttribute,
  parseOfferAttributes,
} from '~/lib/offers/attributes';
import {realExtendSeamDeps} from './extend-seam';
import {
  failed,
  rejectedStep,
  revalidateCartOffers,
  type CartLineAddInput,
  type CartMutationResult,
  type OfferRuntime,
  type RejectedStep,
  type StepChangeResult,
} from './server';
import {withAttribute} from './step-attributes';

/** Starts a cart when the cookie points at none (the cart route passes Hydrogen's `cart.create`). */
export type CartCreator = (input: {
  lines: CartLineAddInput[];
}) => Promise<CartMutationResult>;

export type AddWithProtectionInput = {
  readonly variantId: string;
  readonly quantity: number;
  readonly planKey: string;
};

export type AddProtectionInput = {
  readonly lineId: string;
  readonly planKey: string;
};

type Resolved =
  | {
      readonly status: 'ok';
      readonly plan: CoveragePlan;
      readonly coverageVariantId: string;
      readonly productId: string;
    }
  | RejectedStep;

/**
 * The server-side half of "which plan did the shopper pick": quote the variant again, find the plan by its key and turn
 * its price into the price-point variant. Everything is read from Shopify and Extend (server to server).
 */
async function resolvePlan(
  runtime: OfferRuntime,
  input: AddWithProtectionInput,
): Promise<Resolved> {
  // Flag off or misconfigured: no Shopify or Extend traffic at all, and nothing is added (NFR-013, REQ-ADD-003).
  if (offersConfigOf(runtime).status !== 'enabled') {
    return rejectedStep('protection-unavailable');
  }
  const deps = realExtendSeamDeps(runtime);
  const catalog = await deps.loadCatalog();
  if (catalog.status !== 'ok') return rejectedStep('protection-unavailable');
  // A coverage variant named as the item is a forged request: protection is never bought on protection or alone.
  if (catalog.catalog.coverageVariantIds.has(input.variantId)) {
    return rejectedStep('protection-not-allowed');
  }
  const facts = await loadVariantFacts(runtime.storefront, [input.variantId]);
  if (facts.status !== 'ok') return rejectedStep('protection-unavailable');
  const fact = facts.facts.get(input.variantId);
  const item = coverageItemFor(
    input.variantId,
    input.quantity,
    fact,
    catalog.catalog.coverageVariantIds,
  );
  if (item === null || fact === undefined) {
    return rejectedStep('protection-unavailable');
  }
  const quote = await deps.quote([item], catalog.catalog.index);
  if (quote.status !== 'ok') return rejectedStep('protection-unavailable');
  const plans = quote.plansByKey.get(item.key) ?? [];
  if (plans.length === 0) return rejectedStep('protection-unavailable');
  const plan = plans.find((candidate) => candidate.planId === input.planKey);
  if (plan === undefined) return rejectedStep('protection-plan-unknown');
  const coverage = catalog.catalog.index.byPriceCents.get(plan.priceCents);
  if (coverage === undefined) return rejectedStep('protection-unavailable');
  return {
    status: 'ok',
    plan,
    coverageVariantId: coverage.variantId,
    productId: fact.productId,
  };
}

type DeclineClearing = 'none' | 'cleared' | 'failed';

/**
 * A decline that was recorded earlier is cleared BEFORE protection is added, so a successful add never leaves a
 * protection line next to a "declined" mark (the same order as the comfort guarantee, REQ-PRE-005). `failed` means the
 * write failed and nothing has been added. `cleared` obliges the caller to put the mark back if the add then fails
 * (`failAdd`), otherwise a refused add would silently turn a decline into "not asked yet".
 */
async function clearEarlierDecline(
  runtime: OfferRuntime,
  cart: Pick<CartApiQueryFragment, 'attributes'> | null,
): Promise<DeclineClearing> {
  if (!cart) return 'none';
  if (!parseOfferAttributes(cart.attributes).declined['accident-protection']) {
    return 'none';
  }
  const reset = await runtime.cart.updateAttributes(
    withAttribute(
      cart.attributes,
      clearDeclineAttribute('accident-protection'),
    ),
  );
  return failed(reset) ? 'failed' : 'cleared';
}

/**
 * The add was refused and nothing changed, so the shopper's earlier decline still stands: write it back from the cart
 * as it was before. Best effort: if this write fails too, the cart only loses the "declined" mark, which means the
 * protection step is asked again; it never leaves protection and a decline together.
 */
async function failAdd(
  runtime: OfferRuntime,
  before: Pick<CartApiQueryFragment, 'attributes'> | null,
  clearing: DeclineClearing,
): Promise<RejectedStep> {
  if (clearing === 'cleared' && before) {
    await runtime.cart.updateAttributes(
      withAttribute(before.attributes, declineAttribute('accident-protection')),
    );
  }
  return rejectedStep('protection-add-failed');
}

type CartLineNode = CartApiQueryFragment['lines']['nodes'][number];

/** The parent of a cart line, or null. Componentizable lines (bundles) have no nested parent. */
function parentIdOf(line: CartLineNode): string | null {
  return 'parentRelationship' in line
    ? (line.parentRelationship?.parent.id ?? null)
    : null;
}

function topLevelLinesOf(
  cart: CartApiQueryFragment,
  variantId: string,
): CartLineNode[] {
  return cart.lines.nodes.filter(
    (line) => line.merchandise?.id === variantId && parentIdOf(line) === null,
  );
}

/** Units of a line that no coverage child covers yet. */
function uncoveredUnits(
  cart: CartApiQueryFragment,
  line: CartLineNode,
): number {
  const covered = cart.lines.nodes
    .filter((child) => parentIdOf(child) === line.id)
    .reduce((sum, child) => sum + child.quantity, 0);
  return line.quantity - covered;
}

/**
 * The line a just-added item landed on when the cart already held that variant: the one with the most uncovered units
 * (ties go to the later line). Shopify merges identical lines, so this is normally the single line.
 */
function parentAfterAdd(
  cart: CartApiQueryFragment,
  variantId: string,
): {line: CartLineNode; uncovered: number} | null {
  let best: {line: CartLineNode; uncovered: number} | null = null;
  for (const line of topLevelLinesOf(cart, variantId)) {
    const uncovered = uncoveredUnits(cart, line);
    if (uncovered > 0 && (best === null || uncovered >= best.uncovered)) {
      best = {line, uncovered};
    }
  }
  return best;
}

/**
 * Product page: add the chosen item AND its protection plan in one submission (P5A-05, REQ-ADD-003).
 *
 * New item: one `cartLinesAdd` with the item and the coverage line nested under it by variant, so either both land or
 * neither does. Item already in the cart: Shopify cannot reference an existing line by variant, so the item is added
 * first and the coverage line is then nested under the line it landed on; if that second step fails the item is still
 * in the cart and the result carries the `protection-partial` warning (the shopper can add protection from the cart).
 */
export async function addItemWithProtection(
  runtime: OfferRuntime,
  current: CartApiQueryFragment | null,
  input: AddWithProtectionInput,
  create?: CartCreator,
): Promise<StepChangeResult> {
  const resolved = await resolvePlan(runtime, input);
  if (resolved.status === 'rejected') return resolved;
  const attributes = buildCoverageAttributes(resolved.plan, resolved.productId);
  if (attributes === null) return rejectedStep('protection-unavailable');
  const clearing = await clearEarlierDecline(runtime, current);
  if (clearing === 'failed') return rejectedStep('record-failed');

  const alreadyInCart =
    current !== null && topLevelLinesOf(current, input.variantId).length > 0;
  if (!alreadyInCart) {
    const lines: CartLineAddInput[] = [
      {merchandiseId: input.variantId, quantity: input.quantity},
      {
        merchandiseId: resolved.coverageVariantId,
        quantity: input.quantity,
        attributes,
        parent: {merchandiseId: input.variantId},
      },
    ];
    let result = await runtime.cart.addLines(lines);
    // A stale or unknown cart cookie answers with no cart and no error: start a fresh cart with the same lines.
    if (!result.cart?.id && !failed(result) && create) {
      result = await create({lines});
    }
    return failed(result)
      ? failAdd(runtime, current, clearing)
      : {status: 'ok', result};
  }

  const added = await runtime.cart.addLines([
    {merchandiseId: input.variantId, quantity: input.quantity},
  ]);
  if (failed(added)) return failAdd(runtime, current, clearing);
  const after = await runtime.cart.get();
  const parent = after ? parentAfterAdd(after, input.variantId) : null;
  if (!parent)
    return {status: 'ok', result: added, warning: 'protection-partial'};
  const covered = await runtime.cart.addLines([
    {
      merchandiseId: resolved.coverageVariantId,
      // Only the units just added; the gate trims it again if the parent is smaller than expected.
      quantity: Math.min(input.quantity, parent.uncovered),
      attributes,
      parent: {lineId: parent.line.id},
    },
  ]);
  return failed(covered)
    ? {status: 'ok', result: added, warning: 'protection-partial'}
    : {status: 'ok', result: covered};
}

/**
 * Cart and pre-checkout step: protect a line that is already in the cart (P5A-07, REQ-PRE-004). The line must be one
 * the engine itself reports as eligible with uncovered units in THIS pass, the plan must be one Extend quoted for that
 * line, and the quantity is the uncovered units (never a number from the browser).
 */
export async function addProtectionToLine(
  runtime: OfferRuntime,
  current: CartApiQueryFragment | null,
  input: AddProtectionInput,
): Promise<StepChangeResult> {
  const offers = await revalidateCartOffers(runtime, current);
  const cart = offers.cart;
  if (!cart || cart.lines.nodes.length === 0) return rejectedStep('cart-gone');
  // A cart that could not be verified offers no questions at all.
  if (
    !offers.view ||
    offers.view.blocked.some((r) => r.code === 'unverified')
  ) {
    return rejectedStep('unverified');
  }
  const offered = offers.view.accidentProtection?.lines.find(
    (line) => line.lineId === input.lineId,
  );
  const line = cart.lines.nodes.find((node) => node.id === input.lineId);
  if (!offered || !line || !offers.coverage) {
    return rejectedStep('protection-not-offered');
  }
  const plan = offers.coverage.plansByLineId
    .get(input.lineId)
    ?.find((candidate) => candidate.planId === input.planKey);
  if (plan === undefined) return rejectedStep('protection-plan-unknown');
  const coverageVariantId = offers.coverage.variantIdByPriceCents.get(
    plan.priceCents,
  );
  const productId = line.merchandise?.product?.id;
  const attributes =
    productId === undefined ? null : buildCoverageAttributes(plan, productId);
  if (coverageVariantId === undefined || attributes === null) {
    return rejectedStep('protection-unavailable');
  }
  const clearing = await clearEarlierDecline(runtime, cart);
  if (clearing === 'failed') return rejectedStep('record-failed');
  const added = await runtime.cart.addLines([
    {
      merchandiseId: coverageVariantId,
      quantity: offered.uncoveredQuantity,
      attributes,
      parent: {lineId: line.id},
    },
  ]);
  return failed(added)
    ? failAdd(runtime, cart, clearing)
    : {status: 'ok', result: added};
}

/**
 * Declining is recorded as a cart attribute that becomes an order note attribute (REQ-PRE-005). It is recorded only for
 * a question that was actually put to the shopper (the step is pending in the engine's own view of THIS cart), so a
 * forged post cannot write a decline for an offer that never applied.
 */
export async function declineProtection(
  runtime: OfferRuntime,
  current: CartApiQueryFragment | null,
): Promise<StepChangeResult> {
  if (!current || current.lines.nodes.length === 0) {
    return rejectedStep('cart-gone');
  }
  const offers = await revalidateCartOffers(runtime, current);
  const cart = offers.cart;
  if (!cart || cart.lines.nodes.length === 0) return rejectedStep('cart-gone');
  if (
    !offers.view ||
    offers.view.blocked.some((r) => r.code === 'unverified')
  ) {
    return rejectedStep('unverified');
  }
  const step = offers.view.accidentProtection;
  if (!step || step.status !== 'pending' || step.lines.length === 0) {
    return rejectedStep('protection-not-offered');
  }
  const written = await runtime.cart.updateAttributes(
    withAttribute(cart.attributes, declineAttribute('accident-protection')),
  );
  return failed(written)
    ? rejectedStep('record-failed')
    : {status: 'ok', result: written};
}
