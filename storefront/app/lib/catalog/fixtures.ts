// SYNTHETIC catalog for tests and demos. Every brand, line and model name here
// is invented; none refers to a real company or product. Image URLs use the
// reserved ".test" domain and never resolve, so a demo must map them to a local
// placeholder. Variant IDs are not Shopify IDs and cannot be added to a real cart.
// This module is removed from runtime paths once the Storefront API is wired
// (query modules in app/lib/shopify/, task P3B-01).

import type {
  Benefit,
  ComfortLevel,
  MattressType,
  SleepPosition,
} from '~/lib/catalog/attributes';
import {SIZES} from '~/lib/catalog/attributes';
import type {VariantPlan} from '~/lib/catalog/builders';
import {buildVariants} from '~/lib/catalog/builders';
import type {CatalogProduct, ProductRating} from '~/lib/catalog/types';

type FixtureSpec = {
  readonly handle: string;
  readonly title: string;
  readonly brand: string;
  readonly productLine: string;
  readonly comfortLevel: ComfortLevel;
  readonly mattressType: MattressType;
  readonly sleepPositions: readonly SleepPosition[];
  readonly benefits: readonly Benefit[];
  readonly heightInches: number;
  readonly rating: ProductRating | null;
  readonly queenDollars: number;
  readonly plan?: VariantPlan;
};

function fixtureProduct(spec: FixtureSpec): CatalogProduct {
  return {
    id: `fixture-product:${spec.handle}`,
    handle: spec.handle,
    title: spec.title,
    brand: spec.brand,
    productType: 'Mattress',
    productLine: spec.productLine,
    comfortLevel: spec.comfortLevel,
    mattressType: spec.mattressType,
    sleepPositions: spec.sleepPositions,
    benefits: spec.benefits,
    heightInches: spec.heightInches,
    compareGroup: `${spec.productLine} ${spec.mattressType}`,
    rating: spec.rating,
    images: [
      {
        url: `https://cdn.example.test/fixtures/${spec.handle}-1.jpg`,
        altText: `${spec.title}, front view`,
        width: 1200,
        height: 900,
      },
      {
        url: `https://cdn.example.test/fixtures/${spec.handle}-2.jpg`,
        altText: `${spec.title}, cutaway of the layers`,
        width: 1200,
        height: 900,
      },
    ],
    variants: buildVariants(spec.handle, spec.queenDollars, spec.plan),
  };
}

