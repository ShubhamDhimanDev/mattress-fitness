// Reading the offers view back in the browser. The view arrives in a loader or action result (data from our
// own server), but fetcher data is typed `unknown`, so it is checked before use. A view that does not look
// right is ignored and the cart simply shows no offers (NFR-013).

import type {CartOffersView} from './view';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Documented narrowing helper: structural check of the fields the cart UI reads. */
export function isOffersView(value: unknown): value is CartOffersView {
  return (
    isRecord(value) &&
    isRecord(value.freeDelivery) &&
    typeof value.freeDelivery.enabled === 'boolean' &&
    isRecord(value.lineSizes) &&
    Array.isArray(value.gifts) &&
    Array.isArray(value.addOns) &&
    Array.isArray(value.blocked) &&
    Array.isArray(value.notices) &&
    (value.updatedAt === null || typeof value.updatedAt === 'string')
  );
}

/** The offers view inside a cart action or `/cart` loader result, or null. */
export function readOffersView(data: unknown): CartOffersView | null {
  return isRecord(data) && isOffersView(data.offers) ? data.offers : null;
}

/**
 * Picks the view that describes the cart on screen. A view for the same cart version is used; so is a NEWER
 * one: a page load can repair the cart (removing an orphaned gift) after the drawer's cart was read, and the
 * drawer should then show the repaired cart's offers rather than none. An older view is never used. An
 * optimistic cart has no version of its own, so the caller passes the server cart's. With several usable
 * views the newest wins; ties keep the first.
 */
export function pickOffersView(
  candidates: readonly (CartOffersView | null)[],
  cartUpdatedAt: string | null | undefined,
): CartOffersView | null {
  if (!cartUpdatedAt) return null;
  const cartTime = Date.parse(cartUpdatedAt);
  let best: CartOffersView | null = null;
  let bestTime = Number.NEGATIVE_INFINITY;
  for (const view of candidates) {
    if (view === null || view.updatedAt === null) continue;
    if (view.updatedAt === cartUpdatedAt) {
      if (bestTime < cartTime || best === null) {
        best = view;
        bestTime = cartTime;
      }
      continue;
    }
    const time = Date.parse(view.updatedAt);
    if (Number.isNaN(time) || Number.isNaN(cartTime) || time < cartTime)
      continue;
    if (time > bestTime) {
      best = view;
      bestTime = time;
    }
  }
  return best;
}
