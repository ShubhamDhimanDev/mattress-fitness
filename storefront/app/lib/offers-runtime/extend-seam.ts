// Where Extend plugs into cart revalidation (P5A-06, P5A-07). Extend stays behind PUBLIC_EXTEND_ENABLED and the
// local mock (ADR-0009), and no price-point catalog or Offers call exists in the cart path yet, so this seam
// answers "no coverage lines known, nothing eligible". Consequence, stated plainly: until P5A-06 connects it,
// coverage lines are not recognised by the cart revalidation (the engine sees them as ordinary lines), which
// is why they are not offered anywhere in the storefront either.

import type {CartLike} from '~/lib/offers/types';
import {withCoverageRoles} from '~/lib/offers/roles';

export type ExtendCartInputs = {
  /** Variant ids of the Extend price-point products, from server data (never from the cart). */
  readonly coverageVariantIds: ReadonlySet<string>;
  readonly protectionEligibleLineIds: readonly string[];
};

export const NO_EXTEND_INPUTS: ExtendCartInputs = {
  coverageVariantIds: new Set<string>(),
  protectionEligibleLineIds: [],
};

/**
 * Roles are assigned from the server's variant list only. A 'coverage' role or any role-like attribute
 * that arrived with the cart is cleared by `withCoverageRoles`; no other role is ever read from the cart.
 */
export function applyServerRoles(
  cart: CartLike,
  extend: ExtendCartInputs,
): CartLike {
  return withCoverageRoles(cart, extend.coverageVariantIds);
}
