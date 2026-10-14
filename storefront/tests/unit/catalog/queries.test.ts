import {describe, expect, it} from 'vitest';
import {
  catalogCache,
  pricedCache,
  PRICED_MAX_AGE_SECONDS,
  PRICED_STALE_WHILE_REVALIDATE_SECONDS,
} from '~/lib/shopify/cache';
import {MAX_PRODUCT_VARIANTS} from '~/lib/shopify/config';
import {PRODUCT_CARD_FRAGMENT} from '~/lib/shopify/queries';
import {toCacheableTerm} from '~/lib/shopify/search-data';
import {fakeStorefront} from './fake-storefront';

// REQ-COL-001 / REQ-SRCH-002: card queries read every variant, so "From $" is the true lowest price.
describe('product card fragment', () => {
  it('reads as many variants as the product page (a cap would hide a cheaper size)', () => {
    expect(PRODUCT_CARD_FRAGMENT).toContain(
      `variants(first: ${MAX_PRODUCT_VARIANTS})`,
    );
  });
});

// DEC-024: price and availability are never cached for hours.
describe('cache strategies', () => {
  it('uses 60 s fresh and 300 s stale-while-revalidate for priced data', () => {
    const {storefront} = fakeStorefront(() => ({}));
    expect(pricedCache(storefront)).toMatchObject({
      maxAge: 60,
      staleWhileRevalidate: 300,
    });
    expect(PRICED_MAX_AGE_SECONDS).toBe(60);
    expect(PRICED_STALE_WHILE_REVALIDATE_SECONDS).toBe(300);
  });

  it('keeps the long strategy for content that carries no price', () => {
    const {storefront} = fakeStorefront(() => ({}));
    expect(catalogCache(storefront)).toEqual({mode: 'long'});
  });
});

// T-05 and cache hygiene: the term inside the cache key is lower-cased and bounded.
describe('toCacheableTerm', () => {
  it('lower-cases, trims and bounds the term', () => {
    expect(toCacheableTerm('  Queen  FIRM ')).toBe('queen  firm');
    expect(toCacheableTerm('X'.repeat(300))).toBe('x'.repeat(80));
    expect(toCacheableTerm('')).toBe('');
  });
});
