import {describe, expect, it} from 'vitest';
import {applyCorrections} from '~/lib/offers/corrections';
import {
  evaluateOffers,
  pendingSteps,
  revalidationOutcome,
} from '~/lib/offers/evaluate';
import type {
  CartLineLike,
  CartLike,
  Correction,
  OfferContext,
  OfferRules,
  Violation,
} from '~/lib/offers/types';
import {EMPTY_OFFER_RULES} from '~/lib/offers/types';
import {
  IN_ZONE_ZIP,
  OUT_OF_ZONE_ZIP,
  PRODUCT,
  RULES,
  VARIANT,
  coverage,
  deepFreeze,
  gift,
  haulAway,
  makeCart,
  makeContext,
  makeLine,
  mattressA,
  protector,
} from '~/lib/offers/test-fixtures';

type Options = {
  context?: Partial<OfferContext>;
  rules?: OfferRules;
  attributes?: Record<string, string>;
  subtotalCents?: number;
};

function evaluate(
  lines: readonly Partial<CartLineLike>[],
  options: Options = {},
) {
  const cart: CartLike = deepFreeze(
    makeCart(
      lines.map((line, index) => ({id: `line-${index}`, ...line})),
      {
        attributes: options.attributes,
        subtotalCents: options.subtotalCents ?? 0,
      },
    ),
  );
  const rules = deepFreeze(options.rules ?? RULES);
  const context = deepFreeze(makeContext(options.context));
  return {cart, rules, context, result: evaluateOffers(cart, rules, context)};
}

/** Applies the corrections, evaluates again, and returns the second pass. */
function evaluateAgain(
  cart: CartLike,
  rules: OfferRules,
  context: OfferContext,
  corrections: readonly Correction[],
) {
  return evaluateOffers(applyCorrections(cart, corrections), rules, context);
}

// REQ-PRE-001: steps appear in order, are skipped when not applicable, accept and decline both advance.
describe('evaluateOffers: step orchestration (REQ-PRE-001)', () => {
  it('returns the steps in checkout order, all skipped when nothing applies', () => {
    const {result} = evaluate([], {context: {deliveryChoice: null}});
    expect(result.steps.map((step) => step.id)).toEqual([
      'comfort-guarantee',
      'haul-away',
      'accident-protection',
    ]);
    expect(result.steps.map((step) => step.status)).toEqual([
      'not-applicable',
      'not-applicable',
      'not-applicable',
    ]);
    expect(result.corrections).toEqual([]);
    expect(result.violations).toEqual([]);
    expect(pendingSteps(result)).toEqual([]);
  });

  it('asks all three questions for a qualifying mattress delivered in-home inside the zone', () => {
    const {result} = evaluate([{...mattressA('Queen')}], {
      context: {protectionEligibleLineIds: ['mattress-queen']},
    });
    expect(pendingSteps(result).map((step) => step.id)).toEqual([
      'comfort-guarantee',
      'haul-away',
      'accident-protection',
    ]);
  });

  it('skips haul-away for store pickup', () => {
    const {result} = evaluate([mattressA('Queen')], {
      context: {deliveryChoice: 'pickup'},
    });
    expect(result.steps[1]).toMatchObject({
      status: 'not-applicable',
      reason: 'pickup-selected',
    });
    expect(pendingSteps(result).map((step) => step.id)).toEqual([
      'comfort-guarantee',
    ]);
  });

  it('skips haul-away outside the delivery zone', () => {
    const {result} = evaluate([mattressA('Queen')], {
      context: {zip: OUT_OF_ZONE_ZIP},
    });
    expect(result.steps[1]).toMatchObject({
      status: 'not-applicable',
      reason: 'outside-zone',
    });
  });

  it('advances after an accept: the protector is in the cart', () => {
    const {result} = evaluate([
      mattressA('Queen'),
      protector(VARIANT.protQueen, 'p1'),
    ]);
    expect(result.steps[0].status).toBe('accepted');
    expect(pendingSteps(result).map((step) => step.id)).not.toContain(
      'comfort-guarantee',
    );
  });

  it('advances after a decline recorded as a cart attribute', () => {
    const {result} = evaluate([mattressA('Queen')], {
      attributes: {
        offer_declined_comfort_guarantee: 'yes',
        offer_declined_haul_away: 'yes',
      },
    });
    expect(result.steps.map((step) => step.status)).toEqual([
      'declined',
      'declined',
      'not-applicable',
    ]);
    expect(pendingSteps(result)).toEqual([]);
  });

  it.each(['maybe', 'true', '1', 'declined', '', 'no'])(
    'a decline attribute with the value %j does not skip the step',
    (value) => {
      const {result} = evaluate([mattressA('Queen')], {
        attributes: {offer_declined_comfort_guarantee: value},
      });
      expect(result.steps[0].status).toBe('pending');
    },
  );

  it('ignores decline attributes with the wrong key', () => {
    const {result} = evaluate([mattressA('Queen')], {
      attributes: {
        Offer_Declined_Comfort_Guarantee: 'yes',
        decline_comfort: 'yes',
      },
    });
    expect(result.steps[0].status).toBe('pending');
  });

  it('takes the delivery choice from the context only, never from the cart attributes', () => {
    // The caller parses delivery_choice once (parseOfferAttributes) and passes it in the context.
    const pickup = evaluate([mattressA('Queen')], {
      context: {deliveryChoice: 'pickup'},
      attributes: {delivery_choice: 'in-home'},
    });
    expect(pickup.result.steps[1]).toMatchObject({reason: 'pickup-selected'});
  });
});

