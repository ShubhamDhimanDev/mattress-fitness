#!/usr/bin/env node
// Creates the BG by BEDGEAR Complete Bedding Set of bedgear-product.json (read from mattresswarehouse.com on 2026-11-13 at the
// owner's request) with its nine photos in the page's order (the first is the main image), ACTIVE and published to the sales
// channels the active Molecule mattresses are on. A product whose handle already exists is never touched.
//
//   bash scripts/setup/with-admin-token.sh node scripts/catalog/bedgear/import.mjs              # dry run
//   bash scripts/setup/with-admin-token.sh node scripts/catalog/bedgear/import.mjs --live
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
const {product} = JSON.parse(readFileSync(fileURLToPath(new URL('./bedgear-product.json', import.meta.url)), 'utf8'));
const existing = (await gql(`query($h: String!){productByIdentifier(identifier:{handle:$h}){id status}}`, {h: product.handle})).productByIdentifier;
const pubs = await gql(`query{products(first:1,query:"vendor:Molecule status:active"){nodes{resourcePublicationsV2(first:20){nodes{isPublished publication{id name}}}}}}`);
const publications = (pubs.products.nodes[0]?.resourcePublicationsV2.nodes ?? []).filter((n) => n.isPublished).map((n) => n.publication);
console.log(`${existing ? 'EXISTS' : 'CREATE'} ${product.handle} | ${product.variants.length} sizes at ${product.variants[0].price} | ${product.images.length} photos | ACTIVE, published to ${publications.map((p) => p.name).join(', ')}`);
if (existing) process.exit(0);
if (!live) {
  console.log('Dry run. Nothing was sent. Add --live to write.');
  process.exit(0);
}
const set = (
  await gql(`mutation($input: ProductSetInput!){productSet(input:$input, synchronous:true){product{id handle status} userErrors{field message}}}`, {
    input: {
      handle: product.handle,
      title: product.title,
      descriptionHtml: product.descriptionHtml,
      vendor: product.vendor,
      productType: product.productType,
      status: 'ACTIVE',
      tags: product.tags,
      productOptions: product.options.map((option, index) => ({name: option.name, position: index + 1, values: option.values.map((name) => ({name}))})),
      variants: product.variants.map((variant) => ({
        optionValues: [{optionName: 'Size', name: variant.size}],
        price: variant.price,
        inventoryPolicy: 'DENY',
        taxable: true,
        inventoryItem: {sku: variant.sku, requiresShipping: true},
      })),
      files: product.images.map((source, index) => ({originalSource: source, contentType: 'IMAGE', alt: index === 0 ? product.title : `${product.title}, view ${index + 1}`})),
    },
  })
).productSet;
if (set.userErrors.length > 0 || !set.product) {
  console.error(`FAILED: ${JSON.stringify(set.userErrors)}`);
  process.exit(1);
}
for (const publication of publications) {
  const errors = (await gql(`mutation($id: ID!, $input: [PublicationInput!]!){publishablePublish(id:$id, input:$input){userErrors{field message}}}`, {id: set.product.id, input: [{publicationId: publication.id}]})).publishablePublish.userErrors;
  if (errors.length > 0) console.error(`publish to ${publication.name}: ${JSON.stringify(errors)}`);
}
console.log(`created ${set.product.handle} (${set.product.status})`);
