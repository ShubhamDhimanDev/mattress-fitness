import {describe, expect, it} from 'vitest';
import {parseOfferConfig} from '~/lib/offers-runtime/config';
import {offerRulesOf} from '~/lib/offers-runtime/shopify-rules';
import {OFFLINE_ENV, offerEnv} from '~/lib/offers-runtime/test-fixtures';

// REQ-PROMO-002 / M1: the bundle rule names the automatic discount that gives it its saving. The rules come from Shopify (ADR-0013).

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

describe('offerRulesOf (ADR-0013)', () => {
  it('returns the rules the loader holds for the store', async () => {
    const env = offerEnv({rules: {bundles: [BUNDLE]}});
    expect((await offerRulesOf(env)).bundles).toHaveLength(1);
  });

  it('reads an unreadable store and a store with no token as no rules (fail open)', async () => {
    expect((await offerRulesOf(offerEnv({}, 'invalid'))).bundles).toEqual([]);
    expect((await offerRulesOf(OFFLINE_ENV)).bundles).toEqual([]);
  });
});
