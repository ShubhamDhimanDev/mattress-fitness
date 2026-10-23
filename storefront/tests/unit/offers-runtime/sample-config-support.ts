// TEST ONLY. Shared by the sample-config tests (P4-12 interim, DEC-082): reads the PLACEHOLDER example offer
// configuration and the made-up sample catalog sheets, and answers the cart-offer Storefront queries from that
// sheet data. Nothing here talks to a store; every id is a fake placeholder (see offer-config.example.json).

import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {parseOfferConfig} from '~/lib/offers-runtime/config';
import {validateSheet} from '../../../../scripts/catalog/validate.mjs';
import type {RecordedCall} from '../catalog/fake-storefront';

/** Canonical size order of the product sheet (scripts/catalog/schema.mjs); the placeholder id scheme uses it. */
export const SIZES = [
  'Twin',
  'Twin XL',
  'Full',
  'Queen',
  'King',
  'California King',
  'Split California King',
] as const;
export type SampleSize = (typeof SIZES)[number];

function pathOf(relative: string): string {
  return fileURLToPath(new URL(relative, import.meta.url));
}

const CONFIG_PATH = pathOf('../../../offer-config.example.json');
const SAMPLE_DIR = '../../../../scripts/catalog/sample/';

export function readExampleConfigText(): string {
  return readFileSync(CONFIG_PATH, 'utf8');
}

/** The example configuration the way an env file carries it: one line, no formatting. */
export function minifiedExampleConfig(): string {
  return JSON.stringify(JSON.parse(readExampleConfigText()));
}

export function loadExampleConfig() {
  return parseOfferConfig(JSON.parse(readExampleConfigText()));
}

// ---------------------------------------------------------------------------------------------------
// The placeholder id scheme, written down independently of the JSON so the test can catch a mismatch.
// ---------------------------------------------------------------------------------------------------

export const PRODUCT_NUMBER: Readonly<Record<string, number>> = {
  'luxe-hybrid': 7001,
  'luxe-foam': 7002,
  'cloudmere-hybrid': 7003,
  'sample-foundation': 7101,
  'sample-protector': 7102,
  'sample-pillow': 7103,
  'sample-gift-pillow': 7104,
  'sample-sheets': 7105,
  'recycle-and-disposal-service': 7106,
};

export const HAUL_HANDLE = 'recycle-and-disposal-service';

export function productId(handle: string): string {
  const number = PRODUCT_NUMBER[handle];
  if (number === undefined) throw new Error(`no placeholder id for ${handle}`);
  return `gid://shopify/Product/${number}`;
}

export function variantId(handle: string, size: SampleSize): string {
  const number = PRODUCT_NUMBER[handle];
  if (number === undefined) throw new Error(`no placeholder id for ${handle}`);
  return `gid://shopify/ProductVariant/${number * 10 + SIZES.indexOf(size) + 1}`;
}

export type DecodedVariant = {
  readonly handle: string;
  readonly size: SampleSize;
};

/** The product and size a placeholder variant id stands for, or null when it is not one of ours. */
export function decodeVariant(id: string): DecodedVariant | null {
  const match = /^gid:\/\/shopify\/ProductVariant\/(\d+)$/.exec(id);
  if (!match) return null;
  const value = Number(match[1]);
  const number = Math.floor(value / 10);
  const size = SIZES[(value % 10) - 1];
  const handle = Object.keys(PRODUCT_NUMBER).find(
    (candidate) => PRODUCT_NUMBER[candidate] === number,
  );
  return handle !== undefined && size !== undefined ? {handle, size} : null;
}

export function decodeProduct(id: string): string | null {
  const match = /^gid:\/\/shopify\/Product\/(\d+)$/.exec(id);
  if (!match) return null;
  return (
    Object.keys(PRODUCT_NUMBER).find(
      (candidate) => PRODUCT_NUMBER[candidate] === Number(match[1]),
    ) ?? null
  );
}

// ---------------------------------------------------------------------------------------------------
// The sample catalog: both sheets, validated by the real catalog validator.
// ---------------------------------------------------------------------------------------------------

export type SampleVariant = {
  readonly size: string;
  readonly sku: string;
  /** Regular price in cents. */
  readonly priceCents: number;
  /** What a shopper pays: the sale price when there is one (the importer makes it the variant price). */
  readonly payableCents: number;
};

export type SampleProduct = {
  readonly handle: string;
  readonly model: string;
  readonly productType: string;
  readonly variants: readonly SampleVariant[];
};

function sheet(name: string) {
  const text = readFileSync(pathOf(`${SAMPLE_DIR}${name}`), 'utf8');
  const report = validateSheet(text, {availableImages: null});
  if (!report.ok) {
    throw new Error(
      `${name} does not validate: ${report.summary.errors} errors`,
    );
  }
  return report;
}

