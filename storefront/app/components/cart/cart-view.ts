// Pure display decisions for the cart (CR-31 redesign). Nothing here computes a price: every amount is one Shopify already
// returned, and the only money operations are comparisons of integer cents (is a line free, is a threshold reached).

import {linePromotions} from '~/lib/cart/lines';
import type {SubtotalView} from '~/lib/cart/subtotal';
import {EXTEND_LINE_ATTRIBUTES} from '~/lib/extend/linking';
import {
  formatCents,
  formatMoney,
  toCents,
  type MoneyV2Like,
} from '~/lib/format';
import {freeDeliveryMessage} from '~/lib/offers/free-delivery';
import type {FreeDeliveryProgress} from '~/lib/offers/types';

type Attribute = {readonly key: string; readonly value?: string | null};

/** The parts of a cart line the decisions below read. A structural type, so tests need no Shopify fixtures. */
export type LineFacts = {
  readonly attributes?: readonly Attribute[] | null;
  readonly cost?: {
    readonly totalAmount?: MoneyV2Like | null;
    readonly subtotalAmount?: MoneyV2Like | null;
  } | null;
  readonly discountAllocations?: Parameters<typeof linePromotions>[0];
};

function attributeValue(
  attributes: LineFacts['attributes'],
  key: string,
): string | null {
  const found = attributes?.find((attribute) => attribute.key === key);
  return found?.value ?? null;
}

/**
 * An Extend coverage line carries the plan id the SERVER wrote when it added the line (linking.ts). The browser never
 * supplies it, so it is a safe cue for where to draw the line: inside the card of the item it covers.
 */
export function isCoverageLine(line: Pick<LineFacts, 'attributes'>): boolean {
  const planId = attributeValue(line.attributes, EXTEND_LINE_ATTRIBUTES.planId);
  return planId !== null && planId !== '';
}

/** Months of coverage the server recorded on a coverage line, or null. */
export function coverageTermMonths(
  line: Pick<LineFacts, 'attributes'>,
): number | null {
  const raw = attributeValue(line.attributes, EXTEND_LINE_ATTRIBUTES.term);
  if (raw === null || !/^\d{1,3}$/.test(raw)) return null;
  const months = Number(raw);
  return months > 0 ? months : null;
}

function isZero(amount: MoneyV2Like | null | undefined): boolean {
  if (!amount) return false;
  try {
    return toCents(amount.amount) === 0;
  } catch {
    return false;
  }
}

/**
 * A line Shopify priced at zero because a named line-level discount took the whole price off: the gift with purchase
 * (REQ-PROMO-001). The label is a display decision from Shopify's own numbers; whether the gift is allowed to exist is the
 * server's rule (orphan gifts are removed there), not this function's.
 */
export function isFreeGiftLine(line: LineFacts): boolean {
  return (
    !isCoverageLine(line) &&
    isZero(line.cost?.totalAmount) &&
    linePromotions(line.discountAllocations).length > 0
  );
}

/** What a free gift line would have cost, as Shopify reports it before the discount; null when it reports nothing above zero. */
export function freeGiftValue(line: LineFacts): MoneyV2Like | null {
  if (!isFreeGiftLine(line)) return null;
  const before = line.cost?.subtotalAmount;
  if (!before) return null;
  try {
    return toCents(before.amount) > 0 ? before : null;
  } catch {
    return null;
  }
}

export type FreeDeliveryView =
  | {readonly status: 'off'}
  | {
      readonly status: 'open' | 'reached';
      /** The sentence beside the bar and the bar's spoken value. */
      readonly message: string;
      readonly percent: number;
      /** The admin threshold as a label ("$999"), never a number typed into the page. */
      readonly threshold: string;
    };

/** The free-delivery progress card from the engine's numbers (REQ-CART-004). Off when the admin switched it off. */
export function freeDeliveryView(
  progress: FreeDeliveryProgress | null | undefined,
): FreeDeliveryView {
  if (!progress?.enabled) return {status: 'off'};
  const message = freeDeliveryMessage(progress);
  if (message === null) return {status: 'off'};
  return {
    status: progress.reached ? 'reached' : 'open',
    message,
    percent: progress.percent,
    threshold: formatCents(progress.thresholdCents, {compact: true}),
  };
}

/** The delivery row of the summary: "Free" only once the engine says the threshold is reached, otherwise Shopify decides at checkout. */
export function deliverySummary(
  progress: FreeDeliveryProgress | null | undefined,
): {
  readonly text: string;
  readonly free: boolean;
} {
  return progress?.enabled && progress.reached
    ? {text: 'Free', free: true}
    : {text: 'Calculated at checkout', free: false};
}

type CartTotalLike = {
  readonly isOptimistic?: boolean | null;
  readonly cost?: {
    readonly totalAmount?: {
      readonly amount?: string | null;
      readonly currencyCode?: string | null;
    } | null;
  } | null;
} | null;

/**
 * The estimated total is Shopify's `cost.totalAmount`, shown as returned (taxes and delivery are added at checkout). Same
 * states as the subtotal (RS-02): pending until Shopify answers, ready and flagged while a change is in flight.
 */
export function totalView(cart: CartTotalLike | undefined): SubtotalView {
  const total = cart?.cost?.totalAmount;
  if (!total?.amount || !total.currencyCode) return {status: 'pending'};
  return {
    status: 'ready',
    amount: {amount: total.amount, currencyCode: total.currencyCode},
    updating: Boolean(cart?.isOptimistic),
  };
}

/** A Shopify amount as text for a small "each" label; null for data the money helper rejects, so a bad record shows nothing. */
export function moneyText(
  amount: MoneyV2Like | null | undefined,
): string | null {
  if (!amount) return null;
  try {
    return formatMoney(amount);
  } catch {
    return null;
  }
}

/** "1 item" or "3 items" for the count line. A non-count (negative, fractional) reads as no items. */
export function itemCountText(count: number | null | undefined): string {
  const n = Number.isSafeInteger(count) && (count ?? 0) > 0 ? (count ?? 0) : 0;
  return n === 1 ? '1 item' : `${n} items`;
}
