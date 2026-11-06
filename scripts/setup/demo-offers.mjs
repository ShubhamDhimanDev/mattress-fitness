// Offer setup on a DEVELOPMENT store (P4-12, docs/integrations/OFFER_SETUP_DEVSTORE.md sections 1, 2 and 3), in one idempotent run:
//   1. tags `sample-protector` and `sample-gift-pillow` with `offer-only`;
//   2. creates the "Recycle and disposal service" product ($49.00, tag offer-only) unless it exists, and publishes it;
//   3. upserts placeholder offer_rule and delivery_zone metaobjects (the storefront reads them from Shopify, no environment variable);
// The rules stay placeholders (DEC-082). Nothing here is the client's offer.
//
// Needs STORE, SHOPIFY_ADMIN_API_ACCESS_TOKEN (write_products, write_metaobjects), SHOPIFY_ALLOWED_STORES and PUB (the channel's publication
// gid) in the environment: run it through scripts/setup/with-admin-token.sh.

const {STORE, SHOPIFY_ADMIN_API_ACCESS_TOKEN: TOKEN, SHOPIFY_ALLOWED_STORES: ALLOWED = '', PUB} = process.env;
if (!STORE || !TOKEN || !PUB) {
  console.error('Set STORE, SHOPIFY_ADMIN_API_ACCESS_TOKEN and PUB (gid://shopify/Publication/...).');
  process.exit(2);
}
if (!ALLOWED.split(',').map((s) => s.trim()).includes(STORE)) {
  console.error(`Refused: ${STORE} is not listed in SHOPIFY_ALLOWED_STORES.`);
  process.exit(3);
}

const SERVICE_HANDLE = 'recycle-and-disposal-service';

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

// 3. the placeholder offer rules and delivery zone as Shopify metaobjects (the storefront reads them with the Admin token;
// docs/integrations/OFFER_SETUP_DEVSTORE.md). Idempotent: an entry is upserted by its handle. The gift is NOT made here: it is
// the automatic Buy X get Y discount you create in Discounts (OFFER_SETUP_DEVSTORE section 4.1).
const ids = {};
for (const handle of ['luxe-hybrid', 'luxe-foam', 'cloudmere-hybrid', 'sample-foundation', 'sample-protector', 'sample-pillow', 'sample-sheets', SERVICE_HANDLE]) {
  const product = await productByHandle(handle);
  if (!product) throw new Error(`Product ${handle} is missing in the store.`);
  ids[handle] = product.id;
}
const MATTRESSES = ['luxe-hybrid', 'luxe-foam', 'cloudmere-hybrid'];
const list = (handles) => JSON.stringify(handles.map((handle) => ids[handle]));
const money = (amount) => JSON.stringify({amount, currency_code: 'USD'});
const rule = (handle, fields) => ({type: 'offer_rule', handle, fields: [{key: 'enabled', value: 'true'}, ...fields]});
const entries = [
  rule('placeholder-comfort-protector', [{key: 'name', value: 'Comfort guarantee protector (placeholder)'}, {key: 'type', value: 'comfort_protector'}, {key: 'trigger_product', value: ids['luxe-hybrid']}, {key: 'products', value: list(['sample-protector'])}]),
  rule('placeholder-haul-away', [{key: 'name', value: 'Haul-away (placeholder)'}, {key: 'type', value: 'haul_away'}, {key: 'products', value: list([SERVICE_HANDLE])}, {key: 'max_quantity', value: '2'}]),
  ...MATTRESSES.flatMap((mattress) => [
    rule(`placeholder-foundation-${mattress}`, [{key: 'name', value: `Foundation for ${mattress} (placeholder)`}, {key: 'type', value: 'foundation'}, {key: 'trigger_product', value: ids[mattress]}, {key: 'products', value: list(['sample-foundation'])}]),
    rule(`placeholder-pillow-${mattress}`, [{key: 'name', value: `Pillow for ${mattress} (placeholder)`}, {key: 'type', value: 'pillow'}, {key: 'trigger_product', value: ids[mattress]}, {key: 'products', value: list(['sample-pillow'])}]),
    rule(`placeholder-bedding-${mattress}`, [{key: 'name', value: `Sheets for ${mattress} (placeholder)`}, {key: 'type', value: 'bedding'}, {key: 'trigger_product', value: ids[mattress]}, {key: 'products', value: list(['sample-sheets'])}]),
    rule(`placeholder-bundle-${mattress}`, [{key: 'name', value: `Sleep set: ${mattress} (placeholder)`}, {key: 'type', value: 'bundle'}, {key: 'trigger_product', value: ids[mattress]}, {key: 'products', value: list(['sample-protector', 'sample-pillow'])}, {key: 'discount_title', value: 'Sleep set 10% off (placeholder)'}]),
  ]),
  {type: 'delivery_zone', handle: 'placeholder-metro-zone', fields: [
    {key: 'name', value: 'Placeholder metro zone'},
    {key: 'postal_codes', value: '60601, 60602, 60603, 60645'},
    {key: 'fee', value: money('149.00')},
    {key: 'free_over', value: money('999.00')},
    {key: 'promise_white_glove', value: 'Placeholder wording: in-home delivery and setup is available in your area.'},
    {key: 'promise_parcel', value: 'Placeholder wording: this item ships to your door.'},
    {key: 'promise_pickup', value: 'Placeholder wording: ready for pickup at the store.'},
  ]},
];
for (const entry of entries) {
  const result = await gql(
    'mutation($handle: MetaobjectHandleInput!, $metaobject: MetaobjectUpsertInput!) { metaobjectUpsert(handle: $handle, metaobject: $metaobject) { userErrors { message } } }',
    {handle: {type: entry.type, handle: entry.handle}, metaobject: {fields: entry.fields}},
  );
  must(result.metaobjectUpsert.userErrors);
}
console.log(`upserted ${entries.length} placeholder offer_rule / delivery_zone entries (DEC-082). Create the gift discount by hand (Buy X get Y).`);