describe('evaluateOffers: accident protection (REQ-PRE-004)', () => {
  const eligible = (...ids: string[]) => ({protectionEligibleLineIds: ids});

  it('offers coverage for an eligible line that is not covered yet', () => {
    const {result} = evaluate([mattressA('Queen', {quantity: 2})], {
      context: eligible('mattress-queen'),
    });
    expect(result.steps[2]).toEqual({
      id: 'accident-protection',
      applies: true,
      reason: 'eligible-items-in-cart',
      status: 'pending',
      options: [{lineId: 'mattress-queen', quantity: 2, uncoveredQuantity: 2}],
    });
  });

  it('is accepted once coverage is linked to the item', () => {
    const {result} = evaluate(
      [mattressA('Queen'), coverage('c1', 'mattress-queen')],
      {context: eligible('mattress-queen')},
    );
    expect(result.steps[2]).toMatchObject({status: 'accepted', options: []});
    expect(result.corrections).toEqual([]);
  });

  it('keeps asking for the uncovered units of a partly covered line', () => {
    const {result} = evaluate(
      [mattressA('Queen', {quantity: 2}), coverage('c1', 'mattress-queen')],
      {context: eligible('mattress-queen')},
    );
    expect(result.steps[2].options).toEqual([
      {lineId: 'mattress-queen', quantity: 2, uncoveredQuantity: 1},
    ]);
  });

  it.each([
    ['nothing is eligible', {protectionEligibleLineIds: []}],
    ['the eligible id is not in the cart', eligible('line-that-left')],
    ['the eligible id is a coverage line', eligible('c1')],
  ])('does not apply when %s', (_label, context) => {
    const {result} = evaluate(
      [mattressA('Queen'), coverage('c1', 'mattress-queen')],
      {context},
    );
    expect(result.steps[2]).toMatchObject({
      applies: false,
      status: 'not-applicable',
    });
  });

  it('records a decline', () => {
    const {result} = evaluate([mattressA('Queen')], {
      context: eligible('mattress-queen'),
      attributes: {offer_declined_protection: 'yes'},
    });
    expect(result.steps[2].status).toBe('declined');
  });

  it('does not remove coverage just because Extend is unavailable (no eligible ids)', () => {
    const {result} = evaluate(
      [mattressA('Queen'), coverage('c1', 'mattress-queen')],
      {context: eligible()},
    );
    expect(result.corrections).toEqual([]);
  });
});

