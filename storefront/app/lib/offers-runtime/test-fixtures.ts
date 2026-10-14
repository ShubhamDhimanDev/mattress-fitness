// Fixtures for the cart-offers tests: synthetic ids, an in-memory cart handler and a fake storefront.
// Imported by *.test.ts files only; nothing in the app bundle uses it.

import type {CartApiQueryFragment} from 'storefrontapi.generated';
import type {
  CartHandlerLike,
  CartLineAddInput,
  CartMutationResult,
} from '~/lib/offers-runtime/server';

export const GID = {
  mattress: 'gid://shopify/Product/1',
  protector: 'gid://shopify/Product/2',
  giftPillow: 'gid://shopify/Product/3',
  haul: 'gid://shopify/Product/4',
  pillow: 'gid://shopify/Product/5',
  other: 'gid://shopify/Product/9',
  mattressQueen: 'gid://shopify/ProductVariant/11',
  mattressKing: 'gid://shopify/ProductVariant/12',
  protectorQueen: 'gid://shopify/ProductVariant/21',
  protectorKing: 'gid://shopify/ProductVariant/22',
  gift: 'gid://shopify/ProductVariant/31',
  haulVariant: 'gid://shopify/ProductVariant/41',
  pillowVariant: 'gid://shopify/ProductVariant/51',
  otherVariant: 'gid://shopify/ProductVariant/91',
  coverageVariant: 'gid://shopify/ProductVariant/61',
  coverageHigh: 'gid://shopify/ProductVariant/62',
  coverageProduct: 'gid://shopify/Product/900',
} as const;

export const CONFIG = {
  rules: {
    gifts: [
      {
        id: 'gift-pillow',
        name: 'Free pillow',
        qualifyingProductIds: [GID.mattress],
        giftVariantIdsBySize: {Standard: GID.gift},
        maxQuantity: 1,
      },
    ],
    comfortGuarantee: {
      qualifyingProductIds: [GID.mattress],
      protectorVariantIdBySize: {
        Queen: GID.protectorQueen,
        King: GID.protectorKing,
      },
    },
    matchingAddOns: {
      pillows: [
        {
          mattressProductId: GID.mattress,
          size: null,
          productId: GID.pillow,
          variantId: GID.pillowVariant,
        },
      ],
    },
    haulAway: {variantId: GID.haulVariant, maxPieces: 2},
    freeDelivery: {thresholdCents: 99900},
  },
  zone: {
    name: 'Test metro',
    postalCodes: '606*, 60007',
    feeCents: 14900,
    freeOverCents: 99900,
    promise: {inHome: 'White-glove.', parcel: 'Ships.', pickup: 'Ready.'},
  },
};

export const ENV = {OFFER_CONFIG_JSON: JSON.stringify(CONFIG)};

type LineSpec = {
  id: string;
  variantId: string;
  productId: string;
  quantity?: number;
  size?: string | null;
  attributes?: Array<{key: string; value: string}>;
  parentId?: string;
  priceCents?: number;
};

const money = (cents: number) => ({
  amount: `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`,
  currencyCode: 'USD' as const,
});

export function lineNode(spec: LineSpec) {
  const price = money(spec.priceCents ?? 100000);
  return {
    id: spec.id,
    quantity: spec.quantity ?? 1,
    attributes: spec.attributes ?? [],
    cost: {totalAmount: price, amountPerQuantity: price},
    merchandise: {
      id: spec.variantId,
      availableForSale: true,
      requiresShipping: true,
      title: spec.size ?? 'Default Title',
      price,
      product: {
        id: spec.productId,
        handle: `product-${spec.productId.split('/').pop()}`,
        title: `Product ${spec.productId.split('/').pop()}`,
        vendor: 'Test',
      },
      selectedOptions:
        spec.size === null || spec.size === undefined
          ? []
          : [{name: 'Size', value: spec.size}],
    },
    ...(spec.parentId
      ? {parentRelationship: {parent: {id: spec.parentId}}}
      : {}),
  };
}

export type LineNode = ReturnType<typeof lineNode>;

export function cartOf(
  lines: readonly LineSpec[],
  options: {
    attributes?: Array<{key: string; value: string}>;
    subtotalCents?: number;
    updatedAt?: string;
  } = {},
): CartApiQueryFragment {
  const subtotal = money(options.subtotalCents ?? 100000);
  return {
    id: 'gid://shopify/Cart/c1-test',
    updatedAt: options.updatedAt ?? '2026-10-13T10:00:00Z',
    checkoutUrl: 'https://shop.example/checkouts/c/c1-test',
    totalQuantity: lines.reduce((sum, line) => sum + (line.quantity ?? 1), 0),
    note: null,
    appliedGiftCards: [],
    buyerIdentity: {countryCode: 'US', email: null, phone: null},
    lines: {nodes: lines.map(lineNode)},
    cost: {subtotalAmount: subtotal, totalAmount: subtotal},
    attributes: options.attributes ?? [],
    discountCodes: [],
  };
}

