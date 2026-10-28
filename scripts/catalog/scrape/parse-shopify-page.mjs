// Serta and Beautyrest product pages to scraped products. Both sites share one catalog: each page carries a schema.org
// ProductGroup (name, description, one entry per variant with price, SKU and photo) and an Overview/Details text block.
// The names of a second option (for example the feel) are drawn by JavaScript and are not in the page, so variants that share
// a size are told apart by the part number in their SKU, and the notes say so.
import { jsonLdNodes, metaContent, pageTitle, visibleText } from './html.mjs';
import {
  benefitsFrom, classify, clip, comfortFrom, heightFrom, mattressTypeFrom, normalizeSize, oneLine, SIZE_ORDER, toCents,
} from './model.mjs';

const KNOWN_SIZES = new Set([...SIZE_ORDER, 'Split Head Queen', 'Split Head King', 'Split Head California King', 'Split King', 'Short Queen', 'RV King']);

/** The text between two markers, or '' when either is missing. */
function between(text, start, endPattern) {
  const at = text.indexOf(start);
  if (at < 0) return '';
  const rest = text.slice(at + start.length);
  const end = rest.search(endPattern);
  return (end < 0 ? rest : rest.slice(0, end)).trim();
}

/** @param {string} url @returns {string} the file part of an image URL, for duplicate detection */
const imageKey = (url) => url.split('?')[0].split('/').pop() ?? url;

/**
 * @param {{ brand: string, origin: string, slug: string }} site
 * @param {string} html
 * @param {string} url
 * @returns {import('./build.mjs').ScrapedProduct | null}
 */
export function parseShopifyPage(site, html, url) {
  const nodes = jsonLdNodes(html);
  /** @type {any} */
  const group = nodes.find((node) => /** @type {any} */ (node)['@type'] === 'ProductGroup') ?? nodes.find((node) => /** @type {any} */ (node)['@type'] === 'Product');
  if (!group) return null;
  const handle = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '');
  const rawTitle = oneLine(group.name ?? '');
  const { kind, productType } = classify({ title: rawTitle, typeHint: String(group.category ?? ''), handle });
  if (kind === 'skip') return null;
  const title = kind === 'Mattress' && !/mattress|bed\b/i.test(rawTitle) ? `${rawTitle} Mattress` : rawTitle;

  /** @type {any[]} */
  const entries = group.hasVariant ?? [{ name: 'Default', offers: group.offers, sku: group.sku, image: group.image }];
  const priced = entries.filter((entry) => toCents(entry.offers?.price));
  if (priced.length === 0) return null;

  const names = priced.map((entry) => normalizeSize(entry.name ?? 'Default'));
  const allSizes = names.every((name) => KNOWN_SIZES.has(name));
  const duplicates = new Set(names).size !== names.length;
  const skuBase = (/** @type {any} */ entry) => String(entry.sku ?? '').split('-')[0];
  const bases = [...new Set(priced.map(skuBase))];

  /** @type {{ name: string, values: string[] }[]} */
  const options = [{ name: allSizes ? 'Size' : 'Option', values: [...new Set(names)] }];
  const notes = [];
  if (duplicates && bases.length > 1 && allSizes) {
    options.push({ name: 'Configuration', values: bases.map((base) => `Part ${base}`) });
    notes.push('Several configurations share each size; their names (for example the feel) are drawn by JavaScript on the maker site, so they are labelled by part number.');
  }
  const variants = priced.map((entry, index) => ({
    sku: oneLine(String(entry.sku ?? '')),
    options: options.length === 2 ? [names[index], `Part ${skuBase(entry)}`] : [names[index]],
    priceCents: toCents(entry.offers.price) ?? 0,
    compareAtCents: null,
    image: typeof entry.image === 'string' ? entry.image.split('?')[0] : null,
    dimensions: '',
  }));

  const text = visibleText(html);
  const overview = between(text, ' Overview ', / Details | FIND A RETAILER | FAQs /);
  const details = between(text, ' Details ', / FIND A RETAILER | Store Locator | FAQs /);
  const specs = {};
  for (const label of ['Comfort Type', 'Mattress Height', 'Cooling', 'Comfort Layers', 'Support System']) {
    const match = new RegExp(`${label}\\s+(.+?)(?=\\s+(?:Comfort Type|Mattress Height|Cooling|Comfort Layers|Support System|Materials|Shipping)\\b|$)`).exec(details);
    if (match && match[1].length <= 200) specs[label] = oneLine(match[1]);
  }
  // Pages without labelled specs describe the product in the Details block itself (up to the shipping terms).
  const detailsCore = details.split(/ Shipping,? (?:&|and)? ?Returns/i)[0].trim();
  const detailsText = Object.keys(specs).length === 0 && detailsCore.length > 30 && detailsCore.length < 1500 ? detailsCore : '';
  const description = [oneLine(group.description ?? ''), overview.length > 20 && overview.length < 1500 ? overview : '', detailsText].filter(Boolean).join('\n\n');
  const comfortText = specs['Comfort Type'] ?? '';
  const imageUrls = [group.image, metaContent(html, 'og:image'), ...priced.map((entry) => entry.image)].filter((u) => typeof u === 'string' && /^https?:/.test(u));
  const seen = new Set();
  const images = imageUrls.filter((u) => !seen.has(imageKey(u)) && seen.add(imageKey(u))).slice(0, 8).map((u) => ({ src: u.split('?')[0], alt: title }));
  const haystack = `${title} ${description} ${Object.values(specs).join(' ')}`;

  return {
    brand: site.brand,
    source: site.slug,
    sourceUrl: url,
    sourceHandle: handle,
    title,
    kind,
    productType,
    description,
    bullets: [],
    specs,
    comfort: kind === 'Mattress' ? comfortFrom(`${comfortText} ${title} ${handle.replace(/-/g, ' ')}`) : null,
    mattressType: kind === 'Mattress' ? mattressTypeFrom(`${title} ${handle} ${specs['Support System'] ?? ''} ${specs['Comfort Layers'] ?? ''}`) ?? mattressTypeFrom(description) : null,
    heightInches: kind === 'Mattress' ? (specs['Mattress Height'] ? heightFrom(specs['Mattress Height']) : null) ?? heightFrom(`${title} ${description}`) : null,
    benefits: kind === 'Mattress' ? benefitsFrom(haystack) : [],
    options,
    variants,
    images,
    seoTitle: pageTitle(html).split(':')[0].trim(),
    seoDescription: clip(metaContent(html, 'description') || description, 160),
    notes,
    updatedAt: '',
  };
}
