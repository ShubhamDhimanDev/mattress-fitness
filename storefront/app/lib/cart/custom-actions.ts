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

/**
 * Add a gift from the cart picker (P4-04, REQ-CART-002): a rule id and a variant id, both taken from the offers view. The
 * server re-judges the cart, proves the variant belongs to that rule and derives the quantity.
 */
export const ADD_GIFT_ACTION = 'CustomAddGift';

/** Add a size-matched add-on from the cart picker (P4-05, REQ-CART-003): a variant id, plus an optional mattress variant id from the product page slot (P4-03). */
export const ADD_ADDON_ACTION = 'CustomAddAddOn';

/** Add the missing companions of a bundle (P4-06, REQ-ADD-002): a bundle id and the anchor line id only. */
export const ADD_BUNDLE_ACTION = 'CustomAddBundle';

/**
 * "Add all" on the product page (P4-06, REQ-ADD-002): a bundle id and the anchor variant being viewed, which may not be in
 * the cart yet. The server derives every line, size and quantity again.
 */
export const ADD_PRODUCT_BUNDLE_ACTION = 'CustomAddProductBundle';
