import {describe, expect, it} from 'vitest';
import {fakeStorefront} from '../catalog/fake-storefront';
import {CART_QUERY_FRAGMENT} from '~/lib/fragments';
import {
  loadExtendCartInputs,
  type SeamCart,
} from '~/lib/offers-runtime/extend-seam';

// N-L1: with Extend off, coverage is recognised from the cart data alone. The catalog read matches SKU, variant title and
// product title, so the cart query must carry the SKU too, and the name check must use it.

const OFF = {PUBLIC_EXTEND_ENABLED: 'false'};
const runtime = () => ({
  storefront: fakeStorefront(() => ({})).storefront,
  env: OFF,
  production: true,
});

const line = (
  id: string,
  variant: string,
  merchandise: Record<string, unknown> = {},
) => ({
  id,
  quantity: 1,
  merchandise: {
    id: variant,
    title: 'Default Title',
    price: {amount: '10.00', currencyCode: 'USD'},
    product: {
      id: `gid://shopify/Product/${variant.split('/').pop()}`,
      title: 'Some product',
    },
    ...merchandise,
  },
});

describe('N-L1 coverage recognition by SKU with Extend off', () => {
  it('asks the cart query for the variant SKU (both line fragments)', () => {
    expect(CART_QUERY_FRAGMENT.match(/\n\s+sku\n/g)).toHaveLength(2);
  });

  it('recognises a line whose ONLY price-point name is its SKU', async () => {
    const cart: SeamCart = {
      lines: {
        nodes: [
          line('l1', 'gid://shopify/ProductVariant/1'),
          line('l2', 'gid://shopify/ProductVariant/2', {
            sku: 'Extend-Protection-Plan-14.99',
          }),
        ],
      },
    };
    const outcome = await loadExtendCartInputs(runtime(), cart);
    expect(outcome.status).toBe('disabled');
    expect([...outcome.inputs.coverageVariantIds]).toEqual([
      'gid://shopify/ProductVariant/2',
    ]);
    expect(outcome.coverageLinesInCart).toBe(true);
  });

  it('ignores a null, unrelated or lookalike SKU', async () => {
    const cart: SeamCart = {
      lines: {
        nodes: [
          line('l1', 'gid://shopify/ProductVariant/1', {sku: null}),
          line('l2', 'gid://shopify/ProductVariant/2', {sku: 'MATT-QUEEN'}),
          line('l3', 'gid://shopify/ProductVariant/3', {
            sku: 'extend-protection-plan-14.99',
          }),
          line('l4', 'gid://shopify/ProductVariant/4', {
            sku: 'Extend-Protection-Plan-14.999',
          }),
        ],
      },
    };
    const outcome = await loadExtendCartInputs(runtime(), cart);
    expect(outcome.inputs.coverageVariantIds.size).toBe(0);
    expect(outcome.coverageLinesInCart).toBe(false);
  });
});
