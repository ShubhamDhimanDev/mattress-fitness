// Maps validated sheet products to the shape the importer compares and writes (REQ-CAT-002, REQ-CAT-003).
// Pure functions only: no I/O, so every mapping rule is unit-tested without a store.
//
// Mapping decisions (see README for the client-facing version):
//  - One product per model, one variant per size, option name "Size" (SOW section 8, SHOPIFY_DATA_MODEL).
//  - sale_price present  -> variant price = sale price, compareAtPrice = regular price (REQ-CAT-002).
//    sale_price blank    -> price = regular price, compareAtPrice = null.
//  - copy_approved = yes -> ACTIVE, otherwise DRAFT: only approved copy is published (REQ-CAT-004, CLR-017).
//  - Attributes become metafields in namespace "custom" (data model) and, for legacy rule-based
//    collections, prefixed tags. Tags the client added by hand are kept (see mergeTags).

import { escapeHtml } from './sanitize.mjs';
import { METAFIELD_NAMESPACE, SIZES } from './schema.mjs';

export const SIZE_OPTION_NAME = 'Size';
export const MAX_ALT_LENGTH = 512;

/** Tags with these prefixes are owned by the importer; all other tags are the client's. */
export const MANAGED_TAG_PREFIXES = Object.freeze(['brand:', 'comfort:', 'type:', 'line:', 'position:', 'benefit:', 'delivery:']);

/**
 * @typedef {{ namespace: string, key: string, type: string, value: string }} MetafieldValue
 * @typedef {{ size: string, sku: string, price: string, compareAtPrice: string | null, metafields: MetafieldValue[] }} DesiredVariant
 * @typedef {{ fileName: string, alt: string }} DesiredImage
 * @typedef {object} DesiredProduct
 * @property {string} handle
 * @property {string} title
 * @property {string} descriptionHtml
 * @property {string} vendor
 * @property {string} productType
 * @property {'ACTIVE' | 'DRAFT'} status
 * @property {string[]} tags              managed tags only
 * @property {string | null} seoTitle
 * @property {string | null} seoDescription
 * @property {string[]} sizes
 * @property {DesiredVariant[]} variants
 * @property {MetafieldValue[]} metafields
 * @property {DesiredImage[]} images
 * @property {string[]} warnings          mapping notes, for example unresolved related handles
 */

/**
 * @param {number} cents
 * @returns {string} "1299.00"
 */
export function formatMoney(cents) {
  const whole = Math.trunc(cents / 100);
  const fraction = String(cents % 100).padStart(2, '0');
  return `${whole}.${fraction}`;
}

/**
 * @param {string} text
 * @returns {string}
 */
