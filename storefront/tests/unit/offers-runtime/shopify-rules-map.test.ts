import {describe, expect, it} from 'vitest';
import {parseOfferConfig} from '~/lib/offers-runtime/config';
import {
  buildRawOfferConfig,
  centsOfMoney,
  giftProductIdsOf,
  giftsFromDiscounts,
  productInfoOf,
  referencedIds,
  zoneFromMetaobject,
  type ProductInfo,
} from '~/lib/offers-runtime/shopify-rules-map';

// ADR-0013, REQ-PROMO-001, REQ-CART-002, REQ-PRE-002, REQ-PRE-003, REQ-DEL-001: what Shopify's Admin API says becomes the
// raw rule JSON, and that JSON must pass the strict validator without a dropped entry. Fake answers only: nothing here
// has run against a store (V-03, V-05).

const MATTRESS = 'gid://shopify/Product/1';
const MATTRESS_2 = 'gid://shopify/Product/2';
const PILLOW = 'gid://shopify/Product/30';
const PROTECTOR = 'gid://shopify/Product/40';
const SERVICE = 'gid://shopify/Product/50';
const FOUNDATION = 'gid://shopify/Product/60';
const COLLECTION = 'gid://shopify/Collection/7';

const variant = (
  id: number,
  size: string | null,
  title = size ?? 'Default Title',
) => ({
  id: `gid://shopify/ProductVariant/${id}`,
  title,
  selectedOptions: size === null ? [] : [{name: 'Size', value: size}],
});

const productNode = (
  id: string,
  title: string,
  variants: ReturnType<typeof variant>[],
) => ({id, title, variants: {nodes: variants}});

type DiscountOverrides = {
  title?: string;
  status?: string;
  typename?: string;
  usesPerOrderLimit?: string | null;
  buysValue?: object;
  buysItems?: object;
  getsValue?: object;
  getsItems?: object;
};

function discountNode(
  over: DiscountOverrides = {},
  nodeId = 'gid://shopify/DiscountAutomaticNode/1',
) {
  return {
    id: nodeId,
    discount: {
      __typename: over.typename ?? 'DiscountAutomaticBxgy',
      title: over.title ?? 'Free pillow with a mattress',
      status: over.status ?? 'ACTIVE',
      usesPerOrderLimit: over.usesPerOrderLimit ?? null,
      customerBuys: {
        value: over.buysValue ?? {
          __typename: 'DiscountQuantity',
          quantity: '1',
        },
        items: over.buysItems ?? {
          __typename: 'DiscountProducts',
          products: {nodes: [{id: MATTRESS}]},
          productVariants: {nodes: []},
        },
      },
      customerGets: {
        value: over.getsValue ?? {
          __typename: 'DiscountOnQuantity',
          quantity: {quantity: '1'},
          effect: {__typename: 'DiscountPercentage', percentage: 1},
        },
        items: over.getsItems ?? {
          __typename: 'DiscountProducts',
          products: {
            nodes: [
              productNode(PILLOW, 'Gift pillow', [
                variant(301, 'Queen'),
                variant(302, 'King'),
              ]),
            ],
          },
          productVariants: {nodes: []},
        },
      },
    },
  };
}

const discounts = (...nodes: unknown[]) => ({discountNodes: {nodes}});

function collect() {
  const warnings: string[] = [];
  return {warnings, warn: (note: string) => warnings.push(note)};
}

