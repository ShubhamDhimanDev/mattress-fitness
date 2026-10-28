// Helix product records (read from the pages in a browser, see helix-browser.mjs and the README) to scraped products.
// A record is { url, title, h1, metaDescription, category, variants[], images[], bodyText }. Each variant carries the regular
// price in cents (`price`), the current promotional price (`discounted_price`, ignored: the retailer sets its own sale) and
// its dimensions.
import {
  benefitsFrom, classify, clip, comfortFrom, heightFrom, mattressTypeFrom, normalizeSize, oneLine, SIZE_ORDER,
} from './model.mjs';

const SIZE_WORDS = new Set([...SIZE_ORDER, 'Short Queen', 'RV King', 'Split King', 'Split Queen', 'Split Head King', 'Split Head Queen']);

/** @param {string[]} values */
function optionNameFor(values, index) {
  const sizes = values.map((value) => normalizeSize(value));
  if (sizes.every((value) => SIZE_WORDS.has(value))) return 'Size';
  if (values.some((value) => /cover|knit|tencel/i.test(value))) return 'Cover';
  if (values.some((value) => /support|ergoalign|layer/i.test(value))) return 'Support';
  if (values.some((value) => /charcoal|white|oak|walnut|black|grey|gray|natural|color/i.test(value))) return 'Color';
  return `Option ${index + 1}`;
}

/**
 * @param {{ brand: string, origin: string, slug: string }} site
 * @param {any} record
 * @returns {import('./build.mjs').ScrapedProduct | null}
 */
export function parseHelixRecord(site, record) {
  const rawTitle = oneLine(record.h1 || record.title || '');
  const handle = String(record.url ?? '').split('/').pop() ?? '';
  const { kind, productType } = classify({ title: rawTitle, typeHint: String(record.category ?? ''), handle });
  if (kind === 'skip' || !Array.isArray(record.variants) || record.variants.length === 0) return null;
  const title = kind === 'Mattress' && !/mattress|bed\b/i.test(rawTitle) ? `${rawTitle} Mattress` : rawTitle;

  /** @type {any[]} */
  const rows = record.variants.filter((variant) => Number(variant.price) > 0);
  if (rows.length === 0) return null;
  const columns = [1, 2, 3].filter((n) => rows.some((row) => oneLine(row[`option_${n}_label`] ?? row[`option_${n}`] ?? '') !== ''));
  // The variant title ("Twin / Breathe Knit Cover / Standard Support") has every option in its proper case; option_N is lower-cased.
  const valuesFor = (/** @type {number} */ n) => rows.map((row) => {
    const parts = oneLine(row.title ?? '').split(' / ');
    return oneLine(parts.length === columns.length ? parts[columns.indexOf(n)] : row[`option_${n}_label`] ?? row[`option_${n}`] ?? '');
  });
  const options = columns.map((n, index) => {
    const raw = valuesFor(n);
    const name = optionNameFor(raw, index);
    return { name, values: [...new Set(raw.map((value) => (name === 'Size' ? normalizeSize(value) : value)))] };
  }).filter((option, _, all) => option.values.length > 1 || all.every((o) => o.values.length <= 1));
  const keepNames = new Set(options.map((option) => option.name));
  const finalOptions = options.length ? options : [{ name: 'Title', values: ['Default'] }];

  const variants = rows.map((row, rowIndex) => {
    const values = columns.map((n, index) => {
      const raw = valuesFor(n)[rowIndex];
      const name = optionNameFor(valuesFor(n), index);
      return { name, value: name === 'Size' ? normalizeSize(raw) : raw };
    }).filter((entry) => keepNames.has(entry.name));
    const dims = /(\d+(?:\.\d+)?)\s*in\s*W\s*[×x]\s*(\d+(?:\.\d+)?)\s*in\s*L/i.exec(row.metafields?.dimensions ?? '');
    return {
      sku: record.sku ? `${record.sku}-${row.id}` : '',
      options: values.length ? values.map((entry) => entry.value) : ['Default'],
      priceCents: Math.round(Number(row.price)),
      compareAtCents: null,
      image: null,
      dimensions: dims ? `${dims[1]} in x ${dims[2]} in` : '',
    };
  });

  const heightMatch = rows.map((row) => /(\d+(?:\.\d+)?)\s*in\s*H/i.exec(row.metafields?.dimensions ?? '')).find(Boolean);
  const text = oneLine(record.bodyText ?? '');
  const buyIf = /Buy if:\s*(.+?)(?:\s{2,}|Firm Feel|Medium Feel|Soft Feel|Plush Feel|$)/i.exec(text)?.[1] ?? '';
  const description = [oneLine(record.metaDescription ?? ''), buyIf && `Buy if: ${oneLine(buyIf).replace(/^Buy if:\s*/i, '').slice(0, 300)}`].filter(Boolean).join('\n\n');
  const seen = new Set();
  // The page shows 300 px thumbnails; the same Cloudinary path serves a 1600 px version.
  const images = (record.images ?? [])
    .filter((src) => /\.(webp|jpe?g|png)/i.test(src) && !/icon|logo|badge|sprite|\.svg/i.test(src))
    .map((src) => src.replace(/\/upload\/w_\d+,c_limit/, '/upload/w_1600,c_limit'))
    .filter((src) => { const key = src.replace(/\/v\d+\//, '/'); return !seen.has(key) && seen.add(key); })
    .slice(0, 8)
    .map((src) => ({ src, alt: title }));
  const haystack = `${title} ${description} ${text.slice(0, 1500)}`;

  return {
    brand: site.brand,
    source: site.slug,
    sourceUrl: record.url,
    sourceHandle: handle,
    title,
    kind,
    productType,
    description,
    bullets: [],
    specs: {},
    comfort: kind === 'Mattress' ? comfortFrom(`${text.slice(0, 600)} ${title}`) : null,
    mattressType: kind === 'Mattress' ? mattressTypeFrom(`${title} ${description} ${handle}`) ?? mattressTypeFrom(text.slice(0, 2000)) : null,
    heightInches: kind === 'Mattress' ? (heightMatch ? Number(heightMatch[1]) : heightFrom(text)) : null,
    benefits: kind === 'Mattress' ? benefitsFrom(haystack) : [],
    options: finalOptions,
    variants,
    images,
    seoTitle: oneLine(record.title ?? '').split(' - ')[0],
    seoDescription: clip(record.metaDescription || description, 160),
    notes: ['Read through a browser session, one page at a time.'],
    updatedAt: record.fetchedAt ?? '',
  };
}
