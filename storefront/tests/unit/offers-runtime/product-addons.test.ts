import {describe, expect, it} from 'vitest';
import {fakeStorefront} from '../catalog/fake-storefront';
import {
  hasDevAddOnsCookie,
  isProductGid,
  itemsForSize,
  readProductAddOnsAnswer,
  variantIdsInCart,
  type ProductAddOnItem,
} from '~/lib/offers-runtime/product-addons';
import {
  loadProductAddOns,
  productHasAddOns,
} from '~/lib/offers-runtime/product-addons-server';
import {
  CONFIG,
  GID,
  storefrontResponder,
} from '~/lib/offers-runtime/test-fixtures';

// REQ-ADD-001 / REQ-CAT-007 (P4-03): the product page's add-on slot. The rules are the admin-configured relations the
// cart engine uses; prices and stock are Shopify's. Mock-green only: no development store exists, and mock.shop answers
// no nodes() lookups, so none of this has run against live data.

const RULES = {
  ...CONFIG.rules,
  matchingAddOns: {
    foundations: [
      {
        mattressProductId: GID.mattress,
        size: 'Queen',
        productId: GID.foundation,
        variantId: GID.foundationQueen,
      },
      {
        mattressProductId: GID.mattress,
        size: 'King',
        productId: GID.foundation,
        variantId: GID.foundationKing,
      },
    ],
    // Not offered on the product page (cart only): a pillow relation must never leak into the slot.
    pillows: CONFIG.rules.matchingAddOns.pillows,
  },
};
const ENV = {OFFER_CONFIG_JSON: JSON.stringify({...CONFIG, rules: RULES})};

function item(
  variantId: string,
  size: string | null,
  title = 'Foundation',
): ProductAddOnItem {
  return {
    category: 'foundation',
    size,
    variant: {
      variantId,
      productTitle: title,
      productHandle: 'foundation',
      variantTitle: size,
      price: {amount: '49.00', currencyCode: 'USD'},
    },
  };
}

describe('itemsForSize (REQ-ADD-001: changing the size swaps the offered variants)', () => {
  const items = [
    item(GID.foundationQueen, 'Queen'),
    item(GID.foundationKing, 'King'),
    item('gid://shopify/ProductVariant/80', null, 'Universal frame'),
  ];

  it.each([
    ['Queen', [GID.foundationQueen, 'gid://shopify/ProductVariant/80']],
    ['King', [GID.foundationKing, 'gid://shopify/ProductVariant/80']],
    ['  queen ', [GID.foundationQueen, 'gid://shopify/ProductVariant/80']],
    // No matching size: only what fits every size is offered.
    ['Twin', ['gid://shopify/ProductVariant/80']],
    [null, ['gid://shopify/ProductVariant/80']],
  ])('size %j offers %j', (size, expected) => {
    expect(
      itemsForSize(items, size).map((entry) => entry.variant.variantId),
    ).toEqual(expected);
  });

  it('offers nothing when no item fits (nothing is shown)', () => {
    expect(itemsForSize([item(GID.foundationKing, 'King')], 'Queen')).toEqual(
      [],
    );
    expect(itemsForSize([], 'Queen')).toEqual([]);
  });

  it('lists a variant once even when two relations name it', () => {
    expect(
      itemsForSize(
        [item(GID.foundationQueen, 'Queen'), item(GID.foundationQueen, null)],
        'Queen',
      ),
    ).toHaveLength(1);
  });

  it('does not mix Twin and Twin XL', () => {
    expect(
      itemsForSize([item(GID.foundationQueen, 'Twin XL')], 'Twin'),
    ).toEqual([]);
  });
});

describe('productHasAddOns (rules only, no Shopify read)', () => {
  it('is true for a mattress product with foundation relations', () => {
    expect(productHasAddOns(ENV, GID.mattress)).toBe(true);
  });

  it.each([
    ['a product with no relation', ENV, GID.other],
    ['offers switched off', {...ENV, OFFERS_ENABLED: 'false'}, GID.mattress],
    ['no configuration', {}, GID.mattress],
    ['an unreadable configuration', {OFFER_CONFIG_JSON: '{nope'}, GID.mattress],
  ])('is false for %s', (_name, env, productId) => {
    expect(productHasAddOns(env, productId)).toBe(false);
  });

  it('is false for a product that has only pillow relations (cart only)', () => {
    const env = {
      OFFER_CONFIG_JSON: JSON.stringify({
        ...CONFIG,
        rules: {
          ...CONFIG.rules,
          matchingAddOns: {pillows: CONFIG.rules.matchingAddOns.pillows},
        },
      }),
    };
    expect(productHasAddOns(env, GID.mattress)).toBe(false);
  });
});

/** The items of an answer that must be a list; a failure to read is a test failure here, not an empty list. */
async function listed(
  read: ReturnType<typeof loadProductAddOns>,
): Promise<readonly ProductAddOnItem[]> {
  const answer = await read;
  if (answer.status !== 'ok') throw new Error('expected a list');
  return answer.items;
}

