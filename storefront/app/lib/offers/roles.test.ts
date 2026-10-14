import {describe, expect, it} from 'vitest';
import {withCoverageRoles} from '~/lib/offers/roles';
import {makeCart, mattressA} from '~/lib/offers/test-fixtures';

// REQ-EXT-002 / REQ-PRE-006: coverage is recognised by variant id, never by an attribute or role the cart supplies.
describe('withCoverageRoles', () => {
  const coverageVariants = new Set(['gid://variant/extend-149']);

  it('marks price-point variants as coverage even when the cart gave them no role', () => {
    const cart = makeCart([
      mattressA('Queen'),
      {id: 'c1', variantId: 'gid://variant/extend-149', parentLineId: null},
    ]);
    const result = withCoverageRoles(cart, coverageVariants);
    expect(result.lines.find((l) => l.id === 'c1')?.role).toBe('coverage');
    expect(result.lines.find((l) => l.id === 'mattress-queen')?.role).not.toBe(
      'coverage',
    );
  });

  it('clears a forged coverage role on a line whose variant is not a price point', () => {
    const cart = makeCart([{...mattressA('Queen'), role: 'coverage'}]);
    expect(withCoverageRoles(cart, coverageVariants).lines[0]?.role).toBeNull();
  });

  it('keeps other roles and does not mutate its input', () => {
    const cart = makeCart([{...mattressA('Queen'), role: 'mattress'}]);
    const frozen = JSON.stringify(cart);
    const result = withCoverageRoles(cart, coverageVariants);
    expect(result.lines[0]?.role).toBe('mattress');
    expect(JSON.stringify(cart)).toBe(frozen);
  });
});