describe('evaluateOffers: coverage stays linked to its item (REQ-PRE-004, REQ-PRE-006)', () => {
  it.each([
    ['no parent', null],
    ['a parent that is not in the cart', 'gone'],
    ['itself as parent', 'c1'],
  ])('removes coverage with %s (never bought alone)', (_label, parent) => {
    const {cart, rules, context, result} = evaluate([
      mattressA('Queen'),
      coverage('c1', parent),
    ]);
    expect(result.corrections).toEqual([
      {type: 'remove-line', lineId: 'c1', reason: 'orphan-coverage'},
    ]);
    expect(
      evaluateAgain(cart, rules, context, result.corrections).corrections,
    ).toEqual([]);
  });

  it('removes coverage whose parent is another coverage line', () => {
    const {result} = evaluate([
      mattressA('Queen'),
      coverage('c1', 'mattress-queen'),
      coverage('c2', 'c1'),
    ]);
    expect(result.corrections).toEqual([
      {type: 'remove-line', lineId: 'c2', reason: 'orphan-coverage'},
    ]);
  });

  it.each([2, 9, Number.MAX_SAFE_INTEGER])(
    'clamps coverage of %i to the quantity of the covered item',
    (quantity) => {
      const {result} = evaluate([
        mattressA('Queen'),
        coverage('c1', 'mattress-queen', quantity),
      ]);
      expect(result.corrections).toEqual([
        {
          type: 'set-quantity',
          lineId: 'c1',
          quantity: 1,
          previousQuantity: quantity,
          reason: 'coverage-exceeds-item',
        },
      ]);
    },
  );

  it('removes a second coverage line once the item is fully covered', () => {
    const {result} = evaluate([
      mattressA('Queen'),
      coverage('c1', 'mattress-queen'),
      coverage('c2', 'mattress-queen'),
    ]);
    expect(result.corrections).toEqual([
      {type: 'remove-line', lineId: 'c2', reason: 'coverage-exceeds-item'},
    ]);
  });

  it('removes coverage together with a gift line that is being removed', () => {
    const {cart, rules, context, result} = evaluate([
      gift(VARIANT.giftStandard, 'g1'),
      coverage('c1', 'g1'),
    ]);
    expect(result.corrections).toEqual([
      {type: 'remove-line', lineId: 'g1', reason: 'orphan-gift'},
      {type: 'remove-line', lineId: 'c1', reason: 'orphan-coverage'},
    ]);
    expect(
      evaluateAgain(cart, rules, context, result.corrections).corrections,
    ).toEqual([]);
  });

  it('reduces coverage when the covered haul-away quantity is clamped in the same pass', () => {
    const {cart, rules, context, result} = evaluate([
      haulAway('h1', 9),
      coverage('c1', 'h1', 9),
    ]);
    expect(result.corrections).toEqual([
      {
        type: 'set-quantity',
        lineId: 'h1',
        quantity: 3,
        previousQuantity: 9,
        reason: 'haul-away-over-max',
      },
      {
        type: 'set-quantity',
        lineId: 'c1',
        quantity: 3,
        previousQuantity: 9,
        reason: 'coverage-exceeds-item',
      },
    ]);
    expect(
      evaluateAgain(cart, rules, context, result.corrections).corrections,
    ).toEqual([]);
  });

  it('does not stack a repair on coverage whose parent has a malformed quantity', () => {
    const {result} = evaluate([
      mattressA('Queen', {quantity: -1}),
      coverage('c1', 'mattress-queen'),
    ]);
    expect(result.corrections).toEqual([]);
    expect(result.violations).toEqual([
      {code: 'invalid-quantity', lineId: 'mattress-queen'},
    ]);
  });
});

describe('evaluateOffers: free-delivery progress and offers in one result (REQ-CART-004, REQ-ADD-001)', () => {
  it('reports progress from the cart subtotal', () => {
    const {result} = evaluate([mattressA('Queen')], {subtotalCents: 50000});
    expect(result.freeDelivery).toMatchObject({
      enabled: true,
      reached: false,
      remainingCents: 49900,
    });
  });

  it('turns the message off when the rule is off', () => {
    const {result} = evaluate([mattressA('Queen')], {
      rules: {...RULES, freeDelivery: null},
      subtotalCents: 1,
    });
    expect(result.freeDelivery).toEqual({enabled: false});
  });

  it('includes the gifts and matching add-ons to show', () => {
    const {result} = evaluate([mattressA('Queen')]);
    expect(result.gifts.map((g) => g.ruleId)).toEqual(['gift-pillows']);
    expect(result.matchingAddOns.map((o) => o.category)).toEqual([
      'foundation',
      'pillow',
    ]);
  });

  it('degrades to no offers with empty rules', () => {
    const {result} = evaluate(
      [mattressA('Queen'), protector(VARIANT.protQueen, 'p1')],
      {rules: EMPTY_OFFER_RULES},
    );
    expect(result.gifts).toEqual([]);
    expect(result.matchingAddOns).toEqual([]);
    expect(result.steps.map((step) => step.applies)).toEqual([
      false,
      false,
      false,
    ]);
    expect(result.corrections).toEqual([]);
  });
});

