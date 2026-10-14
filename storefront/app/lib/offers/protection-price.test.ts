import {describe, expect, it} from 'vitest';
import {applyCorrections} from '~/lib/offers/corrections';
import {evaluateOffers} from '~/lib/offers/evaluate';
import {
  RULES,
  coverage,
  deepFreeze,
  makeCart,
  makeContext,
  mattressA,
} from '~/lib/offers/test-fixtures';
import type {CartLike, OfferContext} from '~/lib/offers/types';

// REQ-EXT-002 / REQ-PRE-004 / T-06 / security review (cart-gate review, MAJOR 1): a coverage line must cost one of the
// plans Extend quoted for the item it hangs off. The price comes from Shopify (unitPriceCents), the quote from Extend.

const PRICES = new Map<string, readonly number[]>([
  ['mattress-queen', [7999, 9999]],
  ['mattress-twin-xl', [2999]],
]);

function context(overrides: Partial<OfferContext> = {}): OfferContext {
  return makeContext({
    protectionEligibleLineIds: ['mattress-queen', 'mattress-twin-xl'],
    coveragePlanPricesByLineId: PRICES,
    ...overrides,
  });
}

function cartOf(
  coverageLines: ReturnType<typeof coverage>[],
  extra: ReturnType<typeof mattressA>[] = [],
): CartLike {
  return deepFreeze(makeCart([mattressA('Queen'), ...extra, ...coverageLines]));
}

describe('coverage price must be a quoted plan for its parent', () => {
  it('keeps coverage whose price is one of the quoted plans', () => {
    const result = evaluateOffers(
      cartOf([coverage('c1', 'mattress-queen', 1, {unitPriceCents: 7999})]),
      RULES,
      context(),
    );
    expect(result.corrections).toEqual([]);
    expect(result.steps[2]).toMatchObject({status: 'accepted'});
  });

  it('removes coverage priced for a cheaper item: a low-size SKU on an expensive size (permalink with a mismatched plan)', () => {
    const result = evaluateOffers(
      cartOf([coverage('c1', 'mattress-queen', 1, {unitPriceCents: 2999})]),
      RULES,
      context(),
    );
    expect(result.corrections).toEqual([
      {
        type: 'remove-line',
        lineId: 'c1',
        reason: 'coverage-price-mismatch',
      },
    ]);
  });

  it('removes coverage with no readable price: it cannot be verified', () => {
    const result = evaluateOffers(
      cartOf([coverage('c1', 'mattress-queen')]),
      RULES,
      context(),
    );
    expect(result.corrections).toEqual([
      {
        type: 'remove-line',
        lineId: 'c1',
        reason: 'coverage-price-mismatch',
      },
    ]);
  });

  it('judges each parent by its own quote (Twin XL and Queen of the same product)', () => {
    const twin = mattressA('Twin XL');
    const result = evaluateOffers(
      cartOf(
        [
          coverage('c-queen', 'mattress-queen', 1, {unitPriceCents: 7999}),
          coverage('c-twin', 'mattress-twin-xl', 1, {unitPriceCents: 2999}),
          coverage('c-wrong', 'mattress-twin-xl', 1, {unitPriceCents: 7999}),
        ],
        [twin],
      ),
      RULES,
      context(),
    );
    expect(result.corrections.map((c) => [c.lineId, c.reason])).toEqual([
      ['c-wrong', 'coverage-price-mismatch'],
    ]);
  });

  it('does not judge price when the parent has no quote on record (Extend unavailable): the order sync cross-checks later', () => {
    const result = evaluateOffers(
      cartOf([coverage('c1', 'mattress-queen', 1, {unitPriceCents: 2999})]),
      RULES,
      context({coveragePlanPricesByLineId: new Map()}),
    );
    expect(result.corrections).toEqual([]);
  });

  it('is idempotent: after the correction a second pass finds nothing', () => {
    const cart = cartOf([
      coverage('c1', 'mattress-queen', 1, {unitPriceCents: 2999}),
    ]);
    const first = evaluateOffers(cart, RULES, context());
    const repaired = applyCorrections(cart, first.corrections);
    const second = evaluateOffers(repaired, RULES, context());
    expect(second.corrections).toEqual([]);
    expect(repaired.lines.map((line) => line.id)).toEqual(['mattress-queen']);
  });

  it('a removed mismatched coverage line does not count towards the item being covered', () => {
    const result = evaluateOffers(
      cartOf([coverage('c1', 'mattress-queen', 1, {unitPriceCents: 2999})]),
      RULES,
      context(),
    );
    expect(result.steps[2]).toMatchObject({
      status: 'pending',
      options: [{lineId: 'mattress-queen', uncoveredQuantity: 1}],
    });
  });
});
