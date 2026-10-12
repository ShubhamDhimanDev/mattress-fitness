// Accident-protection step (REQ-PRE-004) and the rules that keep Extend coverage linked to its covered item.
// Which lines CAN be covered is the Extend adapter's answer (context.protectionEligibleLineIds); this module
// only enforces what must always hold: coverage is never bought alone (BASIC_PLAN_WORKAROUNDS item 5,
// ADR-0009) and never exceeds the quantity of the item it covers. Coverage lines are recognised by the
// 'coverage' role that the Extend adapter sets, because the 250 price-point variants are not in the offer rules.

import type {PreparedCart} from './lines';
import type {
  AccidentProtectionOption,
  AccidentProtectionStep,
  Correction,
  OfferStepStatus,
} from './types';

export type AccidentProtectionResult = {
  readonly step: AccidentProtectionStep;
  readonly corrections: readonly Correction[];
};

function stepStatus(
  applies: boolean,
  uncovered: number,
  declined: boolean,
): OfferStepStatus {
  if (!applies) return 'not-applicable';
  if (uncovered === 0) return 'accepted';
  return declined ? 'declined' : 'pending';
}

/**
 * @param effectiveQuantities line id -> quantity after the corrections of the other rules (0 = removed).
 *   Coverage is checked last, against these, so a covered line that is being removed or reduced takes its
 *   coverage with it in the same pass (this is what makes corrections idempotent).
 */
export function evaluateAccidentProtection(
  prepared: PreparedCart,
  effectiveQuantities: ReadonlyMap<string, number>,
  eligibleLineIds: readonly string[],
  declined: boolean,
): AccidentProtectionResult {
  const corrections: Correction[] = [];
  const remainingByParent = new Map<string, number>();
  const coveredByParent = new Map<string, number>();

  for (const {line, kind} of prepared.lines) {
    if (kind !== 'coverage') continue;

    const parentId = line.parentLineId;
    const parentKind =
      parentId === null ? undefined : prepared.kindById.get(parentId);
    // A parent with a malformed quantity is already a violation for the whole cart; do not stack a repair on it.
    if (parentId !== null && prepared.malformedIds.has(parentId)) continue;

    const parentQuantity =
      parentId === null ? 0 : (effectiveQuantities.get(parentId) ?? 0);
    if (
      parentId === null ||
      parentId === line.id ||
      parentKind === undefined ||
      parentKind === 'coverage' ||
      parentQuantity < 1
    ) {
      corrections.push({
        type: 'remove-line',
        lineId: line.id,
        reason: 'orphan-coverage',
      });
      continue;
    }

    const remaining = remainingByParent.get(parentId) ?? parentQuantity;
    const kept = Math.min(line.quantity, remaining);
    remainingByParent.set(parentId, remaining - kept);
    coveredByParent.set(parentId, (coveredByParent.get(parentId) ?? 0) + kept);

    if (kept === line.quantity) continue;
    corrections.push(
      kept > 0
        ? {
            type: 'set-quantity',
            lineId: line.id,
            quantity: kept,
            previousQuantity: line.quantity,
            reason: 'coverage-exceeds-item',
          }
        : {
            type: 'remove-line',
            lineId: line.id,
            reason: 'coverage-exceeds-item',
          },
    );
  }

  const eligible = new Set(eligibleLineIds);
  const options: AccidentProtectionOption[] = [];
  let eligibleCount = 0;
  for (const {line, kind} of prepared.lines) {
    const quantity = effectiveQuantities.get(line.id) ?? 0;
    if (kind !== 'regular' || quantity < 1 || !eligible.has(line.id)) continue;
    eligibleCount++;
    const uncoveredQuantity = quantity - (coveredByParent.get(line.id) ?? 0);
    if (uncoveredQuantity > 0) {
      options.push({lineId: line.id, quantity, uncoveredQuantity});
    }
  }

  const applies = eligibleCount > 0;
  return {
    step: {
      id: 'accident-protection',
      applies,
      reason: applies ? 'eligible-items-in-cart' : 'no-eligible-items',
      status: stepStatus(applies, options.length, declined),
      options,
    },
    corrections,
  };
}
