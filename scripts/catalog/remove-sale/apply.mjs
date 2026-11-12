#!/usr/bin/env node
// Takes the sale off every product of the named brands: a variant whose compare-at price is above its price gets its regular
// price back (price = the compare-at price) and the compare-at price is cleared, so the cards and the product page show no
// saving. Owner request 2026-11-12: "remove any discount/sale (only keep the free adjustable base) from Aireloom, Kingsdown and
// Molecule". The free adjustable base is a Shopify automatic discount and is not touched; neither is the newsletter code.
//
//   bash scripts/setup/with-admin-token.sh node scripts/catalog/remove-sale/apply.mjs "Aireloom,Kingsdown,Molecule"                       # dry run
//   bash scripts/setup/with-admin-token.sh node scripts/catalog/remove-sale/apply.mjs "Aireloom,Kingsdown,Molecule" --live --expect 426   # writes
//   bash scripts/setup/with-admin-token.sh node scripts/catalog/remove-sale/apply.mjs --restore scripts/catalog/.runs/remove-sale-<time>.json [--live]
//
// Every changed variant is written to a manifest in scripts/catalog/.runs/ (git-ignored) with its previous price and compare-at,
// so `--restore <manifest>` puts the sale back exactly. A restore only touches a variant that still holds the value this run wrote.
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
const vendors = restoreFile ? [] : (args.find((a) => !a.startsWith('--') && a !== flag('--expect')) ?? '').split(',').map((v) => v.trim()).filter(Boolean);
const {STORE, SHOPIFY_ADMIN_API_ACCESS_TOKEN: TOKEN, SHOPIFY_ALLOWED_STORES: ALLOWED = ''} = process.env;
if (!STORE || !TOKEN) {
  console.error('Set STORE and SHOPIFY_ADMIN_API_ACCESS_TOKEN (run through scripts/setup/with-admin-token.sh).');
  process.exit(2);
}
if (!ALLOWED.split(',').map((s) => s.trim()).includes(STORE)) {
  console.error(`Refused: ${STORE} is not listed in SHOPIFY_ALLOWED_STORES.`);
  process.exit(3);
}
if (!restoreFile && vendors.length === 0) {
  console.error('Name the brands, for example "Aireloom,Kingsdown,Molecule", or give --restore <manifest>.');
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
const UPDATE = `mutation($id: ID!, $variants: [ProductVariantsBulkInput!]!){productVariantsBulkUpdate(productId:$id, variants:$variants){userErrors{field message}}}`;
const money = (value) => Number(value).toFixed(2);

async function writeUpdates(byProduct) {
  let failed = 0;
  for (const [productId, variants] of byProduct) {
    const errors = (await gql(UPDATE, {id: productId, variants})).productVariantsBulkUpdate.userErrors;
    if (errors.length > 0) {
      console.error(`FAILED ${productId}: ${JSON.stringify(errors)}`);
      failed += 1;
    }
  }
  return failed;
}

if (restoreFile) {
  // ---- put a previous run back ------------------------------------------------------------------
  const manifest = JSON.parse(readFileSync(restoreFile, 'utf8'));
  const byProduct = new Map();
  let skipped = 0;
  for (const row of manifest.changed) {
    const now = (await gql(`query($id: ID!){productVariant(id:$id){id price compareAtPrice}}`, {id: row.variantId})).productVariant;
    if (!now || Number(now.price) !== Number(row.after.price) || now.compareAtPrice !== null) {
      skipped += 1;
      continue;
    }
    const list = byProduct.get(row.productId) ?? [];
    list.push({id: row.variantId, price: money(row.before.price), compareAtPrice: money(row.before.compareAtPrice)});
    byProduct.set(row.productId, list);
  }
  const count = [...byProduct.values()].reduce((n, list) => n + list.length, 0);
  console.log(`Restore ${restoreFile}: ${count} variants to put back, ${skipped} changed since and left alone.`);
  if (!live) {
    console.log('Dry run. Add --live to write.');
    process.exit(0);
  }
  process.exit((await writeUpdates(byProduct)) > 0 ? 1 : 0);
}

// ---- take the sale off ----------------------------------------------------------------------------
const changed = [];
const byProduct = new Map();
const perBrand = {};
for (const vendor of vendors) {
  let after = null;
  for (;;) {
    const data = await gql(
      `query($q:String!,$after:String){products(first:25,after:$after,query:$q){nodes{id handle vendor variants(first:100){nodes{id price compareAtPrice}}}pageInfo{hasNextPage endCursor}}}`,
      {q: `vendor:'${vendor}'`, after},
    );
    for (const product of data.products.nodes) {
      if (product.vendor !== vendor) continue; // the search is a text match: never touch another brand's product
      for (const variant of product.variants.nodes) {
        if (variant.compareAtPrice === null || !(Number(variant.compareAtPrice) > Number(variant.price))) continue;
        changed.push({
          handle: product.handle,
          vendor,
          productId: product.id,
          variantId: variant.id,
          before: {price: variant.price, compareAtPrice: variant.compareAtPrice},
          after: {price: money(variant.compareAtPrice), compareAtPrice: null},
        });
        const list = byProduct.get(product.id) ?? [];
        list.push({id: variant.id, price: money(variant.compareAtPrice), compareAtPrice: null});
        byProduct.set(product.id, list);
        perBrand[vendor] ??= {products: new Set(), variants: 0};
        perBrand[vendor].products.add(product.handle);
        perBrand[vendor].variants += 1;
      }
    }
    if (!data.products.pageInfo.hasNextPage) break;
    after = data.products.pageInfo.endCursor;
  }
}
for (const vendor of vendors) {
  const brand = perBrand[vendor];
  console.log(`${vendor.padEnd(10)} ${brand ? `${brand.variants} variants in ${brand.products.size} products on sale` : 'no sale'}`);
}
for (const row of changed.slice(0, 6)) console.log(`   e.g. ${row.handle}: ${row.before.price} (was ${row.before.compareAtPrice}) -> ${row.after.price}, no sale`);
console.log(`${changed.length} variants would go back to their regular price.`);
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
const out = `${dir}remove-sale-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
writeFileSync(out, JSON.stringify({store: STORE, at: new Date().toISOString(), vendors, changed}, null, 1));
console.log(`Manifest written first: ${out}`);
const failed = await writeUpdates(byProduct);
console.log(`Updated ${changed.length - 0} variants, ${failed} product writes failed.`);
process.exit(failed > 0 ? 1 : 0);
