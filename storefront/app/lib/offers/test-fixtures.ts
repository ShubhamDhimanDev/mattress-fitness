// Shared fixtures for the offer tests. Synthetic ids only: no real products, customers or prices.
// Imported by *.test.ts files only; nothing in the app bundle uses it.

import type {DeliveryZone} from '~/lib/delivery/zone';
import type {
  BundleRule,
  CartLike,
  CartLineLike,
  GiftRule,
  OfferContext,
  OfferRules,
} from './types';

export const ZONE: DeliveryZone = {
  name: 'Test metro',
  postalCodes: ['606*', '60007'],
  feeCents: 14900,
  freeOverCents: 99900,
  promise: {
    inHome: 'White-glove delivery.',
    parcel: 'Ships in a week.',
    pickup: 'Ready in 2 hours.',
  },
};

export const IN_ZONE_ZIP = '60645';
export const OUT_OF_ZONE_ZIP = '90210';

export const PRODUCT = {
  mattressA: 'p-mattress-a',
  mattressB: 'p-mattress-b',
  other: 'p-other',
  protector: 'p-protector',
  foundation: 'p-foundation',
  pillow: 'p-pillow',
  giftPillow: 'p-gift-pillow',
  haul: 'p-haul',
  coverage: 'p-coverage',
} as const;

export const VARIANT = {
  aTwin: 'v-a-twin',
  aQueen: 'v-a-queen',
  aKing: 'v-a-king',
  bQueen: 'v-b-queen',
  other: 'v-other',
  protTwin: 'v-prot-twin',
  protQueen: 'v-prot-queen',
  protKing: 'v-prot-king',
  protCalKing: 'v-prot-calking',
  foundQueen: 'v-found-queen',
  foundKing: 'v-found-king',
  pillow: 'v-pillow',
  giftStandard: 'v-gift-standard',
  giftKing: 'v-gift-king',
  giftSheetsQueen: 'v-gift-sheets-queen',
  haul: 'v-haul',
  cov199: 'v-cov-199',
  cov299: 'v-cov-299',
} as const;

export const GIFT_PILLOWS: GiftRule = {
  id: 'gift-pillows',
  name: 'Free pillows',
  qualifyingProductIds: [PRODUCT.mattressA],
  qualifyingCollectionIds: ['c-premium'],
  giftVariantIdsBySize: {
    Standard: VARIANT.giftStandard,
    King: VARIANT.giftKing,
  },
  maxQuantity: 1,
};

export const GIFT_SHEETS: GiftRule = {
  id: 'gift-sheets',
  name: 'Free sheets',
  qualifyingProductIds: [PRODUCT.mattressB],
  qualifyingCollectionIds: [],
  giftVariantIdsBySize: {Queen: VARIANT.giftSheetsQueen},
  maxQuantity: 2,
};

export const BUNDLE: BundleRule = {
  id: 'bundle-sleep',
  name: 'Sleep set',
  anchorProductId: PRODUCT.mattressA,
  members: [
    {
      productId: PRODUCT.foundation,
      quantity: 1,
      variants: {
        type: 'by-size',
        variantIdBySize: {Queen: VARIANT.foundQueen, King: VARIANT.foundKing},
      },
    },
    {
      productId: PRODUCT.pillow,
      quantity: 2,
      variants: {type: 'single', variantId: VARIANT.pillow},
    },
  ],
};

export const RULES: OfferRules = {
  gifts: [GIFT_PILLOWS, GIFT_SHEETS],
  bundles: [BUNDLE],
  comfortGuarantee: {
    qualifyingProductIds: [PRODUCT.mattressA],
    protectorVariantIdBySize: {
      Twin: VARIANT.protTwin,
      Queen: VARIANT.protQueen,
      King: VARIANT.protKing,
      'Split King': VARIANT.protKing,
      'Cal King': VARIANT.protCalKing,
    },
  },
  matchingAddOns: {
    foundations: [
      {
        mattressProductId: PRODUCT.mattressA,
        size: 'Queen',
        productId: PRODUCT.foundation,
        variantId: VARIANT.foundQueen,
      },
      {
        mattressProductId: PRODUCT.mattressA,
        size: 'King',
        productId: PRODUCT.foundation,
        variantId: VARIANT.foundKing,
      },
    ],
    protectors: [],
    pillows: [
      {
        mattressProductId: PRODUCT.mattressA,
        size: null,
        productId: PRODUCT.pillow,
        variantId: VARIANT.pillow,
      },
    ],
    bedding: [],
  },
  haulAway: {variantId: VARIANT.haul, maxPieces: 3},
  freeDelivery: {thresholdCents: 99900},
};

export const CONTEXT: OfferContext = {
  zip: IN_ZONE_ZIP,
  deliveryChoice: 'in-home',
  zone: ZONE,
  protectionEligibleLineIds: [],
};

export function makeContext(
  overrides: Partial<OfferContext> = {},
): OfferContext {
  return {...CONTEXT, ...overrides};
}

export function makeRules(overrides: Partial<OfferRules> = {}): OfferRules {
  return {...RULES, ...overrides};
}

type LineInput = Partial<CartLineLike> & {id: string};

export function makeLine(input: LineInput): CartLineLike {
  return {
    variantId: VARIANT.other,
    productId: PRODUCT.other,
    quantity: 1,
    attributes: {},
    size: null,
    parentLineId: null,
    ...input,
  };
}

export function makeCart(
  lines: readonly LineInput[],
  extra: Partial<Omit<CartLike, 'lines'>> = {},
): CartLike {
  return {
    lines: lines.map(makeLine),
    subtotalCents: 0,
    ...extra,
  };
}

// Common lines.
export const mattressA = (
  size: string,
  overrides: Partial<CartLineLike> = {},
) =>
  makeLine({
    id: `mattress-${size.toLowerCase().replace(/\s+/g, '-')}`,
    productId: PRODUCT.mattressA,
    variantId: `v-a-${size.toLowerCase().replace(/\s+/g, '-')}`,
    size,
    ...overrides,
  });

export const protector = (
  variantId: string,
  id: string,
  overrides: Partial<CartLineLike> = {},
) =>
  makeLine({
    id,
    variantId,
    productId: PRODUCT.protector,
    role: 'protector',
    ...overrides,
  });

export const gift = (
  variantId: string,
  id: string,
  overrides: Partial<CartLineLike> = {},
) =>
  makeLine({
    id,
    variantId,
    productId: PRODUCT.giftPillow,
    role: 'gift',
    ...overrides,
  });

export const haulAway = (
  id: string,
  quantity: number,
  overrides: Partial<CartLineLike> = {},
) =>
  makeLine({
    id,
    variantId: VARIANT.haul,
    productId: PRODUCT.haul,
    role: 'haul-away',
    quantity,
    ...overrides,
  });

export const coverage = (
  id: string,
  parentLineId: string | null,
  quantity = 1,
  overrides: Partial<CartLineLike> = {},
) =>
  makeLine({
    id,
    variantId: VARIANT.cov199,
    productId: PRODUCT.coverage,
    role: 'coverage',
    quantity,
    parentLineId,
    ...overrides,
  });

/** Deep-freezes a value so any accidental mutation by the code under test throws in strict mode. */
export function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
