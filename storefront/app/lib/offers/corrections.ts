// Applies corrections to a cart snapshot. Pure: it returns a new cart and is used by tests and by the server
// to preview a repaired cart. The real repair is a Shopify cart mutation built from the same list
// (cartLinesRemove / cartLinesUpdate); after it, re-run evaluateOffers until no corrections are returned.
//
// Exactly the listed corrections are applied, with no cascade to nested children: Shopify removes a
// nested child with its parent by itself, and the engine already lists the coverage lines that depend on
// a line it removes or reduces. The subtotal is NOT recomputed (prices are Shopify's), so a preview must
// not be used to show money.

import type {CartLike, Correction} from './types';

export function applyCorrections(
  cart: CartLike,
  corrections: readonly Correction[],
): CartLike {
  const removed = new Set<string>();
  const quantities = new Map<string, number>();
  for (const correction of corrections) {
    if (correction.type === 'remove-line') {
      removed.add(correction.lineId);
    } else {
      quantities.set(correction.lineId, correction.quantity);
    }
  }
  return {
    ...cart,
    lines: cart.lines
      .filter((line) => !removed.has(line.id))
      .map((line) => {
        const quantity = quantities.get(line.id);
        // Only ever lower a quantity, even if a malformed cart repeats the id on another line.
        return quantity !== undefined &&
          Number.isSafeInteger(line.quantity) &&
          line.quantity > quantity
          ? {...line, quantity}
          : line;
      }),
  };
}
