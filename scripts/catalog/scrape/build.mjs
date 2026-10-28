#!/usr/bin/env node
// Builds the brand catalog from what the scrapers collected:
//   .scrape/raw/*.feed.json   Shopify feeds (shopify-feed.mjs)
//   .scrape/pages/<brand>/    page HTML (pages.mjs) and Helix records read in a browser
// and writes, into the brand-catalog folder:
//   brand-mattresses.shopify.csv   every product, in the column layout of Shopify's product export (Products > Import)
//   brand-mattresses.csv           the project sheet (scripts/catalog/README.md) for the products it can describe
//   review-notes.csv               what was derived, assumed or left out, per product
//   .scrape/products.json          the normalised products, for checking and for download-images.mjs
//
//   node scripts/catalog/scrape/build.mjs [--images-manifest <file>]
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stringifyCsv } from '../csv.mjs';
import { descriptionToHtml, formatMoney } from '../map.mjs';
import { SHOPIFY_COLUMNS } from '../to-shopify-csv.mjs';
import { COLUMN_NAMES, BENEFITS, SIZES } from '../schema.mjs';
import { FEED_BRANDS } from './shopify-feed.mjs';
import { cacheName } from './pages.mjs';
import { parseAireloomPage } from './parse-aireloom.mjs';
import { parseFeedProduct } from './parse-feed.mjs';
import { parseHelixRecord } from './parse-helix.mjs';
import { parseShopifyPage } from './parse-shopify-page.mjs';
import { parseTsiPage } from './parse-tsi.mjs';
import { STANDARD_DIMENSIONS, clip, comfortFrom, mattressTypeFrom, oneLine, positionsFor, slugify, titleKey } from './model.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, '../brand-catalog');
const SCRAPE = path.join(OUT, '.scrape');

/** @typedef {import('./model.mjs').Option} Option */
/**
 * @typedef {object} ScrapedProduct
 * @property {string} brand @property {string} source @property {string} sourceUrl @property {string} sourceHandle
 * @property {string} title @property {string} kind @property {string} productType @property {string} description
 * @property {string[]} bullets @property {Record<string, string>} specs
 * @property {string | null} comfort @property {string | null} mattressType @property {number | null} heightInches @property {string[]} benefits
 * @property {{ name: string, values: string[] }[]} options
 * @property {{ sku: string, options: string[], priceCents: number, compareAtCents: number | null, image: string | null, dimensions: string }[]} variants
 * @property {{ src: string, alt: string }[]} images
 * @property {string} seoTitle @property {string} seoDescription @property {string[]} [notes] @property {string} [updatedAt]
 * @property {string} [handle] @property {{ src: string, alt: string, file: string }[]} [planned]
 */

/** Brand keys: the site slug used by the scrapers, the display name, the SKU prefix and the handle prefix. */
export const BRANDS = Object.freeze({
  'tempur-pedic': { brand: 'Tempur-Pedic', origin: 'https://www.tempurpedic.com', code: 'TP', prefix: 'tempur' },
  'stearns-foster': { brand: 'Stearns & Foster', origin: 'https://www.stearnsandfoster.com', code: 'SF', prefix: 'stearns' },
  sealy: { brand: 'Sealy', origin: 'https://www.sealy.com', code: 'SEA', prefix: 'sealy' },
  molecule: { brand: 'Molecule', origin: 'https://moleculesleep.com', code: 'MOL', prefix: 'molecule' },
  serta: { brand: 'Serta', origin: 'https://www.serta.com', code: 'SER', prefix: 'serta' },
  'brooklyn-bedding': { brand: 'Brooklyn Bedding', origin: 'https://brooklynbedding.com', code: 'BB', prefix: 'brooklyn' },
  helix: { brand: 'Helix', origin: 'https://helixsleep.com', code: 'HLX', prefix: 'helix' },
  puffy: { brand: 'Puffy', origin: 'https://puffy.com', code: 'PUF', prefix: 'puffy' },
  beautyrest: { brand: 'Beautyrest', origin: 'https://www.beautyrest.com', code: 'BTR', prefix: 'beautyrest' },
  aireloom: { brand: 'Aireloom', origin: 'https://aireloom.com', code: 'AIR', prefix: 'aireloom' },
  kingsdown: { brand: 'Kingsdown', origin: 'https://kingsdown.com', code: 'KD', prefix: 'kingsdown' },
  casper: { brand: 'Casper', origin: 'https://casper.com', code: 'CAS', prefix: 'casper' },
});

