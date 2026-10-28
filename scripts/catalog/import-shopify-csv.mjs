#!/usr/bin/env node
// Creates the products of a Shopify-layout product CSV (brand-catalog/brand-mattresses.shopify.csv) that are not in the store yet.
// Why: import.mjs needs the project sheet, whose contract is "one row per mattress size"; pillows, bases, protectors and other
// accessories have other options (Color, Option, Title...) and exist only in the Shopify layout. Shopify admin's own importer
// could load them, but not the brand reference or the publication, so this does the same through productSet. Dev-store tool.
//
//   bash scripts/setup/with-admin-token.sh node scripts/catalog/import-shopify-csv.mjs <file.csv>                       # dry run
//   bash scripts/setup/with-admin-token.sh node scripts/catalog/import-shopify-csv.mjs <file.csv> --live --expect 264 \
//       [--active] [--publication gid://shopify/Publication/...] [--limit 3]
//
// Only products whose handle is absent from the store are created; existing products are never updated or deleted, so a rerun
// after a partial failure only creates what is still missing. `--expect N` makes a live run stop unless exactly N are missing.
// Status follows the CSV (draft for unapproved copy) unless --active. Images are given to Shopify as their source URL.
// A manifest (handle, id, failures) is written to scripts/catalog/.runs/ (git-ignored).
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {parseCsv} from './csv.mjs';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--') && a !== valueOf('--expect') && a !== valueOf('--publication') && a !== valueOf('--limit') && a !== valueOf('--skip-type'));
function valueOf(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const live = args.includes('--live');
const active = args.includes('--active');
const expected = valueOf('--expect') === undefined ? null : Number(valueOf('--expect'));
const publication = valueOf('--publication') ?? null;
const skipType = valueOf('--skip-type') ?? null;
const limit = valueOf('--limit') === undefined ? Infinity : Number(valueOf('--limit'));
const {STORE, SHOPIFY_ADMIN_API_ACCESS_TOKEN: TOKEN, SHOPIFY_ALLOWED_STORES: ALLOWED = ''} = process.env;

if (!file) {
  console.error('Usage: import-shopify-csv.mjs <file.csv> [--live --expect N] [--active] [--publication <gid>] [--limit N] [--skip-type <Type>]');
  process.exit(2);
}
if (!STORE || !TOKEN) {
  console.error('Set STORE and SHOPIFY_ADMIN_API_ACCESS_TOKEN (run through scripts/setup/with-admin-token.sh).');
  process.exit(2);
}
if (!ALLOWED.split(',').map((s) => s.trim()).includes(STORE)) {
  console.error(`Refused: ${STORE} is not listed in SHOPIFY_ALLOWED_STORES.`);
  process.exit(3);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const gql = async (query, variables = {}) => {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(`https://${STORE}/admin/api/2026-10/graphql.json`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN},
      body: JSON.stringify({query, variables}),
    });
    const body = await response.json();
    const throttled = response.status === 429 || (body.errors ?? []).some((e) => e.extensions?.code === 'THROTTLED');
    if (throttled && attempt < 6) {
      await sleep(2000 * (attempt + 1));
      continue;
    }
    if (body.errors) throw new Error(JSON.stringify(body.errors).slice(0, 300));
    return body.data;
  }
};

// ---- read the CSV: one group per Handle, in file order ---------------------------------------------
const parsed = parseCsv(readFileSync(file, 'utf8'));
if (!parsed.ok) {
  console.error(`CSV error at row ${parsed.error.row}: ${parsed.error.message}`);
  process.exit(2);
}
const [header, ...records] = parsed.records.map((record) => record.fields);
const col = Object.fromEntries(header.map((name, index) => [name, index]));
const groups = new Map();
for (const row of records) {
  const handle = row[col.Handle];
  if (!handle) continue;
  if (!groups.has(handle)) groups.set(handle, []);
  groups.get(handle).push(row);
}
const cell = (row, name) => (row[col[name]] ?? '').trim();

const slug = (text) => text.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const droppedVariants = {};

