// Comfort-guarantee step (REQ-PRE-002, CLR-010): a protector in the mattress's size, offered only while a
// qualifying mattress is in the cart. The protector variants in the rules are offer-only products
// (excluded from collections and search), so one in a cart without its mattress is an orphan and is removed.

import {normalizeSize, sizeMap} from './helpers';
import type {PreparedCart} from './lines';
import type {
  ComfortGuaranteeOption,
  ComfortGuaranteeRules,
  ComfortGuaranteeStep,
  Correction,
  OfferStepStatus,
} from './types';

type SizedVariant = {readonly size: string; readonly id: string};

/** The protector variant for a mattress size, or null when the rules have none for that size. */
export function comfortProtectorVariantFor(
  rules: ComfortGuaranteeRules | null,
  size: string | null,
): string | null {
  if (rules === null) return null;
  const key = normalizeSize(size);
  if (key === null) return null;
  return sizeMap(rules.protectorVariantIdBySize).get(key)?.id ?? null;
}

type Need = {
  readonly protectorVariantId: string;
  readonly size: string;
  readonly mattressLineIds: string[];
  quantity: number;
};

export type ComfortGuaranteeResult = {
  readonly step: ComfortGuaranteeStep;
  readonly corrections: readonly Correction[];
};

function stepStatus(
  applies: boolean,
  missing: number,
  declined: boolean,
): OfferStepStatus {
  if (!applies) return 'not-applicable';
  if (missing === 0) return 'accepted';
  return declined ? 'declined' : 'pending';
}

export function evaluateComfortGuarantee(
  prepared: PreparedCart,
  rules: ComfortGuaranteeRules | null,
  declined: boolean,
): ComfortGuaranteeResult {
  const sizeToVariant: ReadonlyMap<string, SizedVariant> =
    rules === null
      ? new Map<string, SizedVariant>()
      : sizeMap(rules.protectorVariantIdBySize);
  const qualifyingProducts = new Set(rules?.qualifyingProductIds ?? []);

  const mattressLines = prepared.lines.filter(
    ({line, kind}) =>
      kind === 'regular' && qualifyingProducts.has(line.productId),
  );

  // Protectors needed per protector variant: one per mattress of the size that variant fits.
  const needs = new Map<string, Need>();
  for (const {line} of mattressLines) {
    const size = normalizeSize(line.size);
    const match = size === null ? undefined : sizeToVariant.get(size);
    if (match === undefined) continue;
    const need = needs.get(match.id) ?? {
      protectorVariantId: match.id,
      size: line.size?.trim() ?? match.size,
      mattressLineIds: [],
      quantity: 0,
    };
    need.mattressLineIds.push(line.id);
    need.quantity += line.quantity;
    needs.set(match.id, need);
  }

  const corrections: Correction[] = [];
  const keptByVariant = new Map<string, number>();
  const remainingByVariant = new Map<string, number>(
    [...needs.values()].map((need) => [need.protectorVariantId, need.quantity]),
  );

  for (const {line, kind} of prepared.lines) {
    if (kind !== 'comfort-protector') continue;

    // The link to a particular mattress line is not checked: what matters is that a mattress of the right
    // size is in the cart for every protector. (Shopify also removes a nested child with its parent.)
    const allowance = remainingByVariant.get(line.variantId) ?? 0;
    const kept = Math.min(line.quantity, allowance);
    remainingByVariant.set(line.variantId, allowance - kept);
    keptByVariant.set(
      line.variantId,
      (keptByVariant.get(line.variantId) ?? 0) + kept,
    );

    if (kept === line.quantity) continue;
    if (kept > 0) {
      corrections.push({
        type: 'set-quantity',
        lineId: line.id,
        quantity: kept,
        previousQuantity: line.quantity,
        reason: 'protector-exceeds-mattresses',
      });
    } else if (mattressLines.length === 0) {
      corrections.push({
        type: 'remove-line',
        lineId: line.id,
        reason: 'protector-without-mattress',
      });
    } else {
      const sizeHasMattress = (needs.get(line.variantId)?.quantity ?? 0) > 0;
      corrections.push({
        type: 'remove-line',
        lineId: line.id,
        reason: sizeHasMattress
          ? 'protector-exceeds-mattresses'
          : 'wrong-size-protector',
      });
    }
  }

  const options: ComfortGuaranteeOption[] = [];
  for (const need of needs.values()) {
    const quantityMissing =
      need.quantity - (keptByVariant.get(need.protectorVariantId) ?? 0);
    if (quantityMissing > 0) {
      options.push({
        protectorVariantId: need.protectorVariantId,
        size: need.size,
        mattressLineIds: need.mattressLineIds,
        quantityMissing,
      });
    }
  }

  const applies = needs.size > 0;
  const reason: ComfortGuaranteeStep['reason'] =
    rules === null
      ? 'not-configured'
      : mattressLines.length === 0
        ? 'no-qualifying-mattress'
        : needs.size === 0
          ? 'no-protector-for-size'
          : 'qualifying-mattress-in-cart';

  return {
    step: {
      id: 'comfort-guarantee',
      applies,
      reason,
      status: stepStatus(applies, options.length, declined),
      options,
    },
    corrections,
  };
}