const MAX_IMAGES = 8;
/** Sample add-on handles of the offer setup, as in the first brand sheet. */
const RELATED = { foundations: '', protectors: '', bedding: '' }; // the sample add-on products are deleted; real related products are linked later (owner)
const PROJECT_KINDS = new Set(['Mattress', 'Mattress Topper', 'Mattress Protector', 'Foundation', 'Adjustable Base']);
const MAX_COMBINATIONS = 8;

/** @param {string} dir */
const listFiles = (dir) => readdir(dir).catch(() => /** @type {string[]} */ ([]));
const readJson = async (/** @type {string} */ file) => JSON.parse(await readFile(file, 'utf8'));

/** @returns {Promise<{ products: ScrapedProduct[], skipped: string[] }>} */
export async function loadProducts() {
  /** @type {ScrapedProduct[]} */
  const products = [];
  const skipped = [];
  for (const site of FEED_BRANDS) {
    const file = path.join(SCRAPE, 'raw', `${site.slug}.feed.json`);
    const feed = await readJson(file).catch(() => null);
    if (!feed) continue;
    let bundles = 0;
    for (const item of feed.products) {
      const product = parseFeedProduct(site, item);
      if (product) products.push(product);
      else if (/bundle/i.test(`${item.product_type} ${item.title}`)) bundles += 1;
      else skipped.push(`${site.brand}: ${item.title} (service, fee, protection plan, gift card or no price)`);
    }
    if (bundles) skipped.push(`${site.brand}: ${bundles} bundle listings (mattress + accessories sold together; bundle prices come from Shopify discounts, not from a product)`);
  }
  const pageSites = ['tempur-pedic', 'stearns-foster', 'sealy', 'beautyrest', 'serta', 'aireloom'];
  for (const slug of pageSites) {
    const site = { ...BRANDS[slug], slug };
    const dir = path.join(SCRAPE, 'pages', slug);
    const urls = await readJson(path.join(dir, '_urls.json')).catch(() => []);
    for (const url of urls) {
      const html = await readFile(path.join(dir, cacheName(url)), 'utf8').catch(() => null);
      if (html === null) continue;
      const parsed = slug === 'beautyrest' || slug === 'serta'
        ? [parseShopifyPage(site, html, url)]
        : slug === 'aireloom' ? [parseAireloomPage(site, html, url)] : parseTsiPage(site, html, url);
      const real = parsed.filter((p) => p !== null);
      if (real.length === 0) skipped.push(`${site.brand}: ${url} (no price listed, discontinued, or not a sellable product)`);
      products.push(...real);
    }
  }
  const helixDir = path.join(SCRAPE, 'pages', 'helix');
  for (const file of (await listFiles(helixDir)).filter((name) => name.endsWith('.json') && !name.startsWith('_'))) {
    const parsed = parseHelixRecord({ ...BRANDS.helix, slug: 'helix' }, await readJson(path.join(helixDir, file)));
    if (parsed) products.push(parsed);
    else skipped.push(`Helix: ${file} (not a sellable product)`);
  }
  return { products, skipped };
}

/** Keeps one listing per brand and title: the one with the most variants and photos. @param {ScrapedProduct[]} products */
export function dedupe(products) {
  /** @type {Map<string, ScrapedProduct>} */
  const best = new Map();
  const dropped = [];
  const score = (/** @type {ScrapedProduct} */ p) => p.variants.length * 3 + p.images.length - p.sourceHandle.length / 100;
  for (const product of products) {
    const key = `${product.brand}|${titleKey(product.title)}`;
    const current = best.get(key);
    if (!current) best.set(key, product);
    else if (score(product) > score(current)) { dropped.push(`${current.brand}: ${current.sourceHandle} (duplicate of ${product.sourceHandle})`); best.set(key, product); }
    else dropped.push(`${product.brand}: ${product.sourceHandle} (duplicate of ${current.sourceHandle})`);
  }
  return { products: [...best.values()], dropped };
}