/** Builds the productSet input of one handle group, or throws a message naming what is wrong. */
export function buildInput(rows) {
  const first = rows[0];
  const allVariantRows = rows.filter((row) => cell(row, 'Option1 Value') !== '' || cell(row, 'Variant SKU') !== '');
  // The makers list a few options twice under different SKUs (for example two foundation heights); Shopify allows one variant per
  // option combination, so the first stays and the rest are reported in the manifest.
  const seenCombos = new Set();
  const variantRows = allVariantRows.filter((row) => {
    const key = [1, 2, 3].map((n) => cell(row, `Option${n} Value`)).join('\u0001');
    if (seenCombos.has(key)) return false;
    seenCombos.add(key);
    return true;
  });
  droppedVariants[cell(rows[0], 'Handle')] = allVariantRows.length - variantRows.length;
  const optionNames = [1, 2, 3].map((n) => cell(first, `Option${n} Name`)).filter(Boolean);
  if (optionNames.length === 0 || variantRows.length === 0) throw new Error('no options or variants');
  const optionValues = optionNames.map((name, index) => ({
    name,
    values: [...new Set(variantRows.map((row) => cell(row, `Option${index + 1} Value`)))].map((value) => ({name: value})),
  }));
  const variants = variantRows.map((row) => {
    const price = cell(row, 'Variant Price');
    const compare = cell(row, 'Variant Compare At Price');
    return {
      optionValues: optionNames.map((name, index) => ({optionName: name, name: cell(row, `Option${index + 1} Value`)})),
      price,
      ...(compare ? {compareAtPrice: compare} : {}),
      inventoryPolicy: cell(row, 'Variant Inventory Policy').toUpperCase() === 'CONTINUE' ? 'CONTINUE' : 'DENY',
      taxable: cell(row, 'Variant Taxable').toLowerCase() !== 'false',
      inventoryItem: {sku: cell(row, 'Variant SKU'), requiresShipping: cell(row, 'Variant Requires Shipping').toLowerCase() !== 'false'},
    };
  });
  if (variants.some((variant) => variant.price === '' || Number.isNaN(Number(variant.price)))) throw new Error('a variant has no valid price');
  const seen = new Set();
  const files = [];
  for (const row of rows) {
    const src = cell(row, 'Image Src');
    if (!src || seen.has(src)) continue;
    seen.add(src);
    files.push({originalSource: src, contentType: 'IMAGE', ...(cell(row, 'Image Alt Text') ? {alt: cell(row, 'Image Alt Text')} : {})});
  }
  const tags = cell(first, 'Tags').split(',').map((tag) => tag.trim()).filter(Boolean);
  const status = active ? 'ACTIVE' : cell(first, 'Status').toUpperCase() === 'ACTIVE' ? 'ACTIVE' : 'DRAFT';
  return {
    handle: cell(first, 'Handle'),
    title: cell(first, 'Title'),
    descriptionHtml: first[col['Body (HTML)']] ?? '',
    vendor: cell(first, 'Vendor'),
    productType: cell(first, 'Type'),
    status,
    tags,
    ...(cell(first, 'SEO Title') || cell(first, 'SEO Description') ? {seo: {title: cell(first, 'SEO Title'), description: cell(first, 'SEO Description')}} : {}),
    productOptions: optionValues,
    variants,
    ...(files.length > 0 ? {files} : {}),
  };
}

// ---- what is missing in the store -------------------------------------------------------------------
const existing = new Set();
for (let after = null; ; ) {
  const data = await gql(`query($after:String){products(first:250,after:$after){pageInfo{hasNextPage endCursor}nodes{handle}}}`, {after});
  for (const node of data.products.nodes) existing.add(node.handle);
  if (!data.products.pageInfo.hasNextPage) break;
  after = data.products.pageInfo.endCursor;
}
// A type can be skipped when its products are already in the store under other handles (the sheet groups some mattresses differently).
const missing = [...groups.keys()].filter((handle) => !existing.has(handle) && (skipType === null || cell(groups.get(handle)[0], 'Type') !== skipType));
const byType = {};
const bad = [];
const inputs = [];
for (const handle of missing) {
  try {
    const input = buildInput(groups.get(handle));
    inputs.push(input);
    byType[input.productType] = (byType[input.productType] ?? 0) + 1;
  } catch (error) {
    bad.push({handle, reason: error.message});
  }
}
console.log(`${groups.size} products in the CSV, ${existing.size} in ${STORE}: ${missing.length} missing (${inputs.length} buildable, ${bad.length} not).`);
console.log('Missing by type:', JSON.stringify(byType));
if (bad.length > 0) console.log('Not buildable:', JSON.stringify(bad.slice(0, 10)));
console.log(`Status on create: ${active ? 'ACTIVE (--active)' : 'from the CSV'}; publication: ${publication ?? 'none'}.`);

