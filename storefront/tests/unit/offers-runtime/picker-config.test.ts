import {describe, expect, it} from 'vitest';
import {
  giftPickerEnabled,
  offerRulesOf,
  parseOfferConfig,
} from '~/lib/offers-runtime/config';

// REQ-PROMO-002 / M1: the bundle rule names the automatic discount that gives it its saving. K-M1: the gift picker flag.
// K-L8 / m10: the parsed rules are reused while the setting text is unchanged.

const BUNDLE = {
  id: 'sleep-set',
  name: 'Sleep set',
  anchorProductId: 'gid://shopify/Product/1',
  members: [
    {
      productId: 'gid://shopify/Product/2',
      quantity: 1,
      variants: {type: 'single', variantId: 'gid://shopify/ProductVariant/20'},
    },
  ],
};

const rulesWith = (bundle: object) =>
  parseOfferConfig({rules: {bundles: [bundle]}}).config.rules.bundles;

describe('bundle discountTitle in the offer configuration (M1)', () => {
  it('keeps a valid title, trimmed', () => {
    expect(
      rulesWith({...BUNDLE, discountTitle: '  Sleep set saving '}),
    ).toEqual([expect.objectContaining({discountTitle: 'Sleep set saving'})]);
  });

  it.each([
    ['missing', undefined],
    ['blank', '   '],
    ['not a string', 7],
    ['too long', 'x'.repeat(500)],
  ])(
    'a %s title leaves the rule without one (no saving figure), not dropped',
    (_n, value) => {
      const [rule] = rulesWith({...BUNDLE, discountTitle: value});
      expect(rule?.id).toBe('sleep-set');
      expect(rule && 'discountTitle' in rule).toBe(false);
    },
  );
});

describe('giftPickerEnabled (K-M1)', () => {
  it.each([
    [{}, false],
    [{PUBLIC_GIFT_PICKER_ENABLED: ''}, false],
    [{PUBLIC_GIFT_PICKER_ENABLED: 'false'}, false],
    [{PUBLIC_GIFT_PICKER_ENABLED: 'TRUE'}, false],
    [{PUBLIC_GIFT_PICKER_ENABLED: 'true'}, true],
  ])('%j is %s', (env, expected) => {
    expect(giftPickerEnabled(env)).toBe(expected);
  });
});

describe('offerRulesOf (m10)', () => {
  const env = (rules: object) => ({
    OFFER_CONFIG_JSON: JSON.stringify({rules}),
  });

  it('returns the same parsed rules for the same setting text, and new ones when it changes', () => {
    const first = offerRulesOf(env({bundles: [BUNDLE]}));
    expect(offerRulesOf(env({bundles: [BUNDLE]}))).toBe(first);
    const changed = offerRulesOf(env({bundles: []}));
    expect(changed).not.toBe(first);
    expect(changed.bundles).toEqual([]);
  });

  it('reads "offers off" and a missing setting as no rules, never from the cache', () => {
    offerRulesOf(env({bundles: [BUNDLE]}));
    expect(offerRulesOf({OFFERS_ENABLED: 'false'}).bundles).toEqual([]);
    expect(offerRulesOf({}).bundles).toEqual([]);
  });
});
