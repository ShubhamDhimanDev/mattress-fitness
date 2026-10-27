#!/usr/bin/env node
// Downloads the public product pages of the brands that have no product feed and keeps the HTML in a cache folder, so the
// parsers (parse-*.mjs) can be changed and re-run without fetching again. One request at a time per site, with the site's own
// crawl delay. A page already in the cache is not fetched again.
//
//   node scripts/catalog/scrape/pages.mjs <cacheDir> <brand> [--limit N]
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fetchText } from './http.mjs';

/**
 * `include` picks product pages out of the sitemap; `exclude` drops listing and non-product pages. `gapMs` follows robots.txt
 * (Serta and Beautyrest state Crawl-delay: 10).
 * @type {Readonly<Record<string, { origin: string, sitemap: string, gapMs: number, include: RegExp, exclude?: RegExp }>>}
 */
export const PAGE_BRANDS = Object.freeze({
  'tempur-pedic': {
    origin: 'https://www.tempurpedic.com', sitemap: '/sitemap.xml', gapMs: 2000,
    include: /\/(shop-mattresses|shop-pillows|bases-and-foundations|bedding|other-products)\/[^/]+\/$/,
    exclude: /\/(all|all-[a-z-]+|compare-tempurpedic-mattresses|split-head-king)\/$/,
  },
  'stearns-foster': {
    origin: 'https://www.stearnsandfoster.com', sitemap: '/sitemap.xml', gapMs: 2000,
    include: /\/(mattresses|pillow-landing-page|adjustable-bases-and-foundations)\/[^/]+\/$/,
  },
  sealy: {
    origin: 'https://www.sealy.com', sitemap: '/sitemap.xml', gapMs: 2000,
    include: /\/(mattresses|shop-pillows|bases)\/[^/]+\/$/,
    exclude: /\/(lines|easebasetestingpage)\/|\/mattresses\/lines\//,
  },
  // No robots.txt on this WordPress site; a 3 second gap is polite enough for 36 pages.
  aireloom: { origin: 'https://aireloom.com', sitemap: '/wp-sitemap-posts-product-1.xml', gapMs: 3000, include: /\/product\/[^/]+\/$/ },
  beautyrest: { origin: 'https://www.beautyrest.com', sitemap: '/products-sitemap.xml', gapMs: 10_000, include: /\/products\/[^/]+$/ },
  serta: { origin: 'https://www.serta.com', sitemap: '/products-sitemap.xml', gapMs: 10_000, include: /\/products\/[^/]+$/ },
});

/** @param {string} xml */
export function locs(xml) {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((match) => match[1]);
}

/** @param {string} url */
export function cacheName(url) {
  const { pathname } = new URL(url);
  return pathname.replace(/^\/|\/$/g, '').replace(/[^a-zA-Z0-9._-]+/g, '__') + '.html';
}

/** @param {keyof typeof PAGE_BRANDS} slug */
export async function listProductUrls(slug) {
  const site = PAGE_BRANDS[slug];
  const { text, status } = await fetchText(site.origin + site.sitemap, { gapMs: site.gapMs, accept: 'application/xml' });
  if (status !== 200) throw new Error(`${slug} sitemap: HTTP ${status}`);
  return [...new Set(locs(text))].filter((url) => site.include.test(url) && !(site.exclude?.test(url) ?? false));
}

/** @param {readonly string[]} argv */
async function main(argv) {
  const [cacheDir, slug, ...rest] = argv;
  const limitIndex = rest.indexOf('--limit');
  const limit = limitIndex >= 0 ? Number(rest[limitIndex + 1]) : Infinity;
  if (!cacheDir || !slug || !(slug in PAGE_BRANDS)) {
    console.error(`Usage: node scripts/catalog/scrape/pages.mjs <cacheDir> <${Object.keys(PAGE_BRANDS).join('|')}> [--limit N]`);
    return 2;
  }
  const site = PAGE_BRANDS[slug];
  const dir = path.join(cacheDir, slug);
  await mkdir(dir, { recursive: true });
  const urls = (await listProductUrls(slug)).slice(0, limit);
  await writeFile(path.join(dir, '_urls.json'), JSON.stringify(urls, null, 1));
  console.log(`${slug}: ${urls.length} product pages listed`);
  let fetched = 0;
  let failed = 0;
  for (const url of urls) {
    const file = path.join(dir, cacheName(url));
    const cached = await readFile(file, 'utf8').then(() => true, () => false);
    if (cached) continue;
    try {
      const { status, text } = await fetchText(url, { gapMs: site.gapMs, accept: 'text/html' });
      if (status === 200) {
        await writeFile(file, text);
        fetched += 1;
      } else {
        failed += 1;
        console.warn(`  HTTP ${status}: ${url}`);
      }
    } catch (error) {
      failed += 1;
      console.warn(`  failed: ${url} (${error instanceof Error ? error.message : error})`);
    }
    if (fetched % 10 === 0 && fetched > 0) console.log(`  ${slug}: ${fetched} fetched`);
  }
  console.log(`${slug}: done, ${fetched} fetched now, ${failed} failed, rest were cached`);
  return 0;
}

if (process.argv[1]?.endsWith('pages.mjs')) process.exitCode = await main(process.argv.slice(2));