const SPECS: readonly FixtureSpec[] = [
  {
    handle: 'wrenfield-solace-plush-memory-foam',
    title: 'Wrenfield Solace Plush Memory Foam Mattress',
    brand: 'Wrenfield Sleep',
    productLine: 'Solace Series',
    comfortLevel: 'Plush',
    mattressType: 'Memory Foam',
    sleepPositions: ['Back', 'Side'],
    benefits: ['Pressure Relief', 'Motion Separation'],
    heightInches: 11,
    rating: {average: 4.6, count: 812},
    queenDollars: 899,
  },
  {
    handle: 'wrenfield-solace-medium-memory-foam',
    title: 'Wrenfield Solace Medium Memory Foam Mattress',
    brand: 'Wrenfield Sleep',
    productLine: 'Solace Series',
    comfortLevel: 'Medium',
    mattressType: 'Memory Foam',
    sleepPositions: ['Back', 'Side'],
    benefits: ['Pressure Relief', 'Back Support'],
    heightInches: 12,
    rating: {average: 4.5, count: 655},
    queenDollars: 1099,
  },
  {
    handle: 'wrenfield-solace-firm-memory-foam',
    title: 'Wrenfield Solace Firm Memory Foam Mattress',
    brand: 'Wrenfield Sleep',
    productLine: 'Solace Series',
    comfortLevel: 'Firm',
    mattressType: 'Memory Foam',
    sleepPositions: ['Back', 'Stomach'],
    benefits: ['Back Support'],
    heightInches: 12,
    rating: {average: 4.4, count: 390},
    queenDollars: 1199,
    plan: {soldOutSizes: ['King', 'California King']},
  },
  {
    handle: 'larkmoor-cedar-medium-hybrid',
    title: 'Larkmoor Cedar Medium Hybrid Mattress',
    brand: 'Larkmoor',
    productLine: 'Cedar Series',
    comfortLevel: 'Medium',
    mattressType: 'Hybrid',
    sleepPositions: ['Back', 'Side', 'Stomach'],
    benefits: ['Cooling', 'Motion Separation', 'Back Support'],
    heightInches: 13,
    rating: {average: 4.7, count: 1204},
    queenDollars: 1499,
    plan: {soldOutSizes: ['Split California King']},
  },
  {
    handle: 'larkmoor-cedar-plush-hybrid',
    title: 'Larkmoor Cedar Plush Hybrid Mattress',
    brand: 'Larkmoor',
    productLine: 'Cedar Series',
    comfortLevel: 'Plush',
    mattressType: 'Hybrid',
    sleepPositions: ['Side'],
    benefits: ['Cooling', 'Pressure Relief'],
    heightInches: 14,
    rating: {average: 4.6, count: 980},
    queenDollars: 1999,
    plan: {saleOffPercent: 20},
  },
  {
    handle: 'larkmoor-cedar-firm-hybrid',
    title: 'Larkmoor Cedar Firm Hybrid Mattress',
    brand: 'Larkmoor',
    productLine: 'Cedar Series',
    comfortLevel: 'Firm',
    mattressType: 'Hybrid',
    sleepPositions: ['Back', 'Stomach'],
    benefits: ['Cooling', 'Back Support'],
    heightInches: 13,
    rating: {average: 4.3, count: 402},
    queenDollars: 1599,
    plan: {soldOutSizes: ['Twin XL', 'Full']},
  },
  {
    handle: 'larkmoor-cedar-ultra-plush-hybrid',
    title: 'Larkmoor Cedar Ultra Plush Hybrid Mattress',
    brand: 'Larkmoor',
    productLine: 'Cedar Series',
    comfortLevel: 'Ultra Plush',
    mattressType: 'Hybrid',
    sleepPositions: ['Side'],
    benefits: ['Cooling', 'Pressure Relief'],
    heightInches: 15,
    rating: {average: 4.8, count: 310},
    queenDollars: 2499,
  },
  {
    handle: 'ashvale-heartwood-medium-latex',
    title: 'Ashvale Heartwood Medium Latex Mattress',
    brand: 'Ashvale Home',
    productLine: 'Heartwood Collection',
    comfortLevel: 'Medium',
    mattressType: 'Latex',
    sleepPositions: ['Back', 'Side'],
    benefits: ['Cooling', 'Back Support', 'Eco-Friendly'],
    heightInches: 10,
    rating: {average: 4.5, count: 221},
    queenDollars: 1899,
  },
  {
    handle: 'ashvale-heartwood-firm-latex',
    title: 'Ashvale Heartwood Firm Latex Mattress',
    brand: 'Ashvale Home',
    productLine: 'Heartwood Collection',
    comfortLevel: 'Firm',
    mattressType: 'Latex',
    sleepPositions: ['Back', 'Stomach'],
    benefits: ['Back Support', 'Eco-Friendly'],
    heightInches: 10,
    rating: null,
    queenDollars: 2099,
  },
  {
    handle: 'ashvale-fieldstone-firm-innerspring',
    title: 'Ashvale Fieldstone Firm Innerspring Mattress',
    brand: 'Ashvale Home',
    productLine: 'Fieldstone Series',
    comfortLevel: 'Firm',
    mattressType: 'Innerspring',
    sleepPositions: ['Back', 'Stomach'],
    benefits: ['Back Support'],
    heightInches: 10,
    rating: {average: 4.1, count: 540},
    queenDollars: 749,
  },
  {
    handle: 'ashvale-fieldstone-medium-innerspring',
    title: 'Ashvale Fieldstone Medium Innerspring Mattress',
    brand: 'Ashvale Home',
    productLine: 'Fieldstone Series',
    comfortLevel: 'Medium',
    mattressType: 'Innerspring',
    sleepPositions: ['Back', 'Side'],
    benefits: ['Cooling'],
    heightInches: 11,
    rating: {average: 4.0, count: 610},
    queenDollars: 649,
    plan: {sizes: ['Full', 'Queen', 'King', 'California King']},
  },
  {
    handle: 'tidewell-harbor-extra-firm-foam',
    title: 'Tidewell Harbor Extra Firm Foam Mattress',
    brand: 'Tidewell',
    productLine: 'Harbor Series',
    comfortLevel: 'Extra Firm',
    mattressType: 'Foam',
    sleepPositions: ['Back', 'Stomach'],
    benefits: ['Back Support'],
    heightInches: 9,
    rating: {average: 3.9, count: 130},
    queenDollars: 499,
  },
  {
    handle: 'tidewell-harbor-medium-foam',
    title: 'Tidewell Harbor Medium Foam Mattress',
    brand: 'Tidewell',
    productLine: 'Harbor Series',
    comfortLevel: 'Medium',
    mattressType: 'Foam',
    sleepPositions: ['Back', 'Side'],
    benefits: ['Pressure Relief'],
    heightInches: 8,
    rating: {average: 4.2, count: 870},
    queenDollars: 399,
  },
  {
    handle: 'tidewell-cove-medium-hybrid',
    title: 'Tidewell Cove Medium Hybrid Mattress',
    brand: 'Tidewell',
    productLine: 'Cove Series',
    comfortLevel: 'Medium',
    mattressType: 'Hybrid',
    sleepPositions: ['Back', 'Side'],
    benefits: ['Cooling', 'Motion Separation'],
    heightInches: 12,
    rating: {average: 4.4, count: 430},
    queenDollars: 1099,
  },
  {
    handle: 'tidewell-cove-ultra-plush-memory-foam',
    title: 'Tidewell Cove Ultra Plush Memory Foam Mattress',
    brand: 'Tidewell',
    productLine: 'Cove Series',
    comfortLevel: 'Ultra Plush',
    mattressType: 'Memory Foam',
    sleepPositions: ['Side'],
    benefits: ['Cooling', 'Pressure Relief', 'Motion Separation'],
    heightInches: 13,
    rating: {average: 4.6, count: 275},
    queenDollars: 1899,
  },
  {
    // Sold out in every size: proves exclusion rules and sold-out states.
    handle: 'wrenfield-kestrel-extra-firm-hybrid',
    title: 'Wrenfield Kestrel Extra Firm Hybrid Mattress',
    brand: 'Wrenfield Sleep',
    productLine: 'Kestrel Series',
    comfortLevel: 'Extra Firm',
    mattressType: 'Hybrid',
    sleepPositions: ['Back', 'Stomach'],
    benefits: ['Motion Separation', 'Back Support'],
    heightInches: 14,
    rating: {average: 4.2, count: 96},
    queenDollars: 1799,
    plan: {soldOutSizes: SIZES},
  },
];

export const FIXTURE_PRODUCTS: readonly CatalogProduct[] =
  SPECS.map(fixtureProduct);

/** Looks up a fixture; an unknown handle is a mistake in the test, so it throws. */
export function getFixtureProduct(handle: string): CatalogProduct {
  const found = FIXTURE_PRODUCTS.find((product) => product.handle === handle);
  if (!found) throw new Error(`Unknown fixture product: ${handle}`);
  return found;
}
