import {describe, expect, it, vi} from 'vitest';
import {loadExtendEligibilityByHandle} from '~/lib/shopify/protection-load';
import {fakeStorefront} from './fake-storefront';

// REQ-EXT-005 / NFR-002 / P5A-05: the product page's "has an Extend category" hint reads the metafield by handle and
// validates it with the parser the offers route uses; a failed read is "unknown", never "not eligible".

const PRODUCT = 'gid://shopify/Product/1';

describe('loadExtendEligibilityByHandle', () => {
  it.each([
    ['a category', {value: 'mattress'}, true],
    ['no metafield', null, false],
    ['a value that is not a plain label', {value: '<script>'}, false],
  ])('%s -> %s', async (_name, metafield, expected) => {
    const {storefront, calls} = fakeStorefront(() => ({
      product: {id: PRODUCT, metafield},
    }));
    expect(await loadExtendEligibilityByHandle(storefront, 'queen-bed')).toBe(
      expected,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.variables).toEqual({handle: 'queen-bed'});
    // Priced window (DEC-024): never the long cache, never uncached.
    expect(calls[0]?.cache).toMatchObject({mode: 'public', maxAge: 60});
  });

  it('an unknown handle (no product) is not eligible', async () => {
    const {storefront} = fakeStorefront(() => ({product: null}));
    expect(await loadExtendEligibilityByHandle(storefront, 'nope')).toBe(false);
  });

  it('an invalid handle makes no request', async () => {
    const {storefront, calls} = fakeStorefront(() => ({product: null}));
    expect(await loadExtendEligibilityByHandle(storefront, '../etc')).toBe(
      false,
    );
    expect(calls).toHaveLength(0);
  });

  it('a failed read is unknown (null), and does not throw', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const {storefront} = fakeStorefront(() => {
      throw new Error('boom');
    });
    expect(
      await loadExtendEligibilityByHandle(storefront, 'queen-bed'),
    ).toBeNull();
  });
});
