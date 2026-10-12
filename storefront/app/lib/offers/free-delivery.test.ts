import {describe, expect, it} from 'vitest';
import {
  freeDeliveryMessage,
  freeDeliveryProgress,
} from '~/lib/offers/free-delivery';

const RULE = {thresholdCents: 99900};

// REQ-CART-004 (threshold math, recomputed after every cart change), CLR-009.
describe('freeDeliveryProgress (REQ-CART-004)', () => {
  it.each([
    ['empty cart', 0, 99900, false, 0],
    ['halfway', 49950, 49950, false, 50],
    ['one cent short', 99899, 1, false, 99],
    ['exactly at the threshold', 99900, 0, true, 100],
    ['one cent over', 99901, 0, true, 100],
    ['far over', 10_000_000, 0, true, 100],
  ])(
    '%s: subtotal %i -> remaining %i, reached %s, %i%%',
    (_label, subtotal, remaining, reached, percent) => {
      expect(freeDeliveryProgress(RULE, subtotal)).toEqual({
        enabled: true,
        thresholdCents: 99900,
        subtotalCents: subtotal,
        remainingCents: remaining,
        reached,
        percent,
      });
    },
  );

  it('is recomputed from the new subtotal each time (no hidden state)', () => {
    const first = freeDeliveryProgress(RULE, 50000);
    const second = freeDeliveryProgress(RULE, 120000);
    expect(first).toMatchObject({reached: false, remainingCents: 49900});
    expect(second).toMatchObject({reached: true, remainingCents: 0});
    expect(freeDeliveryProgress(RULE, 50000)).toEqual(first);
  });

  it.each([
    null,
    {thresholdCents: 0},
    {thresholdCents: -5},
    {thresholdCents: 1.5},
    {thresholdCents: Number.NaN},
    {thresholdCents: Number.POSITIVE_INFINITY},
  ])('is off for the unusable rule %j', (rule) => {
    expect(freeDeliveryProgress(rule, 500_000)).toEqual({enabled: false});
  });

  it.each([-100, Number.NaN, 12.5, Number.POSITIVE_INFINITY, 2 ** 60])(
    'reads the hostile subtotal %s as zero (never as reached)',
    (subtotal) => {
      expect(freeDeliveryProgress(RULE, subtotal)).toMatchObject({
        enabled: true,
        subtotalCents: 0,
        reached: false,
        remainingCents: 99900,
        percent: 0,
      });
    },
  );
});

describe('freeDeliveryMessage (REQ-CART-004)', () => {
  it('shows the remaining amount, then the success state', () => {
    expect(freeDeliveryMessage(freeDeliveryProgress(RULE, 50000))).toBe(
      'You are $499 away from free delivery.',
    );
    expect(freeDeliveryMessage(freeDeliveryProgress(RULE, 99950))).toBe(
      'You have unlocked free delivery.',
    );
  });

  it('keeps cents when the remaining amount is not whole dollars', () => {
    expect(freeDeliveryMessage(freeDeliveryProgress(RULE, 99899))).toBe(
      'You are $0.01 away from free delivery.',
    );
  });

  it('has no message when the offer is off', () => {
    expect(freeDeliveryMessage({enabled: false})).toBeNull();
    expect(freeDeliveryMessage(freeDeliveryProgress(null, 1000))).toBeNull();
  });
});