describe('giftsFromDiscounts (REQ-PROMO-001, REQ-CART-002)', () => {
  it('turns an active Buy X get Y into a gift rule with sizes from the Size option', () => {
    const {warnings, warn} = collect();
    const gifts = giftsFromDiscounts(discounts(discountNode()), warn);
    expect(warnings).toEqual([]);
    expect(gifts).toEqual([
      {
        id: 'gid://shopify/DiscountAutomaticNode/1',
        name: 'Free pillow with a mattress',
        qualifyingProductIds: [MATTRESS],
        qualifyingCollectionIds: [],
        giftVariantIdsBySize: {
          Queen: 'gid://shopify/ProductVariant/301',
          King: 'gid://shopify/ProductVariant/302',
        },
        maxQuantity: 1,
      },
    ]);
  });

  it('passes the strict validator with no dropped entry (the contract with parseOfferConfig)', () => {
    const {warn} = collect();
    const gifts = giftsFromDiscounts(discounts(discountNode()), warn);
    const parsed = parseOfferConfig({rules: {gifts}});
    expect(parsed.status).toBe('ok');
    expect(parsed.warnings).toEqual([]);
    expect(parsed.config.rules.gifts).toHaveLength(1);
  });

  it('qualifies by collection when the discount does', () => {
    const {warn} = collect();
    const [gift] = giftsFromDiscounts(
      discounts(
        discountNode({
          buysItems: {
            __typename: 'DiscountCollections',
            collections: {nodes: [{id: COLLECTION}]},
          },
        }),
      ),
      warn,
    );
    expect(gift).toMatchObject({
      qualifyingProductIds: [],
      qualifyingCollectionIds: [COLLECTION],
    });
  });

  it('multiplies the get quantity by "maximum uses per order", and defaults to one use', () => {
    const {warn} = collect();
    const getsValue = (quantity: string) => ({
      __typename: 'DiscountOnQuantity',
      quantity: {quantity},
      effect: {__typename: 'DiscountPercentage', percentage: 1},
    });
    const [limited] = giftsFromDiscounts(
      discounts(
        discountNode({usesPerOrderLimit: '3', getsValue: getsValue('2')}),
      ),
      warn,
    );
    expect(limited?.maxQuantity).toBe(6);
    const [unlimited] = giftsFromDiscounts(
      discounts(discountNode({getsValue: getsValue('2')})),
      warn,
    );
    // Shopify repeats an unlimited discount per set of buys; the cap stays conservative.
    expect(unlimited?.maxQuantity).toBe(2);
  });

  it('keys a product without a Size option by its title ("Default Title" reads as Standard)', () => {
    const {warn} = collect();
    const [plain] = giftsFromDiscounts(
      discounts(
        discountNode({
          getsItems: {
            __typename: 'DiscountProducts',
            products: {
              nodes: [productNode(PILLOW, 'Gift', [variant(301, null)])],
            },
            productVariants: {nodes: []},
          },
        }),
      ),
      warn,
    );
    expect(plain?.giftVariantIdsBySize).toEqual({
      Standard: 'gid://shopify/ProductVariant/301',
    });
    const [titled] = giftsFromDiscounts(
      discounts(
        discountNode({
          getsItems: {
            __typename: 'DiscountProducts',
            products: {
              nodes: [
                productNode(PILLOW, 'Gift', [variant(301, null, 'Silk cover')]),
              ],
            },
            productVariants: {nodes: []},
          },
        }),
      ),
      warn,
    );
    expect(titled?.giftVariantIdsBySize).toEqual({
      'Silk cover': 'gid://shopify/ProductVariant/301',
    });
  });

  it('uses only the variants the discount names when it names some', () => {
    const {warn} = collect();
    const [gift] = giftsFromDiscounts(
      discounts(
        discountNode({
          getsItems: {
            __typename: 'DiscountProducts',
            products: {nodes: []},
            productVariants: {
              nodes: [
                {
                  ...variant(302, 'King'),
                  product: {id: PILLOW, title: 'Gift pillow'},
                },
              ],
            },
          },
        }),
      ),
      warn,
    );
    expect(gift?.giftVariantIdsBySize).toEqual({
      King: 'gid://shopify/ProductVariant/302',
    });
  });

  it('prefixes the product title when two gift products share a size, so one does not overwrite the other', () => {
    const {warn} = collect();
    const [gift] = giftsFromDiscounts(
      discounts(
        discountNode({
          getsItems: {
            __typename: 'DiscountProducts',
            products: {
              nodes: [
                productNode(PILLOW, 'Pillow', [variant(301, 'Queen')]),
                productNode(PROTECTOR, 'Protector', [variant(401, 'Queen')]),
              ],
            },
            productVariants: {nodes: []},
          },
        }),
      ),
      warn,
    );
    expect(Object.keys(gift?.giftVariantIdsBySize ?? {}).sort()).toEqual([
      'Pillow Queen',
      'Protector Queen',
    ]);
  });

  it.each([
    [
      'a spend condition (the engine cannot evaluate it)',
      {buysValue: {__typename: 'DiscountPurchaseAmount', amount: '999.0'}},
    ],
    [
      'a buy quantity above one',
      {buysValue: {__typename: 'DiscountQuantity', quantity: '2'}},
    ],
    [
      'a discount below 100%',
      {
        getsValue: {
          __typename: 'DiscountOnQuantity',
          quantity: {quantity: '1'},
          effect: {__typename: 'DiscountPercentage', percentage: 0.5},
        },
      },
    ],
    [
      'a fixed-amount effect',
      {
        getsValue: {
          __typename: 'DiscountOnQuantity',
          quantity: {quantity: '1'},
          effect: {__typename: 'DiscountAmount'},
        },
      },
    ],
    [
      'buys that are not specific products or collections',
      {buysItems: {__typename: 'AllDiscountItems', allItems: true}},
    ],
    [
      'no gift variants',
      {
        getsItems: {
          __typename: 'DiscountProducts',
          products: {nodes: []},
          productVariants: {nodes: []},
        },
      },
    ],
  ])('skips %s with a warning, and offers no gift', (_name, over) => {
    const {warnings, warn} = collect();
    expect(giftsFromDiscounts(discounts(discountNode(over)), warn)).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/gift discount skipped/);
  });

  it('ignores inactive discounts and other discount types without a warning', () => {
    const {warnings, warn} = collect();
    expect(
      giftsFromDiscounts(
        discounts(
          discountNode({status: 'EXPIRED'}),
          discountNode({typename: 'DiscountAutomaticBasic'}),
          'not a node',
        ),
        warn,
      ),
    ).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('tolerates hostile shapes without throwing', () => {
    const {warn} = collect();
    expect(giftsFromDiscounts(null, warn)).toEqual([]);
    expect(giftsFromDiscounts({discountNodes: 5}, warn)).toEqual([]);
    expect(
      giftsFromDiscounts(
        discounts({id: 1, discount: []}, {discount: {}}),
        warn,
      ),
    ).toEqual([]);
  });
});

describe('giftsFromDiscounts: a product at 100% off is a gift (REQ-PROMO-001, owner 2026-11-06)', () => {
  const pillowItems = {
    __typename: 'DiscountProducts',
    products: {nodes: [{id: PILLOW, title: 'Gift pillow'}]},
  };
  const freeNode = (over: Record<string, unknown> = {}) => ({
    id: 'gid://shopify/DiscountAutomaticNode/9',
    discount: {
      __typename: 'DiscountAutomaticBasic',
      title: 'Free pillow',
      status: 'ACTIVE',
      minimumRequirement: null,
      customerGets: {
        value: {__typename: 'DiscountPercentage', percentage: 1},
        items: pillowItems,
      },
      ...over,
    },
  });
  const pillow: ProductInfo = {
    id: PILLOW,
    title: 'Gift pillow',
    variants: [
      {id: 'gid://shopify/ProductVariant/301', title: 'Queen', size: 'Queen'},
      {id: 'gid://shopify/ProductVariant/302', title: 'King', size: 'King'},
    ],
  };
  const lookup = new Map([[PILLOW, pillow]]);
  const run = (over: Record<string, unknown> = {}) => {
    const {warnings, warn} = collect();
    const gifts = giftsFromDiscounts(null, warn, {
      free: {discountNodes: {nodes: [freeNode(over)]}},
      products: lookup,
    });
    return {gifts, warnings};
  };

  it('makes the product a gift offered with any purchase, one per order, and the validator accepts it', () => {
    const {gifts, warnings} = run();
    expect(gifts).toEqual([
      {
        id: 'gid://shopify/DiscountAutomaticNode/9',
        name: 'Free pillow',
        anyPurchase: true,
        giftVariantIdsBySize: {
          Queen: 'gid://shopify/ProductVariant/301',
          King: 'gid://shopify/ProductVariant/302',
        },
        maxQuantity: 1,
      },
    ]);
    expect(warnings).toEqual([]);
    const parsed = parseOfferConfig({rules: {gifts}});
    expect(parsed.config.rules.gifts[0]?.anyPurchase).toBe(true);
    expect(parsed.warnings).toEqual([]);
  });

  it('lists the gift product ids so the loader can fetch their variants', () => {
    expect(giftProductIdsOf({discountNodes: {nodes: [freeNode()]}})).toEqual([
      PILLOW,
    ]);
  });

  it.each([
    [
      'a 10% sale',
      {
        customerGets: {
          value: {__typename: 'DiscountPercentage', percentage: 0.1},
          items: pillowItems,
        },
      },
    ],
    ['an inactive discount', {status: 'EXPIRED'}],
    [
      'a fixed amount off',
      {
        customerGets: {
          value: {__typename: 'DiscountAmount'},
          items: pillowItems,
        },
      },
    ],
  ])('ignores %s without a warning', (_name, over) => {
    const {gifts, warnings} = run(over);
    expect(gifts).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it.each([
    [
      'a minimum requirement',
      {minimumRequirement: {__typename: 'DiscountMinimumSubtotal'}},
    ],
    [
      'free items that are a collection',
      {
        customerGets: {
          value: {__typename: 'DiscountPercentage', percentage: 1},
          items: {__typename: 'DiscountCollections'},
        },
      },
    ],
    [
      'a product the store did not return',
      {
        customerGets: {
          value: {__typename: 'DiscountPercentage', percentage: 1},
          items: {
            __typename: 'DiscountProducts',
            products: {nodes: [{id: 'gid://shopify/Product/404'}]},
          },
        },
      },
    ],
  ])('skips %s with a warning, and offers no gift', (_name, over) => {
    const {gifts, warnings} = run(over);
    expect(gifts).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/free-product discount skipped/);
  });
});

describe('centsOfMoney', () => {
  it.each([
    ['149.00', 14900],
    ['149', 14900],
    ['149.5', 14950],
    ['0.07', 7],
    ['{"amount":"149.0","currency_code":"USD"}', 14900],
    ['{"amount":"999.99","currency_code":"USD"}', 99999],
  ])('%s is %s cents', (value, cents) => {
    expect(centsOfMoney(value)).toBe(cents);
  });

  it.each([
    [undefined],
    [''],
    ['abc'],
    ['-1'],
    ['1.234'],
    ['{"amount":12}'],
    ['{nope'],
    ['1e5'],
  ])('%s is not money', (value) => {
    expect(centsOfMoney(value)).toBeNull();
  });
});

const info = (node: object): ProductInfo => {
  const product = productInfoOf(node);
  if (product === null) throw new Error('fixture product');
  return product;
};

const PRODUCTS = new Map<string, ProductInfo>([
  [PILLOW, info(productNode(PILLOW, 'Pillow', [variant(301, null)]))],
  [
    PROTECTOR,
    info(
      productNode(PROTECTOR, 'Protector', [
        variant(401, 'Queen'),
        variant(402, 'King'),
      ]),
    ),
  ],
  [
    SERVICE,
    info(
      productNode(SERVICE, 'Recycle and disposal service', [
        variant(501, null),
      ]),
    ),
  ],
  [
    FOUNDATION,
    info(
      productNode(FOUNDATION, 'Foundation', [
        variant(601, 'Queen'),
        variant(602, 'King'),
      ]),
    ),
  ],
]);

const ruleNode = (id: number, fields: Record<string, string>) => ({
  id: `gid://shopify/Metaobject/${id}`,
  fields: Object.entries(fields).map(([key, value]) => ({key, value})),
});

const list = (...ids: string[]) => JSON.stringify(ids);

describe('buildRawOfferConfig (REQ-PRE-002, REQ-PRE-003, REQ-ADD-001)', () => {
  const build = (
    ruleNodes: object[],
    zoneNode: unknown = null,
    collections = new Map<string, string[]>(),
  ) => {
    const {warnings, warn} = collect();
    const raw = buildRawOfferConfig({
      gifts: [],
      ruleNodes,
      zoneNode,
      lookups: {products: PRODUCTS, collections},
      warn,
    });
    return {raw, warnings, parsed: parseOfferConfig(raw)};
  };

  it('maps a comfort-guarantee rule to the protector variants by size', () => {
    const {raw, warnings, parsed} = build([
      ruleNode(1, {
        name: 'Comfort guarantee',
        type: 'comfort_protector',
        trigger_product: MATTRESS,
        products: list(PROTECTOR),
      }),
    ]);
    expect(warnings).toEqual([]);
    expect(raw.rules.comfortGuarantee).toEqual({
      qualifyingProductIds: [MATTRESS],
      protectorVariantIdBySize: {
        Queen: 'gid://shopify/ProductVariant/401',
        King: 'gid://shopify/ProductVariant/402',
      },
    });
    expect(parsed.warnings).toEqual([]);
    expect(parsed.config.rules.comfortGuarantee).not.toBeNull();
  });

  it('expands a trigger collection into its products', () => {
    const {raw} = build(
      [
        ruleNode(1, {
          name: 'Comfort',
          type: 'comfort_protector',
          trigger_collection: COLLECTION,
          products: list(PROTECTOR),
        }),
      ],
      null,
      new Map([[COLLECTION, [MATTRESS, MATTRESS_2]]]),
    );
    expect(raw.rules.comfortGuarantee).toMatchObject({
      qualifyingProductIds: [MATTRESS, MATTRESS_2],
    });
  });

  it('maps haul-away to the first variant of the service product and the maximum quantity', () => {
    const {raw, parsed} = build([
      ruleNode(2, {
        name: 'Haul-away',
        type: 'haul_away',
        products: list(SERVICE),
        max_quantity: '2',
      }),
    ]);
    expect(raw.rules.haulAway).toEqual({
      variantId: 'gid://shopify/ProductVariant/501',
      maxPieces: 2,
    });
    expect(parsed.config.rules.haulAway?.maxPieces).toBe(2);
  });

  it('skips haul-away with no maximum quantity', () => {
    const {raw, warnings} = build([
      ruleNode(2, {
        name: 'Haul-away',
        type: 'haul_away',
        products: list(SERVICE),
      }),
    ]);
    expect(raw.rules.haulAway).toBeNull();
    expect(warnings[0]).toMatch(/skipped/);
  });

  it('maps add-on types to one relation per mattress, size and offered product', () => {
    const {raw, parsed, warnings} = build([
      ruleNode(3, {
        name: 'Foundations',
        type: 'foundation',
        trigger_product: MATTRESS,
        products: list(FOUNDATION),
      }),
      ruleNode(4, {
        name: 'Pillows',
        type: 'pillow',
        trigger_product: MATTRESS,
        products: list(PILLOW),
      }),
    ]);
    expect(warnings).toEqual([]);
    const addOns = raw.rules.matchingAddOns;
    expect(addOns).toMatchObject({
      foundations: [
        {
          mattressProductId: MATTRESS,
          size: 'Queen',
          productId: FOUNDATION,
          variantId: 'gid://shopify/ProductVariant/601',
        },
        {
          mattressProductId: MATTRESS,
          size: 'King',
          productId: FOUNDATION,
          variantId: 'gid://shopify/ProductVariant/602',
        },
      ],
      // A single-variant product fits every size.
      pillows: [
        {
          mattressProductId: MATTRESS,
          size: null,
          productId: PILLOW,
          variantId: 'gid://shopify/ProductVariant/301',
        },
      ],
    });
    expect(parsed.warnings).toEqual([]);
    expect(parsed.config.rules.matchingAddOns.foundations).toHaveLength(2);
  });

  it('keeps a large catalog of relations (more than the generic list cap)', () => {
    const triggers = Array.from(
      {length: 120},
      (_, i) => `gid://shopify/Product/${1000 + i}`,
    );
    const {parsed} = build(
      [
        ruleNode(5, {
          name: 'Foundations',
          type: 'foundation',
          trigger_collection: COLLECTION,
          products: list(FOUNDATION),
        }),
      ],
      null,
      new Map([[COLLECTION, triggers]]),
    );
    expect(parsed.config.rules.matchingAddOns.foundations).toHaveLength(240);
  });

  it('maps a bundle: the trigger is the anchor, members come from the offered products, never the anchor itself', () => {
    const {raw, parsed, warnings} = build([
      ruleNode(6, {
        name: 'Sleep set',
        type: 'bundle',
        trigger_product: MATTRESS,
        products: list(PROTECTOR, PILLOW),
        discount_title: 'Sleep set 10% off',
      }),
    ]);
    expect(warnings).toEqual([]);
    expect(raw.rules.bundles).toEqual([
      {
        id: 'bundle-6-1',
        name: 'Sleep set',
        anchorProductId: MATTRESS,
        discountTitle: 'Sleep set 10% off',
        members: [
          {
            productId: PROTECTOR,
            quantity: 1,
            variants: {
              type: 'by-size',
              variantIdBySize: {
                Queen: 'gid://shopify/ProductVariant/401',
                King: 'gid://shopify/ProductVariant/402',
              },
            },
          },
          {
            productId: PILLOW,
            quantity: 1,
            variants: {
              type: 'single',
              variantId: 'gid://shopify/ProductVariant/301',
            },
          },
        ],
      },
    ]);
    expect(parsed.warnings).toEqual([]);
    expect(parsed.config.rules.bundles[0]?.discountTitle).toBe(
      'Sleep set 10% off',
    );
  });

  it('ignores a disabled rule, a gift entry (gifts come from discounts) and an unknown type, saying why', () => {
    const {raw, warnings} = build([
      ruleNode(7, {
        name: 'Off',
        type: 'haul_away',
        products: list(SERVICE),
        max_quantity: '2',
        enabled: 'false',
      }),
      ruleNode(8, {name: 'Old gift', type: 'gift'}),
      ruleNode(9, {name: 'Mystery', type: 'teleport'}),
    ]);
    expect(raw.rules.haulAway).toBeNull();
    expect(warnings).toEqual([
      'offer rule "Old gift" ignored: gifts come from automatic discounts',
      'offer rule "Mystery" skipped (unknown type)',
    ]);
  });

  it('maps the delivery zone and uses its free-over amount as the free-delivery threshold', () => {
    const {raw, parsed, warnings} = build(
      [],
      ruleNode(10, {
        name: 'Metro',
        postal_codes: '606*, 60007',
        fee: '{"amount":"149.0","currency_code":"USD"}',
        free_over: '{"amount":"999.0","currency_code":"USD"}',
        promise_white_glove: 'White-glove.',
        promise_parcel: 'Ships.',
        promise_pickup: 'Ready.',
      }),
    );
    expect(warnings).toEqual([]);
    expect(raw.zone).toEqual({
      name: 'Metro',
      postalCodes: '606*, 60007',
      feeCents: 14900,
      freeOverCents: 99900,
      promise: {inHome: 'White-glove.', parcel: 'Ships.', pickup: 'Ready.'},
    });
    expect(raw.rules.freeDelivery).toEqual({thresholdCents: 99900});
    expect(parsed.config.zone?.postalCodes).toEqual(['606*', '60007']);
    expect(parsed.config.rules.freeDelivery).toEqual({thresholdCents: 99900});
  });

  it('ignores a zone with no fee or no postal codes', () => {
    const {warn, warnings} = collect();
    expect(
      zoneFromMetaobject(
        ruleNode(11, {name: 'Metro', postal_codes: '606*'}),
        warn,
      ),
    ).toBeNull();
    expect(warnings).toEqual([
      'delivery zone ignored: needs a name, postal codes and a fee',
    ]);
  });
});

describe('referencedIds', () => {
  it('lists each offered product and trigger collection once', () => {
    expect(
      referencedIds([
        ruleNode(1, {
          products: list(PILLOW, PROTECTOR),
          trigger_collection: COLLECTION,
        }),
        ruleNode(2, {products: list(PILLOW), trigger_collection: COLLECTION}),
        ruleNode(3, {products: 'not a list or id'}),
        'junk',
      ]),
    ).toEqual({
      offeredProductIds: [PILLOW, PROTECTOR, 'not a list or id'],
      triggerCollectionIds: [COLLECTION],
    });
  });
});