describe('loadProductAddOns (REQ-ADD-001, REQ-CAT-007)', () => {
  it('offers the in-stock foundations of every size with the price Shopify returned, and not the pillow', async () => {
    const {storefront, calls} = fakeStorefront(storefrontResponder());
    const items = await listed(
      loadProductAddOns(storefront, ENV, GID.mattress),
    );
    expect(items.map((entry) => [entry.size, entry.variant.variantId])).toEqual(
      [
        ['Queen', GID.foundationQueen],
        ['King', GID.foundationKing],
      ],
    );
    expect(items[0]?.variant.price).toEqual({
      amount: '49.00',
      currencyCode: 'USD',
    });
    // One lookup of exactly the related variants, in the priced 60 s window (DEC-024), nothing personal in the key.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.variables).toEqual({
      ids: [GID.foundationQueen, GID.foundationKing],
    });
    expect(calls[0]?.cache).toMatchObject({maxAge: 60});
  });

  it('never offers a sold-out variant', async () => {
    const {storefront} = fakeStorefront(
      storefrontResponder({soldOut: [GID.foundationKing]}),
    );
    const items = await listed(
      loadProductAddOns(storefront, ENV, GID.mattress),
    );
    expect(items.map((entry) => entry.variant.variantId)).toEqual([
      GID.foundationQueen,
    ]);
  });

  it('offers nothing when every related variant is sold out', async () => {
    const {storefront} = fakeStorefront(
      storefrontResponder({soldOut: [GID.foundationQueen, GID.foundationKing]}),
    );
    expect(
      await listed(loadProductAddOns(storefront, ENV, GID.mattress)),
    ).toEqual([]);
  });

  it.each([
    ['a product that is not a mattress with add-ons', ENV, GID.other],
    ['offers switched off', {...ENV, OFFERS_ENABLED: 'false'}, GID.mattress],
    ['no configuration', {}, GID.mattress],
  ])('offers nothing, and reads nothing, for %s', async (_name, env, id) => {
    const {storefront, calls} = fakeStorefront(storefrontResponder());
    expect(await listed(loadProductAddOns(storefront, env, id))).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('a failed Shopify read is reported as unavailable, not as an empty list, and does not throw', async () => {
    const {storefront} = fakeStorefront(() => {
      throw new Error('upstream down');
    });
    const answer = await loadProductAddOns(storefront, ENV, GID.mattress);
    expect(answer).toEqual({status: 'unavailable'});
  });
});

describe('readProductAddOnsAnswer (the browser trusts nothing it did not check)', () => {
  const good = item(GID.foundationQueen, 'Queen');

  it('reads a well-formed answer', () => {
    expect(readProductAddOnsAnswer({status: 'ok', items: [good]})).toEqual({
      status: 'ok',
      items: [good],
    });
  });

  it('keeps only the known fields of an item', () => {
    const answer = readProductAddOnsAnswer({
      status: 'ok',
      items: [{...good, quantity: 50, discount: 'FREE'}],
    });
    expect(answer?.items[0]).toEqual(good);
  });

  it.each([
    ['null', null],
    ['an array', []],
    ['an invalid-status answer', {status: 'invalid'}],
    ['items that are not a list', {status: 'ok', items: 'x'}],
  ])('treats %s as an error', (_name, body) => {
    expect(readProductAddOnsAnswer(body)).toBeNull();
  });

  it.each([
    [
      'a variant id that is not a variant',
      {...good, variant: {...good.variant, variantId: 'abc'}},
    ],
    [
      'a price without an amount',
      {...good, variant: {...good.variant, price: {currencyCode: 'USD'}}},
    ],
    ['a category the page does not offer', {...good, category: 'pillow'}],
    ['a size that is a number', {...good, size: 5}],
  ])('drops an item with %s and keeps the rest', (_name, bad) => {
    const answer = readProductAddOnsAnswer({status: 'ok', items: [bad, good]});
    expect(answer?.items).toEqual([good]);
  });
});

describe('variantIdsInCart (what the row treats as added)', () => {
  const cart = (...ids: string[]) => ({
    lines: {nodes: ids.map((id) => ({merchandise: {id}}))},
  });

  it('lists the variant ids on the cart lines', () => {
    expect(variantIdsInCart(cart('a', 'b'))).toEqual(new Set(['a', 'b']));
  });

  it('treats no cart as an empty cart', () => {
    expect(variantIdsInCart(null)).toEqual(new Set());
  });

  it.each([
    ['undefined', undefined],
    ['a string', 'cart'],
    ['no lines', {}],
    ['lines without nodes', {lines: {}}],
  ])('treats %s as unknown, so nothing is claimed as added', (_name, value) => {
    expect(variantIdsInCart(value)).toBeNull();
  });

  it('skips a line with no merchandise', () => {
    expect(
      variantIdsInCart({
        lines: {nodes: [{merchandise: null}, {}, {merchandise: {id: 'a'}}]},
      }),
    ).toEqual(new Set(['a']));
  });
});

describe('small guards', () => {
  it.each([
    ['gid://shopify/Product/1', true],
    ['gid://shopify/Product/0', false],
    ['gid://shopify/ProductVariant/1', false],
    ['gid://shopify/Product/1?x=1', false],
    ['', false],
    [null, false],
  ])('isProductGid(%j) is %s', (value, expected) => {
    expect(isProductGid(value)).toBe(expected);
  });

  it.each([
    ['e2e_addons_expected=1', true],
    ['a=b; e2e_addons_expected=1', true],
    ['e2e_addons_expected=1; a=b', true],
    ['e2e_addons_expected=0', false],
    ['xe2e_addons_expected=1', false],
    ['', false],
  ])('hasDevAddOnsCookie(%j) is %s', (header, expected) => {
    expect(hasDevAddOnsCookie(header)).toBe(expected);
  });
});
