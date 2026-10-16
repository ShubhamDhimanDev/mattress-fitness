// Product page view model (REQ-PDP-001, REQ-PDP-002). The content query is cached long and the
// availability query short; availability and price from the short read win, so a sale or a sell-out shows
// within seconds while descriptions and images can be cached for an hour.

import type {
  CatalogProductAvailabilityQuery,
  CatalogProductQuery,
} from 'storefrontapi.generated';
import {
  BENEFITS,
  COMFORT_LEVELS,
  MATTRESS_TYPES,
  PRODUCT_METAFIELD_KEYS,
  SLEEP_POSITIONS,
} from '~/lib/catalog/attributes';
import {cleanText} from '~/lib/catalog/text';
import {normalizeBrandSlug} from '~/lib/shopify/brand-path';
import {BRAND_FIELDS, FAQ_FIELDS} from '~/lib/shopify/config';
import {centsOf, fieldRecord, mapImage, mapMoney} from '~/lib/shopify/common';
import {
  indexMetafields,
  readChoice,
  readChoices,
  readPositiveNumber,
  readSpecifications,
  readText,
  readTextList,
} from '~/lib/shopify/metafields';
import {richTextToParagraphs, textToParagraphs} from '~/lib/shopify/rich-text';
import type {
  BrandView,
  FaqView,
  ImageView,
  ProductPageView,
  VariantView,
} from '~/lib/shopify/types';
import type {MoneyV2Like} from '~/lib/money';

export type ProductSource = NonNullable<CatalogProductQuery['product']>;
export type AvailabilitySource = NonNullable<
  CatalogProductAvailabilityQuery['product']
>;

type AvailabilityVariant = AvailabilitySource['variants']['nodes'][number];

/** A compare-at price only counts when it is above the price (REQ-COL-001, REQ-PDP-001). */
export function effectiveCompareAt(
  price: MoneyV2Like,
  compareAt: MoneyV2Like | null,
): MoneyV2Like | null {
  const priceCents = centsOf(price);
  const compareCents = centsOf(compareAt);
  return priceCents !== null &&
    compareCents !== null &&
    compareCents > priceCents
    ? compareAt
    : null;
}

function mapVariants(
  product: ProductSource,
  availability: AvailabilitySource | null,
): VariantView[] {
  const fresh = new Map<string, AvailabilityVariant>();
  for (const variant of availability?.variants.nodes ?? []) {
    fresh.set(variant.id, variant);
  }

  const variants: VariantView[] = [];
  for (const variant of product.variants.nodes) {
    const latest = fresh.get(variant.id);
    const price = mapMoney(latest?.price ?? variant.price);
    if (price === null) continue;
    const dimensions = variant.dimensions?.value
      ? cleanText(variant.dimensions.value).slice(0, 80)
      : '';
    variants.push({
      id: variant.id,
      title: variant.title,
      sku: variant.sku && variant.sku.trim() !== '' ? variant.sku : null,
      available: latest?.availableForSale ?? variant.availableForSale,
      price,
      compareAt: effectiveCompareAt(
        price,
        mapMoney(latest ? latest.compareAtPrice : variant.compareAtPrice),
      ),
      selectedOptions: variant.selectedOptions.map(({name, value}) => ({
        name,
        value,
      })),
      image: mapImage(variant.image),
      dimensions: dimensions === '' ? null : dimensions,
    });
  }
  return variants;
}

function mapImages(product: ProductSource): ImageView[] {
  const images: ImageView[] = [];
  for (const image of product.images.nodes) {
    const mapped = mapImage(image);
    if (mapped) images.push(mapped);
  }
  if (images.length === 0) {
    const featured = mapImage(product.featuredImage);
    if (featured) images.push(featured);
  }
  return images;
}

function mapBrand(product: ProductSource): BrandView | null {
  const reference = product.brand?.reference;
  if (!reference || !('fields' in reference)) return null;
  const fields = fieldRecord(reference.fields);
  const name = fields[BRAND_FIELDS.name]
    ? cleanText(fields[BRAND_FIELDS.name])
    : '';
  if (name === '') return null;
  const logoField = reference.fields.find(
    (field) => field.key === BRAND_FIELDS.logo,
  );
  const logoReference = logoField?.reference;
  return {
    name,
    slug: fields[BRAND_FIELDS.slug]
      ? cleanText(fields[BRAND_FIELDS.slug])
      : null,
    // The metaobject's own handle is what the brand page is served by; the slug field is documented to equal it.
    handle: normalizeBrandSlug(reference.handle),
    logo:
      logoReference && 'image' in logoReference
        ? mapImage(logoReference.image)
        : null,
    about: richTextToParagraphs(fields[BRAND_FIELDS.about]),
    warranty: richTextToParagraphs(fields[BRAND_FIELDS.warranty]),
  };
}

type FaqNodeSource = {
  readonly id?: string;
  readonly fields?: readonly {
    readonly key: string;
    readonly value?: string | null;
  }[];
};

/** FAQ metaobjects with both a question and an answer; incomplete entries are skipped, not shown empty. */
export function mapFaqs(
  nodes: readonly (FaqNodeSource | Record<string, never>)[] | undefined,
): FaqView[] {
  const faqs: FaqView[] = [];
  for (const node of nodes ?? []) {
    if (!('fields' in node) || !node.fields) continue;
    const fields = fieldRecord(node.fields);
    const question = fields[FAQ_FIELDS.question]
      ? cleanText(fields[FAQ_FIELDS.question]).slice(0, 300)
      : '';
    const answer = richTextToParagraphs(fields[FAQ_FIELDS.answer]);
    if (question === '' || answer.length === 0) continue;
    faqs.push({id: node.id ?? `faq-${faqs.length}`, question, answer});
  }
  return faqs;
}

export function mapProductPage(
  product: ProductSource,
  availability: AvailabilitySource | null,
): ProductPageView {
  const metafields = indexMetafields(product.metafields);
  return {
    id: product.id,
    handle: product.handle,
    title: product.title,
    vendor: product.vendor,
    productType: product.productType,
    description: textToParagraphs(product.description),
    seoTitle: product.seo.title ? cleanText(product.seo.title) : null,
    seoDescription: product.seo.description
      ? cleanText(product.seo.description)
      : null,
    images: mapImages(product),
    options: product.options.map((option) => ({
      name: option.name,
      values: option.optionValues.map((value) => value.name),
    })),
    variants: mapVariants(product, availability),
    comfortLevel: readChoice(
      metafields,
      PRODUCT_METAFIELD_KEYS.comfortLevel,
      COMFORT_LEVELS,
    ),
    mattressType: readChoice(
      metafields,
      PRODUCT_METAFIELD_KEYS.mattressType,
      MATTRESS_TYPES,
    ),
    sleepPositions: readChoices(
      metafields,
      PRODUCT_METAFIELD_KEYS.sleepPositions,
      SLEEP_POSITIONS,
    ),
    benefits: readChoices(
      metafields,
      PRODUCT_METAFIELD_KEYS.benefits,
      BENEFITS,
    ),
    productLine: readText(metafields, PRODUCT_METAFIELD_KEYS.productLine),
    heightInches: readPositiveNumber(
      metafields,
      PRODUCT_METAFIELD_KEYS.heightInches,
    ),
    specifications: readSpecifications(metafields, 'specifications'),
    features: readTextList(metafields, 'features'),
    brand: mapBrand(product),
    faqs: mapFaqs(product.faqs?.references?.nodes),
  };
}
