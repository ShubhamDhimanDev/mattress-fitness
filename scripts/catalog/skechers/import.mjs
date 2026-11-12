#!/usr/bin/env node
// Creates the three Skechers Recovery Series mattresses of skechers-products.json (the owner's CSV of 2026-11-12) with their two
// photos (the owner's files, in scripts/catalog/brand-catalog/images/, git-ignored). The first photo is the main image.
//
//   bash scripts/setup/with-admin-token.sh node scripts/catalog/skechers/import.mjs              # dry run: reads, writes nothing
//   bash scripts/setup/with-admin-token.sh node scripts/catalog/skechers/import.mjs --live --expect-new 3
//   bash scripts/setup/with-admin-token.sh node scripts/catalog/skechers/import.mjs --live --expect-new 3 --active --publication-from Molecule   # also active and on the sales channels the Molecule mattresses are on
//
// The CSV says Published = FALSE, so the products are created as DRAFT (hidden) unless --active is given. A product whose handle
// already exists is never touched (a rerun only creates what is missing). The photos are handed to Shopify through staged uploads.
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const args = process.argv.slice(2);
const live = args.includes('--live');
const active = args.includes('--active');
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const expectNew = flag('--expect-new') === undefined ? null : Number(flag('--expect-new'));
const publicationFrom = flag('--publication-from') ?? null;
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

const here = (path) => fileURLToPath(new URL(path, import.meta.url));
const data = JSON.parse(readFileSync(here('./skechers-products.json'), 'utf8'));
const imageDir = here('../brand-catalog/images/');

const BY_HANDLE = `query($h: String!){productByIdentifier(identifier:{handle:$h}){id status}}`;
const plan = [];
for (const product of data.products) {
  const existing = (await gql(BY_HANDLE, {h: product.handle})).productByIdentifier;
  plan.push({product, existing});
}
for (const {product, existing} of plan) {
  console.log(`${existing ? 'EXISTS  ' : 'CREATE  '} ${product.handle} | ${product.variants.length} variants (${product.options.map((o) => o.name).join(' x ')}) | ${data.images.length} photos | ${active ? 'ACTIVE' : 'DRAFT'}`);
}
const toCreate = plan.filter((p) => !p.existing);

let publications = [];
if (publicationFrom) {
  const pubs = await gql(`query($q:String!){products(first:1,query:$q){nodes{resourcePublicationsV2(first:20){nodes{isPublished publication{id name}}}}}}`, {q: `vendor:'${publicationFrom}' status:active`});
  publications = (pubs.products.nodes[0]?.resourcePublicationsV2.nodes ?? []).filter((n) => n.isPublished).map((n) => n.publication);
  console.log(`Publish to: ${publications.map((p) => p.name).join(', ') || '(none found)'}`);
}
if (!live) {
  console.log(`Dry run. Nothing was sent. Add --live --expect-new ${toCreate.length} to write.`);
  process.exit(0);
}
if (expectNew !== toCreate.length) {
  console.error(`Stopped: --expect-new ${expectNew} does not match the ${toCreate.length} to create. Nothing was written.`);
  process.exit(4);
}

const STAGED = `mutation($input: [StagedUploadInput!]!){stagedUploadsCreate(input:$input){stagedTargets{url resourceUrl parameters{name value}} userErrors{field message}}}`;
async function stageImage(name) {
  const bytes = readFileSync(imageDir + name);
  const staged = (await gql(STAGED, {input: [{resource: 'IMAGE', filename: name, mimeType: 'image/png', httpMethod: 'POST', fileSize: String(bytes.length)}]})).stagedUploadsCreate;
  if (staged.userErrors.length > 0 || !staged.stagedTargets[0]) throw new Error(`staged upload: ${JSON.stringify(staged.userErrors)}`);
  const target = staged.stagedTargets[0];
  const form = new FormData();
  for (const {name: key, value} of target.parameters) form.append(key, value);
  form.append('file', new Blob([bytes], {type: 'image/png'}), name);
  const sent = await fetch(target.url, {method: 'POST', body: form});
  if (!sent.ok) throw new Error(`image upload ${sent.status}`);
  return target.resourceUrl;
}

const BRAND = `query($handle: MetaobjectHandleInput!){metaobjectByHandle(handle:$handle){id}}`;
let brandId = null;
for (const handle of ['skechers', 'skechers-by-serta']) {
  brandId ??= (await gql(BRAND, {handle: {type: 'brand', handle}})).metaobjectByHandle?.id ?? null;
}
console.log(brandId ? `Brand entry: ${brandId}` : 'No Skechers brand entry: the products are created without the brand link.');

const PRODUCT_SET = `mutation($input: ProductSetInput!){productSet(input:$input, synchronous:true){product{id handle status} userErrors{field message}}}`;
const PUBLISH = `mutation($id: ID!, $input: [PublicationInput!]!){publishablePublish(id:$id, input:$input){userErrors{field message}}}`;
const staged = [];
for (const name of data.images) staged.push(await stageImage(name));

let failed = 0;
for (const {product} of toCreate) {
  const input = {
    handle: product.handle,
    title: product.title,
    descriptionHtml: product.descriptionHtml,
    vendor: product.vendor,
    productType: product.productType,
    status: active ? 'ACTIVE' : 'DRAFT',
    tags: product.tags,
    seo: {title: product.seoTitle, description: product.seoDescription},
    productOptions: product.options.map((option, index) => ({name: option.name, position: index + 1, values: option.values.map((name) => ({name}))})),
    variants: product.variants.map((variant) => ({
      optionValues: variant.options.map((name, index) => ({optionName: product.options[index].name, name})),
      price: variant.price,
      inventoryPolicy: 'DENY',
      taxable: true,
      inventoryItem: {sku: variant.sku, requiresShipping: true},
    })),
    files: staged.map((source, index) => ({originalSource: source, contentType: 'IMAGE', alt: index === 0 ? product.title : `${product.title}, view ${index + 1}`})),
    ...(brandId ? {metafields: [{namespace: 'custom', key: 'brand', type: 'metaobject_reference', value: brandId}]} : {}),
  };
  const set = (await gql(PRODUCT_SET, {input})).productSet;
  if (set.userErrors.length > 0 || !set.product) {
    console.error(`FAILED ${product.handle}: ${JSON.stringify(set.userErrors)}`);
    failed += 1;
    continue;
  }
  if (active) {
    for (const publication of publications) {
      const errors = (await gql(PUBLISH, {id: set.product.id, input: [{publicationId: publication.id}]})).publishablePublish.userErrors;
      if (errors.length > 0) console.error(`publish ${product.handle} to ${publication.name}: ${JSON.stringify(errors)}`);
    }
  }
  console.log(`created ${product.handle} (${set.product.status})`);
}
process.exit(failed > 0 ? 1 : 0);
