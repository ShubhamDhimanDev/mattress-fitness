import {describe, expect, it} from 'vitest';
import {
  detectOrderViolations,
  detectWithConfig,
  unreadableOrderResult,
} from '~/lib/detective/detect';
import {
  GIFT_BY_COLLECTION,
  IN_ZONE,
  OUT_OF_ZONE,
  P,
  RULES,
  SYNTHETIC_PII,
  V,
  ZONE,
  coverage,
  deepFreeze,
  detectiveOrder,
  gift,
  haulAway,
  lineGid,
  mattress,
  orderLine,
  protector,
} from '~/lib/detective/test-fixtures';
import type {
  DetectOptions,
  DetectiveOrder,
  DetectiveResult,
} from '~/lib/detective/types';
import {EMPTY_OFFER_RULES, type OfferRules} from '~/lib/offers/types';

// P5B-05 / ADR-0006 decision 3 / REQ-PRE-003 / REQ-PRE-006 / REQ-PROMO-003 / security review E-M3 (T-01, T-02, T-06):
// an order placed through a cart our gate never saw is judged after the fact, by the same offer engine the gate uses.

/**
 * Most tests are about rules other than coverage price, so by default the price is "judged elsewhere" (the Extend sync).
 * The tests that prove what happens when nothing judges it pass `{}` explicitly.
 */
function judge(
  order: DetectiveOrder,
  rules: OfferRules = RULES,
  zone: typeof ZONE | null = ZONE,
  options: DetectOptions = {coveragePriceJudgedElsewhere: true},
): DetectiveResult {
  return detectOrderViolations(deepFreeze(order), rules, zone, options);
}

function codes(result: DetectiveResult): string[] {
  return result.violations.map((violation) => violation.code);
}

describe('P5B-05 a compliant order is clean', () => {
  it('mattress, matching protector, haul-away inside the cap, in-home to an in-zone ZIP', () => {
    const result = judge(
      detectiveOrder([
        mattress(1, 'Queen'),
        protector(2, V.protQueen),
        haulAway(3, 3),
        gift(4),
      ]),
    );
    expect(result).toEqual({
      status: 'clean',
      orderId: '7001',
      violations: [],
      unjudged: [],
    });
  });

  it('an order with no offer lines at all is clean', () => {
    expect(judge(detectiveOrder([orderLine({id: 1})])).status).toBe('clean');
  });
});

describe('P5B-05 REQ-PRE-003 haul-away against the delivery address (E-M3)', () => {
  it('flags a shipping ZIP outside the zone even when the cart said in-home', () => {
    const result = judge(detectiveOrder([haulAway(1, 1)], {zip: OUT_OF_ZONE}));
    expect(result.status).toBe('violations');
    expect(result.violations).toEqual([
      {code: 'haul-away-outside-zone', lineIds: ['1']},
    ]);
  });

  it.each([
    ['ZIP+4 inside the zone', '60645-1234', []],
    ['ZIP with a space and +4 inside the zone', '60645 1234', []],
    ['an exact-code entry', '60007', []],
    [
      'a ZIP just outside a wildcard range',
      '60700',
      ['haul-away-outside-zone'],
    ],
    ['letters', 'ABCDE', ['haul-away-zip-invalid']],
    ['four digits', '6064', ['haul-away-zip-invalid']],
    ['an empty ZIP', '', ['haul-away-no-shipping-zip']],
  ])('%s', (_name, zip, expected) => {
    const result = judge(detectiveOrder([haulAway(1, 1)], {zip}));
    expect(codes(result)).toEqual(expected);
  });

  it('no shipping address (a pickup order) with a haul-away line is flagged', () => {
    const result = judge(detectiveOrder([haulAway(1, 1)], {zip: null}));
    expect(codes(result)).toEqual(['haul-away-no-shipping-zip']);
  });

  it('a non-US address never matches the zone, even with a ZIP-shaped postcode', () => {
    // 60645 is a Chicago ZIP in the test zone and also a valid German postcode.
    const german = judge(
      detectiveOrder([haulAway(1, 1)], {zip: IN_ZONE, country: 'DE'}),
    );
    expect(codes(german)).toEqual(['haul-away-outside-zone']);
    const unknownCountry = judge(
      detectiveOrder([haulAway(1, 1)], {zip: IN_ZONE, country: null}),
    );
    expect(codes(unknownCountry)).toEqual(['haul-away-zip-invalid']);
  });

  it('accepts a lower-case country code from the API', () => {
    expect(
      judge(detectiveOrder([haulAway(1, 1)], {zip: IN_ZONE, country: 'us'}))
        .status,
    ).toBe('clean');
  });

  it('an unknown zone is "not judged", not a violation and not clean', () => {
    const result = judge(detectiveOrder([haulAway(1, 1)]), RULES, null);
    expect(result).toMatchObject({
      status: 'unjudgeable',
      violations: [],
      unjudged: ['zone_unavailable'],
    });
  });
});

