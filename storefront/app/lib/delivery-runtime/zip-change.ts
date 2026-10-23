// Browser-side record that the shopper's delivery ZIP changed during this page session (P3B-11, REQ-NAV-003).
//
// Why: the cart's offers view (haul-away eligibility, the free-delivery message) is computed on the server from
// the signed ZIP cookie, but the view is cached in the browser per cart version, and a ZIP change does not change
// the cart version. Anything that kept a view from before the change would keep telling the old story until a
// manual reload. Readers compare against this record and drop what predates it. Nothing here is cached by a
// server or keyed by the ZIP: it holds only a counter (the ZIP itself never enters this module).
//
// A module-level store on purpose, like cart-results: the writer (the header's ZIP control, always mounted) and
// the readers (the cart page, the drawer, mounted and unmounted at will) sit in different subtrees. Effects do
// not run on the server, so nothing is written there and the server snapshot is always the empty record.

import type {DeliveryView} from '~/lib/delivery/status';

export type ZipChange = {
  /** Number of ZIP saves or clears that succeeded since the page loaded; 0 means none. */
  readonly epoch: number;
  /**
   * The cart-result sequence number (cart-results.ts) at the moment of the change. A cart answer with a higher
   * number was computed by the server after the cookie changed; one with a lower or equal number was not.
   */
  readonly cartResultSeq: number;
};

export const NO_ZIP_CHANGE: ZipChange = {epoch: 0, cartResultSeq: 0};

let latest: ZipChange = NO_ZIP_CHANGE;
const listeners = new Set<() => void>();

export function subscribeZipChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function currentZipChange(): ZipChange {
  return latest;
}

export function markZipChanged(cartResultSeq: number): void {
  latest = {epoch: latest.epoch + 1, cartResultSeq};
  listeners.forEach((listener) => listener());
}

export function resetZipChangeForTests(): void {
  latest = NO_ZIP_CHANGE;
  listeners.forEach((listener) => listener());
}

/**
 * What a delivery answer says, reduced to a comparable string, so saving the same ZIP again (or clearing when
 * none was saved) is not counted as a change and does not cost the cart a refresh. Kept in memory only for the
 * comparison; it is never logged, stored or sent anywhere.
 */
export function deliverySignature(view: DeliveryView | null): string {
  if (view === null) return 'none';
  return 'zip' in view ? `${view.status}:${view.zip}` : view.status;
}
