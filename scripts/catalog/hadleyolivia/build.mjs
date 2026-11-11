#!/usr/bin/env node
// Turns the raw read of the 14 Aireloom mattress pages of hadleyolivia.com into `aireloom-products.json`, the file
// `import.mjs` (next to it) sends to Shopify. Owner request 2026-11-12: "Add 14 Aireloom listings from Hadley Olivia, with double
// variations (Size x Foundation), the exact photos and videos, and the main image as on the website."
//
//   node scripts/catalog/hadleyolivia/build.mjs        # reads brand-catalog/.scrape/hadleyolivia-raw.json
//
// The raw file is a browser read of the public product pages (git-ignored, like the rest of .scrape/): per page the JSON-LD
// ProductGroup (variants and list prices), the media gallery in page order (images, and the mp4 of each video) and the text tabs.
// Texts, photos and videos are the retailer's and the maker's, copied as published (owner decision of 2026-10-27, same as
// brand-catalog/README.md); the client needs the brands' permission before this goes live.
//
// The sale: every one of the 14 pages carries the label "Save 20% Off In Cart" and says "Take an extra 20% off, applied automatically
// at checkout. Your price: <list price less 20%>" (owner, 2026-11-12: "you did not pick up sale"). Here that is a plain sale price:
// price = list price less 20% (whole cents), compare-at = their list price, so cards and product pages show the saving from
// Shopify's own price fields. Our checkout needs no discount code for it.
//
// What is NOT copied: their showroom and phone text, and their stock flags (some sizes show out of stock there; here every variant
// is orderable like the rest of the catalog).
import {readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const here = (path) => fileURLToPath(new URL(path, import.meta.url));
const raw = JSON.parse(readFileSync(here('../brand-catalog/.scrape/hadleyolivia-raw.json'), 'utf8'));

// The sheet's own words for filters (comfort, type, positions, height) come from the maker data already in
// brand-catalog/brand-mattresses.csv for the same model. Model M2+ Plush is new there: it takes the M2 Plush values.
const ATTRIBUTES = {
  'aireloom-tight-top-extra-firm': {comfort: 'Extra Firm', positions: ['Back', 'Stomach'], height: '14', old: 'aireloom-tight-top-extra-firm-mattress'},
  'aireloom-tight-top-luxury-firm-mattress': {comfort: 'Firm', positions: ['Back', 'Stomach'], height: '14', old: 'aireloom-tight-top-luxury-firm-mattress'},
  'aireloom-euro-top-plush': {comfort: 'Plush', positions: ['Side'], height: '15', old: 'aireloom-euro-top-plush-mattress'},
  'aireloom-streamline-firm': {comfort: 'Firm', positions: ['Back', 'Stomach'], height: '14', old: 'aireloom-streamline-firm-mattress'},
  'aireloom-streamline-plush-mattress': {comfort: 'Plush', positions: ['Side'], height: '15', old: 'aireloom-streamline-plush-mattress'},
  'aireloom-streamline-extra-firm-mattress': {comfort: 'Extra Firm', positions: ['Back', 'Stomach'], height: '15', old: 'aireloom-streamline-extra-firm-mattress'},
  'aireloom-streamline-luxury-firm-mattress': {comfort: 'Firm', positions: ['Back', 'Stomach'], height: '15.5', old: 'aireloom-streamline-luxury-firm-mattress'},
  'aireloom-streamline-m1-plush-mattress': {comfort: 'Plush', positions: ['Side'], height: '15.5', old: 'aireloom-streamline-m1-plush-mattress'},
  'aireloom-luxetop-m1-firm-mattress': {comfort: 'Firm', positions: ['Back', 'Stomach'], height: '15.5', old: 'aireloom-luxetop-m1-firm-mattress'},
  'aireloom-luxetop-m1-luxury-firm': {comfort: 'Firm', positions: ['Back', 'Stomach'], height: '15.5', old: 'aireloom-luxetop-m1-luxury-firm-mattress'},
  'aireloom-luxetop-m2-firm': {comfort: 'Firm', positions: ['Back', 'Stomach'], height: '15.5', old: 'aireloom-luxetop-m2-firm-mattress'},
  'aireloom-luxetop-m2-luxury-firm': {comfort: 'Firm', positions: ['Back', 'Stomach'], height: '15.5', old: 'aireloom-luxetop-m2-luxury-firm-mattress'},
  'aireloom-luxetop-m2-plush': {comfort: 'Plush', positions: ['Side'], height: '15.5', old: 'aireloom-luxetop-m2-plush-mattress'},
  'aireloom-luxetop-m2-plush-plus-mattress': {comfort: 'Plush', positions: ['Side'], height: '15.5', old: null},
};
const SALE_PERCENT = 20;
/** List price in dollars to [sale price, compare-at] strings, in whole cents. */
function salePrices(listDollars) {
  const listCents = Math.round(Number(listDollars) * 100);
  const saleCents = Math.round((listCents * (100 - SALE_PERCENT)) / 100);
  return {price: (saleCents / 100).toFixed(2), compareAt: (listCents / 100).toFixed(2)};
}
const BENEFITS = ['Cooling', 'Pressure Relief', 'Eco-Friendly'];

/** Their size words to the storefront's (the size filter and the cart read these): only "Cal King" is spelled differently. */
const SIZE_NAME = {'Cal King': 'California King'};
const SIZE_CODE = {Twin: 'TWIN', 'Twin XL': 'TXL', Full: 'FULL', Queen: 'QUEEN', King: 'KING', 'California King': 'CALKING', 'Split King': 'SPLITKING'};
const FOUNDATION_CODE = {'No Foundation': 'NOFND', '9" Foundation': '9IN', '5.75" Foundation': '575IN'};

const escapeHtml = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// The page's text tabs come out of the read with paragraphs separated by one line break, and some with no break at all after a
// full stop ("...durability.The surface..."): a lower-case letter, full stop and capital with no space is a paragraph start.
const paragraphs = (text) =>
  text
    .replace(/([a-z)])\.([A-Z])/g, '$1.\n$2')
    .split(/\n+/)
    .map((part) => part.trim())
    .filter(Boolean);

