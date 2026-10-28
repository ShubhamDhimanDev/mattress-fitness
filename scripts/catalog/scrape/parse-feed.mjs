// Shopify product feed (/products.json) to scraped products. Used for Molecule, Brooklyn Bedding, Puffy, Kingsdown and Casper.
import {
  benefitsFrom, classify, clip, comfortFrom, heightFrom, htmlToText, looksLikeSizeOption, mattressTypeFrom, normalizeSize, oneLine, toCents,
} from './model.mjs';

/** "Queen  -  (60"W x 80"L x 14"H) / Hybrid" carries the dimensions and height in the option value (Puffy). @param {string} value */
function dimensionsFromValue(value) {
  const match = /(\d+(?:\.\d+)?)"?\s*W\s*x\s*(\d+(?:\.\d+)?)"?\s*L(?:\s*x\s*(\d+(?:\.\d+)?)"?\s*H)?/i.exec(value);
  return match ? { dimensions: `${match[1]} in x ${match[2]} in`, height: match[3] ? Number(match[3]) : null } : null;
}

/**
 * @param {{ brand: string, origin: string, slug: string }} site
 * @param {any} item one entry of the feed's `products`
 * @returns {import('./build.mjs').ScrapedProduct | null}
 */
export function parseFeedProduct(site, item) {
  const title = oneLine(item.title).replace(/\s*\((free upgrade|new)\)\s*/gi, ' ').trim();
  const { kind, productType } = classify({ title, typeHint: item.product_type ?? '', handle: item.handle });
  if (kind === 'skip') return null;

  const text = htmlToText(item.body_html ?? '');
  const bullets = text.split('\n').filter((line) => line.startsWith('- ')).map((line) => line.slice(2).trim()).filter((line) => line.length > 1 && line.length <= 200).slice(0, 12);
  const description = text.split('\n').filter((line) => !line.startsWith('- ')).join('\n').replace(/\n{3,}/g, '\n\n').trim();

  /** @type {{ name: string, values: string[] }[]} */
  let options = item.options.map((/** @type {any} */ option) => ({ name: oneLine(option.name), values: option.values.map((/** @type {string} */ v) => oneLine(v)) }));
  const sizeIndex = options.findIndex((option) => looksLikeSizeOption(option.name));
  let height = null;
  const dimensionByVariant = new Map();
  if (sizeIndex >= 0) {
    for (const value of options[sizeIndex].values) {
      const found = dimensionsFromValue(value);
      if (found) {
        dimensionByVariant.set(value, found.dimensions);
        height ??= found.height;
      }
    }
  }
  const mapValue = (/** @type {number} */ index, /** @type {string} */ value) => (index === sizeIndex ? normalizeSize(value) : value);
  options = options.map((option, index) => ({ name: index === sizeIndex ? 'Size' : option.name, values: [...new Set(option.values.map((v) => mapValue(index, v)))] }));

  // The default "Title / Default Title" option of a one-variant product, and options with a single value next to a real option, say nothing.
  const keepIndexes = options.map((option, index) => index).filter((index) => options[index].name !== 'Title' && (options[index].values.length > 1 || options.every((o) => o.values.length <= 1)));
  const finalIndexes = keepIndexes.length ? keepIndexes : [0];

  const variants = item.variants.map((/** @type {any} */ variant) => {
    const raw = [variant.option1, variant.option2, variant.option3];
    const sizeValue = sizeIndex >= 0 ? oneLine(raw[sizeIndex]) : '';
    return {
      sku: oneLine(variant.sku ?? ''),
      options: finalIndexes.map((index) => mapValue(index, oneLine(raw[index] ?? ''))),
      priceCents: toCents(variant.price) ?? 0,
      compareAtCents: toCents(variant.compare_at_price) && toCents(variant.compare_at_price) > (toCents(variant.price) ?? 0) ? toCents(variant.compare_at_price) : null,
      image: variant.featured_image?.src ?? null,
      dimensions: dimensionByVariant.get(sizeValue) ?? '',
    };
  });
  if (variants.length === 0 || variants.every((variant) => variant.priceCents <= 0)) return null;

  const haystack = `${title} ${item.handle} ${text} ${(item.tags ?? []).join(' ')}`;
  return {
    brand: site.brand,
    source: site.slug,
    sourceUrl: `${site.origin}/products/${item.handle}`,
    sourceHandle: item.handle,
    title,
    kind,
    productType,
    description,
    bullets,
    specs: {},
    comfort: kind === 'Mattress' ? comfortFrom(`${title} ${item.handle}`) ?? comfortFrom(text) : null,
    mattressType: kind === 'Mattress' ? mattressTypeFrom(`${title} ${item.handle} ${(item.tags ?? []).join(' ')}`) ?? mattressTypeFrom(text) : null,
    heightInches: kind === 'Mattress' ? height ?? heightFrom(`${title} ${item.handle.replace(/-/g, ' ')}`) ?? heightFrom(text) : null,
    benefits: kind === 'Mattress' ? benefitsFrom(haystack) : [],
    options: finalIndexes.map((index) => options[index]),
    variants,
    images: (item.images ?? []).map((/** @type {any} */ image) => ({ src: String(image.src).split('?')[0], alt: oneLine(image.alt ?? '') || title })),
    seoTitle: '',
    seoDescription: clip(description.split('\n')[0] ?? '', 160),
    updatedAt: item.updated_at ?? '',
  };
}
