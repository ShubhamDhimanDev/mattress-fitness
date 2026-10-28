#!/usr/bin/env node
// Collects the public Shopify product feed (/products.json) of the brands that run on Shopify and writes the raw feed to
// <out>/<brand>.feed.json. Normalising happens in normalize.mjs so the raw data stays available for checking.
//
//   node scripts/catalog/scrape/shopify-feed.mjs <outDir> [brand ...]
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fetchText } from './http.mjs';

/** Feed sites. `slug` names the output file; `origin` is the storefront the feed is read from. */
export const FEED_BRANDS = Object.freeze([
  { slug: 'molecule', brand: 'Molecule', origin: 'https://moleculesleep.com' },
  { slug: 'brooklyn-bedding', brand: 'Brooklyn Bedding', origin: 'https://brooklynbedding.com' },
  { slug: 'puffy', brand: 'Puffy', origin: 'https://puffy.com' },
  { slug: 'kingsdown', brand: 'Kingsdown', origin: 'https://kingsdown.com' },
  { slug: 'casper', brand: 'Casper', origin: 'https://casper.com' },
]);

/** @param {{ origin: string }} site */
export async function collectFeed(site) {
  /** @type {unknown[]} */
  const products = [];
  for (let page = 1; page <= 20; page += 1) {
    const { status, text } = await fetchText(`${site.origin}/products.json?limit=250&page=${page}`, { accept: 'application/json' });
    if (status !== 200) throw new Error(`${site.origin} feed page ${page}: HTTP ${status}`);
    const batch = JSON.parse(text).products;
    if (!Array.isArray(batch) || batch.length === 0) break;
    products.push(...batch);
    if (batch.length < 250) break;
  }
  return products;
}

/** @param {readonly string[]} argv */
async function main(argv) {
  const [outDir, ...only] = argv;
  if (!outDir) {
    console.error('Usage: node scripts/catalog/scrape/shopify-feed.mjs <outDir> [brand slug ...]');
    return 2;
  }
  await mkdir(outDir, { recursive: true });
  for (const site of FEED_BRANDS.filter((entry) => only.length === 0 || only.includes(entry.slug))) {
    const products = await collectFeed(site);
    await writeFile(path.join(outDir, `${site.slug}.feed.json`), JSON.stringify({ brand: site.brand, origin: site.origin, fetchedAt: new Date().toISOString(), products }));
    console.log(`${site.brand}: ${products.length} products`);
  }
  return 0;
}

if (process.argv[1]?.endsWith('shopify-feed.mjs')) process.exitCode = await main(process.argv.slice(2));