/** Plain text of the tabs as sanitised HTML: paragraphs, one bullet list, the construction notes and the questions. */
function descriptionHtml(tabs) {
  const tab = (name) => tabs.find((t) => t.title.toLowerCase() === name)?.text ?? '';
  const out = [];
  for (const part of paragraphs(tab('description'))) out.push(`<p>${escapeHtml(part)}</p>`);
  const bullets = tab('key features')
    .split('\n')
    .map((line) => line.replace(/^\s*[•\-*]\s*/, '').trim())
    .filter(Boolean);
  if (bullets.length > 0) out.push('<h3>Key features</h3>', `<ul>${bullets.map((b) => `<li>${escapeHtml(b)}</li>`).join('')}</ul>`);
  const construction = tab('construction and materials');
  if (construction) {
    out.push('<h3>Construction and materials</h3>');
    // The page runs sentences together without a break after a heading line; keep the text as published.
    for (const part of paragraphs(construction)) out.push(`<p>${escapeHtml(part)}</p>`);
  }
  return {html: out.join(''), bullets, faq: tab('faq')};
}

const products = [];
for (const page of raw) {
  if (page.error) throw new Error(`${page.handle}: page read failed (${page.error})`);
  const attributes = ATTRIBUTES[page.handle];
  if (!attributes) throw new Error(`no attributes for ${page.handle}`);
  const title = page.title;
  const modelCode = page.handle.replace(/^aireloom-/, '').replace(/-mattress$/, '').toUpperCase();

  const variants = page.variants.map((variant) => {
    const [sizeRaw, foundation] = variant.name.split(' - ').pop().split(' / ');
    const size = SIZE_NAME[sizeRaw] ?? sizeRaw;
    if (!SIZE_CODE[size] || !FOUNDATION_CODE[foundation]) throw new Error(`${page.handle}: unknown variant "${variant.name}"`);
    return {size, foundation, ...salePrices(variant.price), sku: `AIR-${modelCode}-${SIZE_CODE[size]}-${FOUNDATION_CODE[foundation]}`};
  });
  if (new Set(variants.map((v) => v.sku)).size !== variants.length) throw new Error(`${page.handle}: duplicate SKU`);

  const media = page.media.map((item, index) => {
    if (item.type === 'video') {
      if (!item.video) throw new Error(`${page.handle}: video ${item.id} has no file`);
      return {type: 'VIDEO', source: item.video.replace(/\?v=0$/, ''), alt: `${title} video`};
    }
    return {type: 'IMAGE', source: item.thumb, alt: index === 0 ? title : `${title}, view ${index + 1}`};
  });
  if (media[0]?.type !== 'IMAGE') throw new Error(`${page.handle}: the main (first) media is not an image`);

  const {html, bullets} = descriptionHtml(page.tabs);
  products.push({
    handle: page.handle,
    replaces: attributes.old,
    title,
    vendor: 'Aireloom',
    productType: 'Mattress',
    descriptionHtml: html,
    tags: ['Aireloom', 'Mattress'],
    options: [
      {name: 'Size', values: [...new Set(variants.map((v) => v.size))]},
      {name: 'Foundation', values: [...new Set(variants.map((v) => v.foundation))]},
    ],
    variants,
    media,
    metafields: {
      comfort_level: attributes.comfort,
      mattress_type: 'Latex',
      sleep_positions: attributes.positions,
      benefits: BENEFITS,
      height_inches: attributes.height,
      features: bullets,
    },
    source: `https://www.hadleyolivia.com/products/${page.handle}`,
  });
}

writeFileSync(here('./aireloom-products.json'), JSON.stringify(products, null, 1) + '\n');
const sizes = products.reduce((n, p) => n + p.variants.length, 0);
const videos = products.reduce((n, p) => n + p.media.filter((m) => m.type === 'VIDEO').length, 0);
const images = products.reduce((n, p) => n + p.media.filter((m) => m.type === 'IMAGE').length, 0);
console.log(`${products.length} products, ${sizes} variants, ${images} images, ${videos} videos -> scripts/catalog/hadleyolivia/aireloom-products.json`);
