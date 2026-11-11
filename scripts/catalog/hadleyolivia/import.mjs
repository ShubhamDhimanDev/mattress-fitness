#!/usr/bin/env node
// Creates the 14 Aireloom mattresses of aireloom-products.json (built by build.mjs from hadleyolivia.com) on the store, with the
// two options Size and Foundation, their photos and videos in the page's order (the first photo is the main image) and the
// filter attributes the storefront reads. Owner request 2026-11-12, with the choice "replace the old drafts".
//
//   bash scripts/setup/with-admin-token.sh node scripts/catalog/hadleyolivia/import.mjs                              # dry run: reads, writes nothing
//   bash scripts/setup/with-admin-token.sh node scripts/catalog/hadleyolivia/import.mjs --live --expect-new 14        # writes
//
// Needs write_products (and write_publications to publish). STORE must be in SHOPIFY_ALLOWED_STORES (the wrapper sets both).
//
// "Replace the old drafts": the store holds a Queen-only DRAFT of 13 of these models (brand-catalog, from the maker's site). For
// each one this script ARCHIVES that draft (reversible in admin: Status > Draft or Active; nothing is deleted). When the old
// draft has the same web address as the new product (6 cases) the old one is first renamed to "<handle>-queen-only", so the new
// product can have the address the retailer's page has. An old product that is not a DRAFT is never touched and blocks that model.
//
// The new products are created ACTIVE and published to the sales channels the active Molecule mattresses are published to (the
// storefront's own channel), so they show on the site at once. Re-running skips a model whose new handle already has 21+ variants.
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const args = process.argv.slice(2);
const live = args.includes('--live');
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const expectNew = flag('--expect-new') === undefined ? null : Number(flag('--expect-new'));
const only = flag('--only') ?? null;
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

const all = JSON.parse(readFileSync(fileURLToPath(new URL('./aireloom-products.json', import.meta.url)), 'utf8'));
const products = only ? all.filter((p) => p.handle === only) : all;

const BY_HANDLE = `query($h: String!){productByIdentifier(identifier:{handle:$h}){id handle title status vendor variantsCount{count}}}`;
const lookup = async (handle) => (await gql(BY_HANDLE, {h: handle})).productByIdentifier;

// ---- plan ---------------------------------------------------------------------------------------------
const plan = [];
for (const product of products) {
  const existingNew = await lookup(product.handle);
  const old = product.replaces ? await lookup(product.replaces) : null;
  let action;
  if (existingNew && existingNew.vendor === 'Aireloom' && existingNew.variantsCount.count >= product.variants.length && existingNew.status === 'ACTIVE') {
    action = 'DONE'; // an earlier run created it (a clashing old draft would have a different id)
  } else if (old && old.status !== 'DRAFT' && old.status !== 'ARCHIVED') {
    action = 'BLOCKED';
  } else {
    action = 'CREATE';
  }
  const clash = old && old.handle === product.handle;
  const stale = existingNew && !(old && existingNew.id === old.id) && action !== 'DONE';
  plan.push({product, action, old, clash, stale, existingNew});
}

const mediaCount = (product, type) => product.media.filter((m) => m.type === type).length;
console.log(`Store ${STORE.replace(/\..*/, '')}: ${products.length} models in the file.`);
for (const {product, action, old, clash, stale} of plan) {
  const note =
    action === 'BLOCKED'
      ? `old ${old.handle} is ${old.status}, not a draft: not touched`
      : action === 'DONE'
        ? 'already created'
        : [old ? `${old.status === 'ARCHIVED' ? 'old draft already archived' : 'archive old draft'} ${old.handle}${clash ? ' (renamed first, same address)' : ''}` : 'no old draft', stale ? 'WARNING: the address is held by another product' : null].filter(Boolean).join('; ');
  console.log(`${action.padEnd(8)} ${product.handle} | ${product.variants.length} variants | ${mediaCount(product, 'IMAGE')} photos, ${mediaCount(product, 'VIDEO')} video | ${note}`);
}
const toCreate = plan.filter((p) => p.action === 'CREATE');

// The channels the active Molecule mattresses are on (the storefront's own channel), read, never guessed.
const pubs = await gql(`query{products(first:1,query:"vendor:Molecule status:active"){nodes{handle resourcePublicationsV2(first:20){nodes{isPublished publication{id name}}}}}}`);
const publications = (pubs.products.nodes[0]?.resourcePublicationsV2.nodes ?? []).filter((n) => n.isPublished).map((n) => n.publication);
console.log(`Publish to: ${publications.map((p) => p.name).join(', ') || '(none found: the products would stay unpublished)'}`);

if (!live) {
  console.log(`Dry run. Nothing was sent. Add --live --expect-new ${toCreate.length} to write.`);
  process.exit(0);
}
if (expectNew !== toCreate.length) {
  console.error(`Stopped: --expect-new ${expectNew} does not match the ${toCreate.length} to create. Nothing was written.`);
  process.exit(4);
}
if (plan.some((p) => p.stale)) {
  console.error('Stopped: an address is held by a product this run does not replace. Nothing was written.');
  process.exit(5);
}

// ---- write --------------------------------------------------------------------------------------------
const UPDATE = `mutation($input: ProductInput!){productUpdate(input:$input){product{id handle status} userErrors{field message}}}`;
const PRODUCT_SET = `mutation($input: ProductSetInput!){productSet(input:$input, synchronous:true){product{id handle} userErrors{field message}}}`;
const PUBLISH = `mutation($id: ID!, $input: [PublicationInput!]!){publishablePublish(id:$id, input:$input){userErrors{field message}}}`;
const BRAND = `query($handle: MetaobjectHandleInput!){metaobjectByHandle(handle:$handle){id}}`;
const brandId = (await gql(BRAND, {handle: {type: 'brand', handle: 'aireloom'}})).metaobjectByHandle?.id ?? null;
console.log(brandId ? `Brand entry: ${brandId}` : 'No Aireloom brand entry: the products are created without the brand link.');

