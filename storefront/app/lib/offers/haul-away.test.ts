import {describe, expect, it} from 'vitest';
import {
  clampHaulAwayQuantity,
  evaluateHaulAway,
  haulAwayEligibility,
  type HaulAwayEligibilityInput,
} from '~/lib/offers/haul-away';
import {prepareCart} from '~/lib/offers/lines';
import type {HaulAwayRules} from '~/lib/offers/types';
import {
  IN_ZONE_ZIP,
  OUT_OF_ZONE_ZIP,
  RULES,
  VARIANT,
  ZONE,
  haulAway,
  makeCart,
  makeLine,
  mattressA,
} from '~/lib/offers/test-fixtures';

const RULE: HaulAwayRules = {variantId: VARIANT.haul, maxPieces: 3};
const ELIGIBLE: HaulAwayEligibilityInput = {
  zip: IN_ZONE_ZIP,
  deliveryChoice: 'in-home',
  zone: ZONE,
};

function run(
  lines: Parameters<typeof makeCart>[0],
  input: HaulAwayEligibilityInput = ELIGIBLE,
  declined = false,
  rule: HaulAwayRules | null = RULE,
) {
  return evaluateHaulAway(
    prepareCart(makeCart(lines), {...RULES, haulAway: rule}),
    rule,
    input,
    declined,
  );
}

// REQ-PRE-003: offered only for an eligible ZIP and in-home delivery, capped at the admin maximum.
describe('haulAwayEligibility (REQ-PRE-003)', () => {
  it('is eligible for in-home delivery inside the zone', () => {
    expect(haulAwayEligibility(RULE, ELIGIBLE)).toEqual({
      eligible: true,
      variantId: VARIANT.haul,
      maxPieces: 3,
    });
  });

  it('accepts a ZIP+4 inside the zone', () => {
    expect(
      haulAwayEligibility(RULE, {...ELIGIBLE, zip: '60645-1234'}),
    ).toMatchObject({eligible: true});
  });

  it.each([
    [
      'pickup, inside the zone',
      {deliveryChoice: 'pickup' as const},
      'pickup-selected',
    ],
    [
      'pickup, outside the zone',
      {deliveryChoice: 'pickup' as const, zip: OUT_OF_ZONE_ZIP},
      'pickup-selected',
    ],
    ['no delivery choice yet', {deliveryChoice: null}, 'delivery-not-chosen'],
    ['zone not loaded', {zone: null}, 'zone-unavailable'],
    ['ZIP outside the zone', {zip: OUT_OF_ZONE_ZIP}, 'outside-zone'],
    ['ZIP just below the zone', {zip: '60599'}, 'outside-zone'],
    ['ZIP just above the zone', {zip: '60700'}, 'outside-zone'],
    ['no ZIP', {zip: null}, 'zip-missing'],
    ['blank ZIP', {zip: '   '}, 'zip-missing'],
    ['letters for a ZIP', {zip: 'abcde'}, 'zip-invalid'],
    ['injection for a ZIP', {zip: "60645' OR 1=1 --"}, 'zip-invalid'],
    ['four-digit ZIP', {zip: '6064'}, 'zip-invalid'],
  ])('is not eligible: %s', (_label, override, reason) => {
    expect(haulAwayEligibility(RULE, {...ELIGIBLE, ...override})).toEqual({
      eligible: false,
      reason,
    });
  });

  it.each([
    ['no rule', null],
    ['a maximum of 0', {variantId: VARIANT.haul, maxPieces: 0}],
    ['a negative maximum', {variantId: VARIANT.haul, maxPieces: -1}],
    ['a fractional maximum', {variantId: VARIANT.haul, maxPieces: 2.5}],
    ['a NaN maximum', {variantId: VARIANT.haul, maxPieces: Number.NaN}],
    ['an empty variant id', {variantId: '', maxPieces: 3}],
  ])(
    'is not configured with %s, even for an eligible shopper',
    (_label, rule) => {
      expect(haulAwayEligibility(rule, ELIGIBLE)).toEqual({
        eligible: false,
        reason: 'not-configured',
      });
    },
  );
});

describe('clampHaulAwayQuantity (REQ-PRE-003, REQ-PROMO-003)', () => {
  it.each([
    [0, 3, 0],
    [1, 3, 1],
    [3, 3, 3],
    [4, 3, 3],
    [1_000_000_000, 3, 3],
    [Number.MAX_SAFE_INTEGER, 3, 3],
    [2.9, 3, 2],
    [-1, 3, 0],
    [-0.5, 3, 0],
    [5, 0, 0],
    [5, Number.NaN, 0],
    [5, -2, 0],
  ])('clamp(%j, max %j) = %i', (requested, max, expected) => {
    expect(clampHaulAwayQuantity(requested, max)).toBe(expected);
  });

  it.each([
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    '3',
    '2; DROP',
    null,
    undefined,
    {},
    [3],
  ])(
    'reads the unusable request %j as 0, never as the maximum',
    (requested) => {
      expect(clampHaulAwayQuantity(requested, 3)).toBe(0);
    },
  );
});

