// Coverage classification by variant id: the one authoritative way to decide which cart lines are Extend coverage.
// The price-point variant list (extend/price-points.ts) is server data; a role or attribute coming from the cart
// itself is never trusted, because a direct-API cart can attach any attribute to any line (ADR-0006, ADR-0009).

import type {CartLike} from './types';

/**
 * Returns a copy of the cart where a line has role 'coverage' exactly when its variant is a coverage price-point
 * variant. A 'coverage' role that arrived without a matching variant is cleared; every other role is kept.
 */
export function withCoverageRoles(
  cart: CartLike,
  coverageVariantIds: ReadonlySet<string>,
): CartLike {
  return {
    ...cart,
    lines: cart.lines.map((line) => {
      if (coverageVariantIds.has(line.variantId)) {
        return line.role === 'coverage' ? line : {...line, role: 'coverage'};
      }
      return line.role === 'coverage' ? {...line, role: null} : line;
    }),
  };
}