/** The mattress line most tests start from. */
export const MATTRESS_LINE: LineSpec = {
  id: 'gid://shopify/CartLine/mattress',
  variantId: GID.mattressQueen,
  productId: GID.mattress,
  size: 'Queen',
};

export type Call =
  | {method: 'removeLines'; lineIds: string[]}
  | {method: 'updateLines'; lines: unknown[]}
  | {method: 'addLines'; lines: unknown[]}
  | {method: 'updateAttributes'; attributes: unknown[]};

/**
 * An in-memory cart handler: applies removals, quantity updates (and merchandise swaps), additions and
 * attribute writes to a plain list, so a revalidation run can be followed end to end. `failNext` makes the
 * next mutation answer with a user error and change nothing.
 */
export class FakeCart implements CartHandlerLike {
  readonly calls: Call[] = [];
  failNext = false;
  private specs: LineSpec[];
  private attributes: Array<{key: string; value: string}>;
  private version = 0;
  private nextLine = 1;
  private readonly subtotalCents: number;

  constructor(
    lines: readonly LineSpec[],
    options: {
      attributes?: Array<{key: string; value: string}>;
      subtotalCents?: number;
    } = {},
  ) {
    this.specs = lines.map((line) => ({...line}));
    this.attributes = options.attributes ?? [];
    this.subtotalCents = options.subtotalCents ?? 100000;
  }

  snapshot(): CartApiQueryFragment {
    return cartOf(this.specs, {
      attributes: this.attributes,
      subtotalCents: this.subtotalCents,
      updatedAt: `v${this.version}`,
    });
  }

  lineIds(): string[] {
    return this.specs.map((line) => line.id);
  }

  /** A copy of one line as the fake holds it, for assertions on parent and attributes. */
  lineSpec(lineId: string): LineSpec | undefined {
    const found = this.specs.find((line) => line.id === lineId);
    return found ? {...found} : undefined;
  }

  allSpecs(): LineSpec[] {
    return this.specs.map((line) => ({...line}));
  }

  quantityOf(lineId: string): number | undefined {
    return this.specs.find((line) => line.id === lineId)?.quantity;
  }

  attributeValue(key: string): string | undefined {
    return this.attributes.find((attribute) => attribute.key === key)?.value;
  }

  private done(): CartMutationResult {
    if (this.failNext) {
      this.failNext = false;
      return {cart: this.snapshot(), userErrors: [{message: 'Nope'}]};
    }
    this.version += 1;
    return {cart: this.snapshot()};
  }

  private failing(): boolean {
    return this.failNext;
  }

  get(): Promise<CartApiQueryFragment | null> {
    return Promise.resolve(this.snapshot());
  }

  removeLines(lineIds: string[]): Promise<CartMutationResult> {
    this.calls.push({method: 'removeLines', lineIds});
    if (!this.failing()) {
      // Shopify removes nested children with their parent.
      const removed = new Set(lineIds);
      this.specs = this.specs.filter(
        (line) =>
          !removed.has(line.id) &&
          !(line.parentId !== undefined && removed.has(line.parentId)),
      );
    }
    return Promise.resolve(this.done());
  }

  updateLines(
    lines: Array<{id: string; quantity: number; merchandiseId?: string}>,
  ): Promise<CartMutationResult> {
    this.calls.push({method: 'updateLines', lines});
    if (!this.failing()) {
      for (const update of lines) {
        const target = this.specs.find((line) => line.id === update.id);
        if (!target) continue;
        target.quantity = update.quantity;
        if (update.merchandiseId) target.variantId = update.merchandiseId;
      }
    }
    return Promise.resolve(this.done());
  }

  /** The calls this fake would refuse like Shopify does: a parent that cannot be resolved (F-26). */
  failOnBadParent = true;

  addLines(lines: CartLineAddInput[]): Promise<CartMutationResult> {
    this.calls.push({method: 'addLines', lines});
    if (this.failing()) return Promise.resolve(this.done());
    // Shopify resolves a parent by variant only among the lines of the SAME request, and by line id among existing lines.
    const idsInRequest = new Map<string, string>();
    const planned = lines.map((line) => {
      const id = `gid://shopify/CartLine/new-${this.nextLine++}`;
      if (!idsInRequest.has(line.merchandiseId)) {
        idsInRequest.set(line.merchandiseId, id);
      }
      return {line, id};
    });
    const resolved: Array<string | undefined> = [];
    for (const {line} of planned) {
      const parent = line.parent;
      if (!parent) {
        resolved.push(undefined);
      } else if ('lineId' in parent) {
        const found = this.specs.find((spec) => spec.id === parent.lineId);
        if (!found && this.failOnBadParent) {
          return Promise.resolve({
            cart: this.snapshot(),
            userErrors: [{message: 'PARENT_LINE_NOT_FOUND'}],
          });
        }
        resolved.push(parent.lineId);
      } else {
        const sameRequest = idsInRequest.get(parent.merchandiseId);
        if (!sameRequest && this.failOnBadParent) {
          return Promise.resolve({
            cart: this.snapshot(),
            userErrors: [{message: 'PARENT_LINE_INVALID_REFERENCE'}],
          });
        }
        resolved.push(sameRequest);
      }
    }
    planned.forEach(({line, id}, index) => {
      const parentId = resolved[index];
      // Identical plain lines merge, as in Shopify's cart.
      const twin =
        parentId === undefined && !line.attributes?.length
          ? this.specs.find(
              (spec) =>
                spec.variantId === line.merchandiseId &&
                spec.parentId === undefined &&
                !spec.attributes?.length,
            )
          : undefined;
      if (twin) {
        twin.quantity = (twin.quantity ?? 1) + line.quantity;
        return;
      }
      this.specs.push({
        id,
        variantId: line.merchandiseId,
        productId: productOfVariant(line.merchandiseId),
        quantity: line.quantity,
        size: sizeOfVariant(line.merchandiseId),
        ...(line.attributes ? {attributes: line.attributes} : {}),
        ...(parentId ? {parentId} : {}),
        ...(PRICE_OF_VARIANT[line.merchandiseId] !== undefined
          ? {priceCents: PRICE_OF_VARIANT[line.merchandiseId]}
          : {}),
      });
    });
    return Promise.resolve(this.done());
  }

