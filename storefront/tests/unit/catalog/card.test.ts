import {describe, expect, it} from 'vitest';
import type {CatalogProductCardFragment} from 'storefrontapi.generated';
import collection from '../../fixtures/shopify/collection.json';
import {recorded} from './recorded';
import {mapProductCard, mapProductCards} from '~/lib/shopify/card';

// REQ-COL-001: "From $" is the lowest available variant price; a sale badge needs compare-at above price.
// The base product is recorded from bedding.mock.shop; the other cases edit a copy of it.

const base = recorded<CatalogProductCardFragment>(
  collection.collection.products.nodes[0],
);

function card(
  edit: (product: CatalogProductCardFragment) => void = () => {},
): CatalogProductCardFragment {
  const copy = structuredClone(base);
  edit(copy);
  return copy;
}

describe('mapProductCard (REQ-COL-001)', () => {
  it('maps a recorded product with no metafields', () => {
    const view = mapProductCard(card());
    expect(view.handle).toBe('linen-pillowcase-pair-in-warm-clay');
    expect(view.price).toEqual({amount: '75.0', currencyCode: 'USD'});
    expect(view.compareAt).toBeNull();
    expect(view.soldOut).toBe(false);
    expect(view.sizes).toEqual(['Twin', 'Full', 'Queen', 'King']);
    expect(view.comfortLevel).toBeNull();
    expect(view.mattressType).toBeNull();
    expect(view.benefits).toEqual([]);
    expect(view.productLine).toBeNull();
    expect(view.rating).toBeNull();
    expect(view.image?.url.startsWith('https://')).toBe(true);
  });

  it('says "From" only when buyable variants have different prices', () => {
    expect(mapProductCard(card()).priceIsFrom).toBe(true);
    const sameFee = card((p) => {
      for (const v of p.variants.nodes)
        v.price = {amount: '75.0', currencyCode: 'USD'};
    });
    expect(mapProductCard(sameFee).priceIsFrom).toBe(false);
  });

  it('uses the lowest AVAILABLE variant price, not the lowest overall', () => {
    const view = mapProductCard(
      card((p) => {
        for (const v of p.variants.nodes) {
          if (v.price.amount === '75.0') v.availableForSale = false;
        }
      }),
    );
    expect(view.price?.amount).toBe('78.75');
    expect(view.soldOut).toBe(false);
  });

  it('is sold out with no price when no variant can be bought', () => {
    const view = mapProductCard(
      card((p) => {
        for (const v of p.variants.nodes) v.availableForSale = false;
      }),
    );
    expect(view.soldOut).toBe(true);
    expect(view.price).toBeNull();
    expect(view.compareAt).toBeNull();
  });

  it.each([
    ['compare-at above price', '99.0', '99.0'],
    ['compare-at equal to price', '75.0', null],
    ['compare-at below price', '60.0', null],
  ])('sale: %s', (_name, compareAt, expected) => {
    const view = mapProductCard(
      card((p) => {
        for (const v of p.variants.nodes) {
          if (v.price.amount === '75.0') {
            v.compareAtPrice = {amount: compareAt, currencyCode: 'USD'};
          }
        }
      }),
    );
    expect(view.compareAt?.amount ?? null).toBe(expected);
  });

  it('ignores the compare-at of a variant that is not the lowest available one', () => {
    const view = mapProductCard(
      card((p) => {
        const dearer = p.variants.nodes.find((v) => v.price.amount === '86.25');
        if (dearer)
          dearer.compareAtPrice = {amount: '120.0', currencyCode: 'USD'};
      }),
    );
    expect(view.compareAt).toBeNull();
  });

  it('skips a variant whose price is malformed (hostile data)', () => {
    const view = mapProductCard(
      card((p) => {
        p.variants.nodes[0].price = {amount: 'NaN', currencyCode: 'USD'};
      }),
    );
    expect(view.price?.amount).toBe('75.0'); // other twin colours
  });

  it('reads attribute metafields only when valid', () => {
    const view = mapProductCard(
      card((p) => {
        p.metafields = [
          {key: 'comfort_level', value: 'medium'},
          {key: 'mattress_type', value: 'Waterbed'},
          {key: 'benefits', value: '["Cooling","Magic","Pressure Relief"]'},
          {key: 'product_line', value: '  Signature  '},
        ];
      }),
    );
    expect(view.comfortLevel).toBe('Medium');
    expect(view.mattressType).toBeNull();
    expect(view.benefits).toEqual(['Cooling', 'Pressure Relief']);
    expect(view.productLine).toBe('Signature');
  });

  it('handles a product with a single variant and no Size option', () => {
    const view = mapProductCard(
      card((p) => {
        p.variants.nodes = [
          {
            id: 'gid://shopify/ProductVariant/1',
            availableForSale: true,
            price: {amount: '19.99', currencyCode: 'USD'},
            compareAtPrice: null,
            selectedOptions: [{name: 'Title', value: 'Default Title'}],
          },
        ];
      }),
    );
    expect(view.price?.amount).toBe('19.99');
    expect(view.priceIsFrom).toBe(false);
    expect(view.sizes).toEqual([]);
  });

  it('keeps unknown sizes after the standard ones', () => {
    const view = mapProductCard(
      card((p) => {
        p.variants.nodes[0].selectedOptions = [{name: 'size', value: 'Crib'}];
      }),
    );
    expect(view.sizes.at(-1)).toBe('Crib');
    expect(view.sizes.slice(0, 4)).toEqual(['Twin', 'Full', 'Queen', 'King']);
  });

  it('drops images that are not https', () => {
    const view = mapProductCard(
      card((p) => {
        if (p.featuredImage) p.featuredImage.url = 'http://cdn.example/a.png';
      }),
    );
    expect(view.image).toBeNull();
  });
});

describe('mapProductCards', () => {
  it('skips search nodes that are not products', () => {
    const nodes: object[] = [{}, card(), {}];
    expect(mapProductCards(nodes)).toHaveLength(1);
  });

  it('maps every product of a recorded collection page', () => {
    const cards = mapProductCards(collection.collection.products.nodes);
    expect(cards.map((c) => c.handle)).toEqual(
      collection.collection.products.nodes.map((n) => n.handle),
    );
    for (const view of cards) expect(view.price).not.toBeNull();
  });
});
