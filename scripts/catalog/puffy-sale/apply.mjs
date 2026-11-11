#!/usr/bin/env node
// Puts Puffy's sale prices (puffy-sale-prices.json, built by build.mjs from puffy.com) on the Puffy mattresses of the store: the
// variant price becomes the sale price and the compare-at price the regular price, so the cards and the product page show the
// saving from Shopify's own fields. Variants are matched by their size name; a size that is not in the file is left alone.
//
//   bash scripts/setup/with-admin-token.sh node scripts/catalog/puffy-sale/apply.mjs            # dry run
//   bash scripts/setup/with-admin-token.sh node scripts/catalog/puffy-sale/apply.mjs --live
//   bash scripts/setup/with-admin-token.sh node scripts/catalog/puffy-sale/apply.mjs --live --end   # the sale is over: price back to the regular price, compare-at cleared
//
// Safety: a variant is changed only when its current regular price (its compare-at if the sale is already on, else its price)
// equals the regular price Puffy lists. Anything else is reported and left alone, so a price the team changed by hand is never
// overwritten. Puffy's sale runs until `validUntil` in the file; this store does not end it by itself, so run `--end` then.
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const live = process.argv.includes('--live');
const end = process.argv.includes('--end');
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

const file = JSON.parse(readFileSync(fileURLToPath(new URL('./puffy-sale-prices.json', import.meta.url)), 'utf8'));
const READ = `query($h: String!){productByIdentifier(identifier:{handle:$h}){id status variants(first:100){nodes{id title price compareAtPrice}}}}`;
const UPDATE = `mutation($id: ID!, $variants: [ProductVariantsBulkInput!]!){productVariantsBulkUpdate(productId:$id, variants:$variants){userErrors{field message}}}`;
const money = (value) => Number(value).toFixed(2);

let changed = 0;
let problems = 0;
console.log(`Puffy sale ${end ? 'END' : 'ON'}, from ${file.source}, read ${file.readOn}, valid until ${file.validUntil}.`);
for (const [handle, product] of Object.entries(file.products)) {
  const stored = (await gql(READ, {h: handle})).productByIdentifier;
  if (!stored) {
    console.log(`MISSING  ${handle}`);
    problems += 1;
    continue;
  }
  const updates = [];
  const notes = [];
  for (const variant of stored.variants.nodes) {
    const size = variant.title.replace(/\s+-\s+\(.*$/, '').trim();
    const row = product.sizes[size];
    if (!row) {
      notes.push(`${size}: not in the file`);
      continue;
    }
    const regular = variant.compareAtPrice ? Number(variant.compareAtPrice) : Number(variant.price);
    if (regular !== row.list) {
      notes.push(`${size}: regular price here ${regular}, Puffy lists ${row.list}: left alone`);
      problems += 1;
      continue;
    }
    const wanted = end ? {price: money(row.list), compareAtPrice: null} : {price: money(row.sale), compareAtPrice: money(row.list)};
    const same = Number(variant.price) === Number(wanted.price) && (variant.compareAtPrice === null ? null : Number(variant.compareAtPrice)) === (wanted.compareAtPrice === null ? null : Number(wanted.compareAtPrice));
    if (!same) updates.push({id: variant.id, ...wanted});
  }
  changed += updates.length;
  console.log(`${updates.length === 0 ? 'unchanged' : live ? 'UPDATE   ' : 'would set '} ${handle}: ${updates.length} of ${stored.variants.nodes.length} variants${notes.length ? ' | ' + notes.join('; ') : ''}`);
  if (live && updates.length > 0) {
    const errors = (await gql(UPDATE, {id: stored.id, variants: updates})).productVariantsBulkUpdate.userErrors;
    if (errors.length > 0) {
      console.error(`FAILED ${handle}: ${JSON.stringify(errors)}`);
      problems += 1;
    }
  }
}
console.log(`${live ? 'Updated' : 'Dry run: would update'} ${changed} variants, ${problems} problems.`);
process.exit(problems > 0 ? 1 : 0);
