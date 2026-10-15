// A gift line must cost nothing (REQ-PROMO-001, ADR-0003, BASIC_PLAN_WORKAROUNDS item 8). Its price is a Shopify
// discount; our server only adds the line. If Shopify charges anything for it (the discount was deactivated, no longer
// matches the cart, or never existed on this store), the shopper would pay full price for something shown as a gift.
// This module judges only WHICH gift lines are not free, from the line totals Shopify returned after discounts. It
// computes no price. Pure: the caller supplies the totals it read from the cart.

import {prepareCart} from './lines';
import type {CartLike, OfferRules} from './types';

/**
 * Line id -> what Shopify charges for the whole line after line-level discounts, in cents. A line with no entry (the
 * cost was missing or unreadable) counts as "cannot confirm it is free", never as free.
 */
export type LineTotals = ReadonlyMap<string, number>;

/** Ids of gift lines that are not confirmed to cost 0, in cart order. */
export function giftLinesNotFree(
  cart: CartLike,
  rules: OfferRules,
  totals: LineTotals,
): string[] {
  return prepareCart(cart, rules)
    .lines.filter(({line, kind}) => {
      if (kind !== 'gift') return false;
      const total = totals.get(line.id);
      return total === undefined || total !== 0;
    })
    .map(({line}) => line.id);
}
