#!/usr/bin/env node
// Distils Puffy's current sale prices into `puffy-sale-prices.json` (owner request 2026-11-12: "check the Puffy mattress original
// website and implement the Puffy sale prices"). Reads, from brand-catalog/.scrape (git-ignored):
//   puffy-sale-raw.json            what puffy.com/products/<handle> publishes per size: the JSON-LD ProductGroup variants with the
//                                  price a shopper pays today (the early Black Friday sale), valid until `priceValidUntil`
//   raw-2026-11-12/puffy.feed.json the same site's public /products.json feed: the regular (list) price per size
//
// Only the five mattress models have a sale; every other Puffy product page shows its regular price only. Our store carries the
// sizes Twin to California King, so the Split sizes are in the file for the record but are not applied.
import {readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const here = (path) => fileURLToPath(new URL(path, import.meta.url));
const scrape = (path) => JSON.parse(readFileSync(here(`../brand-catalog/.scrape/${path}`), 'utf8'));
const raw = scrape('puffy-sale-raw.json');
const feedFile = scrape('raw-2026-11-12/puffy.feed.json');
const feed = new Map((Array.isArray(feedFile) ? feedFile : feedFile.products).map((p) => [p.handle, p]));

/** Our store's product handle -> puffy.com's. */
const MODELS = {
  'puffy-cloud-mattress': 'puffy-mattress',
  'puffy-lux-mattress': 'puffy-lux-mattress',
  'puffy-royal-mattress': 'puffy-royal-mattress',
  'puffy-monarch-mattress': 'puffy-monarch-mattress',
  'puffy-legacy-mattress': 'puffy-legacy-mattress',
};
/** The size words of the site's variants ("Twin - (38"W x 75"L x 10"H) / Hybrid") to the store's. */
const sizeOf = (text) => {
  const size = text.replace(/\s+-\s+\(.*$/, '').replace(/\s+-\s*\(.*$/, '').replace(/ \/ .*$/, '').replace(/^.* - /, '').trim();
  return size === 'Cal King' ? 'California King' : size;
};

const products = {};
let validUntil = null;
for (const [storeHandle, puffyHandle] of Object.entries(MODELS)) {
  const page = raw.find((entry) => entry.handle === puffyHandle);
  const list = feed.get(puffyHandle);
  if (!page || page.error || !list) throw new Error(`${puffyHandle}: missing from the raw read or the feed`);
  validUntil ??= page.until ?? null;
  const listBySize = new Map(list.variants.map((variant) => [sizeOf(variant.title), Number(variant.price)]));
  const sizes = {};
  for (const variant of page.variants) {
    const size = sizeOf(variant.name);
    const listPrice = listBySize.get(size);
    // A size the feed does not list (Legacy Split King) has no regular price to compare with, so no sale is recorded for it.
    if (listPrice === undefined) continue;
    if (!(variant.price < listPrice)) continue; // no sale on this size
    sizes[size] = {list: listPrice, sale: variant.price};
  }
  products[storeHandle] = {source: `https://puffy.com/products/${puffyHandle}`, sizes};
}

const out = {source: 'puffy.com product pages (JSON-LD offers) and /products.json', readOn: '2026-11-12', validUntil, products};
writeFileSync(here('./puffy-sale-prices.json'), JSON.stringify(out, null, 1) + '\n');
for (const [handle, product] of Object.entries(products)) {
  console.log(handle.padEnd(26), Object.entries(product.sizes).map(([size, p]) => `${size} ${p.sale} (was ${p.list}, -${p.list - p.sale})`).join('; '));
}
console.log(`valid until ${validUntil}`);
