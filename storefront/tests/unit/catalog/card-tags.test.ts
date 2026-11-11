import {describe, expect, it} from 'vitest';
import {
  offerTagIndex,
  offerTagOfGift,
  withOfferTags,
} from '~/lib/offers/card-tags';
import type {GiftRule} from '~/lib/offers/types';
import {saleTagLabel} from '~/lib/shopify/pricing';

function gift(name: string, productIds: string[]): GiftRule {
  return {
    id: name,
    name,
    qualifyingProductIds: productIds,
    qualifyingCollectionIds: [],
    giftVariantIdsBySize: {Twin: 'gid://shopify/ProductVariant/1'},
    maxQuantity: 1,
  };
}

describe('offer tags from Shopify gift rules (REQ-COL-001, REQ-PDP-001)', () => {
  it('tells a free adjustable base from any other gift by the discount title', () => {
    expect(offerTagOfGift({name: 'Free adjustable base with Molecule'})).toBe(
      'free-base',
    );
    expect(offerTagOfGift({name: 'Free pillow with a queen mattress'})).toBe(
      'free-gift',
    );
  });

  it('tags only the products a rule names, in a fixed order', () => {
    const index = offerTagIndex([
      gift('Free pillow', ['p1', 'p2']),
      gift('Free adjustable base with Molecule', ['p1']),
    ]);
    const tagged = withOfferTags([{id: 'p1'}, {id: 'p2'}, {id: 'p3'}], index);
    expect(tagged[0]?.offerTags).toEqual(['free-base', 'free-gift']);
    expect(tagged[1]?.offerTags).toEqual(['free-gift']);
    expect(tagged[2]).toEqual({id: 'p3'});
  });

  it('shows no tag without rules', () => {
    expect(withOfferTags([{id: 'p1'}], offerTagIndex([]))).toEqual([
      {id: 'p1'},
    ]);
  });
});

describe('sale tag (REQ-COL-001, REQ-PDP-001)', () => {
  const usd = (amount: string) => ({amount, currencyCode: 'USD' as const});

  it('names the saving in dollars only when compare-at is above price', () => {
    expect(saleTagLabel(usd('499.00'), usd('799.00'))).toBe('Save $300 Today!');
    expect(saleTagLabel(usd('499.00'), usd('499.00'))).toBeNull();
    expect(saleTagLabel(usd('499.00'), null)).toBeNull();
  });
});
