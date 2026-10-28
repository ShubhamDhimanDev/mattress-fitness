// Tempur Sealy platform pages (tempurpedic.com, stearnsandfoster.com, sealy.com) to scraped products. Each page embeds
// window.__PRELOADED_PROPS__ with the product record (children = one per size/feel, with the retail price), the CMS blocks
// (feature list, measurements) and the photo galleries.
import { assignedJson } from './html.mjs';
import {
  benefitsFrom, classify, clip, comfortFrom, decodeEntities, heightFrom, htmlToText, mattressTypeFrom, normalizeSize, oneLine, toCents,
} from './model.mjs';

/** @param {any} node @param {string} code */
const attr = (node, code) => node.attributes?.find((/** @type {any} */ a) => a.code === code)?.value;

const OPTION_NAMES = { option_size: 'Size', option_feel: 'Feel', option_color: 'Color', option_top: 'Top', option_height: 'Height', option_pillow_loft: 'Loft', option_fill: 'Fill' };

/** @param {string} code */
function optionName(code) {
  return OPTION_NAMES[code] ?? code.replace(/^option_/, '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Walks CMS blocks and gathers the pieces of text we use. @param {any[]} modules */
function readModules(modules) {
  const bullets = [];
  const specs = {};
  const dimensions = new Map();
  let height = null;
  for (const module of modules) {
    const value = module.value ?? {};
    if (module.type === 'features') {
      for (const feature of value.features ?? []) {
        const name = oneLine(htmlToText(feature.title ?? ''));
        const desc = oneLine(htmlToText(feature.desc ?? '')).replace(/[ǁˇ*†‡]+$/g, '').trim();
        if (name && desc) bullets.push(`${name.charAt(0)}${name.slice(1).toLowerCase()}: ${desc}`.slice(0, 200));
      }
    }
    if (module.type === 'details') {
      for (const column of ['column1', 'column2', 'column3']) {
        for (const block of value[column] ?? []) {
          const title = oneLine(htmlToText(block.title ?? ''));
          const copy = oneLine(htmlToText(block.copy ?? ''));
          if (/measure|dimension/i.test(title)) {
            for (const match of copy.matchAll(/([A-Za-z][A-Za-z .]*?)\s*:\s*(\d+(?:\.\d+)?)\s*["”″]\s*x\s*(\d+(?:\.\d+)?)\s*["”″]/g)) {
              const size = normalizeSize(match[1]);
              if (!dimensions.has(size)) dimensions.set(size, `${match[2]} in x ${match[3]} in`);
            }
            const h = /Height\s*:\s*(\d+(?:\.\d+)?)/i.exec(copy);
            if (h) height = Number(h[1]);
          } else if (title && copy && copy.length < 220 && /construction|care|warranty/i.test(title)) {
            specs[title] = copy;
          }
        }
      }
    }
  }
  return { bullets, specs, dimensions, height };
}

/** Photos from the page galleries, widest rendition first. @param {any[]} modules */
function galleryImages(modules) {
  /** @type {{ src: string, alt: string }[]} */
  const found = [];
  const visit = (/** @type {any} */ node) => {
    if (Array.isArray(node)) node.forEach(visit);
    else if (node && typeof node === 'object') {
      if (node.type === 'image' && node.value?.url) {
        const rendition = node.value.renditions?.desktop_img?.url ?? node.value.url;
        found.push({ src: rendition, alt: oneLine(node.value.default_alt_text ?? node.value.title ?? '') });
      } else Object.values(node).forEach(visit);
    }
  };
  modules.filter((m) => m.type === 'gallery_block').forEach(visit);
  return found;
}

/**
 * @param {{ brand: string, origin: string, slug: string }} site
 * @param {string} html
 * @param {string} url
 * @returns {import('./build.mjs').ScrapedProduct[]}
 */
export function parseTsiPage(site, html, url) {
  const props = assignedJson(html, 'window.__PRELOADED_PROPS__ = ');
  if (!props?.configurator?.products_data) return [];
  /** @type {any[]} */
  const records = JSON.parse(props.configurator.products_data);
  const modules = props.page?.modules?.value ?? [];
  const { bullets, specs, dimensions, height } = readModules(modules);
  const metaText = oneLine(decodeEntities(props.page_chrome?.search_description ?? ''));
  const gallery = galleryImages(modules);

  return records.flatMap((record) => {
    const cls = record.product_class?.split('/').slice(-2, -1)[0] ?? '';
    const baseTitle = oneLine(decodeEntities(record.title));
    const { kind, productType } = classify({ title: baseTitle, typeHint: cls, handle: record.slug });
    if (kind === 'skip') return [];
    const title = kind === 'Mattress' && !/mattress|bed\b/i.test(baseTitle) ? `${baseTitle} Mattress` : baseTitle;

    const children = record.children?.length ? record.children : [record];
    const codes = JSON.parse(attr(record, 'product_options') ?? '[]');
    const optionCodes = codes.length ? codes : [];
    const options = optionCodes.map((/** @type {string} */ code) => ({
      name: optionName(code),
      values: [...new Set(children.map((/** @type {any} */ c) => oneLine(String(attr(c, code) ?? ''))).filter(Boolean))].map((v) => (code === 'option_size' ? normalizeSize(v) : v)),
    }));
    if (options.length === 0) options.push({ name: 'Title', values: ['Default'] });

    const variants = children.map((/** @type {any} */ child) => {
      const values = optionCodes.length ? optionCodes.map((/** @type {string} */ code) => {
        const raw = oneLine(String(attr(child, code) ?? ''));
        return code === 'option_size' ? normalizeSize(raw) : raw;
      }) : ['Default'];
      const size = optionCodes.includes('option_size') ? values[optionCodes.indexOf('option_size')] : '';
      return {
        sku: oneLine(String(child.upc ?? child.skus?.[0] ?? '')),
        options: values,
        priceCents: toCents(child.price?.retail ?? child.price?.excl_tax) ?? 0,
        compareAtCents: null,
        image: child.images?.[0]?.original ?? null,
        dimensions: dimensions.get(size) ?? '',
      };
    }).filter((/** @type {any} */ v) => v.priceCents > 0);
    if (variants.length === 0) return [];

    const feel = attr(record, 'option_feel') ?? '';
    const construction = attr(record, 'option_construction') ?? children.map((/** @type {any} */ c) => attr(c, 'option_construction')).find(Boolean) ?? '';
    const description = oneLine(decodeEntities(record.description ? htmlToText(record.description) : '')) || metaText;
    const categories = (record.category_names ?? []).join(' ');
    const haystack = `${title} ${description} ${construction} ${categories} ${bullets.join(' ')}`;

    const productImages = (record.images ?? [])
      .slice()
      .sort((a, b) => (/Product Feed/.test(a.role) ? 0 : 1) - (/Product Feed/.test(b.role) ? 0 : 1))
      .map((/** @type {any} */ image) => ({ src: image.original, alt: title }));
    const images = [...productImages, ...(records.length === 1 ? gallery : []), ...(props.hero?.hero_image_url && records.length === 1 ? [{ src: props.hero.hero_image_url, alt: title }] : [])];

    return [{
      brand: site.brand,
      source: site.slug,
      sourceUrl: url,
      sourceHandle: record.slug,
      title,
      kind,
      productType,
      description: description || '',
      bullets: records.length === 1 ? bullets.slice(0, 12) : [],
      specs: records.length === 1 ? specs : {},
      comfort: kind === 'Mattress' ? comfortFrom(`${feel} ${title}`) ?? comfortFrom(description) : null,
      mattressType: kind === 'Mattress' ? mattressTypeFrom(`${title} ${construction} ${categories}`) ?? mattressTypeFrom(haystack) : null,
      heightInches: kind === 'Mattress' ? (records.length === 1 ? height : null) ?? heightFrom(`${title} ${description}`) : null,
      benefits: kind === 'Mattress' ? benefitsFrom(haystack) : [],
      options,
      variants,
      images,
      seoTitle: oneLine(decodeEntities(props.page_chrome?.seo_title_bare ?? '')),
      seoDescription: clip(description, 160),
      updatedAt: record.date_updated ?? '',
    }];
  });
}