// Shopify refuses a video it is given by the address of another Shopify store ("Invalid video url"), so each video is downloaded
// (from Shopify's own CDN host, the same file the retailer's page plays) and handed over through a staged upload.
const STAGED = `mutation($input: [StagedUploadInput!]!){stagedUploadsCreate(input:$input){stagedTargets{url resourceUrl parameters{name value}} userErrors{field message}}}`;
async function stageVideo(sourceUrl) {
  const cdn = sourceUrl.replace(/^https:\/\/www\.hadleyolivia\.com\/cdn\/shop\//, 'https://cdn.shopify.com/');
  const download = await fetch(cdn);
  if (!download.ok) throw new Error(`video download ${download.status}: ${cdn}`);
  const bytes = Buffer.from(await download.arrayBuffer());
  const filename = cdn.split('/').pop().split('?')[0];
  const staged = (await gql(STAGED, {input: [{resource: 'VIDEO', filename, mimeType: 'video/mp4', httpMethod: 'POST', fileSize: String(bytes.length)}]})).stagedUploadsCreate;
  if (staged.userErrors.length > 0 || !staged.stagedTargets[0]) throw new Error(`staged upload: ${JSON.stringify(staged.userErrors)}`);
  const target = staged.stagedTargets[0];
  const form = new FormData();
  for (const {name, value} of target.parameters) form.append(name, value);
  form.append('file', new Blob([bytes], {type: 'video/mp4'}), filename);
  const sent = await fetch(target.url, {method: 'POST', body: form});
  if (!sent.ok) throw new Error(`video upload ${sent.status}`);
  return target.resourceUrl;
}

const metafield = (key, type, value) => ({namespace: 'custom', key, type, value});
async function inputOf(product) {
  const m = product.metafields;
  const files = [];
  for (const item of product.media) {
    files.push({originalSource: item.type === 'VIDEO' ? await stageVideo(item.source) : item.source, contentType: item.type, alt: item.alt});
  }
  return {
    handle: product.handle,
    title: product.title,
    descriptionHtml: product.descriptionHtml,
    vendor: product.vendor,
    productType: product.productType,
    status: 'ACTIVE',
    tags: product.tags,
    productOptions: product.options.map((option, index) => ({name: option.name, position: index + 1, values: option.values.map((name) => ({name}))})),
    variants: product.variants.map((variant) => ({
      optionValues: [
        {optionName: 'Size', name: variant.size},
        {optionName: 'Foundation', name: variant.foundation},
      ],
      price: variant.price,
      compareAtPrice: variant.compareAt,
      inventoryPolicy: 'DENY',
      taxable: true,
      inventoryItem: {sku: variant.sku, requiresShipping: true},
    })),
    files,
    metafields: [
      metafield('comfort_level', 'single_line_text_field', m.comfort_level),
      metafield('mattress_type', 'single_line_text_field', m.mattress_type),
      metafield('sleep_positions', 'list.single_line_text_field', JSON.stringify(m.sleep_positions)),
      metafield('benefits', 'list.single_line_text_field', JSON.stringify(m.benefits)),
      metafield('height_inches', 'number_decimal', m.height_inches),
      metafield('delivery_type', 'single_line_text_field', 'both'),
      ...(m.features.length > 0 ? [metafield('features', 'list.single_line_text_field', JSON.stringify(m.features))] : []),
      ...(brandId ? [metafield('brand', 'metaobject_reference', brandId)] : []),
    ],
  };
}

const manifest = {store: STORE, at: new Date().toISOString(), archived: [], created: [], failed: []};
for (const {product, old, clash} of toCreate) {
  try {
    if (old && old.status === 'DRAFT') {
      const input = {id: old.id, status: 'ARCHIVED', ...(clash ? {handle: `${old.handle}-queen-only`, redirectNewHandle: false} : {})};
      const result = (await gql(UPDATE, {input})).productUpdate;
      if (result.userErrors.length > 0) throw new Error(`archive ${old.handle}: ${JSON.stringify(result.userErrors)}`);
      manifest.archived.push({id: old.id, was: old.handle, now: result.product.handle, status: result.product.status});
    }
    const set = (await gql(PRODUCT_SET, {input: await inputOf(product)})).productSet;
    if (set.userErrors.length > 0 || !set.product) throw new Error(`create ${product.handle}: ${JSON.stringify(set.userErrors)}`);
    for (const publication of publications) {
      const errors = (await gql(PUBLISH, {id: set.product.id, input: [{publicationId: publication.id}]})).publishablePublish.userErrors;
      if (errors.length > 0) manifest.failed.push({handle: product.handle, stage: `publish ${publication.name}`, errors});
    }
    manifest.created.push({handle: product.handle, id: set.product.id});
    console.log(`created ${product.handle}`);
  } catch (error) {
    manifest.failed.push({handle: product.handle, error: String(error.message).slice(0, 500)});
    console.error(`FAILED ${product.handle}: ${String(error.message).slice(0, 300)}`);
  }
}

const dir = fileURLToPath(new URL('../.runs/', import.meta.url));
mkdirSync(dir, {recursive: true});
const out = `${dir}hadleyolivia-${manifest.at.replace(/[:.]/g, '-')}.json`;
writeFileSync(out, JSON.stringify(manifest, null, 1));
console.log(`Archived ${manifest.archived.length}, created ${manifest.created.length}, failed ${manifest.failed.length}. Manifest: ${out}`);
process.exit(manifest.failed.length > 0 ? 1 : 0);