describe('P5B-05 REQ-PRE-003 haul-away delivery method (a shopper-writable claim)', () => {
  it.each([
    ['pickup', {delivery_choice: 'pickup'}, ['haul-away-pickup']],
    ['in-home', {delivery_choice: 'in-home'}, []],
    ['upper case with spaces', {delivery_choice: '  IN-HOME '}, []],
    ['missing', {}, ['haul-away-delivery-not-recorded']],
    [
      'junk',
      {delivery_choice: 'teleport'},
      ['haul-away-delivery-not-recorded'],
    ],
    [
      'a near-miss key',
      {'delivery-choice': 'in-home'},
      ['haul-away-delivery-not-recorded'],
    ],
  ])('attribute %s', (_name, attributes, expected) => {
    const result = judge(detectiveOrder([haulAway(1, 1)], {attributes}));
    expect(codes(result)).toEqual(expected);
  });

  it('a missing or pickup attribute cannot hide an out-of-zone address', () => {
    const result = judge(
      detectiveOrder([haulAway(1, 1)], {zip: OUT_OF_ZONE, attributes: {}}),
    );
    expect(codes(result)).toEqual([
      'haul-away-outside-zone',
      'haul-away-delivery-not-recorded',
    ]);
    const pickup = judge(
      detectiveOrder([haulAway(1, 1)], {
        zip: OUT_OF_ZONE,
        attributes: {delivery_choice: 'pickup'},
      }),
    );
    expect(codes(pickup)).toEqual([
      'haul-away-outside-zone',
      'haul-away-pickup',
    ]);
  });

  it('an order without a haul-away line is not judged on its delivery method', () => {
    expect(
      judge(detectiveOrder([mattress(1)], {attributes: {}, zip: null})).status,
    ).toBe('clean');
  });
});

describe('P5B-05 REQ-PROMO-003 haul-away over the admin maximum', () => {
  it.each([
    ['at the maximum', [haulAway(1, 3)], []],
    ['one over', [haulAway(1, 4)], ['haul-away-over-max']],
    [
      'split across two lines',
      [haulAway(1, 2), haulAway(2, 2)],
      ['haul-away-over-max'],
    ],
    ['a huge quantity', [haulAway(1, 100_000)], ['haul-away-over-max']],
  ])('%s', (_name, lines, expected) => {
    expect(codes(judge(detectiveOrder(lines)))).toEqual(expected);
  });

  it('names every haul-away line', () => {
    const result = judge(detectiveOrder([haulAway(1, 2), haulAway(2, 2)]));
    expect(result.violations[0]?.lineIds).toEqual(['1', '2']);
  });

  it('is judged even when the ZIP is out of zone (the cap does not depend on the address)', () => {
    const result = judge(detectiveOrder([haulAway(1, 4)], {zip: OUT_OF_ZONE}));
    expect(codes(result)).toEqual([
      'haul-away-outside-zone',
      'haul-away-over-max',
    ]);
  });

  it('units refunded after the order no longer count; a cancelled order keeps its original quantities', () => {
    const refunded = orderLine({
      id: 1,
      productId: P.haul,
      variantId: V.haul,
      quantity: 5,
      refunded: 3,
    });
    expect(judge(detectiveOrder([refunded])).status).toBe('clean');
    expect(
      codes(
        judge(
          detectiveOrder([refunded], {cancelledAt: '2026-10-11T00:00:00Z'}),
        ),
      ),
    ).toEqual(['haul-away-over-max']);
    expect(
      codes(judge(detectiveOrder([refunded], {refundState: 'full'}))),
    ).toEqual(['haul-away-over-max']);
  });

  it('a fully refunded line (quantity left 0) is not judged', () => {
    const gone = orderLine({
      id: 1,
      productId: P.haul,
      variantId: V.haul,
      quantity: 9,
      refunded: 9,
    });
    expect(judge(detectiveOrder([gone], {zip: OUT_OF_ZONE})).status).toBe(
      'clean',
    );
  });

  it('when the offer is switched off in the rules the line cannot be recognised and is not a violation', () => {
    const off: OfferRules = {...RULES, haulAway: null};
    expect(judge(detectiveOrder([haulAway(1, 9)]), off).status).toBe('clean');
  });
});

