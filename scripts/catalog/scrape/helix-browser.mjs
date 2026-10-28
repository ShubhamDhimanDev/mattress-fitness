#!/usr/bin/env node
// Helix (helixsleep.com) answers plain HTTP requests with 403 (DataDome) but serves its pages to a real browser. This reads the
// product pages through Chrome at a polite pace and stores the page's own variant data as JSON, one file per product.
// It stops at the first CAPTCHA or block page: it never tries to solve or get around a challenge.
//
//   node scripts/catalog/scrape/helix-browser.mjs <cacheDir> [--limit N] [--headed]
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fetchText } from './http.mjs';
import { locs } from './pages.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('../../../storefront/node_modules/playwright');

const ORIGIN = 'https://helixsleep.com';
const GAP_MS = 4000;
/** Pages that are not for sale as a product. */
const SKIP = /\/products\/(gift-card|shipping|warranty|returns|test)/i;

/** Runs inside the page. Reads the buy box's variant list and the visible product facts. */
function extractInPage() {
  const script = [...document.querySelectorAll('script')].map((s) => s.textContent ?? '').find((text) => text.includes('_variantData:'));
  /** @type {unknown} */
  let variants = null;
  if (script) {
    const start = script.indexOf('[', script.indexOf('_variantData:'));
    let depth = 0;
    let inString = false;
    let escaped = false;
    let end = start;
    for (; end < script.length; end += 1) {
      const c = script[end];
      if (inString) {
        if (escaped) escaped = false;
        else if (c === '\\') escaped = true;
        else if (c === '"') inString = false;
      } else if (c === '"') inString = true;
      else if (c === '[') depth += 1;
      else if (c === ']') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    try { variants = JSON.parse(script.slice(start, end + 1)); } catch { variants = null; }
  }
  const view = (window.dataLayer ?? []).find((entry) => entry && entry.event === 'dl_view_item');
  const product = view?.ecommerce?.detail?.products?.[0] ?? null;
  const images = [...new Set([...document.querySelectorAll('main img')]
    .filter((img) => img.naturalWidth >= 400 && /cloudinary|helixsleep/.test(img.currentSrc || img.src))
    .map((img) => img.currentSrc || img.src))];
  const main = document.querySelector('main');
  return {
    title: document.title,
    h1: document.querySelector('h1')?.innerText ?? '',
    metaDescription: document.querySelector('meta[name=description]')?.getAttribute('content') ?? '',
    ogImage: document.querySelector('meta[property="og:image"]')?.getAttribute('content') ?? '',
    category: product?.category ?? '',
    brand: product?.brand ?? '',
    sku: product?.id ?? '',
    variants,
    images,
    bodyText: (main?.innerText ?? '').slice(0, 12_000),
  };
}

/** @param {readonly string[]} argv */
async function main(argv) {
  const [cacheDir, ...rest] = argv;
  if (!cacheDir) {
    console.error('Usage: node scripts/catalog/scrape/helix-browser.mjs <cacheDir> [--limit N] [--headed]');
    return 2;
  }
  const limitIndex = rest.indexOf('--limit');
  const limit = limitIndex >= 0 ? Number(rest[limitIndex + 1]) : Infinity;
  const dir = path.join(cacheDir, 'helix');
  await mkdir(dir, { recursive: true });

  const sitemap = await fetchText(`${ORIGIN}/sitemap.xml`, { accept: 'application/xml' });
  if (sitemap.status !== 200) throw new Error(`Helix sitemap: HTTP ${sitemap.status}`);
  const urls = [...new Set(locs(sitemap.text))]
    .filter((url) => /^https:\/\/helixsleep\.com\/products\/[^/]+$/.test(url) && !SKIP.test(url))
    .slice(0, limit);
  await writeFile(path.join(dir, '_urls.json'), JSON.stringify(urls, null, 1));
  console.log(`helix: ${urls.length} product pages listed`);

  const browser = await chromium.launch({ channel: 'chrome', headless: !rest.includes('--headed') });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  let done = 0;
  try {
    for (const url of urls) {
      const file = path.join(dir, `${new URL(url).pathname.split('/').pop()}.json`);
      if (await readFile(file, 'utf8').then(() => true, () => false)) continue;
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => null);
      await page.waitForSelector('h1', { timeout: 20_000 }).catch(() => null);
      await sleep(1500);
      const blocked = await page.evaluate(() => /captcha|verify you are human|access denied/i.test(document.body.innerText.slice(0, 600)) || document.querySelector('iframe[src*="captcha-delivery"]') !== null);
      if (blocked || !response || response.status() >= 400 && !(await page.$('h1'))) {
        console.error(`Stopped at ${url}: the site showed a challenge or a block page (status ${response?.status() ?? 'none'}). Not working around it.`);
        break;
      }
      const data = await page.evaluate(extractInPage);
      await writeFile(file, JSON.stringify({ url, fetchedAt: new Date().toISOString(), ...data }));
      done += 1;
      if (done % 10 === 0) console.log(`  helix: ${done} read`);
      await sleep(GAP_MS);
    }
  } finally {
    await browser.close();
  }
  console.log(`helix: done, ${done} read now`);
  return 0;
}

if (process.argv[1]?.endsWith('helix-browser.mjs')) process.exitCode = await main(process.argv.slice(2));