type TamperCase = {
  name: string;
  lines: Partial<CartLineLike>[];
  options?: Options;
  outcome: 'ok' | 'corrected' | 'rejected';
  corrections?: Correction[];
  violations?: Violation[];
};

const TAMPERED: TamperCase[] = [
  {
    name: 'a clean cart',
    lines: [
      mattressA('Queen'),
      protector(VARIANT.protQueen, 'p1'),
      haulAway('h1', 2),
    ],
    outcome: 'ok',
  },
  {
    name: 'haul-away above the maximum',
    lines: [mattressA('Queen'), haulAway('h1', 4)],
    outcome: 'corrected',
    corrections: [
      {
        type: 'set-quantity',
        lineId: 'h1',
        quantity: 3,
        previousQuantity: 4,
        reason: 'haul-away-over-max',
      },
    ],
  },
  {
    name: 'a huge haul-away quantity',
    lines: [mattressA('Queen'), haulAway('h1', Number.MAX_SAFE_INTEGER)],
    outcome: 'corrected',
    corrections: [
      {
        type: 'set-quantity',
        lineId: 'h1',
        quantity: 3,
        previousQuantity: Number.MAX_SAFE_INTEGER,
        reason: 'haul-away-over-max',
      },
    ],
  },
  {
    name: 'haul-away with store pickup',
    lines: [mattressA('Queen'), haulAway('h1', 1)],
    options: {context: {deliveryChoice: 'pickup'}},
    outcome: 'rejected',
    violations: [
      {
        code: 'haul-away-not-eligible',
        reason: 'pickup-selected',
        lineIds: ['h1'],
      },
    ],
  },
  {
    name: 'haul-away outside the zone',
    lines: [mattressA('Queen'), haulAway('h1', 1)],
    options: {context: {zip: OUT_OF_ZONE_ZIP}},
    outcome: 'rejected',
    violations: [
      {code: 'haul-away-not-eligible', reason: 'outside-zone', lineIds: ['h1']},
    ],
  },
  {
    name: 'haul-away with a tampered delivery_choice attribute the parser could not read',
    lines: [mattressA('Queen'), haulAway('h1', 1)],
    options: {
      context: {deliveryChoice: null},
      attributes: {delivery_choice: 'teleport'},
    },
    outcome: 'rejected',
    violations: [
      {
        code: 'haul-away-not-eligible',
        reason: 'delivery-not-chosen',
        lineIds: ['h1'],
      },
    ],
  },
  {
    name: 'haul-away over the maximum AND for pickup (rejected, not repaired)',
    lines: [mattressA('Queen'), haulAway('h1', 9)],
    options: {context: {deliveryChoice: 'pickup'}},
    outcome: 'rejected',
    violations: [
      {
        code: 'haul-away-not-eligible',
        reason: 'pickup-selected',
        lineIds: ['h1'],
      },
    ],
  },
  {
    name: 'an orphan gift (the qualifier was removed)',
    lines: [makeLine({id: 'x'}), gift(VARIANT.giftStandard, 'g1')],
    outcome: 'corrected',
    corrections: [{type: 'remove-line', lineId: 'g1', reason: 'orphan-gift'}],
  },
  {
    name: 'two gifts for one qualifier',
    lines: [
      mattressA('Queen'),
      gift(VARIANT.giftStandard, 'g1'),
      gift(VARIANT.giftKing, 'g2'),
    ],
    outcome: 'corrected',
    corrections: [
      {type: 'remove-line', lineId: 'g2', reason: 'duplicate-gift'},
    ],
  },
  {
    name: 'a gift size the promotion does not offer',
    lines: [mattressA('Queen'), gift('v-gift-xl', 'g1')],
    outcome: 'corrected',
    corrections: [
      {type: 'remove-line', lineId: 'g1', reason: 'gift-not-offered'},
    ],
  },
  {
    name: 'a wrong-size protector',
    lines: [mattressA('King'), protector(VARIANT.protTwin, 'p1')],
    outcome: 'corrected',
    corrections: [
      {type: 'remove-line', lineId: 'p1', reason: 'wrong-size-protector'},
    ],
  },
  {
    name: 'a protector without a mattress',
    lines: [protector(VARIANT.protQueen, 'p1')],
    outcome: 'corrected',
    corrections: [
      {type: 'remove-line', lineId: 'p1', reason: 'protector-without-mattress'},
    ],
  },
  {
    name: 'a negative quantity',
    lines: [mattressA('Queen'), haulAway('h1', -1)],
    outcome: 'rejected',
    violations: [{code: 'invalid-quantity', lineId: 'h1'}],
  },
  {
    name: 'a zero quantity',
    lines: [mattressA('Queen', {quantity: 0})],
    outcome: 'rejected',
    violations: [{code: 'invalid-quantity', lineId: 'mattress-queen'}],
  },
  {
    name: 'a fractional quantity',
    lines: [mattressA('Queen', {quantity: 1.5})],
    outcome: 'rejected',
    violations: [{code: 'invalid-quantity', lineId: 'mattress-queen'}],
  },
  {
    name: 'NaN, infinite and unsafe quantities',
    lines: [
      mattressA('Queen', {quantity: Number.NaN}),
      mattressA('King', {quantity: Number.POSITIVE_INFINITY}),
      mattressA('Twin', {quantity: 2 ** 60}),
    ],
    outcome: 'rejected',
    violations: [
      {code: 'invalid-quantity', lineId: 'mattress-queen'},
      {code: 'invalid-quantity', lineId: 'mattress-king'},
      {code: 'invalid-quantity', lineId: 'mattress-twin'},
    ],
  },
  {
    name: 'a quantity sent as text',
    // Object.assign widens the type the way a forged JSON body would: quantity becomes a string at runtime.
    lines: [Object.assign(mattressA('Queen'), {quantity: '3'})],
    outcome: 'rejected',
    violations: [{code: 'invalid-quantity', lineId: 'mattress-queen'}],
  },
  {
    name: 'two lines with one id',
    lines: [
      mattressA('Queen'),
      mattressA('Queen', {variantId: 'v-other-queen'}),
    ],
    outcome: 'rejected',
    violations: [{code: 'duplicate-line-id', lineId: 'mattress-queen'}],
  },
  {
    // An id-keyed correction would hit both lines, so none is emitted: the cart is refused instead.
    name: 'an over-limit haul-away line that shares its id with another line',
    lines: [
      mattressA('Queen'),
      haulAway('h1', 9),
      haulAway('h1', 1, {attributes: {n: '2'}}),
    ],
    outcome: 'rejected',
    violations: [{code: 'duplicate-line-id', lineId: 'h1'}],
  },
  {
    name: 'three lines sharing one id are reported once',
    lines: [
      mattressA('Queen'),
      gift(VARIANT.giftStandard, 'g1'),
      gift(VARIANT.giftStandard, 'g1', {attributes: {n: '2'}}),
      gift(VARIANT.giftStandard, 'g1', {attributes: {n: '3'}}),
    ],
    outcome: 'rejected',
    violations: [{code: 'duplicate-line-id', lineId: 'g1'}],
  },
  {
    name: 'a protector whose only mattress is malformed',
    lines: [
      mattressA('Queen', {quantity: -2}),
      protector(VARIANT.protQueen, 'p1'),
    ],
    outcome: 'rejected',
    violations: [{code: 'invalid-quantity', lineId: 'mattress-queen'}],
    corrections: [
      {type: 'remove-line', lineId: 'p1', reason: 'protector-without-mattress'},
    ],
  },
  {
    name: 'a rejected cart that also needs repairs',
    lines: [protector(VARIANT.protQueen, 'p1'), haulAway('h1', 1)],
    options: {context: {deliveryChoice: 'pickup'}},
    outcome: 'rejected',
    corrections: [
      {type: 'remove-line', lineId: 'p1', reason: 'protector-without-mattress'},
    ],
    violations: [
      {
        code: 'haul-away-not-eligible',
        reason: 'pickup-selected',
        lineIds: ['h1'],
      },
    ],
  },
];