/** Handles are brand-prefixed and unique store-wide; SKUs are unique and sheet-safe. @param {ScrapedProduct[]} products */
export function assignIdentifiers(products) {
  const handles = new Set();
  const skus = new Set();
  for (const product of products) {
    const meta = Object.values(BRANDS).find((entry) => entry.brand === product.brand);
    const brandSlug = slugify(product.brand);
    let base = slugify(product.title);
    if (!base.startsWith(meta?.prefix ?? brandSlug)) base = `${brandSlug}-${base}`;
    let handle = base.slice(0, 100).replace(/-+$/g, '');
    for (let n = 2; handles.has(handle); n += 1) handle = `${base.slice(0, 95)}-${n}`;
    handles.add(handle);
    product.handle = handle;
    product.variants.forEach((variant, index) => {
      let sku = variant.sku.replace(/[^A-Za-z0-9._/-]+/g, '-').replace(/^[^A-Za-z0-9]+/, '').slice(0, 60);
      if (!sku) sku = `${meta?.code ?? 'SKU'}-${handle.replace(/^[a-z]+-/, '').toUpperCase().slice(0, 36)}-${index + 1}`;
      let unique = sku;
      for (let n = 2; skus.has(unique.toLowerCase()); n += 1) unique = `${sku}-${n}`;
      skus.add(unique.toLowerCase());
      variant.sku = unique;
    });
  }
}

