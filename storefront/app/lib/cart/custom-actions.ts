// Cart form actions that are ours, not Hydrogen's. Hydrogen's CartForm types only accept the built-in names or a
// name starting with "Custom". They travel in the same envelope as the built-in ones, so optimistic UI and the
// one `/cart` endpoint stay the same.

export const CHANGE_SIZE_ACTION = 'CustomChangeSize';

/**
 * Add an item together with an Extend protection plan (P5A-05, REQ-ADD-003). The browser sends a variant id, a
 * quantity and a PLAN KEY only; the server re-quotes, derives the coverage variant and price and nests the line.
 */
export const ADD_WITH_PROTECTION_ACTION = 'CustomAddWithProtection';

/** Protect a line already in the cart (cart and pre-checkout step, P5A-07): a line id and a plan key only. */
export const ADD_PROTECTION_ACTION = 'CustomAddProtection';
