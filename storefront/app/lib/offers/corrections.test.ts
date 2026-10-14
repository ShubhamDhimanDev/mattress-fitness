import {describe, expect, it} from 'vitest';
import {applyCorrections} from '~/lib/offers/corrections';
import type {Correction} from '~/lib/offers/types';
import {
  deepFreeze,
  haulAway,
  makeCart,
  mattressA,
} from '~/lib/offers/test-fixtures';

// REQ-PRE-006: the repaired-cart preview used by the server and the tests.
describe('applyCorrections (REQ-PRE-006)', () => {
  const cart = deepFreeze(
    makeCart([mattressA('Queen'), haulAway('h1', 9), haulAway('h2', 2)], {
      subtotalCents: 123456,
    }),
  );

  it('removes and lowers exactly the listed lines and leaves the rest', () => {
    const corrections: Correction[] = [
      {
        type: 'set-quantity',
        lineId: 'h1',
        quantity: 3,
        previousQuantity: 9,
        reason: 'haul-away-over-max',
      },
      {type: 'remove-line', lineId: 'h2', reason: 'haul-away-over-max'},
    ];
    const result = applyCorrections(cart, corrections);
    expect(result.lines.map((line) => [line.id, line.quantity])).toEqual([
      ['mattress-queen', 1],
      ['h1', 3],
    ]);
  });

  it("does not mutate the original cart and keeps Shopify's subtotal untouched", () => {
    const result = applyCorrections(cart, [
      {type: 'remove-line', lineId: 'h1', reason: 'haul-away-over-max'},
    ]);
    expect(cart.lines).toHaveLength(3);
    expect(result.subtotalCents).toBe(123456);
  });

  it('never raises a quantity, even from a stale correction', () => {
    const result = applyCorrections(cart, [
      {
        type: 'set-quantity',
        lineId: 'h2',
        quantity: 5,
        previousQuantity: 9,
        reason: 'haul-away-over-max',
      },
    ]);
    expect(result.lines.find((line) => line.id === 'h2')?.quantity).toBe(2);
  });

  it('ignores corrections for lines that are not in the cart', () => {
    const result = applyCorrections(cart, [
      {type: 'remove-line', lineId: 'ghost', reason: 'orphan-gift'},
    ]);
    expect(result.lines).toEqual(cart.lines);
  });

  it('is a no-op without corrections', () => {
    expect(applyCorrections(cart, []).lines).toEqual(cart.lines);
  });
});