describe('P5B-05 REQ-PROMO-001 / REQ-CART-002 gifts', () => {
  it('a gift without its qualifying product is flagged', () => {
    const result = judge(detectiveOrder([orderLine({id: 1}), gift(2)]));
    expect(result.violations).toEqual([
      {code: 'gift-without-qualifier', lineIds: ['2']},
    ]);
  });

  it('a gift with its qualifying product is clean', () => {
    expect(judge(detectiveOrder([mattress(1), gift(2)])).status).toBe('clean');
  });

  it('a gift above the rule allowance is flagged', () => {
    expect(
      codes(judge(detectiveOrder([mattress(1), gift(2, V.giftStandard, 2)]))),
    ).toEqual(['gift-over-allowance']);
  });

  it('a second gift line over the allowance is flagged', () => {
    const result = judge(detectiveOrder([mattress(1), gift(2), gift(3)]));
    expect(result.violations).toEqual([
      {code: 'gift-over-allowance', lineIds: ['3']},
    ]);
  });

  it('a gift can never qualify itself or be unlocked by a service line', () => {
    expect(codes(judge(detectiveOrder([gift(1), haulAway(2, 1)])))).toContain(
      'gift-without-qualifier',
    );
  });

  it('a gift that qualifies by collection is "not judged": an order line carries no collections', () => {
    const rules: OfferRules = {...RULES, gifts: [GIFT_BY_COLLECTION]};
    const result = judge(
      detectiveOrder([orderLine({id: 1}), gift(2, V.giftByCollection)]),
      rules,
    );
    expect(result).toMatchObject({
      status: 'unjudgeable',
      violations: [],
      unjudged: ['gift_collection_qualifier'],
    });
  });
});

describe('P5B-05 REQ-PRE-002 comfort-guarantee protector', () => {
  it('a protector without any qualifying mattress is flagged', () => {
    expect(
      codes(
        judge(detectiveOrder([orderLine({id: 1}), protector(2, V.protQueen)])),
      ),
    ).toEqual(['protector-without-mattress']);
  });

  it('a protector of the wrong size is flagged', () => {
    const result = judge(
      detectiveOrder([mattress(1, 'Queen'), protector(2, V.protKing)]),
    );
    expect(result.violations).toEqual([
      {code: 'wrong-size-protector', lineIds: ['2']},
    ]);
  });

  it('more protectors than mattresses of that size is flagged', () => {
    const result = judge(
      detectiveOrder([mattress(1, 'Queen'), protector(2, V.protQueen, 2)]),
    );
    expect(codes(result)).toEqual(['protector-exceeds-mattresses']);
  });

  it('one protector per mattress of each size is clean', () => {
    const result = judge(
      detectiveOrder([
        mattress(1, 'Queen'),
        mattress(2, 'King'),
        protector(3, V.protQueen),
        protector(4, V.protKing),
      ]),
    );
    expect(result.status).toBe('clean');
  });

  it('a mattress with no readable Size option makes size comparisons "not judged", not violations', () => {
    const result = judge(
      detectiveOrder([[mattress(1, 'Queen'), null], protector(2, V.protKing)]),
    );
    expect(result).toMatchObject({
      status: 'unjudgeable',
      violations: [],
      unjudged: ['mattress_size_unreadable'],
    });
  });
});

