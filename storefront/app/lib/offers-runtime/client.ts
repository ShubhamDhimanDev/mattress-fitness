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
 * Picks the view that describes the cart on screen. A view is trusted only when its cart version matches the
 * cart's (`updatedAt`); with several candidates the first match wins. An optimistic cart has no version of its
 * own, so the caller passes the server cart's.
 */
export function pickOffersView(
  candidates: readonly (CartOffersView | null)[],
  cartUpdatedAt: string | null | undefined,
): CartOffersView | null {
  if (!cartUpdatedAt) return null;
  return (
    candidates.find(
      (view) => view !== null && view.updatedAt === cartUpdatedAt,
    ) ?? null
  );
}
