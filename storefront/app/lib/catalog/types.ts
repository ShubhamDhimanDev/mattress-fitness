// Domain model for mattress products. It is deliberately independent of
// Shopify's GraphQL shapes: a mapper in the query module (app/lib/shopify/)
// turns a Storefront API response into these types, and everything else
// (quiz, comparison, filters, tests) works on plain data. Money is integer cents.

import type {
  Benefit,
  ComfortLevel,
  MattressType,
  Size,
  SleepPosition,
} from '~/lib/catalog/attributes';

export type ProductImage = {
  readonly url: string;
  readonly altText: string | null;
  readonly width: number | null;
  readonly height: number | null;
};

/** One purchasable size of a mattress (one Shopify variant per size, SOW section 8). */
export type SizeVariant = {
  readonly id: string;
  readonly size: Size;
  readonly sku: string | null;
  /** Custom metafield `custom.dimensions`, for example 60" x 80". */
  readonly dimensions: string | null;
  readonly priceCents: number;
  /** Original price when on sale; a sale needs compare-at greater than price. */
  readonly compareAtCents: number | null;
  readonly available: boolean;
};

/** Present only when a reviews source exists (Q-011); otherwise the product has null. */
export type ProductRating = {
  readonly average: number;
  readonly count: number;
};

export type CatalogProduct = {
  readonly id: string;
  readonly handle: string;
  readonly title: string;
  readonly brand: string;
  /** The category used by the comparison rules, for example "Mattress". */
  readonly productType: string;
  readonly productLine: string | null;
  /** Attributes can be missing on a badly configured product; null never scores. */
  readonly comfortLevel: ComfortLevel | null;
  readonly mattressType: MattressType | null;
  readonly sleepPositions: readonly SleepPosition[];
  readonly benefits: readonly Benefit[];
  readonly heightInches: number | null;
  /** `custom.compare_group`: products the client groups as comparable (see compare.ts). */
  readonly compareGroup: string | null;
  readonly rating: ProductRating | null;
  readonly images: readonly ProductImage[];
  readonly variants: readonly SizeVariant[];
};
