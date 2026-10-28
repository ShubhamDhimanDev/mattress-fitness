// Bundles, "frequently bought together" (REQ-ADD-002, REQ-PROMO-002, REQ-CAT-008). The saving is a Shopify
// discount, so this module never produces a price: it works out WHICH lines make up a bundle for the chosen
// size (so one Add-all call adds matching sizes only) and how to describe a partial failure.

import {isNonEmptyString, normalizeSize, sizeMap} from './helpers';
import {prepareCart} from './lines';
import type {BundleMemberRule, BundleRule, CartLike, OfferRules} from './types';

/** A bundle member of 0 or 1000 units is a configuration mistake, not an offer. */
const MAX_MEMBER_QUANTITY = 10;
/** The cart's own per-line limit (cart/input.ts); a bundle that would need more is not offered in one step. */
const MAX_COMPLETION_LINE_QUANTITY = 99;

export type BundleLine = {
  readonly variantId: string;
  readonly productId: string;
  readonly quantity: number;
  readonly isAnchor: boolean;
};

export type AddAllRequest = {
  /** The variant the shopper has selected on the product page (the anchor line). */
  readonly anchorVariantId: string;
  /** The selected Size option value; size-matched members follow it. */
  readonly size: string | null;
  /** When given, every line must be in this set (variants known to be in stock) or the bundle is unavailable. */
  readonly availableVariantIds?: ReadonlySet<string>;
};

export type AddAllPayload =
  | {
      readonly status: 'ok';
      readonly bundleId: string;
      /** Everything for one cartLinesAdd call, so a bundle is added in one operation. */
      readonly lines: readonly BundleLine[];
    }
  | {
      readonly status: 'unavailable';
      readonly bundleId: string;
      readonly reason:
        | 'invalid-selection'
        | 'invalid-rule'
        | 'size-not-offered'
        | 'variant-unavailable';
      readonly productIds: readonly string[];
    };

export type BundleMembership = {
  readonly bundle: BundleRule;
  readonly role: 'anchor' | 'member';
};

/** The bundles a product page or cart line belongs to, as the anchor or as a companion. */
export function bundleMembership(
  bundles: readonly BundleRule[],
  productId: string,
): BundleMembership[] {
  const memberships: BundleMembership[] = [];
  for (const bundle of bundles) {
    if (bundle.anchorProductId === productId) {
      memberships.push({bundle, role: 'anchor'});
    } else if (
      bundle.members.some((member) => member.productId === productId)
    ) {
      memberships.push({bundle, role: 'member'});
    }
  }
  return memberships;
}

/** Variant of a member for a size: the single variant, the size's variant, or null when none is offered. */
function memberVariantId(
  member: BundleMemberRule,
  size: string | null,
): string | null {
  if (member.variants.type === 'single') {
    return isNonEmptyString(member.variants.variantId)
      ? member.variants.variantId
      : null;
  }
  const key = normalizeSize(size);
  if (key === null) return null;
  return sizeMap(member.variants.variantIdBySize).get(key)?.id ?? null;
}

/** Every variant a bundle's companions can resolve to, across sizes (for "is this variant in a bundle"). */
export function bundleMemberVariantIds(bundle: BundleRule): Set<string> {
  const ids = new Set<string>();
  for (const member of bundle.members) {
    if (member.variants.type === 'single') {
      if (isNonEmptyString(member.variants.variantId)) {
        ids.add(member.variants.variantId);
      }
    } else {
      for (const id of Object.values(member.variants.variantIdBySize)) {
        if (isNonEmptyString(id)) ids.add(id);
      }
    }
  }
  return ids;
}

function validQuantity(quantity: unknown): quantity is number {
  return (
    typeof quantity === 'number' &&
    Number.isInteger(quantity) &&
    quantity >= 1 &&
    quantity <= MAX_MEMBER_QUANTITY
  );
}

export type BundleCompanion = {
  readonly productId: string;
  readonly variantId: string;
  readonly quantity: number;
};

/**
 * The sizes a product page can offer this bundle in, as the admin wrote them. A rule whose companions are all single
 * variants does not depend on size, so it is offered once for every size (`null`).
 */
export function bundleOfferedSizes(bundle: BundleRule): (string | null)[] {
  const sizes = new Map<string, string>();
  for (const member of bundle.members) {
    if (member.variants.type !== 'by-size') continue;
    for (const size of Object.keys(member.variants.variantIdBySize)) {
      const key = normalizeSize(size);
      if (key !== null && !sizes.has(key)) sizes.set(key, size.trim());
    }
  }
  return sizes.size === 0 ? [null] : [...sizes.values()];
}

/**
 * Every companion of a bundle for one size, one entry per variant (two members that resolve to one variant add up), or
 * null when the rule is invalid or any companion has no variant in that size: a set without all its members would not
 * earn the Shopify saving, so it is never offered. Variant ids only; no price is produced here.
 */
