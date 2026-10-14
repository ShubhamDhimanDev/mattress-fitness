import {describe, expect, it} from 'vitest';
import {detectiveConfigFromOffers} from '~/lib/detective/config';
import {
  detectOrderViolations,
  unreadableOrderResult,
} from '~/lib/detective/detect';
import {summarizeResults} from '~/lib/detective/report';
import {
  OUT_OF_ZONE,
  RULES,
  ZONE,
  detectiveOrder,
  gift,
  haulAway,
  mattress,
} from '~/lib/detective/test-fixtures';
import {
  EMPTY_OFFER_CONFIG,
  parseOfferConfig,
} from '~/lib/offers-runtime/config';

// P5B-05: the summary behind the report script, and the mapping from the cart gate's configuration.

describe('P5B-05 summarizeResults', () => {
  it('counts clean, violating and unjudgeable orders and lists only those that need a person', () => {
    const results = [
      detectOrderViolations(
        detectiveOrder([mattress(1)], {id: 'gid://shopify/Order/1'}),
        RULES,
        ZONE,
      ),
      detectOrderViolations(
        detectiveOrder([haulAway(1, 9), gift(2)], {
          id: 'gid://shopify/Order/2',
          zip: OUT_OF_ZONE,
        }),
        RULES,
        ZONE,
      ),
      unreadableOrderResult('gid://shopify/Order/3'),
      detectOrderViolations(
        detectiveOrder([haulAway(1, 1)], {id: 'gid://shopify/Order/4'}),
        RULES,
        null,
      ),
    ];
    const report = summarizeResults(results);
    expect(report.checkedOrders).toBe(4);
    expect(report.counts).toEqual({clean: 1, violations: 1, unjudgeable: 2});
    expect(report.clean).toBe(false);
    expect(report.findings.map((f) => [f.orderId, f.status])).toEqual([
      ['2', 'violations'],
      ['3', 'unjudgeable'],
      ['4', 'unjudgeable'],
    ]);
    expect(report.byCode).toEqual(
      expect.arrayContaining([
        {code: 'haul-away-outside-zone', orders: 1},
        {code: 'haul-away-over-max', orders: 1},
        {code: 'gift-without-qualifier', orders: 1},
      ]),
    );
    expect(report.unjudgedByReason).toEqual(
      expect.arrayContaining([
        {reason: 'order_unreadable', orders: 1},
        {reason: 'zone_unavailable', orders: 1},
      ]),
    );
  });

  it('is clean only when every order was judged and none has a violation: unjudged is never clean', () => {
    expect(summarizeResults([]).clean).toBe(true);
    expect(summarizeResults([unreadableOrderResult('5')]).clean).toBe(false);
    const clean = detectOrderViolations(
      detectiveOrder([mattress(1)]),
      RULES,
      ZONE,
    );
    expect(summarizeResults([clean, clean])).toMatchObject({
      clean: true,
      counts: {clean: 2},
      findings: [],
    });
  });

  it('serialises to ids and codes only', () => {
    const result = detectOrderViolations(
      detectiveOrder([haulAway(1, 9)], {zip: OUT_OF_ZONE}),
      RULES,
      ZONE,
    );
    const text = JSON.stringify(summarizeResults([result]));
    expect(text).not.toContain(OUT_OF_ZONE);
    expect(text).not.toContain('Testville');
  });
});

describe('P5B-05 detectiveConfigFromOffers', () => {
  it('uses the same rules and zone as the cart gate', () => {
    const load = parseOfferConfig({
      rules: {
        haulAway: {variantId: 'gid://shopify/ProductVariant/621', maxPieces: 3},
      },
      zone: {name: 'Metro', postalCodes: '606*', feeCents: 14900},
    });
    const config = detectiveConfigFromOffers(load);
    expect(config).toMatchObject({status: 'ready'});
    if (config.status === 'ready') {
      expect(config.rules.haulAway?.maxPieces).toBe(3);
      expect(config.zone?.postalCodes).toEqual(['606*']);
    }
  });

  it('a missing or invalid configuration leaves the check unavailable, never an empty "ready" one', () => {
    expect(
      detectiveConfigFromOffers({
        status: 'none',
        config: EMPTY_OFFER_CONFIG,
        warnings: [],
      }),
    ).toEqual({status: 'unavailable', reason: 'no_config'});
    expect(
      detectiveConfigFromOffers({
        status: 'invalid',
        config: EMPTY_OFFER_CONFIG,
        warnings: ['x'],
      }),
    ).toEqual({status: 'unavailable', reason: 'invalid_config'});
  });
});
