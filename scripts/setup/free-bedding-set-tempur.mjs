#!/usr/bin/env node
// Free gift for Tempur-Pedic mattresses: the BG by BEDGEAR Complete Bedding Set (owner request 2026-11-13, replacing the free
// adjustable base I first made for them: "for Tempur-Pedic we have to add free gift: <the bedding set>, not the adjustable bed").
// An automatic "Buy X get Y" like the other gift discounts: buys 1 of the ACTIVE Tempur-Pedic mattresses, gets 1 bedding set
// (every size of the product) 100% off, one per order, combining with product discounts only. The storefront reads it as a gift
// (ADR-0013) and offers it in the size of the mattress in the cart: its title names a "bedding set" (lib/offers/gifts.ts).
//
//   bash scripts/setup/with-admin-token.sh node scripts/setup/free-bedding-set-tempur.mjs                     # dry run
//   bash scripts/setup/with-admin-token.sh node scripts/setup/free-bedding-set-tempur.mjs --live              # creates it (ACTIVE at once)
//   bash scripts/setup/with-admin-token.sh node scripts/setup/free-bedding-set-tempur.mjs --live --remove-old-base
//       also deletes "Free adjustable base with Tempur-Pedic", the first version of this offer (made 2026-11-13, replaced the same day)
//
// Needs write_discounts and read_products. The list of mattresses is a snapshot of the day of the run (Shopify takes at most 100
// products per discount): delete the discount in admin and run this again when Tempur-Pedic mattresses are added.
const LIVE = process.argv.includes('--live');
const REMOVE_OLD = process.argv.includes('--remove-old-base');
const TITLE = 'Free BG by BEDGEAR Complete Bedding Set with Tempur-Pedic';
const OLD_TITLE = 'Free adjustable base with Tempur-Pedic';
const VENDOR = 'Tempur-Pedic';
const GIFT_HANDLE = 'bg-by-bedgear-complete-bedding-set';
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

const gift = (await gql(`query($h: String!){productByIdentifier(identifier:{handle:$h}){id status variantsCount{count}}}`, {h: GIFT_HANDLE})).productByIdentifier;
if (!gift || gift.status !== 'ACTIVE') {
  console.error(`The gift product ${GIFT_HANDLE} is not an active product on ${STORE}: create it first (scripts/catalog/bedgear/import.mjs).`);
  process.exit(3);
}
const discounts = (await gql(`query { discountNodes(first: 50, query: "status:active") { nodes { id discount { __typename ... on DiscountAutomaticBxgy { title } } } } }`)).discountNodes.nodes;
const old = discounts.find((node) => node.discount.title === OLD_TITLE);
const already = discounts.find((node) => node.discount.title === TITLE);

const mattresses = [];
for (let after = null; ; ) {
  const data = await gql(
    `query($after: String) { products(first: 100, after: $after, query: "vendor:'${VENDOR}' status:active") { nodes { id vendor productType status } pageInfo { hasNextPage endCursor } } }`,
    {after},
  );
  mattresses.push(...data.products.nodes.filter((p) => p.vendor === VENDOR && p.productType === 'Mattress' && p.status === 'ACTIVE'));
  if (!data.products.pageInfo.hasNextPage) break;
  after = data.products.pageInfo.endCursor;
}
console.log(`${VENDOR}: ${mattresses.length} active mattresses; gift ${GIFT_HANDLE} (${gift.variantsCount.count} sizes).`);
console.log(already ? `"${TITLE}" is already active (${already.id}).` : `would create "${TITLE}".`);
if (old) console.log(`${REMOVE_OLD ? 'would delete' : 'still active (use --remove-old-base to delete it)'}: "${OLD_TITLE}" ${old.id}`);
if (mattresses.length === 0 || mattresses.length > 100) {
  console.error('Nothing to buy, or over the 100 products Shopify allows in one discount.');
  process.exit(4);
}
if (!LIVE) {
  console.log('Dry run. Nothing was sent. Add --live to write.');
  process.exit(0);
}
if (!already) {
  const created = await gql(
    `mutation($input: DiscountAutomaticBxgyInput!) { discountAutomaticBxgyCreate(automaticBxgyDiscount: $input) { automaticDiscountNode { id } userErrors { field message } } }`,
    {
      input: {
        title: TITLE,
        startsAt: new Date().toISOString(),
        usesPerOrderLimit: '1',
        customerBuys: {value: {quantity: '1'}, items: {products: {productsToAdd: mattresses.map((p) => p.id)}}},
        customerGets: {value: {discountOnQuantity: {quantity: '1', effect: {percentage: 1.0}}}, items: {products: {productsToAdd: [gift.id]}}},
        combinesWith: {productDiscounts: true, orderDiscounts: false, shippingDiscounts: false},
      },
    },
  );
  const {automaticDiscountNode, userErrors} = created.discountAutomaticBxgyCreate;
  if (userErrors.length > 0) {
    console.error(JSON.stringify(userErrors));
    process.exit(1);
  }
  console.log(`created "${TITLE}" ${automaticDiscountNode.id}`);
}
if (old && REMOVE_OLD) {
  const result = (await gql(`mutation($id: ID!){discountAutomaticDelete(id: $id){deletedAutomaticDiscountId userErrors{field message}}}`, {id: old.id})).discountAutomaticDelete;
  console.log(result.userErrors.length > 0 ? `delete failed: ${JSON.stringify(result.userErrors)}` : `deleted "${OLD_TITLE}"`);
}
