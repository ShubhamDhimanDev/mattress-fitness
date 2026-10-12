// Free-delivery progress (REQ-CART-004, CLR-009). Data first, wording second: the cart component renders
// the numbers, and freeDeliveryMessage supplies placeholder copy until the client approves final wording.
// The subtotal is Shopify's cart cost in cents; nothing is recomputed here.

import {formatCents} from '~/lib/money';
import {isValidCents, safeCents} from '~/lib/delivery/cents';
import type {FreeDeliveryProgress, FreeDeliveryRules} from './types';

/**
 * Progress towards the free-delivery threshold. Free delivery is reached AT the threshold, like the zone
 * quote in delivery/zone.ts. A missing, zero or invalid threshold turns the message off: a zero would
 * announce free delivery to every shopper when the admin setting is simply empty.
 */
export function freeDeliveryProgress(
  rule: FreeDeliveryRules | null,
  subtotalCents: number,
): FreeDeliveryProgress {
  if (
    rule === null ||
    !isValidCents(rule.thresholdCents) ||
    rule.thresholdCents === 0
  ) {
    return {enabled: false};
  }
  const subtotal = safeCents(subtotalCents);
  const thresholdCents = rule.thresholdCents;
  const reached = subtotal >= thresholdCents;
  return {
    enabled: true,
    thresholdCents,
    subtotalCents: subtotal,
    remainingCents: Math.max(0, thresholdCents - subtotal),
    reached,
    percent: reached
      ? 100
      : Math.min(99, Math.floor((subtotal / thresholdCents) * 100)),
  };
}

/** Placeholder copy (wording is not client-approved yet); null when the message is switched off. */
export function freeDeliveryMessage(
  progress: FreeDeliveryProgress,
): string | null {
  if (!progress.enabled) return null;
  return progress.reached
    ? 'You have unlocked free delivery.'
    : `You are ${formatCents(progress.remainingCents, {compact: true})} away from free delivery.`;
}
