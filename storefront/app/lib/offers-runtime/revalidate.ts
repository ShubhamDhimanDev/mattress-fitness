// Server-side cart revalidation (REQ-PRE-006, ADR-0003, ADR-0006). It runs the one offer engine against the
// real Shopify cart, applies the engine's corrections through the cart handler, and evaluates again until the
// engine has nothing left to correct. Corrections only ever lower a quantity or remove a line (offers/types),
// so each pass strictly shrinks the cart and the loop ends; the pass limit is a guard against a handler that
// reports success but changes nothing.
//
// Idempotent by construction: a cart the engine already accepts produces no mutation at all, and a repeated
// request after a partial failure simply finishes the job. Violations (a cart that cannot be repaired
// safely) are never "fixed" here; they block the hand-off and the UI explains why.
//
// Pure apart from the injected `port` and `prepare` (both async), so the whole flow is unit-tested with a
// fake cart.

import {evaluateOffers} from '~/lib/offers/evaluate';
import type {
  CartLike,
  Correction,
  OfferContext,
  OfferEvaluation,
  OfferRules,
} from '~/lib/offers/types';
import {toCartLike, type CartSource} from '~/lib/shopify/cart-mapper';
import {
  describeCorrections,
  describeViolation,
  UNVERIFIED_REASON,
  type BlockReason,
} from './messages';

export const MAX_REVALIDATION_PASSES = 3;

export type RevalidatableCart = CartSource & {
  readonly updatedAt?: string | null;
};

export type MutationOutcome<TCart> = {
  /** The cart after the mutation, or null when Shopify did not return one. */
  readonly cart: TCart | null;
  /** True when Shopify answered with errors (userErrors, GraphQL errors). */
  readonly failed: boolean;
};

export type CartPort<TCart> = {
  readonly removeLines: (lineIds: string[]) => Promise<MutationOutcome<TCart>>;
  readonly updateLines: (
    lines: Array<{id: string; quantity: number}>,
  ) => Promise<MutationOutcome<TCart>>;
  readonly refresh: () => Promise<TCart | null>;
};

export type RevalidationDeps = {
  readonly rules: OfferRules;
  /** Adds what only the server knows (roles from variant lists, collection ids); the cart's own claims are not trusted. */
  readonly prepare: (cart: CartLike) => Promise<CartLike>;
  readonly contextFor: (cart: CartLike) => OfferContext;
  readonly maxPasses?: number;
};

export type CartCheck<TCart> = {
  /** blocked = the hand-off must be refused; corrected = the cart was repaired; ok = nothing to do. */
  readonly status: 'ok' | 'corrected' | 'blocked';
  readonly cart: TCart;
  /** Evaluation of the final cart (after the repairs), for the offers UI and the step planner. */
  readonly evaluation: OfferEvaluation;
  readonly applied: readonly Correction[];
  readonly blocked: readonly BlockReason[];
  /** Plain-language notes about what was changed. */
  readonly notices: readonly string[];
};

async function evaluate(
  cart: RevalidatableCart,
  deps: RevalidationDeps,
): Promise<OfferEvaluation> {
  const prepared = await deps.prepare(toCartLike(cart));
  return evaluateOffers(prepared, deps.rules, deps.contextFor(prepared));
}

function blockedReasons(
  evaluation: OfferEvaluation,
  unrepaired: boolean,
): BlockReason[] {
  const reasons = evaluation.violations.map(describeViolation);
  if (unrepaired) reasons.push(UNVERIFIED_REASON);
  return reasons;
}

/** Read-only check (used by page loaders): reports violations, applies nothing. */
export async function checkCart<TCart extends RevalidatableCart>(
  cart: TCart,
  deps: RevalidationDeps,
): Promise<CartCheck<TCart>> {
  const evaluation = await evaluate(cart, deps);
  const blocked = blockedReasons(evaluation, false);
  return {
    status: blocked.length > 0 ? 'blocked' : 'ok',
    cart,
    evaluation,
    applied: [],
    blocked,
    notices: [],
  };
}

async function applyCorrections<TCart>(
  port: CartPort<TCart>,
  corrections: readonly Correction[],
): Promise<MutationOutcome<TCart>> {
  const removals = [
    ...new Set(
      corrections.flatMap((correction) =>
        correction.type === 'remove-line' ? [correction.lineId] : [],
      ),
    ),
  ];
  const removed = new Set(removals);
  const updates = corrections.flatMap((correction) =>
    correction.type === 'set-quantity' && !removed.has(correction.lineId)
      ? [{id: correction.lineId, quantity: correction.quantity}]
      : [],
  );

  let outcome: MutationOutcome<TCart> = {cart: null, failed: false};
  if (removals.length > 0) outcome = await port.removeLines(removals);
  if (outcome.failed) return outcome;
  if (updates.length > 0) {
    const next = await port.updateLines(updates);
    // Keep the removal's cart if the update did not return one; the caller refreshes on failure anyway.
    outcome = {cart: next.cart ?? outcome.cart, failed: next.failed};
  }
  return outcome;
}

/**
 * Evaluate, repair, repeat. Never throws for an expected failure: a mutation that Shopify rejects is
 * retried through a fresh read, and a cart that still cannot be brought into line is reported as blocked
 * ("could not finish checking"), because an unverified cart must not be handed to checkout.
 */
export async function revalidateCart<TCart extends RevalidatableCart>(
  cart: TCart,
  port: CartPort<TCart>,
  deps: RevalidationDeps,
): Promise<CartCheck<TCart>> {
  const maxPasses = deps.maxPasses ?? MAX_REVALIDATION_PASSES;
  const applied: Correction[] = [];
  let current = cart;

  for (let pass = 0; ; pass += 1) {
    const evaluation = await evaluate(current, deps);
    const unrepaired = evaluation.corrections.length > 0;
    if (!unrepaired || pass >= maxPasses) {
      const blocked = blockedReasons(evaluation, unrepaired);
      return {
        status:
          blocked.length > 0
            ? 'blocked'
            : applied.length > 0
              ? 'corrected'
              : 'ok',
        cart: current,
        evaluation,
        applied,
        blocked,
        notices: describeCorrections(applied),
      };
    }

    const outcome = await applyCorrections(port, evaluation.corrections);
    if (!outcome.failed && outcome.cart) {
      applied.push(...evaluation.corrections);
      current = outcome.cart;
    } else {
      // Shopify refused (a line may already be gone with its parent): read the cart again and re-judge it.
      current = (await port.refresh()) ?? current;
    }
  }
}
