#!/usr/bin/env node
// Swaps the product photos that carry a maker's sale bar for the cropped copies (owner request 2026-11-07).
//
// Why: Helix's first and seventh photos showed "20% Off Sitewide / Discount Code FALLSALE20" under the bed. The bar is cut off the
// local files by scrape/strip-sale-bar.py (names in .scrape/helix-cropped-files.json); this script puts those files in Shopify, on the
// products that already have them, keeping each photo's place in the gallery: `fileUpdate` replaces the source of the existing media,
// so ids, order and alt text stay.
//
//   bash scripts/setup/with-admin-token.sh node scripts/catalog/replace-cropped-images.mjs            # dry run: reads, prints, writes nothing
//   bash scripts/setup/with-admin-token.sh node scripts/catalog/replace-cropped-images.mjs --live     # uploads and replaces
//
// Needs read_products and write_files (or write_products) on the app behind the token. STORE must be in SHOPIFY_ALLOWED_STORES (the
// wrapper sets both). A photo matches by its stored file name without the extension (Shopify may change case, add a uuid or switch webp to png, see remote.mjs fileKey), and is replaced by the cropped copy in the same format; a photo
// whose name is not one of the cropped files is left alone and counted, so products imported under other names show up in the report.
// Safe to re-run: a photo that is already short (height under 70 percent of the width) is skipped.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { mimeTypeFor, uploadToStagedTarget } from './images.mjs';
import { fileKey } from './remote.mjs';

const { STORE, SHOPIFY_ADMIN_API_ACCESS_TOKEN: TOKEN, SHOPIFY_ALLOWED_STORES: ALLOWED = '' } = process.env;
if (!STORE || !TOKEN) {
  console.error('Set STORE and SHOPIFY_ADMIN_API_ACCESS_TOKEN (run through scripts/setup/with-admin-token.sh).');
  process.exit(2);
}
if (!ALLOWED.split(',').map((s) => s.trim()).includes(STORE)) {
  console.error(`Refused: ${STORE} is not listed in SHOPIFY_ALLOWED_STORES.`);
  process.exit(3);
}

const LIVE = process.argv.includes('--live');
const VENDOR = 'Helix';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const BRAND_CATALOG = path.join(HERE, 'brand-catalog');
// Every cropped photo in png, jpg and webp (strip-sale-bar.py): the replacement keeps the extension Shopify stored.
const VARIANTS = path.join(BRAND_CATALOG, '.scrape', 'helix-cropped-variants');
const LIST = path.join(BRAND_CATALOG, '.scrape', 'helix-cropped-files.json');
const ALREADY_CROPPED_RATIO = 0.7;