  updateAttributes(
    attributes: Array<{key: string; value: string}>,
  ): Promise<CartMutationResult> {
    this.calls.push({method: 'updateAttributes', attributes});
    if (!this.failing()) this.attributes = attributes.map((a) => ({...a}));
    return Promise.resolve(this.done());
  }
}

const VARIANT_PRODUCT: Record<string, string> = {
  [GID.mattressQueen]: GID.mattress,
  [GID.mattressKing]: GID.mattress,
  [GID.protectorQueen]: GID.protector,
  [GID.protectorKing]: GID.protector,
  [GID.gift]: GID.giftPillow,
  [GID.haulVariant]: GID.haul,
  [GID.pillowVariant]: GID.pillow,
  [GID.otherVariant]: GID.other,
  [GID.coverageVariant]: GID.coverageProduct,
  [GID.coverageHigh]: GID.coverageProduct,
};
// Extend price-point variants (coverage-catalog fixtures): their Shopify price equals the price in their name.
const PRICE_OF_VARIANT: Record<string, number | undefined> = {
  [GID.coverageVariant]: 7999,
  [GID.coverageHigh]: 9999,
};
const VARIANT_SIZE: Record<string, string> = {
  [GID.mattressQueen]: 'Queen',
  [GID.mattressKing]: 'King',
  [GID.protectorQueen]: 'Queen',
  [GID.protectorKing]: 'King',
};

export function productOfVariant(variantId: string): string {
  return VARIANT_PRODUCT[variantId] ?? GID.other;
}

export function sizeOfVariant(variantId: string): string | null {
  return VARIANT_SIZE[variantId] ?? null;
}

/** Storefront answers for the three offer queries, by operation name. `soldOut` variants are unavailable. */
export function storefrontResponder(options: {soldOut?: string[]} = {}) {
  const soldOut = new Set(options.soldOut ?? []);
  const available = (id: string) => !soldOut.has(id);
  return (call: {query: string; variables: Record<string, unknown>}) => {
    if (call.query.includes('query CartOfferProducts')) {
      const ids = Array.isArray(call.variables.ids) ? call.variables.ids : [];
      // Shopify answers for every product asked about; only the mattress has sizes and a collection here.
      return {
        nodes: ids.flatMap((id): unknown[] => {
          if (typeof id !== 'string') return [];
          if (id !== GID.mattress) {
            return [{id, variants: {nodes: []}, collections: {nodes: []}}];
          }
          return [
            {
              id,
              variants: {
                nodes: [GID.mattressQueen, GID.mattressKing].map((variant) => ({
                  id: variant,
                  title: sizeOfVariant(variant),
                  availableForSale: available(variant),
                  selectedOptions: [
                    {name: 'Size', value: sizeOfVariant(variant)},
                  ],
                })),
              },
              collections: {nodes: [{id: 'gid://shopify/Collection/1'}]},
            },
          ];
        }),
      };
    }
    if (call.query.includes('query CartOfferVariants')) {
      const ids = Array.isArray(call.variables.ids) ? call.variables.ids : [];
      return {
        nodes: ids.flatMap((id) =>
          typeof id === 'string'
            ? [
                {
                  id,
                  title: sizeOfVariant(id) ?? 'Default Title',
                  availableForSale: available(id),
                  price: {amount: '49.00', currencyCode: 'USD'},
                  product: {
                    id: productOfVariant(id),
                    title: `Product ${productOfVariant(id)}`,
                    handle: 'handle',
                  },
                },
              ]
            : [],
        ),
      };
    }
    if (call.query.includes('query CartOfferSwapTarget')) {
      const id = String(call.variables.id);
      return {
        node: {
          id,
          availableForSale: available(id),
          product: {id: productOfVariant(id)},
          selectedOptions: sizeOfVariant(id)
            ? [{name: 'Size', value: sizeOfVariant(id)}]
            : [],
        },
      };
    }
    return {};
  };
}