describe('P5B-05 REQ-PRE-004 protection without its covered item (reuses the Extend cross-check)', () => {
  it('coverage with its covered item on the order is clean', () => {
    expect(judge(detectiveOrder([mattress(1), coverage(2)])).status).toBe(
      'clean',
    );
  });

  it('coverage bought alone is flagged', () => {
    const result = judge(detectiveOrder([coverage(2)]));
    expect(result.violations).toEqual([
      {code: 'coverage-without-covered-item', lineIds: ['2']},
    ]);
  });

  it('coverage that points at a product not on the order is flagged', () => {
    const result = judge(
      detectiveOrder([mattress(1), coverage(2, {coveredProductId: '999'})]),
    );
    expect(codes(result)).toEqual(['coverage-without-covered-item']);
  });

  it('coverage with no plan id or an unreadable covered product id is flagged as unlinked', () => {
    expect(
      codes(
        judge(detectiveOrder([mattress(1), coverage(2, {planId: 'bad id!'})])),
      ),
    ).toEqual(['coverage-unlinked']);
    expect(
      codes(
        judge(
          detectiveOrder([mattress(1), coverage(2, {coveredProductId: 'abc'})]),
        ),
      ),
    ).toEqual(['coverage-unlinked']);
  });

  it('coverage on an ineligible item (no Extend category) is flagged', () => {
    const plain = orderLine({id: 1, productId: P.mattress, category: null});
    expect(codes(judge(detectiveOrder([plain, coverage(2)])))).toEqual([
      'coverage-on-ineligible-item',
    ]);
  });

  it('two coverage lines on one item: the second is flagged', () => {
    const result = judge(
      detectiveOrder([mattress(1), coverage(2), coverage(3)]),
    );
    expect(result.violations).toEqual([
      {code: 'coverage-duplicate', lineIds: ['3']},
    ]);
  });

  it('coverage quantity above the covered quantity is flagged', () => {
    expect(
      codes(judge(detectiveOrder([mattress(1), coverage(2, {quantity: 2})]))),
    ).toEqual(['coverage-quantity-mismatch']);
  });

  it('two lines of the covered product make the link unknowable: "not judged"', () => {
    const result = judge(
      detectiveOrder([mattress(1, 'Queen'), mattress(2, 'King'), coverage(3)]),
    );
    expect(result).toMatchObject({
      status: 'unjudgeable',
      violations: [],
      unjudged: ['coverage_link_ambiguous'],
    });
  });

  it('a plan id on an ordinary line does not hide it or make it coverage', () => {
    const sneaky = orderLine({
      id: 1,
      productId: P.mattress,
      category: 'mattress',
      attributes: {_extend_plan_id: 'MOCK-MATT-ADH-3Y-C'},
    });
    expect(judge(detectiveOrder([sneaky])).status).toBe('clean');
  });

  it('price and plan validity are the Extend sync job: with the sync judging them the structural check alone is clean', () => {
    const cheap = coverage(2, {quantity: 1});
    expect(judge(detectiveOrder([mattress(1), cheap])).status).toBe('clean');
  });
});

