#!/usr/bin/env node
// Puts the sale prices of aireloom-products.json (price, and compare-at = the retailer's list price) on the 14 products that
// import.mjs already created. Matches variants by SKU; touches nothing else.
//
//   bash scripts/setup/with-admin-token.sh node scripts/catalog/hadleyolivia/update-prices.mjs           # dry run
//   bash scripts/setup/with-admin-token.sh node scripts/catalog/hadleyolivia/update-prices.mjs --live
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const live = process.argv.includes('--live');
const {STORE, SHOPIFY_ADMIN_API_ACCESS_TOKEN: TOKEN, SHOPIFY_ALLOWED_STORES: ALLOWED = ''} = process.env;
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
    if (body.errors) throw new Error(JSON.stringify(body.errors).slice(0, 400));
    return body.data;
  }
};

const products = JSON.parse(readFileSync(fileURLToPath(new URL('./aireloom-products.json', import.meta.url)), 'utf8'));
const READ = `query($h: String!){productByIdentifier(identifier:{handle:$h}){id variants(first:100){nodes{id sku price compareAtPrice}}}}`;
const UPDATE = `mutation($id: ID!, $variants: [ProductVariantsBulkInput!]!){productVariantsBulkUpdate(productId:$id, variants:$variants){userErrors{field message}}}`;

let changed = 0;
let failed = 0;
for (const product of products) {
  const stored = (await gql(READ, {h: product.handle})).productByIdentifier;
  if (!stored) {
    console.log(`MISSING ${product.handle}`);
    failed += 1;
    continue;
  }
  const bySku = new Map(stored.variants.nodes.map((v) => [v.sku, v]));
  const updates = [];
  for (const variant of product.variants) {
    const current = bySku.get(variant.sku);
    if (!current) {
      console.log(`  no variant with SKU ${variant.sku} on ${product.handle}`);
      failed += 1;
      continue;
    }
    const same = Number(current.price) === Number(variant.price) && Number(current.compareAtPrice ?? 0) === Number(variant.compareAt);
    if (!same) updates.push({id: current.id, price: variant.price, compareAtPrice: variant.compareAt});
  }
  changed += updates.length;
  const sample = product.variants[0];
  console.log(`${updates.length === 0 ? 'unchanged' : live ? 'UPDATE ' : 'would update'} ${product.handle}: ${updates.length} of ${product.variants.length} variants (e.g. ${sample.size} / ${sample.foundation}: ${sample.price}, was ${sample.compareAt})`);
  if (live && updates.length > 0) {
    const errors = (await gql(UPDATE, {id: stored.id, variants: updates})).productVariantsBulkUpdate.userErrors;
    if (errors.length > 0) {
      console.error(`FAILED ${product.handle}: ${JSON.stringify(errors)}`);
      failed += 1;
    }
  }
}
console.log(`${live ? 'Updated' : 'Dry run: would update'} ${changed} variants, ${failed} problems.`);
process.exit(failed > 0 ? 1 : 0);