describe('evaluateOffers: tampered carts are corrected or rejected (REQ-PRE-006, REQ-PRE-003, REQ-PROMO-003)', () => {
  it.each(TAMPERED)(
    '$name -> $outcome',
    ({lines, options, outcome, corrections, violations}) => {
      const {result} = evaluate(lines, options);
      expect(revalidationOutcome(result)).toBe(outcome);
      expect(result.corrections).toEqual(corrections ?? []);
      expect(result.violations).toEqual(violations ?? []);
    },
  );

  it.each(TAMPERED)(
    '$name: applying the corrections leaves nothing to correct (idempotent)',
    ({lines, options}) => {
      const {cart, rules, context, result} = evaluate(lines, options);
      const second = evaluateAgain(cart, rules, context, result.corrections);
      expect(second.corrections).toEqual([]);
      // Violations are never silently repaired: they are the same after the corrections.
      expect(second.violations.map((v) => v.code)).toEqual(
        result.violations.map((v) => v.code),
      );
    },
  );

  it.each(TAMPERED)(
    '$name: corrections never raise a quantity and only name real lines',
    ({lines, options}) => {
      const {cart, result} = evaluate(lines, options);
      for (const correction of result.corrections) {
        const original = cart.lines.find(
          (line) => line.id === correction.lineId,
        );
        expect(original).toBeDefined();
        if (correction.type === 'set-quantity') {
          expect(correction.previousQuantity).toBe(original?.quantity);
          expect(correction.quantity).toBeGreaterThanOrEqual(1);
          expect(correction.quantity).toBeLessThan(correction.previousQuantity);
        }
      }
    },
  );

  it.each(TAMPERED)(
    '$name: is deterministic and does not mutate its input',
    ({lines, options}) => {
      const first = evaluate(lines, options);
      const second = evaluateOffers(first.cart, first.rules, first.context);
      expect(second).toEqual(first.result);
    },
  );

  it('names each line at most once across all corrections', () => {
    const {result} = evaluate([
      protector(VARIANT.protQueen, 'p1', {quantity: 5}),
      gift(VARIANT.giftStandard, 'g1'),
      haulAway('h1', 9),
      coverage('c1', 'h1', 9),
      coverage('c2', null),
    ]);
    const ids = result.corrections.map((c) => c.lineId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('revalidationOutcome and pendingSteps (REQ-PRE-006, REQ-PRE-001)', () => {
  it('pending steps never block the hand-off', () => {
    const {result} = evaluate([mattressA('Queen')]);
    expect(pendingSteps(result).length).toBeGreaterThan(0);
    expect(revalidationOutcome(result)).toBe('ok');
  });

  it('a violation wins over corrections', () => {
    const {result} = evaluate([
      gift(VARIANT.giftStandard, 'g1'),
      makeLine({id: 'bad', quantity: -1}),
    ]);
    expect(result.corrections).toHaveLength(1);
    expect(revalidationOutcome(result)).toBe('rejected');
  });
});

describe('evaluateOffers: hostile rule data and context', () => {
  it('survives sizes that name inherited members', () => {
    const {result} = evaluate([
      makeLine({id: 'm', productId: PRODUCT.mattressA, size: 'constructor'}),
      makeLine({id: 'm2', productId: PRODUCT.mattressA, size: '__proto__'}),
    ]);
    expect(result.steps[0]).toMatchObject({
      applies: false,
      reason: 'no-protector-for-size',
    });
    expect(result.matchingAddOns.map((o) => o.category)).toEqual(['pillow']);
  });

  it.each([
    '<script>alert(1)</script>',
    "60645'; DROP TABLE zips;--",
    '60645\n60700',
    '',
  ])('treats the ZIP %j as not eligible for haul-away', (zip) => {
    const {result} = evaluate([mattressA('Queen'), haulAway('h1', 1)], {
      context: {zip},
    });
    expect(revalidationOutcome(result)).toBe('rejected');
  });

  it('treats a hostile subtotal as zero progress', () => {
    const {result} = evaluate([mattressA('Queen')], {
      subtotalCents: Number.NaN,
    });
    expect(result.freeDelivery).toMatchObject({
      enabled: true,
      subtotalCents: 0,
      reached: false,
    });
  });

  it('an in-zone ZIP with ZIP+4 and padding still qualifies', () => {
    const {result} = evaluate([mattressA('Queen')], {
      context: {zip: ` ${IN_ZONE_ZIP}-1234 `},
    });
    expect(result.steps[1].applies).toBe(true);
  });
});