const gql = async (query, variables = {}) => {
  const response = await fetch(`https://${STORE}/admin/api/2026-10/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN },
    body: JSON.stringify({ query, variables }),
  });
  const body = await response.json();
  if (body.errors) throw new Error(JSON.stringify(body.errors).slice(0, 400));
  return body.data;
};

const names = JSON.parse(await readFile(LIST, 'utf8'));
if (!Array.isArray(names) || names.length === 0) {
  console.error(`${LIST} is empty. Run scrape/strip-sale-bar.py first.`);
  process.exit(2);
}
const stemOf = (name) => fileKey(name).replace(/\.[a-z0-9]+$/, '');
const extensionOf = (name) => {
  const ext = (/\.([a-z0-9]+)$/i.exec(name)?.[1] ?? '').toLowerCase();
  return ext === 'jpeg' ? 'jpg' : ext;
};
const croppedStems = new Set(names.map(stemOf));

const fileNameOf = (url) => {
  try {
    return decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '');
  } catch {
    return '';
  }
};

/** @returns {Promise<{ id: string, handle: string, media: { id: string, name: string, width: number, height: number }[] }[]>} */
async function helixProducts() {
  const found = [];
  let after = null;
  for (;;) {
    const data = await gql(
      `query($q: String!, $after: String) { products(first: 25, after: $after, query: $q) { nodes { id handle media(first: 50) { nodes { id mediaContentType ... on MediaImage { image { url width height } } } } } pageInfo { hasNextPage endCursor } } }`,
      { q: `vendor:${VENDOR}`, after },
    );
    for (const node of data.products.nodes) {
      const media = node.media.nodes
        .filter((item) => item.mediaContentType === 'IMAGE' && item.image)
        .map((item) => ({ id: item.id, name: fileNameOf(item.image.url), width: item.image.width, height: item.image.height }));
      found.push({ id: node.id, handle: node.handle, media });
    }
    if (!data.products.pageInfo.hasNextPage) return found;
    after = data.products.pageInfo.endCursor;
  }
}

const products = await helixProducts();
/** @type {{ product: string, mediaId: string, file: string }[]} */
const todo = [];
let alreadyCropped = 0;
let otherPhotos = 0;
for (const product of products) {
  for (const media of product.media) {
    const extension = extensionOf(media.name);
    const file = croppedStems.has(stemOf(media.name)) && ['png', 'jpg', 'webp'].includes(extension) ? `${stemOf(media.name)}.${extension}` : null;
    if (!file) {
      otherPhotos += 1;
    } else if (media.width > 0 && media.height / media.width < ALREADY_CROPPED_RATIO) {
      alreadyCropped += 1;
    } else {
      todo.push({ product: product.handle, mediaId: media.id, file });
    }
  }
}
const files = [...new Set(todo.map((item) => item.file))];
console.log(`${STORE}: ${products.length} ${VENDOR} products. To replace: ${todo.length} photos (${files.length} different files). Already cropped: ${alreadyCropped}. Other photos left alone: ${otherPhotos}.`);
for (const item of todo.slice(0, 8)) console.log(`  ${item.product}: ${item.file}`);
if (todo.length > 8) console.log(`  ... and ${todo.length - 8} more`);
if (products.length > 0 && todo.length === 0 && alreadyCropped === 0) {
  console.log('Nothing matched by file name. The products were probably imported under other photo names; check one product\'s media in admin.');
}

if (!LIVE) {
  console.log('Dry run: nothing written. Add --live to upload and replace.');
  process.exit(0);
}
if (todo.length === 0) process.exit(0);

// 1. Stage each cropped file once; every product photo that needs it points at the same staged copy.
const resourceUrl = new Map();
for (let start = 0; start < files.length; start += 10) {
  const batch = files.slice(start, start + 10);
  const input = batch.map((filename) => ({ resource: 'IMAGE', filename, mimeType: mimeTypeFor(filename) ?? 'image/webp', httpMethod: 'POST' }));
  const data = await gql(
    `mutation($input: [StagedUploadInput!]!) { stagedUploadsCreate(input: $input) { stagedTargets { url resourceUrl parameters { name value } } userErrors { message } } }`,
    { input },
  );
  const { stagedTargets, userErrors } = data.stagedUploadsCreate;
  if (userErrors.length > 0 || stagedTargets.length !== batch.length) throw new Error(`stagedUploadsCreate: ${JSON.stringify(userErrors)}`);
  for (const [index, filename] of batch.entries()) {
    const result = await uploadToStagedTarget(stagedTargets[index], { name: filename, path: path.join(VARIANTS, filename) });
    if (!result.ok) throw new Error(result.message);
    resourceUrl.set(filename, stagedTargets[index].resourceUrl);
  }
  console.log(`staged ${Math.min(start + 10, files.length)} of ${files.length} files`);
}

// 2. Replace the source of each existing photo, a few at a time.
let replaced = 0;
const failures = [];
for (let start = 0; start < todo.length; start += 10) {
  const batch = todo.slice(start, start + 10);
  const data = await gql(
    `mutation($files: [FileUpdateInput!]!) { fileUpdate(files: $files) { files { id } userErrors { field message } } }`,
    { files: batch.map((item) => ({ id: item.mediaId, originalSource: resourceUrl.get(item.file) })) },
  );
  const { files: updated, userErrors } = data.fileUpdate;
  replaced += updated.length;
  for (const error of userErrors) failures.push(`${batch.map((item) => item.product).join(',')}: ${error.message}`);
  await sleep(500);
}
console.log(`replaced ${replaced} of ${todo.length} photos.`);
if (failures.length > 0) {
  console.error(`${failures.length} error(s):\n${failures.slice(0, 10).join('\n')}`);
  process.exit(1);
}
console.log('Shopify processes the new images for a minute or two. Run the dry run again: it should report 0 to replace.');
