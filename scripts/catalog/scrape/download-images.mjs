#!/usr/bin/env node
// Downloads the product photos planned by build.mjs (.scrape/products.json) into brand-catalog/images/ under the planned file
// names, a few at a time with a small gap per host, and records which succeeded in .scrape/images-manifest.json. Files already
// on disk are not fetched again. Re-run build.mjs afterwards so the project sheet lists only the photos that exist.
//
//   node scripts/catalog/scrape/download-images.mjs [--limit N]
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { USER_AGENT } from './http.mjs';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../brand-catalog');
const IMAGES = path.join(OUT, 'images');
const MANIFEST = path.join(OUT, '.scrape', 'images-manifest.json');
const WORKERS = 6;
const HOST_GAP_MS = 250;
const MIN_BYTES = 1000;

/** Shopify's CDN resizes on request; 1600 px wide is plenty for a product page. @param {string} src */
function downloadUrl(src) {
  const url = new URL(src);
  if (url.hostname === 'cdn.shopify.com' || /\/s\/files\//.test(url.pathname)) url.searchParams.set('width', '1600');
  return url.toString();
}

/** @type {Map<string, number>} */
const hostNext = new Map();
async function politeSlot(/** @type {string} */ host) {
  const wait = Math.max(0, (hostNext.get(host) ?? 0) - Date.now());
  hostNext.set(host, Math.max(Date.now(), hostNext.get(host) ?? 0) + HOST_GAP_MS);
  if (wait) await sleep(wait);
}

/** Why downloads failed, by host and reason, printed at the end. @type {Map<string, number>} */
const reasons = new Map();
const why = (/** @type {string} */ host, /** @type {string} */ reason) => reasons.set(`${host}: ${reason}`, (reasons.get(`${host}: ${reason}`) ?? 0) + 1);

/** @param {string} src @param {string} file @returns {Promise<boolean>} */
async function fetchOne(src, file) {
  const target = path.join(IMAGES, file);
  if (await stat(target).then((s) => s.size >= MIN_BYTES, () => false)) return true;
  const url = downloadUrl(src);
  const host = new URL(url).host;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await politeSlot(host);
    try {
      const response = await fetch(url, { headers: { 'user-agent': USER_AGENT, accept: 'image/*' }, signal: AbortSignal.timeout(60_000) });
      const type = response.headers.get('content-type') ?? '';
      if (!response.ok || !type.startsWith('image/')) { why(host, `HTTP ${response.status} ${type}`); return false; }
      const body = Buffer.from(await response.arrayBuffer());
      if (body.length < MIN_BYTES) { why(host, 'too small'); return false; }
      await writeFile(target, body);
      return true;
    } catch (error) {
      if (attempt === 2) why(host, `${error instanceof Error ? `${error.name} ${error.cause instanceof Error ? error.cause.message : error.message}` : error}`);
      await sleep(2000 * (attempt + 1));
    }
  }
  return false;
}

/** @param {readonly string[]} argv */
async function main(argv) {
  const limitIndex = argv.indexOf('--limit');
  const limit = limitIndex >= 0 ? Number(argv[limitIndex + 1]) : Infinity;
  await mkdir(IMAGES, { recursive: true });
  /** @type {any[]} */
  const products = JSON.parse(await readFile(path.join(OUT, '.scrape', 'products.json'), 'utf8'));
  const jobs = products.flatMap((product) => (product.planned ?? []).map((image) => ({ src: image.src, file: image.file }))).slice(0, limit);
  /** @type {Record<string, boolean>} */
  const manifest = await readFile(MANIFEST, 'utf8').then((text) => JSON.parse(text), () => ({}));
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const job = jobs[next];
      next += 1;
      manifest[job.file] = await fetchOne(job.src, job.file);
      done += 1;
      if (done % 100 === 0) {
        console.log(`  ${done}/${jobs.length}`);
        await writeFile(MANIFEST, JSON.stringify(manifest));
      }
    }
  };
  await Promise.all(Array.from({ length: WORKERS }, worker));
  await writeFile(MANIFEST, JSON.stringify(manifest));
  const failed = jobs.filter((job) => !manifest[job.file]).length;
  console.log(`images: ${jobs.length - failed} on disk, ${failed} failed, of ${jobs.length}`);
  for (const [reason, count] of reasons) console.log(`  ${count} x ${reason}`);
  return 0;
}

if (process.argv[1]?.endsWith('download-images.mjs')) process.exitCode = await main(process.argv.slice(2));
