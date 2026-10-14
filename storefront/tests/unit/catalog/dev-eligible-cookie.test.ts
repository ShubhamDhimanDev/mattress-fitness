import {describe, expect, it} from 'vitest';
import {hasDevEligibleCookie} from '~/lib/shopify/protection-mode';

describe('hasDevEligibleCookie', () => {
  it('matches the cookie alone', () => {
    expect(hasDevEligibleCookie('e2e_extend_eligible=1')).toBe(true);
  });

  it('matches when other cookies come before or after it', () => {
    expect(hasDevEligibleCookie('cart=abc; e2e_extend_eligible=1')).toBe(true);
    expect(hasDevEligibleCookie('cart=abc;e2e_extend_eligible=1; x=y')).toBe(
      true,
    );
    expect(hasDevEligibleCookie('e2e_extend_eligible=1; cart=abc')).toBe(true);
  });

  it('does not match another value, a longer name or no cookie', () => {
    expect(hasDevEligibleCookie('e2e_extend_eligible=0')).toBe(false);
    expect(hasDevEligibleCookie('x_e2e_extend_eligible=1')).toBe(false);
    expect(hasDevEligibleCookie('')).toBe(false);
  });
});
