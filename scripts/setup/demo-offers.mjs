// Offer setup on a DEVELOPMENT store (P4-12, docs/integrations/OFFER_SETUP_DEVSTORE.md sections 1, 2 and 3), in one idempotent run:
//   1. tags `sample-protector` and `sample-gift-pillow` with `offer-only`;
//   2. creates the "Recycle and disposal service" product ($49.00, tag offer-only) unless it exists, and publishes it;
//   3. writes storefront/.offer-config.local.json: offer-config.example.json with every placeholder id replaced by the real one.
// The placeholder rules stay placeholders (DEC-082): only the ids change. Nothing here is the client's offer.
//
// Needs STORE, SHOPIFY_ADMIN_API_ACCESS_TOKEN (write_products), SHOPIFY_ALLOWED_STORES and PUB (the channel's publication
// gid) in the environment: run it through scripts/setup/with-admin-token.sh.
import {readFile, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

const {STORE, SHOPIFY_ADMIN_API_ACCESS_TOKEN: TOKEN, SHOPIFY_ALLOWED_STORES: ALLOWED = '', PUB} = process.env;
if (!STORE || !TOKEN || !PUB) {
  console.error('Set STORE, SHOPIFY_ADMIN_API_ACCESS_TOKEN and PUB (gid://shopify/Publication/...).');
  process.exit(2);
}
if (!ALLOWED.split(',').map((s) => s.trim()).includes(STORE)) {
  console.error(`Refused: ${STORE} is not listed in SHOPIFY_ALLOWED_STORES.`);
  process.exit(3);
}

const root = fileURLToPath(new URL('../../', import.meta.url));
const SERVICE_HANDLE = 'recycle-and-disposal-service';
// The example's size positions: a placeholder variant id is product number * 10 + position (OFFER_SETUP_DEVSTORE section 3).
const SIZE_BY_POSITION = ['Twin', 'Twin XL', 'Full', 'Queen', 'King', 'California King', 'Split California King'];

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
const must = (errors) => {
  if (errors.length > 0) throw new Error(JSON.stringify(errors));
};

const productByHandle = async (handle) =>
  (await gql(
    `query($q: String!) { products(first: 1, query: $q) { nodes { id handle tags variants(first: 20) { nodes { id title selectedOptions { name value } } } } } }`,
    {q: `handle:${handle}`},
  )).products.nodes[0] ?? null;

// 1. tags
for (const handle of ['sample-protector', 'sample-gift-pillow']) {
  const product = await productByHandle(handle);
  if (!product) throw new Error(`Product ${handle} is missing: import scripts/catalog/sample/offer-products.csv first.`);
  if (!product.tags.includes('offer-only')) {
    must((await gql('mutation($id: ID!, $tags: [String!]!) { tagsAdd(id: $id, tags: $tags) { userErrors { message } } }', {id: product.id, tags: ['offer-only']})).tagsAdd.userErrors);
    console.log(`tagged ${handle}`);
  }
}

// 2. the service product
let service = await productByHandle(SERVICE_HANDLE);
if (!service) {
  const created = await gql(
    `mutation($input: ProductCreateInput!) { productCreate(product: $input) { product { id variants(first: 1) { nodes { id } } } userErrors { message } } }`,
    {input: {title: 'Recycle and disposal service', handle: SERVICE_HANDLE, status: 'ACTIVE', tags: ['offer-only'], productType: 'Service', descriptionHtml: '<p>Placeholder service for haul-away testing (sample text, not the client\'s service).</p>'}},
  );
  must(created.productCreate.userErrors);
  const {id, variants} = created.productCreate.product;
  must((await gql(
    'mutation($id: ID!, $v: [ProductVariantsBulkInput!]!) { productVariantsBulkUpdate(productId: $id, variants: $v) { userErrors { message } } }',
    {id, v: [{id: variants.nodes[0].id, price: '49.00'}]},
  )).productVariantsBulkUpdate.userErrors);
  console.log('created the service product');
  service = await productByHandle(SERVICE_HANDLE);
}
must((await gql('mutation($id: ID!, $i: [PublicationInput!]!) { publishablePublish(id: $id, input: $i) { userErrors { message } } }', {id: service.id, i: [{publicationId: PUB}]})).publishablePublish.userErrors);

// 3. the configuration with real ids
const config = JSON.parse(await readFile(`${root}storefront/offer-config.example.json`, 'utf8'));
const fakeProducts = config._products;
/** @type {Map<string, string>} fake id -> real id */
const replacements = new Map();
for (const [handle, fakeProductId] of Object.entries(fakeProducts)) {
  const product = await productByHandle(handle);
  if (!product) throw new Error(`Product ${handle} is missing in the store.`);
  replacements.set(fakeProductId, product.id);
  const productNumber = Number(fakeProductId.split('/').pop());
  product.variants.nodes.forEach((variant, index) => {
    const size = variant.selectedOptions.find((option) => option.name === 'Size')?.value;
    const position = size ? SIZE_BY_POSITION.indexOf(size) + 1 : index + 1;
    if (position > 0) replacements.set(`gid://shopify/ProductVariant/${productNumber * 10 + position}`, variant.id);
  });
}
let text = JSON.stringify(config, null, 2);
let unresolved = 0;
text = text.replace(/gid:\/\/shopify\/Product(?:Variant)?\/\d+/g, (fake) => {
  const real = replacements.get(fake);
  if (!real) unresolved += 1;
  return real ?? fake;
});
const out = JSON.parse(text);
out._placeholder = 'PLACEHOLDER OFFER RULES (DEC-082) with the REAL ids of the products imported on the development store. Development store only; git-ignored.';
out._products = Object.fromEntries(Object.entries(fakeProducts).map(([handle, fake]) => [handle, replacements.get(fake)]));
await writeFile(`${root}storefront/.offer-config.local.json`, `${JSON.stringify(out, null, 2)}\n`);
console.log(`wrote storefront/.offer-config.local.json (${replacements.size} ids mapped, ${unresolved} left as placeholders)`);
if (unresolved > 0) process.exitCode = 1;