describe('P5B-05 REQ-PRE-004 coverage price and plan are not judged by the detective (T-06)', () => {
  const protectedOrder = () => detectiveOrder([mattress(1), coverage(2)]);

  it('with nothing else judging them, an order with protection is "not judged", never clean', () => {
    const result = judge(protectedOrder(), RULES, ZONE, {});
    expect(result).toEqual({
      status: 'unjudgeable',
      orderId: '7001',
      violations: [],
      unjudged: ['coverage_price_unjudged'],
    });
  });

  it('is the default: no options at all reads the same, so a caller cannot forget it', () => {
    expect(detectOrderViolations(protectedOrder(), RULES, ZONE)).toEqual(
      judge(protectedOrder(), RULES, ZONE, {}),
    );
    expect(
      detectWithConfig(protectedOrder(), {
        status: 'ready',
        rules: RULES,
        zone: ZONE,
      }).unjudged,
    ).toEqual(['coverage_price_unjudged']);
  });

  it('a $5 price point on a $2,000 mattress is reported as not judged, not clean', () => {
    const order = detectiveOrder([
      {...mattress(1), unitPriceCents: 200_000, paidUnitPriceCents: 200_000},
      {
        ...coverage(2, {
          sku: 'Extend-Protection-Plan-5.00',
          variantTitle: 'Extend-Protection-Plan-5.00',
        }),
        unitPriceCents: 500,
        paidUnitPriceCents: 500,
      },
    ]);
    const result = judge(order, RULES, ZONE, {});
    expect(result.status).toBe('unjudgeable');
    expect(result.unjudged).toEqual(['coverage_price_unjudged']);
  });

  it('a violation elsewhere still shows, with the unjudged part beside it', () => {
    const result = judge(
      detectiveOrder([mattress(1), coverage(2), haulAway(3, 9)]),
      RULES,
      ZONE,
      {},
    );
    expect(result.status).toBe('violations');
    expect(codes(result)).toContain('haul-away-over-max');
    expect(result.unjudged).toEqual(['coverage_price_unjudged']);
  });

  it('is not said for an order with no protection, or when the sync judges the price', () => {
    expect(judge(detectiveOrder([mattress(1)]), RULES, ZONE, {}).status).toBe(
      'clean',
    );
    expect(
      judge(protectedOrder(), RULES, ZONE, {
        coveragePriceJudgedElsewhere: true,
      }).status,
    ).toBe('clean');
  });

  it('is not said when the protection was fully refunded, or the order cancelled or refunded in full', () => {
    const refunded = coverage(2, {refunded: 1});
    expect(
      judge(detectiveOrder([mattress(1), refunded]), RULES, ZONE, {}).unjudged,
    ).not.toContain('coverage_price_unjudged');
    expect(
      judge(
        detectiveOrder([mattress(1), coverage(2)], {refundState: 'full'}),
        RULES,
        ZONE,
        {},
      ).unjudged,
    ).not.toContain('coverage_price_unjudged');
    expect(
      judge(
        detectiveOrder([mattress(1), coverage(2)], {
          cancelledAt: '2026-10-11T00:00:00Z',
        }),
        RULES,
        ZONE,
        {},
      ).unjudged,
    ).not.toContain('coverage_price_unjudged');
  });
});

describe('P5B-05 fail closed: what cannot be judged is never clean (T-06)', () => {
  it('no offer rules at all: unjudgeable for every order', () => {
    const result = detectWithConfig(detectiveOrder([haulAway(1, 9)]), {
      status: 'unavailable',
      reason: 'no_config',
    });
    expect(result).toEqual({
      status: 'unjudgeable',
      orderId: '7001',
      violations: [],
      unjudged: ['rules_unavailable'],
    });
  });

  it('a ready configuration judges like the plain function', () => {
    const order = detectiveOrder([haulAway(1, 4)]);
    expect(
      detectWithConfig(order, {status: 'ready', rules: RULES, zone: ZONE}),
    ).toEqual(judge(order));
  });

  it('an explicit empty rule set (offers switched off) has nothing to recognise but still checks coverage', () => {
    expect(judge(detectiveOrder([coverage(2)]), EMPTY_OFFER_RULES).status).toBe(
      'violations',
    );
  });

  it.each([
    ['an order id that is not a Shopify id', {id: 'abc'}],
    ['a non-USD order', {currency: 'EUR'}],
  ])('%s', (_name, options) => {
    const result = judge(detectiveOrder([mattress(1)], options));
    expect(result.status).toBe('unjudgeable');
  });

  it('a line with a bad id or quantity is reported, never skipped silently', () => {
    const bad = {...orderLine({id: 1}), id: 'not-an-id'};
    expect(judge(detectiveOrder([bad, mattress(2)]))).toMatchObject({
      status: 'unjudgeable',
      unjudged: expect.arrayContaining(['malformed_lines']),
    });
    const negative = {...orderLine({id: 1}), quantity: -1};
    expect(judge(detectiveOrder([negative])).status).toBe('unjudgeable');
    const fractional = {...orderLine({id: 1}), refundedQuantity: 0.5};
    expect(judge(detectiveOrder([fractional])).status).toBe('unjudgeable');
  });

  it('duplicate line ids are reported as malformed', () => {
    const result = judge(
      detectiveOrder([orderLine({id: 1}), orderLine({id: 1})]),
    );
    expect(result.status).toBe('unjudgeable');
    expect(result.unjudged).toContain('malformed_lines');
  });

  it('more lines than the cap is refused, not sampled', () => {
    const many = Array.from({length: 501}, (_, i) => orderLine({id: i + 1}));
    expect(judge(detectiveOrder(many))).toMatchObject({
      status: 'unjudgeable',
      orderId: 'unknown',
      unjudged: ['invalid_order'],
    });
  });

  it('a hostile input that throws becomes unjudgeable, never an exception and never clean', () => {
    const hostile = detectiveOrder([mattress(1)]);
    const trapped = new Proxy(hostile.order, {
      get(target, property, receiver) {
        if (property === 'lineItems') throw new Error('boom');
        return Reflect.get(target, property, receiver);
      },
    });
    const result = detectOrderViolations(
      {order: trapped, facts: hostile.facts},
      RULES,
      ZONE,
    );
    expect(result).toMatchObject({
      status: 'unjudgeable',
      orderId: '7001',
      unjudged: ['internal_error'],
    });
    const nothing = detectOrderViolations(
      JSON.parse('null') as unknown as DetectiveOrder,
      RULES,
      ZONE,
    );
    expect(nothing).toMatchObject({status: 'unjudgeable', orderId: 'unknown'});
  });

  it('an unreadable order is counted as unjudgeable with the id it had', () => {
    expect(unreadableOrderResult('gid://shopify/Order/42')).toEqual({
      status: 'unjudgeable',
      orderId: '42',
      violations: [],
      unjudged: ['order_unreadable'],
    });
    expect(unreadableOrderResult('<script>').orderId).toBe('unknown');
  });

  it('a violation and an unjudged part together report both', () => {
    const result = judge(
      detectiveOrder([haulAway(1, 9), orderLine({id: 2}), gift(3)]),
      {...RULES, gifts: [GIFT_BY_COLLECTION]},
    );
    expect(result.status).toBe('violations');
    expect(codes(result)).toEqual(['haul-away-over-max']);
  });
});