export function bundleCompanionsForSize(
  bundle: BundleRule,
  size: string | null,
): BundleCompanion[] | null {
  if (
    bundle.members.length === 0 ||
    !bundle.members.every((member) => validQuantity(member.quantity))
  ) {
    return null;
  }
  const companions = new Map<string, BundleCompanion>();
  for (const member of bundle.members) {
    const variantId = memberVariantId(member, size);
    if (variantId === null) return null;
    const existing = companions.get(variantId);
    companions.set(variantId, {
      productId: member.productId,
      variantId,
      quantity: (existing?.quantity ?? 0) + member.quantity,
    });
  }
  return [...companions.values()];
}

/**
 * The lines for one Add-all call: the selected anchor variant plus every companion in the same size. All or
 * nothing: if any companion has no variant for the size, or is not available, no partial bundle is offered,
 * because without every member the Shopify saving would not apply and the shopper would pay full price.
 */
export function addAllPayload(
  bundle: BundleRule,
  request: AddAllRequest,
): AddAllPayload {
  const unavailable = (
    reason:
      | 'invalid-selection'
      | 'invalid-rule'
      | 'size-not-offered'
      | 'variant-unavailable',
    productIds: readonly string[],
  ): AddAllPayload => ({
    status: 'unavailable',
    bundleId: bundle.id,
    reason,
    productIds,
  });

  if (!isNonEmptyString(request.anchorVariantId)) {
    return unavailable('invalid-selection', [bundle.anchorProductId]);
  }
  if (
    bundle.members.length === 0 ||
    !bundle.members.every((m) => validQuantity(m.quantity))
  ) {
    return unavailable('invalid-rule', []);
  }

  const lines = new Map<string, BundleLine>();
  const add = (line: BundleLine): void => {
    const existing = lines.get(line.variantId);
    // Two members resolving to one variant become one line with the summed quantity.
    lines.set(
      line.variantId,
      existing === undefined
        ? line
        : {...existing, quantity: existing.quantity + line.quantity},
    );
  };
  add({
    variantId: request.anchorVariantId,
    productId: bundle.anchorProductId,
    quantity: 1,
    isAnchor: true,
  });

  const missingSize: string[] = [];
  for (const member of bundle.members) {
    const variantId = memberVariantId(member, request.size);
    if (variantId === null) {
      missingSize.push(member.productId);
    } else {
      add({
        variantId,
        productId: member.productId,
        quantity: member.quantity,
        isAnchor: false,
      });
    }
  }
  if (missingSize.length > 0)
    return unavailable('size-not-offered', missingSize);

  if (request.availableVariantIds !== undefined) {
    const available = request.availableVariantIds;
    const soldOut = [...lines.values()]
      .filter((line) => !available.has(line.variantId))
      .map((line) => line.productId);
    if (soldOut.length > 0) return unavailable('variant-unavailable', soldOut);
  }
  return {status: 'ok', bundleId: bundle.id, lines: [...lines.values()]};
}

export type AddedQuantity = {
  readonly variantId: string;
  readonly quantity: number;
};

export type AddAllShortfall = {
  readonly variantId: string;
  readonly productId: string;
  readonly requested: number;
  readonly added: number;
  readonly missing: number;
};

export type AddAllResult =
  | {readonly status: 'complete'}
  | {
      /** Some lines were added: the saving does not apply until the rest is added or the rest removed. */
      readonly status: 'partial';
      readonly added: readonly AddedQuantity[];
      readonly shortfalls: readonly AddAllShortfall[];
      readonly retryLines: readonly BundleLine[];
    }
  | {
      readonly status: 'failed';
      readonly shortfalls: readonly AddAllShortfall[];
      readonly retryLines: readonly BundleLine[];
    };

/**
 * Compares what was asked for with what Shopify actually added (from the cart after the call, or from
 * the mutation result). Unknown variants, negative or non-numeric quantities are ignored, and nothing can
 * count for more than was requested, so a forged result cannot hide a shortfall.
 */
export function reconcileAddAll(
  requested: readonly BundleLine[],
  added: readonly AddedQuantity[],
): AddAllResult {
  const addedByVariant = new Map<string, number>();
  for (const {variantId, quantity} of added) {
    if (
      typeof quantity === 'number' &&
      Number.isSafeInteger(quantity) &&
      quantity > 0
    ) {
      addedByVariant.set(
        variantId,
        (addedByVariant.get(variantId) ?? 0) + quantity,
      );
    }
  }

  const shortfalls: AddAllShortfall[] = [];
  const retryLines: BundleLine[] = [];
  const confirmed: AddedQuantity[] = [];
  for (const line of requested) {
    const got = Math.min(
      addedByVariant.get(line.variantId) ?? 0,
      line.quantity,
    );
    if (got > 0) confirmed.push({variantId: line.variantId, quantity: got});
    if (got < line.quantity) {
      const missing = line.quantity - got;
      shortfalls.push({
        variantId: line.variantId,
        productId: line.productId,
        requested: line.quantity,
        added: got,
        missing,
      });
      retryLines.push({...line, quantity: missing});
    }
  }

  if (shortfalls.length === 0) return {status: 'complete'};
  return confirmed.length === 0
    ? {status: 'failed', shortfalls, retryLines}
    : {status: 'partial', added: confirmed, shortfalls, retryLines};
}