describe('evaluateHaulAway: the step (REQ-PRE-003)', () => {
  it('offers a quantity picker when eligible and nothing is added yet', () => {
    const {step, corrections, violations} = run([mattressA('Queen')]);
    expect(step).toEqual({
      id: 'haul-away',
      applies: true,
      reason: 'eligible',
      status: 'pending',
      options: [{variantId: VARIANT.haul, maxPieces: 3, currentQuantity: 0}],
    });
    expect(corrections).toEqual([]);
    expect(violations).toEqual([]);
  });

  it('is accepted once pieces are in the cart', () => {
    const {step} = run([mattressA('Queen'), haulAway('h1', 2)]);
    expect(step).toMatchObject({status: 'accepted'});
    expect(step.options[0]).toMatchObject({currentQuantity: 2});
  });

  it('records a decline only while nothing is added', () => {
    expect(run([mattressA('Queen')], ELIGIBLE, true).step.status).toBe(
      'declined',
    );
    expect(
      run([mattressA('Queen'), haulAway('h1', 1)], ELIGIBLE, true).step.status,
    ).toBe('accepted');
  });

  it.each([
    [
      'pickup',
      {...ELIGIBLE, deliveryChoice: 'pickup' as const},
      'pickup-selected',
    ],
    ['no choice', {...ELIGIBLE, deliveryChoice: null}, 'delivery-not-chosen'],
    ['outside zone', {...ELIGIBLE, zip: OUT_OF_ZONE_ZIP}, 'outside-zone'],
  ])('does not apply for %s', (_label, input, reason) => {
    const {step} = run([mattressA('Queen')], input);
    expect(step).toEqual({
      id: 'haul-away',
      applies: false,
      reason,
      status: 'not-applicable',
      options: [],
    });
  });
});

describe('evaluateHaulAway: quantity cap (REQ-PRE-003, REQ-PROMO-003)', () => {
  it('leaves a quantity at the maximum alone', () => {
    expect(run([haulAway('h1', 3)]).corrections).toEqual([]);
  });

  it.each([
    ['one over', 4],
    ['far over', 50],
    ['absurdly over', Number.MAX_SAFE_INTEGER],
  ])('clamps a line %s the maximum', (_label, quantity) => {
    const {corrections, step} = run([haulAway('h1', quantity)]);
    expect(corrections).toEqual([
      {
        type: 'set-quantity',
        lineId: 'h1',
        quantity: 3,
        previousQuantity: quantity,
        reason: 'haul-away-over-max',
      },
    ]);
    expect(step.options[0]).toMatchObject({currentQuantity: 3});
  });

  it('counts several haul-away lines together; earlier lines keep their pieces first', () => {
    const {corrections} = run([
      haulAway('h1', 2),
      haulAway('h2', 2),
      haulAway('h3', 1),
    ]);
    expect(corrections).toEqual([
      {
        type: 'set-quantity',
        lineId: 'h2',
        quantity: 1,
        previousQuantity: 2,
        reason: 'haul-away-over-max',
      },
      {type: 'remove-line', lineId: 'h3', reason: 'haul-away-over-max'},
    ]);
  });

  it('counts a role-tagged haul-away line even when its variant is not the configured one', () => {
    const odd = makeLine({
      id: 'h-odd',
      variantId: 'v-other-haul',
      role: 'haul-away',
      quantity: 5,
    });
    expect(run([odd]).corrections).toEqual([
      {
        type: 'set-quantity',
        lineId: 'h-odd',
        quantity: 3,
        previousQuantity: 5,
        reason: 'haul-away-over-max',
      },
    ]);
  });

  it('ignores malformed quantities here; the cart is refused elsewhere (REQ-PRE-006)', () => {
    const {corrections, violations} = run([
      haulAway('h1', -2),
      haulAway('h2', 1.5),
    ]);
    expect(corrections).toEqual([]);
    expect(violations).toEqual([]);
  });
});

describe('evaluateHaulAway: tampered carts are refused (REQ-PRE-003, REQ-PROMO-003, REQ-PRE-006)', () => {
  it.each([
    [
      'pickup',
      {...ELIGIBLE, deliveryChoice: 'pickup' as const},
      'pickup-selected',
    ],
    [
      'no delivery choice',
      {...ELIGIBLE, deliveryChoice: null},
      'delivery-not-chosen',
    ],
    [
      'a ZIP outside the zone',
      {...ELIGIBLE, zip: OUT_OF_ZONE_ZIP},
      'outside-zone',
    ],
    ['no ZIP', {...ELIGIBLE, zip: null}, 'zip-missing'],
    ['an invalid ZIP', {...ELIGIBLE, zip: 'nope'}, 'zip-invalid'],
    ['no zone data', {...ELIGIBLE, zone: null}, 'zone-unavailable'],
  ])('rejects a haul-away line with %s', (_label, input, reason) => {
    const {violations, corrections} = run(
      [mattressA('Queen'), haulAway('h1', 1), haulAway('h2', 1)],
      input,
    );
    expect(violations).toEqual([
      {code: 'haul-away-not-eligible', reason, lineIds: ['h1', 'h2']},
    ]);
    expect(corrections).toEqual([]);
  });

  it('does not flag a cart without a haul-away line', () => {
    const {violations} = run([mattressA('Queen')], {
      ...ELIGIBLE,
      deliveryChoice: 'pickup',
    });
    expect(violations).toEqual([]);
  });

  it('removes a haul-away line when the offer has been switched off in admin', () => {
    const {corrections, violations, step} = run(
      [haulAway('h1', 2)],
      ELIGIBLE,
      false,
      null,
    );
    expect(corrections).toEqual([
      {type: 'remove-line', lineId: 'h1', reason: 'haul-away-disabled'},
    ]);
    expect(violations).toEqual([]);
    expect(step).toMatchObject({applies: false, reason: 'not-configured'});
  });
});
