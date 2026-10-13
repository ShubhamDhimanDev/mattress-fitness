// View models the catalog pages render. They are plain data (no Shopify GraphQL shapes, no framework
// imports): mappers in this folder turn Storefront API responses into them, components only receive them.
// Money stays as Shopify's MoneyV2 strings and is compared in integer cents through lib/money.

import type {
  Benefit,
  ComfortLevel,
  MattressType,
  SleepPosition,
} from '~/lib/catalog/attributes';
import type {MoneyV2Like} from '~/lib/money';

export type ImageView = {
  readonly id: string | null;
  readonly url: string;
  readonly altText: string | null;
  readonly width: number | null;
  readonly height: number | null;
};

export type SelectedOptionView = {
  readonly name: string;
  readonly value: string;
};

/** A product on a collection, search or home card. */
export type ProductCardView = {
  readonly id: string;
  readonly handle: string;
  readonly title: string;
  readonly vendor: string;
  readonly image: ImageView | null;
  /** Lowest price among variants that can be bought; null when every variant is sold out. */
  readonly price: MoneyV2Like | null;
  /** Compare-at price of that same variant, only when it is above the price. */
  readonly compareAt: MoneyV2Like | null;
  /** More than one distinct price among buyable variants, so the card says "From". */
  readonly priceIsFrom: boolean;
  readonly soldOut: boolean;
  /** Size option values in the standard order, followed by any unknown ones. */
  readonly sizes: readonly string[];
  readonly comfortLevel: ComfortLevel | null;
  readonly mattressType: MattressType | null;
  readonly benefits: readonly Benefit[];
  readonly productLine: string | null;
  /** Star rating from the reviews source; always null until a provider exists (Q-011, P3B-12). */
  readonly rating: {readonly average: number; readonly count: number} | null;
};

export type VariantView = {
  readonly id: string;
  readonly title: string;
  readonly sku: string | null;
  readonly available: boolean;
  readonly price: MoneyV2Like;
  readonly compareAt: MoneyV2Like | null;
  readonly selectedOptions: readonly SelectedOptionView[];
  readonly image: ImageView | null;
  /** `custom.dimensions` of the variant, for example 60" x 80". */
  readonly dimensions: string | null;
};

export type OptionView = {
  readonly name: string;
  readonly values: readonly string[];
};

export type BrandView = {
  readonly name: string;
  readonly slug: string | null;
  readonly logo: ImageView | null;
  readonly about: readonly string[];
  readonly warranty: readonly string[];
};

export type FaqView = {
  readonly id: string;
  readonly question: string;
  readonly answer: readonly string[];
};

export type SpecificationRow = {
  readonly label: string;
  readonly value: string;
};

export type ProductPageView = {
  readonly id: string;
  readonly handle: string;
  readonly title: string;
  readonly vendor: string;
  readonly productType: string;
  readonly description: readonly string[];
  readonly seoTitle: string | null;
  readonly seoDescription: string | null;
  readonly images: readonly ImageView[];
  readonly options: readonly OptionView[];
  readonly variants: readonly VariantView[];
  readonly comfortLevel: ComfortLevel | null;
  readonly mattressType: MattressType | null;
  readonly sleepPositions: readonly SleepPosition[];
  readonly benefits: readonly Benefit[];
  readonly productLine: string | null;
  readonly heightInches: number | null;
  readonly specifications: readonly SpecificationRow[];
  readonly features: readonly string[];
  readonly brand: BrandView | null;
  readonly faqs: readonly FaqView[];
};

export type PageInfoView = {
  readonly hasNextPage: boolean;
  readonly endCursor: string | null;
};
