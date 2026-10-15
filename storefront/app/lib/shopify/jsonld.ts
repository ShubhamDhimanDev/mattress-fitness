// Structured data (REQ-PDP-002, REQ-COL-004). Built from the same view models the page renders, so the
// markup cannot drift from the visible content. The objects go to React Router's `meta` as
// `script:ld+json`, which serialises them safely; no HTML string is ever assembled here.
//
// No aggregateRating is emitted: there is no reviews source yet (Q-011), and rating markup without real
// reviews is a policy violation.

import {centsOf} from '~/lib/shopify/common';
import {selectionToSearch} from '~/lib/shopify/variant-selection';
import {fromCents} from '~/lib/money';
import type {FaqView, ProductPageView, VariantView} from '~/lib/shopify/types';

type JsonLd = Record<string, unknown>;

const IN_STOCK = 'https://schema.org/InStock';
const OUT_OF_STOCK = 'https://schema.org/OutOfStock';

function offerFor(
  product: ProductPageView,
  variant: VariantView,
  origin: string | null,
): JsonLd | null {
  const cents = centsOf(variant.price);
  if (cents === null) return null;
  const search = selectionToSearch(variant.selectedOptions);
  return {
    '@type': 'Offer',
    ...(variant.sku ? {sku: variant.sku} : {}),
    // `url` is optional on an Offer; a relative one is invalid, so without an origin it is left out.
    ...(origin
      ? {
          url: `${origin}/products/${product.handle}${search ? `?${search}` : ''}`,
        }
      : {}),
    price: fromCents(cents),
    priceCurrency: 'USD',
    availability: variant.available ? IN_STOCK : OUT_OF_STOCK,
  };
}

/**
 * `origin` is the configured site origin; null (or empty) when none is configured, in which case the absolute
 * `url` fields are left out rather than emitted as relative paths (P-L2).
 */
export function buildProductJsonLd(
  product: ProductPageView,
  origin: string | null,
): JsonLd {
  const offers = product.variants.flatMap((variant) => {
    const offer = offerFor(product, variant, origin);
    return offer ? [offer] : [];
  });
  const prices = product.variants
    .map((variant) => centsOf(variant.price))
    .filter((cents): cents is number => cents !== null);

  const description =
    product.seoDescription ?? product.description.join(' ').slice(0, 5000);
  // A Brand without a name is invalid markup, so a product with neither a brand entry nor a vendor has none.
  const brandName = product.brand?.name.trim() || product.vendor.trim();

  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.title,
    ...(origin ? {url: `${origin}/products/${product.handle}`} : {}),
    ...(description ? {description} : {}),
    ...(product.images.length > 0
      ? {image: product.images.map((image) => image.url)}
      : {}),
    ...(brandName ? {brand: {'@type': 'Brand', name: brandName}} : {}),
    ...(offers.length === 1
      ? {offers: offers[0]}
      : offers.length > 1
        ? {
            offers: {
              '@type': 'AggregateOffer',
              priceCurrency: 'USD',
              lowPrice: fromCents(Math.min(...prices)),
              highPrice: fromCents(Math.max(...prices)),
              offerCount: offers.length,
              offers,
            },
          }
        : {}),
  };
}

export type BreadcrumbEntry = {readonly name: string; readonly path: string};

/**
 * BreadcrumbList markup, or null without a site origin: Google requires absolute item URLs, and a relative one
 * is invalid markup, so no script is emitted then (the visible breadcrumb is unaffected).
 */
export function buildBreadcrumbJsonLd(
  entries: readonly BreadcrumbEntry[],
  origin: string | null,
): JsonLd | null {
  if (!origin) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: entries.map((entry, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: entry.name,
      item: `${origin}${entry.path}`,
    })),
  };
}

/** FAQPage markup, or null when there is nothing to describe (then no script is emitted). */
export function buildFaqJsonLd(faqs: readonly FaqView[]): JsonLd | null {
  if (faqs.length === 0) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((faq) => ({
      '@type': 'Question',
      name: faq.question,
      acceptedAnswer: {'@type': 'Answer', text: faq.answer.join('\n\n')},
    })),
  };
}
