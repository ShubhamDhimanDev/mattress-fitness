#!/usr/bin/env node
// Adds a Size to the BG by BEDGEAR Complete Bedding Set when it is missing (owner request 2026-11-13: a Tempur-Pedic Split
// California King mattress got no free bedding set because the set was not sold in that size, so the size is added). The new size
// has the price of the others and is orderable. The free-set discount gives the whole product, so the new size is part of the gift
// at once (the storefront reads the gift's sizes within a minute).
//
//   bash scripts/setup/with-admin-token.sh node scripts/catalog/bedgear/add-size.mjs                      # dry run
//   bash scripts/setup/with-admin-token.sh node scripts/catalog/bedgear/add-size.mjs --live
//   ... add-size.mjs --size "Split California King" --sku BGB-SPLITCALKING --price 300.00 [--live]
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const live = args.includes('--live');
const SIZE = flag('--size', 'Split California King');
const SKU = flag('--sku', 'BGB-SPLITCALKING');
const PRICE = flag('--price', '300.00');
const HANDLE = 'bg-by-bedgear-complete-bedding-set';
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
const product = (await gql(`query($h: String!){productByIdentifier(identifier:{handle:$h}){id options{id name} variants(first:50){nodes{title sku price}}}}`, {h: HANDLE})).productByIdentifier;
if (!product) {
  console.error(`${HANDLE} is not on ${STORE}.`);
  process.exit(3);
}
const sizeOption = product.options.find((option) => option.name === 'Size');
if (!sizeOption) {
  console.error('The product has no Size option.');
  process.exit(3);
}
if (product.variants.nodes.some((variant) => variant.title === SIZE)) {
  console.log(`${SIZE} already exists on ${HANDLE}. Nothing to do.`);
  process.exit(0);
}
console.log(`${live ? 'adding' : 'would add'} ${SIZE} (${SKU}, ${PRICE}) to ${HANDLE}; it has ${product.variants.nodes.length} sizes: ${product.variants.nodes.map((v) => v.title).join(', ')}`);
if (!live) {
  console.log('Dry run. Add --live to write.');
  process.exit(0);
}
const result = (
  await gql(
    `mutation($id: ID!, $variants: [ProductVariantsBulkInput!]!){productVariantsBulkCreate(productId:$id, variants:$variants){productVariants{id title} userErrors{field message}}}`,
    {
      id: product.id,
      variants: [{optionValues: [{optionName: 'Size', name: SIZE}], price: PRICE, inventoryPolicy: 'DENY', taxable: true, inventoryItem: {sku: SKU, tracked: false, requiresShipping: true}}], // tracked false like the other sizes: a tracked variant with no stock is not sellable
    },
  )
).productVariantsBulkCreate;
if (result.userErrors.length > 0) {
  console.error(JSON.stringify(result.userErrors));
  process.exit(1);
}
console.log(`added ${result.productVariants.map((v) => v.title).join(', ')}`);