describe('P5B-05 results carry ids and codes only (T-05)', () => {
  it('no ZIP, name, address or title is ever in a result', () => {
    const order = detectiveOrder(
      [
        haulAway(1, 9),
        {
          ...orderLine({id: 2, title: `${SYNTHETIC_PII.name} special`}),
          attributes: {note: SYNTHETIC_PII.email},
        },
        mattress(3),
        coverage(4, {coveredProductId: '999'}),
      ],
      {zip: OUT_OF_ZONE, attributes: {note: SYNTHETIC_PII.street}},
    );
    const text = JSON.stringify(judge(order));
    for (const secret of [
      OUT_OF_ZONE,
      SYNTHETIC_PII.name,
      SYNTHETIC_PII.email,
      SYNTHETIC_PII.street,
      'Testville',
      'special',
    ]) {
      expect(text).not.toContain(secret);
    }
    expect(JSON.parse(text)).toMatchObject({status: 'violations'});
  });

  it('uses numeric ids, not GIDs, and is stable across calls', () => {
    const order = detectiveOrder([haulAway(1, 9)]);
    const first = judge(order);
    expect(first.violations[0]?.lineIds).toEqual(['1']);
    expect(first.orderId).toBe('7001');
    expect(judge(order)).toEqual(first);
    expect(lineGid(1)).toContain('gid://');
  });
});

describe('P5B-05 parity with the cart gate: same engine, same answer', () => {
  it('every correction the gate would make on the equivalent cart is a violation here', async () => {
    const {evaluateOffers} = await import('~/lib/offers/evaluate');
    const lines = [
      mattress(1, 'Queen'),
      protector(2, V.protKing),
      protector(3, V.protQueen, 3),
      gift(4, V.giftStandard, 2),
      haulAway(5, 4),
    ];
    const order = detectiveOrder(lines);
    const cart = {
      lines: lines.map((line) => ({
        id: line.id,
        variantId: line.variantId ?? '',
        productId: line.productId ?? '',
        quantity: line.quantity,
        attributes: {},
        size: order.facts.sizeByLineId.get(line.id) ?? null,
        parentLineId: null,
      })),
      subtotalCents: 0,
    };
    const gate = evaluateOffers(cart, RULES, {
      zip: IN_ZONE,
      deliveryChoice: 'in-home',
      zone: ZONE,
      protectionEligibleLineIds: [],
    });
    const gateLines = new Set(
      gate.corrections.map((c) => c.lineId.split('/').pop()),
    );
    const detectiveLines = new Set(
      judge(order).violations.flatMap((violation) => violation.lineIds),
    );
    expect(gateLines.size).toBeGreaterThan(0);
    for (const id of gateLines)
      expect(detectiveLines.has(String(id))).toBe(true);
  });
});
