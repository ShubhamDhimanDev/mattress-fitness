// Removes the SAMPLE products and the sample brand entries from a DEVELOPMENT store so only real brands remain (owner request,
// 2026-10-27). Dry run by default: it lists what it would delete and sends nothing.
//
//   bash scripts/setup/with-admin-token.sh node scripts/setup/clean-dev-store.mjs                  # dry run
//   bash scripts/setup/with-admin-token.sh node scripts/setup/clean-dev-store.mjs --live --expect 80
//
// What goes (all by explicit rule, nothing by guess):
//  - every product of the four made-up brands (Tessaly Home, Brindlewood Bedding, Oakhollow Mattress Co., Quillmoor Sleep), which includes the
//    sample add-ons (`sample-*`);
//  - the products of the earlier four-brand import (Puffy, Molecule, Beautyrest, Serta) created on 2026-10-26 with placeholder pictures:
//    the new brand sheet replaces them under different handles, so keeping them would duplicate every model;
//  - the empty `testing` product;
//  - the eight brand entries (the four made-up ones, and the four real ones whose "about" text calls them made-up brands);
//    the twelve real brands are then seeded with `seed-entries.mjs --only brand`.
// What is never touched (PROTECTED): the haul-away service.
//
// Needs STORE, SHOPIFY_ADMIN_API_ACCESS_TOKEN (write_products, write_metaobjects) and SHOPIFY_ALLOWED_STORES; a live run refuses a store
// that is not listed. `--expect N` makes a live run stop unless exactly N products match, so a changed store is noticed. Every live run
// writes a manifest (id, handle, title) to scripts/catalog/.runs/ (git-ignored).
import {mkdirSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const live = process.argv.includes('--live');
const expectIndex = process.argv.indexOf('--expect');
const expected = expectIndex >= 0 ? Number(process.argv[expectIndex + 1]) : null;
const {STORE, SHOPIFY_ADMIN_API_ACCESS_TOKEN: TOKEN, SHOPIFY_ALLOWED_STORES: ALLOWED = ''} = process.env;

const FAKE_VENDORS = new Set(['Tessaly Home', 'Brindlewood Bedding', 'Oakhollow Mattress Co.', 'Quillmoor Sleep']);
const OLD_REAL_VENDORS = new Set(['Puffy', 'Molecule', 'Beautyrest', 'Serta']);
const OLD_IMPORT_DAY = '2026-10-26';
// Only the real haul-away service stays. The owner removed the gift, bundle and add-on offers on 2026-10-27, so the sample add-ons
// and the three mattresses those discounts were built on are no longer needed.
const PROTECTED_HANDLES = new Set(['recycle-and-disposal-service']);
const BRAND_HANDLES_TO_REPLACE = ['tessaly-home', 'brindlewood-bedding', 'quillmoor-sleep', 'oakhollow-mattress-co', 'puffy', 'molecule', 'beautyrest', 'serta'];

if (!STORE || !TOKEN) {
  console.error('Set STORE and SHOPIFY_ADMIN_API_ACCESS_TOKEN (run through scripts/setup/with-admin-token.sh).');
  process.exit(2);
}
if (!ALLOWED.split(',').map((s) => s.trim()).includes(STORE)) {
  console.error(`Refused: ${STORE} is not listed in SHOPIFY_ALLOWED_STORES.`);
  process.exit(3);
}

const gql = async (query, variables = {}) => {
  const response = await fetch(`https://${STORE}/admin/api/2026-10/graphql.json`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN},
    body: JSON.stringify({query, variables}),
  });
  const body = await response.json();
  if (body.errors) throw new Error(JSON.stringify(body.errors).slice(0, 300));
  return body.data;
};

/** True for a product this script may delete. */
export function isSample(product) {
  if (PROTECTED_HANDLES.has(product.handle)) return false;
  if (FAKE_VENDORS.has(product.vendor)) return true;
  if (OLD_REAL_VENDORS.has(product.vendor)) return product.createdAt.startsWith(OLD_IMPORT_DAY);
  return product.handle === 'testing';
}

const PRODUCTS = `query($after:String){products(first:100,after:$after){pageInfo{hasNextPage endCursor}nodes{id handle title vendor productType createdAt}}}`;
const all = [];
for (let after = null; ; ) {
  const data = await gql(PRODUCTS, {after});
  all.push(...data.products.nodes);
  if (!data.products.pageInfo.hasNextPage) break;
  after = data.products.pageInfo.endCursor;
}
const targets = all.filter(isSample);
const kept = all.length - targets.length;
console.log(`${all.length} products in ${STORE}: ${targets.length} to delete, ${kept} kept.`);
const byVendor = {};
for (const product of targets) byVendor[product.vendor] = (byVendor[product.vendor] ?? 0) + 1;
console.log('To delete by vendor:', JSON.stringify(byVendor));
console.log('Kept:', all.filter((p) => !isSample(p)).map((p) => p.handle).join(', '));
console.log(`Brand entries to replace: ${BRAND_HANDLES_TO_REPLACE.join(', ')}`);

if (!live) {
  console.log('Dry run. Nothing was sent. Add --live --expect <count> to delete.');
  process.exit(0);
}
if (expected !== targets.length) {
  console.error(`Stopped: --expect ${expected} does not match the ${targets.length} products found. Nothing was deleted.`);
  process.exit(4);
}

const manifest = {store: STORE, at: new Date().toISOString(), products: [], brands: [], failed: []};
const DELETE_PRODUCT = `mutation($input: ProductDeleteInput!){productDelete(input:$input){deletedProductId userErrors{field message}}}`;
for (const product of targets) {
  const data = await gql(DELETE_PRODUCT, {input: {id: product.id}});
  const errors = data.productDelete.userErrors;
  if (errors.length > 0) manifest.failed.push({handle: product.handle, errors});
  else manifest.products.push({id: product.id, handle: product.handle, title: product.title, vendor: product.vendor});
}

const FIND_BRAND = `query($handle: MetaobjectHandleInput!){metaobjectByHandle(handle:$handle){id handle}}`;
const DELETE_BRAND = `mutation($id: ID!){metaobjectDelete(id:$id){deletedId userErrors{field message}}}`;
for (const handle of BRAND_HANDLES_TO_REPLACE) {
  const found = (await gql(FIND_BRAND, {handle: {type: 'brand', handle}})).metaobjectByHandle;
  if (!found) continue;
  const errors = (await gql(DELETE_BRAND, {id: found.id})).metaobjectDelete.userErrors;
  if (errors.length > 0) manifest.failed.push({brand: handle, errors});
  else manifest.brands.push({id: found.id, handle});
}

const dir = fileURLToPath(new URL('../catalog/.runs/', import.meta.url));
mkdirSync(dir, {recursive: true});
const file = `${dir}clean-dev-store-${manifest.at.replace(/[:.]/g, '-')}.json`;
writeFileSync(file, JSON.stringify(manifest, null, 1));
console.log(`Deleted ${manifest.products.length} products and ${manifest.brands.length} brand entries; ${manifest.failed.length} failed. Manifest: ${file}`);
process.exit(manifest.failed.length > 0 ? 1 : 0);