/** Price of the haul-away service, set by hand in admin (OFFER_SETUP_DEVSTORE.md); the sheet cannot hold a one-variant product. */
export const HAUL_PRICE_CENTS = 4900;

export function loadSampleCatalog(): ReadonlyMap<string, SampleProduct> {
  const catalog = new Map<string, SampleProduct>();
  for (const name of ['mattresses.csv', 'offer-products.csv']) {
    for (const product of sheet(name).products) {
      if (catalog.has(product.handle)) {
        throw new Error(`handle ${product.handle} is in two sample sheets`);
      }
      catalog.set(product.handle, {
        handle: product.handle,
        model: product.model,
        productType: product.productType,
        variants: product.variants.map((variant) => ({
          size: variant.size,
          sku: variant.sku,
          priceCents: variant.priceCents,
          payableCents: variant.salePriceCents ?? variant.priceCents,
        })),
      });
    }
  }
  return catalog;
}

/** Related-product handles that mattresses.csv names, for the "every referenced handle exists" check. */
export function relatedHandlesOfMattressSheet(): ReadonlySet<string> {
  const related = new Set<string>();
  for (const product of sheet('mattresses.csv').products) {
    for (const handle of [
      ...product.relatedFoundations,
      ...product.relatedProtectors,
      ...product.relatedBedding,
    ]) {
      related.add(handle);
    }
  }
  return related;
}

export function dollars(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------------------------------
// A Storefront stand-in that answers the cart-offer queries from the sample catalog.
// ---------------------------------------------------------------------------------------------------

type VariantFact = {
  readonly id: string;
  readonly title: string;
  readonly options: readonly {name: string; value: string}[];
  readonly amount: string;
  readonly productTitle: string;
  readonly productHandle: string;
  readonly productId: string;
};

function variantFacts(
  catalog: ReadonlyMap<string, SampleProduct>,
): ReadonlyMap<string, VariantFact> {
  const facts = new Map<string, VariantFact>();
  for (const handle of Object.keys(PRODUCT_NUMBER)) {
    if (handle === HAUL_HANDLE) {
      const id = variantId(HAUL_HANDLE, 'Twin');
      facts.set(id, {
        id,
        title: 'Default Title',
        options: [{name: 'Title', value: 'Default Title'}],
        amount: dollars(HAUL_PRICE_CENTS),
        productTitle: 'Recycle and disposal service',
        productHandle: HAUL_HANDLE,
        productId: productId(HAUL_HANDLE),
      });
      continue;
    }
    const product = catalog.get(handle);
    if (!product) throw new Error(`${handle} is not in the sample sheets`);
    for (const variant of product.variants) {
      const size = SIZES.find((candidate) => candidate === variant.size);
      if (!size) throw new Error(`unknown size ${variant.size}`);
      const id = variantId(handle, size);
      facts.set(id, {
        id,
        title: variant.size,
        options: [{name: 'Size', value: variant.size}],
        amount: dollars(variant.payableCents),
        productTitle: product.model,
        productHandle: handle,
        productId: productId(handle),
      });
    }
  }
  return facts;
}

export function sampleStorefrontResponder(
  catalog: ReadonlyMap<string, SampleProduct>,
  options: {readonly soldOut?: readonly string[]} = {},
) {
  const facts = variantFacts(catalog);
  const soldOut = new Set(options.soldOut ?? []);
  const idsOf = (call: RecordedCall): string[] =>
    Array.isArray(call.variables.ids)
      ? call.variables.ids.filter((id): id is string => typeof id === 'string')
      : [];

  return (call: RecordedCall): unknown => {
    if (call.query.includes('query CartOfferProducts')) {
      return {
        nodes: idsOf(call).flatMap((id) => {
          const variants = [...facts.values()].filter(
            (fact) => fact.productId === id,
          );
          if (variants.length === 0) return [];
          return [
            {
              id,
              variants: {
                nodes: variants.map((fact) => ({
                  id: fact.id,
                  title: fact.title,
                  availableForSale: !soldOut.has(fact.id),
                  selectedOptions: fact.options,
                })),
              },
              collections: {nodes: []},
            },
          ];
        }),
      };
    }
    if (call.query.includes('query CartOfferVariants')) {
      return {
        nodes: idsOf(call).flatMap((id) => {
          const fact = facts.get(id);
          return fact
            ? [
                {
                  id,
                  title: fact.title,
                  availableForSale: !soldOut.has(id),
                  price: {amount: fact.amount, currencyCode: 'USD'},
                  product: {
                    id: fact.productId,
                    title: fact.productTitle,
                    handle: fact.productHandle,
                  },
                },
              ]
            : [];
        }),
      };
    }
    return {};
  };
}