if (!live) {
  console.log('Dry run. Nothing was sent. Add --live --expect <count> to create them.');
  process.exit(0);
}
if (expected !== missing.length) {
  console.error(`Stopped: --expect ${expected} does not match the ${missing.length} missing products. Nothing was created.`);
  process.exit(4);
}

// ---- create ------------------------------------------------------------------------------------------
const PRODUCT_SET = `mutation($input: ProductSetInput!){productSet(input:$input, synchronous:true){product{id handle} userErrors{field message}}}`;
const PUBLISH = `mutation($id: ID!, $input: [PublicationInput!]!){publishablePublish(id:$id, input:$input){userErrors{field message}}}`;
const BRAND = `query($handle: MetaobjectHandleInput!){metaobjectByHandle(handle:$handle){id}}`;
const brandIds = new Map();
const brandId = async (vendor) => {
  if (!brandIds.has(vendor)) brandIds.set(vendor, (await gql(BRAND, {handle: {type: 'brand', handle: slug(vendor)}})).metaobjectByHandle?.id ?? null);
  return brandIds.get(vendor);
};

const manifest = {store: STORE, at: new Date().toISOString(), created: [], withoutImages: [], failed: [], duplicateVariantsDropped: Object.fromEntries(Object.entries(droppedVariants).filter(([, count]) => count > 0))};
let done = 0;
for (const input of inputs) {
  if (done >= limit) break;
  done += 1;
  const id = await brandId(input.vendor);
  const withBrand = {...input, ...(id ? {metafields: [{namespace: 'custom', key: 'brand', type: 'metaobject_reference', value: id}]} : {})};
  let data;
  try {
    data = await gql(PRODUCT_SET, {input: withBrand});
  } catch (error) {
    // A dropped connection can leave the product created; look before counting it failed, so a rerun cannot duplicate it.
    const found = await gql(`query($h: String!){productByIdentifier(identifier:{handle:$h}){id}}`, {h: input.handle}).catch(() => null);
    if (found?.productByIdentifier) manifest.created.push({handle: input.handle, id: found.productByIdentifier.id, note: 'created before the connection dropped; not published by this run'});
    else manifest.failed.push({handle: input.handle, errors: [{message: String(error.message)}]});
    continue;
  }
  let errors = data.productSet.userErrors;
  if (errors.length > 0 && input.files) {
    // An image the source site refuses to serve must not cost the product; it is created without photos and listed.
    const { files, ...rest } = withBrand;
    const retry = await gql(PRODUCT_SET, {input: rest});
    if (retry.productSet.userErrors.length === 0) {
      data = retry;
      errors = [];
      manifest.withoutImages.push({handle: input.handle, reason: withBrand.files.length + ' image(s) rejected'});
    }
  }
  if (errors.length > 0 || !data.productSet.product) {
    manifest.failed.push({handle: input.handle, errors});
    continue;
  }
  const productId = data.productSet.product.id;
  if (publication && input.status === 'ACTIVE') {
    const published = (await gql(PUBLISH, {id: productId, input: [{publicationId: publication}]})).publishablePublish.userErrors;
    if (published.length > 0) manifest.failed.push({handle: input.handle, stage: 'publish', errors: published});
  }
  manifest.created.push({handle: input.handle, id: productId});
  if (done % 25 === 0) console.log(`  ${done}/${Math.min(inputs.length, limit)} done`);
}

const dir = fileURLToPath(new URL('./.runs/', import.meta.url));
mkdirSync(dir, {recursive: true});
const out = `${dir}import-shopify-csv-${manifest.at.replace(/[:.]/g, '-')}.json`;
writeFileSync(out, JSON.stringify(manifest, null, 1));
console.log(`Created ${manifest.created.length}, without images ${manifest.withoutImages.length}, failed ${manifest.failed.length}. Manifest: ${out}`);
process.exit(manifest.failed.length > 0 ? 1 : 0);