/** Plans one local file name per image: `<handle>-<n>.<ext>`. @param {ScrapedProduct[]} products */
export function planImages(products) {
  for (const product of products) {
    const seen = new Set();
    const unique = product.images.filter((image) => /^https?:\/\//.test(image.src) && !seen.has(image.src) && seen.add(image.src)).slice(0, MAX_IMAGES);
    product.planned = unique.map((image, index) => {
      const ext = (/\.(jpe?g|png|webp|gif)(?:$|[?#])/i.exec(image.src)?.[1] ?? 'jpg').toLowerCase().replace('jpeg', 'jpg');
      return { ...image, file: `${product.handle}-${index + 1}.${ext}` };
    });
  }
}

/** @param {ScrapedProduct} product */
function bodyHtml(product) {
  const parts = [];
  const paragraphs = descriptionToHtml(product.description.slice(0, 8000));
  if (paragraphs) parts.push(paragraphs);
  const esc = (/** @type {string} */ s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  if (product.bullets.length) parts.push(`<ul>${product.bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>`);
  const specs = Object.entries(product.specs);
  if (specs.length) parts.push(`<ul>${specs.map(([k, v]) => `<li><strong>${esc(k)}:</strong> ${esc(v)}</li>`).join('')}</ul>`);
  return parts.join('');
}

/** @param {ScrapedProduct[]} products @param {Map<string, string> | null} downloaded */
export function toShopifyRows(products) {
  const rows = [[...SHOPIFY_COLUMNS]];
  const col = (/** @type {string} */ name) => SHOPIFY_COLUMNS.indexOf(name);
  for (const product of products) {
    const options = product.options.slice(0, 3);
    const images = product.planned ?? [];
    const imageRows = Math.max(images.length - product.variants.length, 0);
    product.variants.forEach((variant, index) => {
      const row = SHOPIFY_COLUMNS.map(() => '');
      const set = (/** @type {string} */ name, /** @type {string} */ value) => { row[col(name)] = value; };
      set('Handle', product.handle ?? '');
      if (index === 0) {
        set('Title', product.title);
        set('Body (HTML)', bodyHtml(product));
        set('Vendor', product.brand);
        if (product.kind === 'Mattress') set('Product Category', 'Furniture > Beds & Accessories > Mattresses');
        set('Type', product.productType);
        set('Tags', [`brand:${product.brand}`, product.comfort && `comfort:${product.comfort}`, product.mattressType && `type:${product.mattressType}`].filter(Boolean).join(', '));
        set('Published', 'false');
        set('SEO Title', clip(product.seoTitle || product.title, 70));
        set('SEO Description', clip(product.seoDescription, 320));
        set('Status', 'draft');
      }
      options.forEach((option, n) => {
        set(`Option${n + 1} Name`, option.name === 'Title' ? 'Title' : option.name);
        set(`Option${n + 1} Value`, option.name === 'Title' ? 'Default Title' : variant.options[n] ?? '');
      });
      set('Variant SKU', variant.sku);
      set('Variant Inventory Tracker', 'shopify');
      set('Variant Inventory Qty', '0');
      set('Variant Inventory Policy', 'deny');
      set('Variant Fulfillment Service', 'manual');
      set('Variant Price', formatMoney(variant.priceCents));
      set('Variant Compare At Price', variant.compareAtCents ? formatMoney(variant.compareAtCents) : '');
      set('Variant Requires Shipping', 'true');
      set('Variant Taxable', 'true');
      set('Gift Card', 'false');
      if (variant.image && images.some((image) => image.src === variant.image)) set('Variant Image', variant.image);
      if (index < images.length) {
        set('Image Src', images[index].src);
        set('Image Position', String(index + 1));
        set('Image Alt Text', clip(images[index].alt || product.title, 120));
      }
      rows.push(row);
    });
    for (let extra = 0; extra < imageRows; extra += 1) {
      const position = product.variants.length + extra;
      const row = SHOPIFY_COLUMNS.map(() => '');
      row[col('Handle')] = product.handle ?? '';
      row[col('Image Src')] = images[position].src;
      row[col('Image Position')] = String(position + 1);
      row[col('Image Alt Text')] = clip(images[position].alt || product.title, 120);
      rows.push(row);
    }
  }
  return rows;
}

/** Cartesian combinations of the values of the non-size options that occur in the variants. @param {ScrapedProduct} product */
function combinations(product) {
  const sizeIndex = product.options.findIndex((option) => option.name === 'Size');
  const others = product.options.map((option, index) => index).filter((index) => index !== sizeIndex);
  const seen = new Map();
  for (const variant of product.variants) {
    const key = others.map((index) => variant.options[index]).join('\u0001');
    if (!seen.has(key)) seen.set(key, others.map((index) => variant.options[index]));
  }
  return { sizeIndex, others, combos: [...seen.entries()] };
}

/** @param {string} value */
const sheetSafe = (value) => value.replace(/[|]/g, '/').replace(/^[=+\-@\s]+/, '').trim();

/**
 * Project sheet rows, one model per combination of the non-size options, standard sizes only.
 * @param {ScrapedProduct[]} products @param {Map<string, boolean>} hasFile local image file name -> downloaded
 */
export function toProjectRows(products, hasFile) {
  const rows = [[...COLUMN_NAMES]];
  const usedHandles = new Set();
  const left = [];
  const notes = [];
  for (const product of products) {
    if (!PROJECT_KINDS.has(product.kind)) { left.push(product); continue; }
    const { sizeIndex, others, combos } = combinations(product);
    if (sizeIndex < 0 || combos.length > MAX_COMBINATIONS) { left.push(product); notes.push({ handle: product.handle, note: sizeIndex < 0 ? 'No size option: only in the Shopify file.' : `${combos.length} option combinations: only in the Shopify file.` }); continue; }
    const files = (product.planned ?? []).filter((image) => hasFile.get(image.file)).map((image) => image.file);
    if (product.kind === 'Mattress' && files.length === 0) { left.push(product); notes.push({ handle: product.handle, note: 'No photo downloaded: left out of the project sheet (mattresses need one).' }); continue; }
    let wroteAny = false;
    for (const [, rawCombo] of combos) {
      // "Add Cloud Pillowtop? = Yes" reads as "With Cloud Pillowtop" in a product name.
      const combo = rawCombo.map((value, n) => {
        const name = product.options[others[n]].name;
        if (!/^(yes|no)\b/i.test(value)) return value;
        const base = name.replace(/^add\s+/i, '').replace(/\?$/, '').trim();
        return `${/^yes/i.test(value) ? 'With' : 'Without'} ${base}`;
      });
      const comboText = combo.join(' ');
      const variants = [];
      const sizes = new Set();
      for (const variant of product.variants) {
        if (!others.every((index, n) => variant.options[index] === combo[n])) continue;
        const size = variant.options[sizeIndex];
        if (!SIZES.includes(size) || sizes.has(size)) continue;
        sizes.add(size);
        variants.push({ ...variant, size });
      }
      if (variants.length === 0) continue;
      variants.sort((a, b) => SIZES.indexOf(a.size) - SIZES.indexOf(b.size));
      const split = combos.length > 1;
      const model = split ? `${product.title} - ${combo.join(' / ')}` : product.title;
      let handle = split ? `${product.handle}-${slugify(comboText)}`.slice(0, 100).replace(/-+$/g, '') : product.handle;
      // Cutting a long name at 100 characters can make two combinations identical (Kingsdown "Mattress Set (includes ...)"): number the later ones.
      for (let n = 2; usedHandles.has(handle); n += 1) handle = `${handle.slice(0, 96).replace(/-+$/g, '')}-${n}`;
      usedHandles.add(handle);
      const isMattress = product.kind === 'Mattress';
      const comfort = isMattress ? comfortFrom(comboText) ?? product.comfort ?? 'Medium' : '';
      const assumedComfort = isMattress && !comfortFrom(comboText) && !product.comfort;
      const type = isMattress ? mattressTypeFrom(comboText) ?? product.mattressType ?? 'Foam' : '';
      const assumedType = isMattress && !mattressTypeFrom(comboText) && !product.mattressType;
      if (assumedComfort) notes.push({ handle, note: 'Comfort level not stated by the source: Medium assumed.' });
      if (assumedType) notes.push({ handle, note: 'Mattress type not stated by the source: Foam assumed.' });
      if (isMattress && product.heightInches === null) notes.push({ handle, note: 'Height not stated by the source: left blank.' });
      const specs = [
        isMattress && `Firmness=${comfort}`, isMattress && `Construction=${type}`, product.heightInches !== null && `Thickness=${product.heightInches} in`,
        ...Object.entries(product.specs).map(([k, v]) => `${sheetSafe(k).replace(/=/g, '-')}=${sheetSafe(v).replace(/=/g, '-').slice(0, 190)}`),
      ].filter(Boolean).slice(0, 40);
      // Bullets, description and search text are never left blank: a product marked approved needs them (CLR-017). Without the
      // maker's own text they state only facts the sheet already holds (feel, construction, height, sizes), nothing invented.
      const sizeNames = variants.map((v) => v.size);
      const sizeRange = sizeNames.length > 1 ? `Sizes: ${sizeNames[0]} to ${sizeNames[sizeNames.length - 1]}` : `Size: ${sizeNames[0]}`;
      const factBullets = [
        isMattress && `${comfort} feel`, isMattress && `${type} construction`,
        product.heightInches !== null && `${product.heightInches} inch profile`, sizeRange,
      ].filter(Boolean);
      const ownBullets = product.bullets.map((b) => sheetSafe(b).slice(0, 200)).filter(Boolean).slice(0, 8);
      const description = sheetSafe(product.description).slice(0, 9500) || `${model} from ${product.brand}.`;
      const modelCells = {
        model, brand: product.brand, product_line: '', handle, product_type: isMattress ? '' : product.productType,
        comfort_level: comfort, mattress_type: type, sleep_positions: isMattress ? positionsFor(comfort).join('|') : '',
        benefits: product.benefits.filter((b) => BENEFITS.includes(b)).join('|'), height_inches: product.heightInches === null ? '' : String(product.heightInches),
        delivery_type: 'both', description,
        overview_bullets: (ownBullets.length > 0 ? ownBullets : factBullets).join('|'),
        specifications: specs.join('|'), seo_title: clip(product.seoTitle || model, 70), seo_description: clip(product.seoDescription || description, 320),
        images: files.join('|'), extend_category: isMattress ? 'mattress' : '',
        related_foundations: isMattress ? RELATED.foundations : '', related_protectors: isMattress ? RELATED.protectors : '', related_bedding: isMattress ? RELATED.bedding : '',
        compare_group: isMattress ? `${slugify(product.brand)}-${slugify(type)}` : '', copy_approved: 'no',
      };
      // Cells that start with = + - @ are refused by the sheet checker (spreadsheets read them as formulas).
      for (const key of Object.keys(modelCells)) modelCells[key] = modelCells[key].replace(/^[=+\-@\s]+/, '');
      variants.forEach((variant, index) => {
        const base = { handle, size: variant.size, dimensions: variant.dimensions || (isMattress ? STANDARD_DIMENSIONS[variant.size] ?? '' : ''), sku: variant.sku, price: formatMoney(variant.priceCents), sale_price: '' };
        const cells = index === 0 ? { ...modelCells, ...base } : base;
        rows.push(COLUMN_NAMES.map((name) => cells[name] ?? ''));
      });
      wroteAny = true;
    }
    if (!wroteAny) { left.push(product); notes.push({ handle: product.handle, note: 'No standard bed size: only in the Shopify file.' }); }
  }
  return { rows, left, notes };
}

const NEWLINE = String.fromCharCode(10);

/** Removes lines that hold only a list marker, and the blank runs they leave. @param {string} text */
export function cleanDescription(text) {
  return text
    .split(NEWLINE)
    .filter((line) => !/^[-–•]$/.test(line.trim()))
    .join(NEWLINE)
    .replace(/\n{3,}/g, NEWLINE + NEWLINE)
    .trim();
}

/** @param {readonly string[]} argv */
async function main(argv) {
  const manifestIndex = argv.indexOf('--images-manifest');
  const manifestFile = manifestIndex >= 0 ? argv[manifestIndex + 1] : path.join(SCRAPE, 'images-manifest.json');
  const manifest = await readJson(manifestFile).catch(() => ({}));

  const { products: loaded, skipped } = await loadProducts();
  const { products, dropped } = dedupe(loaded);
  products.sort((a, b) => a.brand.localeCompare(b.brand) || a.kind.localeCompare(b.kind) || a.title.localeCompare(b.title));
  // Lines that are only a list marker ("-") come from the makers' markup; drop them, and rebuild a search description that was
  // taken from one of them.
  for (const product of products) {
    product.description = cleanDescription(product.description);
    if (oneLine(product.seoDescription).length < 20) {
      const firstSentence = product.description.split(NEWLINE).map((line) => oneLine(line)).find((line) => line.length >= 20) ?? '';
      product.seoDescription = clip(firstSentence, 160);
    }
  }
  assignIdentifiers(products);
  planImages(products);
  await writeFile(path.join(SCRAPE, 'products.json'), JSON.stringify(products, null, 1));

  const shopify = toShopifyRows(products);
  await writeFile(path.join(OUT, 'brand-mattresses.shopify.csv'), stringifyCsv(shopify, { eol: '\r\n' }), 'utf8');

  const hasFile = new Map(Object.entries(manifest).map(([file, ok]) => [file, ok === true]));
  const project = toProjectRows(products, hasFile);
  await writeFile(path.join(OUT, 'brand-mattresses.csv'), stringifyCsv(project.rows), 'utf8');

  const notes = [['handle', 'note']];
  for (const product of products) for (const note of product.notes ?? []) notes.push([product.handle ?? '', note]);
  for (const note of project.notes) notes.push([note.handle ?? '', note.note]);
  for (const line of [...skipped, ...dropped]) notes.push(['', `Left out: ${line}`]);
  await writeFile(path.join(OUT, 'review-notes.csv'), stringifyCsv(notes), 'utf8');

  const byBrand = {};
  for (const product of products) byBrand[product.brand] = (byBrand[product.brand] ?? 0) + 1;
  console.log(JSON.stringify({ products: products.length, byBrand, shopifyRows: shopify.length - 1, projectRows: project.rows.length - 1, inProjectSheet: products.length - project.left.length, skipped: skipped.length, duplicatesDropped: dropped.length }, null, 1));
  return 0;
}

if (process.argv[1]?.endsWith('build.mjs')) process.exitCode = await main(process.argv.slice(2));
