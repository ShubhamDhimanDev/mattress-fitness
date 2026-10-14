// How the product page treats the accident-protection panel (P5A-05, REQ-ADD-003, NFR-002).
//
// The panel is asked for plans AFTER load, so before the answer the page has to decide how much room to give it.
// The server already knows whether the product can have a plan at all: Extend is only ever asked about products with a
// `custom.extend_category` metafield (REQ-EXT-005). That fact is sent to the page so a product with no category gets no
// panel, no skeleton and no request from the first paint, instead of a reserved gap that collapses.

export type ProtectionMode =
  /** Flag off, or the product has no Extend category: nothing renders and nothing is asked. */
  | 'off'
  /** The product has a category: the panel sits above Add to cart and keeps its height while it loads. */
  | 'eligible'
  /**
   * The category could not be read just now. The panel is asked for anyway but sits BELOW Add to cart and reserves
   * nothing, so whatever it answers cannot move the button.
   */
  | 'unknown';

export function protectionModeFor(input: {
  /** The server's Extend feature flag. */
  enabled: boolean;
  /** Has an Extend category; null when that could not be read. */
  eligible: boolean | null;
}): ProtectionMode {
  if (!input.enabled || input.eligible === false) return 'off';
  return input.eligible === true ? 'eligible' : 'unknown';
}

// Dev-only test hook (see products.$handle.tsx): the e2e opts a page into 'eligible' with this cookie. Kept here as a pure
// function so the multi-cookie header case is tested (a `;s*` typo once matched only a sole or first cookie).
const DEV_ELIGIBLE_COOKIE = /(?:^|;\s*)e2e_extend_eligible=1(?:;|$)/;

export function hasDevEligibleCookie(cookieHeader: string): boolean {
  return DEV_ELIGIBLE_COOKIE.test(cookieHeader);
}
