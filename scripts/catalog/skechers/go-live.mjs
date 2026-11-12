#!/usr/bin/env node
// Owner request 2026-11-12: make the three Skechers Recovery Series mattresses live and put them in the new Skechers brand.
// Links each product to the `brand` entry "skechers" (custom.brand), sets it ACTIVE and publishes it to the sales channels the
// active Molecule mattresses are on. Dry run by default; --live writes. Safe to repeat.
//
//   bash scripts/setup/with-admin-token.sh node scripts/catalog/skechers/go-live.mjs [--live]
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const live = process.argv.includes('--live');
const {STORE, SHOPIFY_ADMIN_API_ACCESS_TOKEN: TOKEN, SHOPIFY_ALLOWED_STORES: ALLOWED = ''} = process.env;
if (!STORE || !TOKEN || !ALLOWED.split(',').map((s) => s.trim()).includes(STORE)) {
  console.error('Run through scripts/setup/with-admin-token.sh with the store in SHOPIFY_ALLOWED_STORES.');
  process.exit(2);
}
const gql = async (query, variables = {}) => {
  const response = await fetch(`https://${STORE}/admin/api/2026-10/graphql.json`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN},
    body: JSON.stringify({query, variables}),
  });
  const body = await response.json();
  if (body.errors) throw new Error(JSON.stringify(body.errors).slice(0, 400));
  return body.data;
};
const data = JSON.parse(readFileSync(fileURLToPath(new URL('./skechers-products.json', import.meta.url)), 'utf8'));
const brand = (await gql(`query{metaobjectByHandle(handle:{type:"brand",handle:"skechers"}){id}}`)).metaobjectByHandle;
if (!brand) {
  console.error('The brand entry "skechers" does not exist: run seed-entries.mjs --only brand --handle skechers --live first.');
  process.exit(3);
}
const pubs = await gql(`query{products(first:1,query:"vendor:Molecule status:active"){nodes{resourcePublicationsV2(first:20){nodes{isPublished publication{id name}}}}}}`);
const publications = (pubs.products.nodes[0]?.resourcePublicationsV2.nodes ?? []).filter((n) => n.isPublished).map((n) => n.publication);
console.log(`Brand ${brand.id}; publish to: ${publications.map((p) => p.name).join(', ')}`);

const READ = `query($h: String!){productByIdentifier(identifier:{handle:$h}){id status vendor}}`;
const UPDATE = `mutation($input: ProductInput!){productUpdate(input:$input){product{id status} userErrors{field message}}}`;
const PUBLISH = `mutation($id: ID!, $input: [PublicationInput!]!){publishablePublish(id:$id, input:$input){userErrors{field message}}}`;
let failed = 0;
for (const product of data.products) {
  const stored = (await gql(READ, {h: product.handle})).productByIdentifier;
  if (!stored) {
    console.log(`MISSING ${product.handle}`);
    failed += 1;
    continue;
  }
  console.log(`${live ? 'UPDATE ' : 'would '} ${product.handle}: ${stored.status} -> ACTIVE, brand link, published to ${publications.length} channels`);
  if (!live) continue;
  const result = (
    await gql(UPDATE, {
      input: {id: stored.id, status: 'ACTIVE', metafields: [{namespace: 'custom', key: 'brand', type: 'metaobject_reference', value: brand.id}]},
    })
  ).productUpdate;
  if (result.userErrors.length > 0) {
    console.error(`FAILED ${product.handle}: ${JSON.stringify(result.userErrors)}`);
    failed += 1;
    continue;
  }
  for (const publication of publications) {
    const errors = (await gql(PUBLISH, {id: stored.id, input: [{publicationId: publication.id}]})).publishablePublish.userErrors;
    if (errors.length > 0) {
      console.error(`publish ${product.handle} to ${publication.name}: ${JSON.stringify(errors)}`);
      failed += 1;
    }
  }
}
process.exit(failed > 0 ? 1 : 0);
