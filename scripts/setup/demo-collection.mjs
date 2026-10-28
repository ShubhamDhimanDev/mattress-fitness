// Creates the `mattresses` collection on a DEVELOPMENT store, adds every product of type Mattress, removes any other product from it, and publishes
// it to one sales channel. Idempotent: an existing collection is reused, and adding a product twice changes nothing.
// Why a script: the catalog importer has no collection step (B6 in docs/deployment/DEMO_STORE_SETUP.md).
//
// Needs STORE, SHOPIFY_ADMIN_API_ACCESS_TOKEN (scope write_products) and PUB (the channel's publication gid) in the
// environment; run it through scripts/setup/with-admin-token.sh. It refuses a store that is not in SHOPIFY_ALLOWED_STORES.
const {STORE, SHOPIFY_ADMIN_API_ACCESS_TOKEN: TOKEN, SHOPIFY_ALLOWED_STORES: ALLOWED = '', PUB} = process.env;
if (!STORE || !TOKEN || !PUB) {
  console.error('Set STORE, SHOPIFY_ADMIN_API_ACCESS_TOKEN and PUB (gid://shopify/Publication/...).');
  process.exit(2);
}
if (!ALLOWED.split(',').map((s) => s.trim()).includes(STORE)) {
  console.error(`Refused: ${STORE} is not listed in SHOPIFY_ALLOWED_STORES.`);
  process.exit(3);
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
const failOnUserErrors = (errors) => {
  if (errors.length > 0) throw new Error(JSON.stringify(errors));
};

let id = (await gql('{ collectionByHandle(handle: "mattresses") { id } }')).collectionByHandle?.id;
if (!id) {
  const created = await gql(
    'mutation($input: CollectionInput!) { collectionCreate(input: $input) { collection { id } userErrors { field message } } }',
    {input: {title: 'Mattresses', handle: 'mattresses', descriptionHtml: 'Demo collection of the sample mattresses.'}},
  );
  failOnUserErrors(created.collectionCreate.userErrors);
  id = created.collectionCreate.collection.id;
}
// Every MATTRESS (the importer gives mattress rows the product type "Mattress"), a page at a time: the store grows past one page once the brand catalog is imported.
/** @type {string[]} */
const productIds = [];
for (let after = null; ; ) {
  const page = (await gql(
    'query($after: String) { products(first: 100, after: $after, query: "product_type:Mattress") { nodes { id } pageInfo { hasNextPage endCursor } } }',
    {after},
  )).products;
  productIds.push(...page.nodes.map((node) => node.id));
  if (!page.pageInfo.hasNextPage) break;
  after = page.pageInfo.endCursor;
}
// collectionAddProducts takes at most 250 ids per call.
for (let start = 0; start < productIds.length; start += 250) {
  const added = await gql(
    'mutation($id: ID!, $products: [ID!]!) { collectionAddProducts(id: $id, productIds: $products) { userErrors { message } } }',
    {id, products: productIds.slice(start, start + 250)},
  );
  failOnUserErrors(added.collectionAddProducts.userErrors);
}
// Earlier versions added every product: take out whatever is not a mattress (add-ons, the haul-away service, gift items).
const inCollection = (await gql(
  'query($id: ID!) { collection(id: $id) { products(first: 250) { nodes { id productType } } } }',
  {id},
)).collection.products.nodes;
const strays = inCollection.filter((node) => node.productType !== 'Mattress').map((node) => node.id);
if (strays.length > 0) {
  const removed = await gql(
    'mutation($id: ID!, $products: [ID!]!) { collectionRemoveProducts(id: $id, productIds: $products) { userErrors { message } } }',
    {id, products: strays},
  );
  failOnUserErrors(removed.collectionRemoveProducts.userErrors);
}
const published = await gql(
  'mutation($id: ID!, $input: [PublicationInput!]!) { publishablePublish(id: $id, input: $input) { userErrors { message } } }',
  {id, input: [{publicationId: PUB}]},
);
failOnUserErrors(published.publishablePublish.userErrors);
console.log(`collection ${id.split('/').pop()}: ${productIds.length} mattresses, ${strays.length} other products removed, published`);
