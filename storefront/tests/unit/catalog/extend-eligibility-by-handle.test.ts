import {describe, expect, it} from 'vitest';
import {loadExtendEligibility} from '~/lib/shopify/product-data';
import {fakeStorefront} from './fake-storefront';

// REQ-EXT-005 / NFR-002 / P5A-05: the product page's "has an Extend category" hint reads the same metafield, through
// the same query, as the offers route; a failed read is "unknown", never "not eligible".

const PRODUCT = 'gid://shopify/Product/1';

describe('loadExtendEligibility', () => {
  it.each([
    ['a category', {value: 'mattress'}, true],
    ['no metafield', null, false],
    ['a value that is not a plain label', {value: '<script>'}, false],
  ])('%s -> %s', async (_name, metafield, expected) => {
    const {storefront, calls} = fakeStorefront(() => ({
      nodes: [{id: PRODUCT, metafield}],
    }));
    expect(await loadExtendEligibility(storefront, PRODUCT)).toBe(expected);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.variables).toEqual({ids: [PRODUCT]});
  });

  it('a failed read is unknown (null), and does not throw', async () => {
    const {storefront} = fakeStorefront(() => {
      throw new Error('boom');
    });
    expect(await loadExtendEligibility(storefront, PRODUCT)).toBeNull();
  });
});
