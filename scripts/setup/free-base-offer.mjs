// Black Friday gift (owner request 2026-11-06): a free baselogic Platform adjustable base, Twin size, with an Aireloom,
// Kingsdown or Molecule mattress and no other brand. It is the "Buy X get Y" automatic discount the storefront already reads
// as a gift (ADR-0013, docs/integrations/OFFER_SETUP_DEVSTORE.md section 4.1): buys a minimum quantity of 1 of the listed
// mattresses, gets the Twin variant of `serta-baselogic-platform` free, at most one per order.
//
//   bash scripts/setup/with-admin-token.sh node scripts/setup/free-base-offer.mjs            # dry run: reads, prints, writes nothing
//   bash scripts/setup/with-admin-token.sh node scripts/setup/free-base-offer.mjs --live     # creates the discount
//
// Needs read_products and write_discounts on the app behind the token. STORE must be listed in SHOPIFY_ALLOWED_STORES (the
// wrapper sets both). The discount is created ACTIVE and takes effect on the store at once: run `--live` only with the owner's
// go-ahead, and on the client's live store only after the SOW deviation notes are acknowledged.
//
// Why a product list and not a collection: Shopify "buys" take products or collections, and the store has no collection per
// brand. Shopify allows 100 products per discount, so the brands are split over two discounts. The list is a snapshot of the brands' mattresses on the day of the run; run it again (it refuses to duplicate the
// discount, so delete or edit the old one in admin first) when mattresses of these brands are added.

const {STORE, SHOPIFY_ADMIN_API_ACCESS_TOKEN: TOKEN, SHOPIFY_ALLOWED_STORES: ALLOWED = ''} = process.env;
if (!STORE || !TOKEN) {
  console.error('Set STORE and SHOPIFY_ADMIN_API_ACCESS_TOKEN (run through scripts/setup/with-admin-token.sh).');
  process.exit(2);
}
if (!ALLOWED.split(',').map((s) => s.trim()).includes(STORE)) {
  console.error(`Refused: ${STORE} is not listed in SHOPIFY_ALLOWED_STORES.`);
  process.exit(3);
}

const LIVE = process.argv.includes('--live');
const BRANDS = ['Aireloom', 'Kingsdown', 'Molecule'];
const GIFT_HANDLE = 'serta-baselogic-platform';
const GIFT_SIZE = 'Twin';
// Product types that are mattresses. An empty type counts: the catalog import leaves it blank for mattresses.
const MATTRESS_TYPES = new Set(['', 'Mattress', 'Mattresses']);

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

async function productsOfBrand(brand) {
  const found = [];
  let after = null;
  for (;;) {
    const data = await gql(
      `query($q: String!, $after: String) { products(first: 100, after: $after, query: $q) { nodes { id handle productType vendor status } pageInfo { hasNextPage endCursor } } }`,
      {q: `vendor:'${brand}'`, after},
    );
    found.push(...data.products.nodes);
    if (!data.products.pageInfo.hasNextPage) return found;
    after = data.products.pageInfo.endCursor;
  }
}

const gift = (
  await gql(
    `query($q: String!) { products(first: 1, query: $q) { nodes { id handle title status variants(first: 20) { nodes { id title selectedOptions { name value } } } } } }`,
    {q: `handle:${GIFT_HANDLE}`},
  )
).products.nodes[0];
if (!gift) throw new Error(`Gift product ${GIFT_HANDLE} was not found on ${STORE}: import it first.`);
const twin = gift.variants.nodes.find((variant) =>
  variant.selectedOptions.some((option) => option.name === 'Size' && option.value === GIFT_SIZE),
);
if (!twin) throw new Error(`${GIFT_HANDLE} has no ${GIFT_SIZE} size variant.`);
console.log(`gift: ${gift.handle} (${gift.status}), variant ${GIFT_SIZE} = ${twin.id}`);

// Shopify caps the products one discount may list at 100 in total (create and update alike), so the brands are packed
// into as few discounts as fit. Each discount gives the same gift, once per order.
const MAX_PRODUCTS = 100;
const groups = []; // {brands: string[], ids: string[]}
for (const brand of BRANDS) {
  const products = await productsOfBrand(brand);
  const byType = {};
  for (const product of products) byType[product.productType || '(blank)'] = (byType[product.productType || '(blank)'] ?? 0) + 1;
  const ids = products.filter((product) => product.status === 'ACTIVE' && MATTRESS_TYPES.has(product.productType)).map((product) => product.id);
  console.log(`${brand}: ${products.length} products ${JSON.stringify(byType)}; ${ids.length} active mattresses qualify`);
  if (ids.length === 0) throw new Error(`${brand} has no qualifying mattress: nothing would earn the gift for it.`);
  if (ids.length > MAX_PRODUCTS) throw new Error(`${brand} has ${ids.length} mattresses, over Shopify's ${MAX_PRODUCTS} per discount: split it by hand.`);
  const group = groups.find((candidate) => candidate.ids.length + ids.length <= MAX_PRODUCTS);
  if (group) {
    group.brands.push(brand);
    group.ids.push(...ids);
  } else {
    groups.push({brands: [brand], ids});
  }
}
const titleOf = (group) => `Free adjustable base with ${group.brands.join(' and ')}`;

const active = (
  await gql(
    `query { discountNodes(first: 100, query: "type:automatic status:active") { nodes { id discount { __typename ... on DiscountAutomaticBxgy { title } } } } }`,
  )
).discountNodes.nodes;

for (const group of groups) {
  const title = titleOf(group);
  const already = active.find((node) => node.discount.title === title);
  if (already) {
    console.log(`"${title}" is already active (${already.id}). Skipped.`);
    continue;
  }
  if (!LIVE) {
    console.log(`DRY RUN: would create "${title}" buying ${group.ids.length} mattresses, getting ${GIFT_HANDLE} ${GIFT_SIZE} free, once per order. Add --live to create it.`);
    continue;
  }
  const created = await gql(
    `mutation($input: DiscountAutomaticBxgyInput!) { discountAutomaticBxgyCreate(automaticBxgyDiscount: $input) { automaticDiscountNode { id } userErrors { field message } } }`,
    {
      input: {
        title,
        startsAt: new Date().toISOString(),
        usesPerOrderLimit: '1',
        customerBuys: {value: {quantity: '1'}, items: {products: {productsToAdd: group.ids}}},
        customerGets: {
          value: {discountOnQuantity: {quantity: '1', effect: {percentage: 1.0}}},
          items: {products: {productVariantsToAdd: [twin.id]}},
        },
        // Product discounts only, so a bundle's "amount off products" can still apply to the mattress on the same order.
        combinesWith: {productDiscounts: true, orderDiscounts: false, shippingDiscounts: false},
      },
    },
  );
  const {automaticDiscountNode, userErrors} = created.discountAutomaticBxgyCreate;
  if (userErrors.length > 0) throw new Error(JSON.stringify(userErrors));
  console.log(`created "${title}" ${automaticDiscountNode.id} with ${group.ids.length} mattresses`);
}
