#!/usr/bin/env node
// Moves every ACTIVE product of the named product types to DRAFT (hidden from the storefront), with a manifest so it can be undone.
// Owner request 2026-11-12: pillows, sheets, mattress toppers, accessories and pet beds to draft.
//
//   bash scripts/setup/with-admin-token.sh node scripts/catalog/set-status/apply.mjs "Pillow,Sheets,Mattress Topper,Accessory,Pet Bed"                    # dry run
//   bash scripts/setup/with-admin-token.sh node scripts/catalog/set-status/apply.mjs "Pillow,Sheets,..." --live --expect 129                              # writes
//   bash scripts/setup/with-admin-token.sh node scripts/catalog/set-status/apply.mjs --restore scripts/catalog/.runs/set-status-<time>.json [--live]       # back to ACTIVE
//
// Only ACTIVE products are touched (a product that is already a draft or archived is left alone), and a product tagged `offer-only`
// (a service or an offer product the cart adds) is never drafted by this script: it is listed and skipped. The manifest in
// scripts/catalog/.runs/ (git-ignored) is written before anything changes; a restore only re-activates a product that is still a DRAFT.
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const args = process.argv.slice(2);
const live = args.includes('--live');
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const restoreFile = flag('--restore');
const expect = flag('--expect') === undefined ? null : Number(flag('--expect'));
const types = restoreFile ? [] : (args.find((a) => !a.startsWith('--') && a !== flag('--expect')) ?? '').split(',').map((t) => t.trim()).filter(Boolean);
const {STORE, SHOPIFY_ADMIN_API_ACCESS_TOKEN: TOKEN, SHOPIFY_ALLOWED_STORES: ALLOWED = ''} = process.env;
if (!STORE || !TOKEN) {
  console.error('Set STORE and SHOPIFY_ADMIN_API_ACCESS_TOKEN (run through scripts/setup/with-admin-token.sh).');
  process.exit(2);
}
if (!ALLOWED.split(',').map((s) => s.trim()).includes(STORE)) {
  console.error(`Refused: ${STORE} is not listed in SHOPIFY_ALLOWED_STORES.`);
  process.exit(3);
}
if (!restoreFile && types.length === 0) {
  console.error('Name the product types, for example "Pillow,Sheets", or give --restore <manifest>.');
  process.exit(2);
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
    if (body.errors) throw new Error(JSON.stringify(body.errors).slice(0, 400));
    return body.data;
  }
};
const SET = `mutation($input: ProductInput!){productUpdate(input:$input){product{id status} userErrors{field message}}}`;
async function setStatus(rows, status) {
  let failed = 0;
  for (const row of rows) {
    const errors = (await gql(SET, {input: {id: row.id, status}})).productUpdate.userErrors;
    if (errors.length > 0) {
      console.error(`FAILED ${row.handle}: ${JSON.stringify(errors)}`);
      failed += 1;
    }
  }
  return failed;
}

if (restoreFile) {
  const manifest = JSON.parse(readFileSync(restoreFile, 'utf8'));
  const rows = [];
  let skipped = 0;
  for (const row of manifest.changed) {
    const now = (await gql(`query($id: ID!){product(id:$id){status}}`, {id: row.id})).product;
    if (now?.status === 'DRAFT') rows.push(row);
    else skipped += 1;
  }
  console.log(`Restore ${restoreFile}: ${rows.length} products back to ACTIVE, ${skipped} changed since and left alone.`);
  if (!live) {
    console.log('Dry run. Add --live to write.');
    process.exit(0);
  }
  process.exit((await setStatus(rows, 'ACTIVE')) > 0 ? 1 : 0);
}

const changed = [];
const skippedOfferOnly = [];
const counts = {};
for (const type of types) {
  let after = null;
  for (;;) {
    const data = await gql(
      `query($q:String!,$after:String){products(first:100,after:$after,query:$q){nodes{id handle title vendor status productType tags}pageInfo{hasNextPage endCursor}}}`,
      {q: `product_type:'${type.replace(/'/g, '')}'`, after},
    );
    for (const p of data.products.nodes) {
      if (p.productType !== type || p.status !== 'ACTIVE') continue; // the search is a text match: exact type, active only
      if (p.tags.includes('offer-only')) {
        skippedOfferOnly.push(p.handle);
        continue;
      }
      changed.push({id: p.id, handle: p.handle, vendor: p.vendor, productType: type, before: p.status});
      counts[type] = (counts[type] ?? 0) + 1;
    }
    if (!data.products.pageInfo.hasNextPage) break;
    after = data.products.pageInfo.endCursor;
  }
}
for (const type of types) console.log(`${type.padEnd(18)} ${counts[type] ?? 0} active products -> DRAFT`);
if (skippedOfferOnly.length > 0) console.log(`Skipped (tagged offer-only): ${skippedOfferOnly.join(', ')}`);
console.log(`${changed.length} products would go to DRAFT.`);
if (!live) {
  console.log(`Dry run. Nothing was sent. Add --live --expect ${changed.length} to write.`);
  process.exit(0);
}
if (expect !== changed.length) {
  console.error(`Stopped: --expect ${expect} does not match ${changed.length}. Nothing was written.`);
  process.exit(4);
}
const dir = fileURLToPath(new URL('../.runs/', import.meta.url));
mkdirSync(dir, {recursive: true});
const out = `${dir}set-status-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
writeFileSync(out, JSON.stringify({store: STORE, at: new Date().toISOString(), types, changed}, null, 1));
console.log(`Manifest written first: ${out}`);
const failed = await setStatus(changed, 'DRAFT');
console.log(`Moved ${changed.length - failed} products to DRAFT, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