export type BundleCartStatus = {
  readonly anchorLineId: string;
  readonly complete: boolean;
  readonly missingProductIds: readonly string[];
};

/**
 * Whether the cart holds every companion for each anchor line, in the anchor's size. A hint for the cart
 * ("add the foundation to complete your bundle"); Shopify's discount is the authority on the saving.
 */
export function bundleCartStatus(
  bundle: BundleRule,
  cart: CartLike,
  rules: OfferRules,
): BundleCartStatus[] {
  const prepared = prepareCart(cart, rules);
  const quantityByVariant = new Map<string, number>();
  for (const {line} of prepared.lines) {
    quantityByVariant.set(
      line.variantId,
      (quantityByVariant.get(line.variantId) ?? 0) + line.quantity,
    );
  }

  return prepared.lines
    .filter(({line}) => line.productId === bundle.anchorProductId)
    .map(({line}) => {
      const missingProductIds = bundle.members
        .filter((member) => {
          const variantId = memberVariantId(member, line.size);
          const have =
            variantId === null ? 0 : (quantityByVariant.get(variantId) ?? 0);
          return have < member.quantity * line.quantity;
        })
        .map((member) => member.productId);
      return {
        anchorLineId: line.id,
        complete: missingProductIds.length === 0,
        missingProductIds,
      };
    });
}

export type BundleCompletion = {
  readonly bundleId: string;
  readonly anchorLineId: string;
  /**
   * complete: every companion is already in the cart in the anchor's size.
   * incomplete: `missing` lists what to add (one cartLinesAdd call).
   * unavailable: the rule cannot be completed for this anchor (no companion in its size, or an invalid rule), so it is
   * never offered: a partial bundle would not earn the saving.
   */
  readonly state: 'complete' | 'incomplete' | 'unavailable';
  /** Companions still to add, never the anchor; empty unless `incomplete`. */
  readonly missing: readonly BundleLine[];
  /** Variants that make up this bundle for the anchor's size (the companions, not the anchor). */
  readonly memberVariantIds: readonly string[];
};

/**
 * What each anchor line in the cart still needs to complete a bundle (REQ-ADD-002 in the cart). Unlike
 * `bundleCartStatus`, companions already in the cart are used up by one anchor line before the next one is judged, so
 * two mattresses of one size are not both "complete" on one foundation. Only ordinary lines can be anchors, and only the
 * quantities of lines that are really in the cart count. Everything is derived from the rule and the cart: the browser
 * names a bundle id and an anchor line, nothing else.
 */
export function bundleCompletions(
  bundle: BundleRule,
  cart: CartLike,
  rules: OfferRules,
): BundleCompletion[] {
  const prepared = prepareCart(cart, rules);
  const pool = new Map<string, number>();
  for (const {line} of prepared.lines) {
    pool.set(line.variantId, (pool.get(line.variantId) ?? 0) + line.quantity);
  }
  const validRule =
    bundle.members.length > 0 &&
    bundle.members.every((member) => validQuantity(member.quantity));

  const completions: BundleCompletion[] = [];
  for (const {line, kind} of prepared.lines) {
    if (kind !== 'regular' || line.productId !== bundle.anchorProductId) {
      continue;
    }
    const unavailable: BundleCompletion = {
      bundleId: bundle.id,
      anchorLineId: line.id,
      state: 'unavailable',
      missing: [],
      memberVariantIds: [],
    };
    if (!validRule) {
      completions.push(unavailable);
      continue;
    }
    const need = new Map<string, {productId: string; quantity: number}>();
    let sizeOffered = true;
    for (const member of bundle.members) {
      const variantId = memberVariantId(member, line.size);
      if (variantId === null) {
        sizeOffered = false;
        break;
      }
      const existing = need.get(variantId);
      need.set(variantId, {
        productId: member.productId,
        quantity: (existing?.quantity ?? 0) + member.quantity * line.quantity,
      });
    }
    if (
      !sizeOffered ||
      [...need.values()].some(
        (entry) => entry.quantity > MAX_COMPLETION_LINE_QUANTITY,
      )
    ) {
      completions.push(unavailable);
      continue;
    }

    const missing: BundleLine[] = [];
    for (const [variantId, {productId, quantity}] of need) {
      const have = pool.get(variantId) ?? 0;
      const taken = Math.min(have, quantity);
      pool.set(variantId, have - taken);
      if (taken < quantity) {
        missing.push({
          variantId,
          productId,
          quantity: quantity - taken,
          isAnchor: false,
        });
      }
    }
    completions.push({
      bundleId: bundle.id,
      anchorLineId: line.id,
      state: missing.length === 0 ? 'complete' : 'incomplete',
      missing,
      memberVariantIds: [...need.keys()],
    });
  }
  return completions;
}
