// Cart preparation shared by every rule: drop malformed lines (and say so), then give each remaining line
// exactly one kind. One kind per line is what keeps the rules independent of each other, and therefore
// keeps corrections idempotent: a gift can never also be a qualifying mattress, a protector never also a
// haul-away line, and so on.

import {isNonEmptyString, isValidQuantity} from './helpers';
import type {CartLike, CartLineLike, OfferRules, Violation} from './types';

export type LineKind =
  'coverage' | 'haul-away' | 'gift' | 'comfort-protector' | 'regular';

export type ClassifiedLine = {
  readonly line: CartLineLike;
  readonly kind: LineKind;
};

export type RuleIndex = {
  readonly giftVariantIds: ReadonlySet<string>;
  readonly haulAwayVariantId: string | null;
  readonly comfortProtectorVariantIds: ReadonlySet<string>;
};

export type PreparedCart = {
  /** Lines with a usable id and quantity, in cart order. Malformed lines are reported, then ignored. */
  readonly lines: readonly ClassifiedLine[];
  /** Every first-seen line by id, including malformed ones, for parent lookups. */
  readonly linesById: ReadonlyMap<string, CartLineLike>;
  readonly kindById: ReadonlyMap<string, LineKind>;
  readonly malformedIds: ReadonlySet<string>;
  readonly violations: readonly Violation[];
  readonly index: RuleIndex;
};

export function buildRuleIndex(rules: OfferRules): RuleIndex {
  const giftVariantIds = new Set<string>();
  for (const rule of rules.gifts) {
    for (const variantId of Object.values(rule.giftVariantIdsBySize)) {
      if (isNonEmptyString(variantId)) giftVariantIds.add(variantId);
    }
  }
  const comfortProtectorVariantIds = new Set<string>();
  if (rules.comfortGuarantee !== null) {
    for (const variantId of Object.values(
      rules.comfortGuarantee.protectorVariantIdBySize,
    )) {
      if (isNonEmptyString(variantId))
        comfortProtectorVariantIds.add(variantId);
    }
  }
  return {
    giftVariantIds,
    haulAwayVariantId:
      rules.haulAway !== null && isNonEmptyString(rules.haulAway.variantId)
        ? rules.haulAway.variantId
        : null,
    comfortProtectorVariantIds,
  };
}

// Order matters: a service or linked line wins over a gift, a gift over a protector, so a variant listed
// in two rules is still handled by one rule only.
export function classifyLine(line: CartLineLike, index: RuleIndex): LineKind {
  if (line.role === 'coverage') return 'coverage';
  if (
    line.role === 'haul-away' ||
    (index.haulAwayVariantId !== null &&
      line.variantId === index.haulAwayVariantId)
  ) {
    return 'haul-away';
  }
  if (line.role === 'gift' || index.giftVariantIds.has(line.variantId)) {
    return 'gift';
  }
  if (index.comfortProtectorVariantIds.has(line.variantId)) {
    return 'comfort-protector';
  }
  return 'regular';
}

export function prepareCart(cart: CartLike, rules: OfferRules): PreparedCart {
  const index = buildRuleIndex(rules);
  const lines: ClassifiedLine[] = [];
  const linesById = new Map<string, CartLineLike>();
  const kindById = new Map<string, LineKind>();
  const malformedIds = new Set<string>();
  const violations: Violation[] = [];

  const idCounts = new Map<string, number>();
  for (const line of cart.lines) {
    idCounts.set(line.id, (idCounts.get(line.id) ?? 0) + 1);
  }

  for (const line of cart.lines) {
    if (!linesById.has(line.id)) linesById.set(line.id, line);
    if ((idCounts.get(line.id) ?? 0) > 1) {
      // A correction is keyed by line id, so it could not tell these lines apart and would hit them all.
      // Every line with the shared id stays out of the rules (no correction names it) and the cart is
      // refused once; Shopify never produces duplicate ids, so this only happens to a forged cart.
      if (!malformedIds.has(line.id)) {
        malformedIds.add(line.id);
        violations.push({code: 'duplicate-line-id', lineId: line.id});
      }
      continue;
    }
    if (!isValidQuantity(line.quantity)) {
      // Zero, negative, fractional, NaN and non-numbers: refused, never "repaired" upwards or downwards.
      malformedIds.add(line.id);
      violations.push({code: 'invalid-quantity', lineId: line.id});
      continue;
    }
    const kind = classifyLine(line, index);
    kindById.set(line.id, kind);
    lines.push({line, kind});
  }

  return {lines, linesById, kindById, malformedIds, violations, index};
}