export function slugify(text) {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Plain text to safe HTML: a blank line separates paragraphs, a single newline becomes <br>.
 * Everything is escaped first, so the sheet can never inject markup (T-07, T-15).
 * @param {string | null} description
 * @returns {string}
 */
export function descriptionToHtml(description) {
  if (!description) return '';
  return description
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== '')
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

/**
 * @param {import('./validate.mjs').Product} product
 * @returns {string[]} sorted, unique, managed tags
 */
export function buildTags(product) {
  /** @type {string[]} */
  const tags = [`brand:${product.brand}`];
  if (product.comfortLevel) tags.push(`comfort:${product.comfortLevel}`);
  if (product.mattressType) tags.push(`type:${product.mattressType}`);
  if (product.productLine) tags.push(`line:${product.productLine}`);
  if (product.deliveryType) tags.push(`delivery:${product.deliveryType}`);
  for (const position of product.sleepPositions) tags.push(`position:${position}`);
  for (const benefit of product.benefits) tags.push(`benefit:${benefit}`);
  return [...new Set(tags)].sort();
}

/**
 * Keeps the client's own tags, replaces ours.
 * @param {readonly string[]} remoteTags
 * @param {readonly string[]} managedTags
 * @returns {string[]}
 */
export function mergeTags(remoteTags, managedTags) {
  const kept = remoteTags.filter((tag) => !MANAGED_TAG_PREFIXES.some((prefix) => tag.toLowerCase().startsWith(prefix)));
  return [...new Set([...kept, ...managedTags])].sort();
}

/**
 * Longest names first so "california-king" wins over "king" and "twin-xl" over "twin".
 * @param {string} fileName
 * @returns {string | null}
 */
export function detectSizeInFilename(fileName) {
  const normalised = `-${fileName.toLowerCase().replace(/\.[a-z0-9]+$/, '').replace(/[^a-z0-9]+/g, '-')}-`;
  const candidates = [...SIZES].sort((a, b) => b.length - a.length);
  return candidates.find((size) => normalised.includes(`-${slugify(size)}-`)) ?? null;
}

/**
 * Alt text from the product title and, where the file name or the product tells us, the size.
 * "Image of" is left out: screen readers already announce an image.
 * @param {string} title
 * @param {string} fileName
 * @param {number} index zero-based position in the gallery
 * @param {readonly string[]} sizes the product's sizes
 * @returns {string}
 */
export function buildAltText(title, fileName, index, sizes) {
  const size = detectSizeInFilename(fileName) ?? (sizes.length === 1 ? sizes[0] : null);
  const parts = [title];
  if (size) parts.push(`${size} size`);
  if (index > 0) parts.push(`view ${index + 1}`);
  return parts.join(', ').slice(0, MAX_ALT_LENGTH);
}

/** @param {string} key @param {string} type @param {string} value @returns {MetafieldValue} */
function meta(key, type, value) {
  return { namespace: METAFIELD_NAMESPACE, key, type, value };
}

/**
 * @typedef {object} MapContext
 * @property {string | null} brandMetaobjectId  GID of the brand metaobject, if one exists
 * @property {Record<'relatedFoundations' | 'relatedProtectors' | 'relatedBedding', string[]>} relatedProductIds  resolved GIDs
 * @property {string[]} [warnings]
 */

/**
 * @param {import('./validate.mjs').Product} product
 * @param {MapContext} context
 * @returns {MetafieldValue[]} blank sheet cells produce no metafield, so they never overwrite admin edits
 */
export function buildProductMetafields(product, context) {
  /** @type {MetafieldValue[]} */
  const out = [];
  if (product.comfortLevel) out.push(meta('comfort_level', 'single_line_text_field', product.comfortLevel));
  if (product.mattressType) out.push(meta('mattress_type', 'single_line_text_field', product.mattressType));
  if (product.sleepPositions.length > 0) out.push(meta('sleep_positions', 'list.single_line_text_field', JSON.stringify(product.sleepPositions)));
  if (product.benefits.length > 0) out.push(meta('benefits', 'list.single_line_text_field', JSON.stringify(product.benefits)));
  if (product.productLine) out.push(meta('product_line', 'single_line_text_field', product.productLine));
  if (product.heightInches) out.push(meta('height_inches', 'number_decimal', product.heightInches));
  if (product.deliveryType) out.push(meta('delivery_type', 'single_line_text_field', product.deliveryType));
  if (product.specifications.length > 0) out.push(meta('specifications', 'json', JSON.stringify(product.specifications)));
  if (product.bullets.length > 0) out.push(meta('features', 'list.single_line_text_field', JSON.stringify(product.bullets)));
  if (product.compareGroup) out.push(meta('compare_group', 'single_line_text_field', product.compareGroup));
  if (product.extendCategory) out.push(meta('extend_category', 'single_line_text_field', product.extendCategory));
  if (context.brandMetaobjectId) out.push(meta('brand', 'metaobject_reference', context.brandMetaobjectId));
  const related = /** @type {const} */ ([
    ['related_foundations', 'relatedFoundations'],
    ['related_protectors', 'relatedProtectors'],
    ['related_bedding', 'relatedBedding'],
  ]);
  for (const [key, field] of related) {
    const ids = context.relatedProductIds[field];
    if (ids.length > 0) out.push(meta(key, 'list.product_reference', JSON.stringify(ids)));
  }
  return out;
}

/**
 * @param {import('./validate.mjs').Product} product
 * @param {MapContext} context
 * @returns {DesiredProduct}
 */
export function toDesiredProduct(product, context) {
  const sizes = product.variants.map((variant) => variant.size);
  return {
    handle: product.handle,
    title: product.model,
    descriptionHtml: descriptionToHtml(product.description),
    vendor: product.brand,
    productType: product.productType,
    status: product.copyApproved ? 'ACTIVE' : 'DRAFT',
    tags: buildTags(product),
    seoTitle: product.seoTitle,
    seoDescription: product.seoDescription,
    sizes,
    variants: product.variants.map((variant) => ({
      size: variant.size,
      sku: variant.sku,
      price: formatMoney(variant.salePriceCents ?? variant.priceCents),
      compareAtPrice: variant.salePriceCents === null ? null : formatMoney(variant.priceCents),
      metafields: variant.dimensions ? [meta('dimensions', 'single_line_text_field', variant.dimensions)] : [],
    })),
    metafields: buildProductMetafields(product, context),
    images: product.images.map((fileName, index) => ({ fileName, alt: buildAltText(product.model, fileName, index, sizes) })),
    warnings: context.warnings ?? [],
  };
}

/**
 * Canonical form for comparing metafield values that Shopify may re-serialise
 * (list and JSON types, decimals).
 * @param {string} type
 * @param {string} value
 * @returns {string}
 */
export function normaliseMetafieldValue(type, value) {
  try {
    if (type === 'json' || type.startsWith('list.')) return canonicalJson(JSON.parse(value));
    if (type === 'number_decimal' || type === 'number_integer') return String(Number(value));
  } catch {
    return value;
  }
  return value;
}

/**
 * @param {unknown} value
 * @returns {string} JSON with object keys sorted
 */
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, inner]) => `${JSON.stringify(key)}:${canonicalJson(inner)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * @param {Pick<MetafieldValue, 'type' | 'value'>} a
 * @param {Pick<MetafieldValue, 'type' | 'value'>} b
 */
export function metafieldValuesEqual(a, b) {
  return normaliseMetafieldValue(a.type, a.value) === normaliseMetafieldValue(b.type, b.value);
}
