// The newsletter promo code (owner request 2026-11-06): 15% off, one use per customer, emailed to every signup by
// storefront/app/lib/signup/welcome-email.ts (the name is PROMO_CODE in storefront/app/lib/signup/shared.ts; keep the two the same).
//
//   bash scripts/setup/with-admin-token.sh node scripts/setup/newsletter-promo-code.mjs            # dry run: reads, writes nothing
//   bash scripts/setup/with-admin-token.sh node scripts/setup/newsletter-promo-code.mjs --live     # creates the code
//
// Needs write_discounts on the app behind the token. The code is created ACTIVE and works on the store at once: run `--live`
// only with the owner's go-ahead. It is a "product discount" on every product, and may combine with product discounts (so the
// Black Friday gift still applies), not with order or shipping discounts. CODE and PERCENT must equal PROMO_CODE and PROMO_PERCENT in
// storefront/app/lib/signup/shared.ts, which is what the forms and the email say.

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
const CODE = 'WELCOME15';
const PERCENT = 15;

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

const existing = (await gql(`query($code: String!) { codeDiscountNodeByCode(code: $code) { id } }`, {code: CODE})).codeDiscountNodeByCode;
if (existing) {
  console.log(`The code ${CODE} already exists (${existing.id}). Nothing to do.`);
  process.exit(0);
}
if (!LIVE) {
  console.log(`DRY RUN: would create the code ${CODE}: ${PERCENT}% off all products, once per customer. Add --live to create it.`);
  process.exit(0);
}

const created = await gql(
  `mutation($input: DiscountCodeBasicInput!) { discountCodeBasicCreate(basicCodeDiscount: $input) { codeDiscountNode { id } userErrors { field message } } }`,
  {
    input: {
      title: `Newsletter welcome code ${CODE}`,
      code: CODE,
      startsAt: new Date().toISOString(),
      appliesOncePerCustomer: true,
      customerSelection: {all: true},
      customerGets: {value: {percentage: PERCENT / 100}, items: {all: true}},
      combinesWith: {productDiscounts: true, orderDiscounts: false, shippingDiscounts: false},
    },
  },
);
const {codeDiscountNode, userErrors} = created.discountCodeBasicCreate;
if (userErrors.length > 0) throw new Error(JSON.stringify(userErrors));
console.log(`created ${CODE} ${codeDiscountNode.id}`);
