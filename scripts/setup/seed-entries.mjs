// Seeds sample metaobject ENTRIES (brands, FAQs, two stores, homepage sections, site settings) on a DEVELOPMENT store so the
// storefront readers have real content to show. All names, addresses and copy are invented sample text, not the client's.
// Idempotent: each entry is upserted by type and handle, so a second run changes nothing.
//
// Needs STORE, SHOPIFY_ADMIN_API_ACCESS_TOKEN with the `write_metaobjects` scope, and SHOPIFY_ALLOWED_STORES (a live run
// refuses a store that is not listed). Dry run by default: prints what would be written and sends nothing.
//   bash scripts/setup/with-admin-token.sh node scripts/setup/seed-entries.mjs          # dry run
//   bash scripts/setup/with-admin-token.sh node scripts/setup/seed-entries.mjs --live
// After the brands exist, re-run the product import so each product's `custom.brand` is linked (P3A-07).

const live = process.argv.includes('--live');
const {STORE, SHOPIFY_ADMIN_API_ACCESS_TOKEN: TOKEN, SHOPIFY_ALLOWED_STORES: ALLOWED = ''} = process.env;

/** Shopify rich text field value (JSON) for plain paragraphs. */
const rich = (...paragraphs) =>
  JSON.stringify({
    type: 'root',
    children: paragraphs.map((text) => ({type: 'paragraph', children: [{type: 'text', value: text}]})),
  });

const SAMPLE_NOTE = 'Sample text for the development store. Not real product or warranty information.';

/** @type {{type: string, handle: string, fields: Record<string, string | number | boolean>}[]} */
const ENTRIES = [
  // slug must equal the handle: the product importer finds the brand by it (definitions.json, brand.slug).
  ...[
    ['tessaly-home', 'Tessaly Home'],
    ['brindlewood-bedding', 'Brindlewood Bedding'],
    ['quillmoor-sleep', 'Quillmoor Sleep'],
    ['oakhollow-mattress-co', 'Oakhollow Mattress Co.'],
  ].map(([slug, name]) => ({
    type: 'brand',
    handle: slug,
    fields: {name, slug, about: rich(`${name} is a made-up brand used to test the brand pages. ${SAMPLE_NOTE}`), warranty_terms: rich(SAMPLE_NOTE)},
  })),
  ...[
    ['how-long-does-delivery-take', 'How long does delivery take?', 'Sample answer: most in-zone orders are delivered within a week. The real answer comes from the client.', 'general'],
    ['can-i-try-before-i-buy', 'Can I try a mattress in a store?', 'Sample answer: yes, visit any store from the store locator. The real answer comes from the client.', 'general'],
    ['what-is-the-comfort-guarantee', 'What is the comfort guarantee?', 'Sample answer: a protector in the mattress size keeps the guarantee valid. The real terms come from the client.', 'product'],
    ['do-you-remove-my-old-mattress', 'Do you remove my old mattress?', 'Sample answer: yes, for a fee, when we deliver. The real answer comes from the client.', 'product'],
  ].map(([handle, question, answer, scope]) => ({type: 'faq', handle, fields: {question, answer: rich(answer), scope}})),
  {
    type: 'store',
    handle: 'chicago-loop',
    fields: {
      name: 'Sample Sleep Gallery Chicago Loop', slug: 'chicago-loop', address_line_1: '100 Example Street', city: 'Chicago', state: 'IL', postal_code: '60601',
      latitude: 41.8864, longitude: -87.6186, phone: '312-555-0101', time_zone: 'America/Chicago',
      hours: JSON.stringify({'Mon-Fri': '10:00-20:00', Sat: '10:00-18:00', Sun: '12:00-17:00'}),
    },
  },
  {
    type: 'store',
    handle: 'evanston-studio',
    fields: {
      name: 'Sample Sleep Studio Evanston', slug: 'evanston-studio', address_line_1: '25 Sample Avenue', city: 'Evanston', state: 'IL', postal_code: '60201',
      latitude: 42.0451, longitude: -87.6877, phone: '847-555-0102', time_zone: 'America/Chicago',
      hours: JSON.stringify({'Mon-Sat': '10:00-19:00', Sun: 'Closed'}),
    },
  },
  {
    type: 'homepage_section',
    handle: 'home-hero',
    fields: {type: 'hero', heading: 'Find the mattress that fits you', body: 'Browse by size, comfort and type, or take the sleep quiz.', link: '/quiz', link_label: 'Take the sleep quiz', order: 1, enabled: true},
  },
  {type: 'homepage_section', handle: 'home-shop-by-size', fields: {type: 'shop-by-size', heading: 'Shop by size', order: 2, enabled: true}},
  {type: 'homepage_section', handle: 'home-featured', fields: {type: 'featured', heading: 'Mattresses', order: 3, enabled: true}},
  {type: 'homepage_section', handle: 'home-brands', fields: {type: 'brands', heading: 'Shop by brand', order: 4, enabled: true}},
  {
    type: 'site_settings',
    handle: 'site-settings',
    fields: {promo_bar_text: 'Sample promotion: free delivery on orders over $999', promo_bar_link: '/collections/mattresses', support_phone: '1-800-555-0100', haul_away_max: 2},
  },
];

const UPSERT = `mutation($handle: MetaobjectHandleInput!, $metaobject: MetaobjectUpsertInput!) {
  metaobjectUpsert(handle: $handle, metaobject: $metaobject) { metaobject { id handle } userErrors { field message code } }
}`;

if (!live) {
  for (const entry of ENTRIES) console.log(`DRY RUN ${entry.type}/${entry.handle}: ${Object.keys(entry.fields).join(', ')}`);
  console.log(`${ENTRIES.length} entries would be upserted. Nothing was sent. Add --live to write them.`);
  process.exit(0);
}
if (!STORE || !TOKEN) {
  console.error('Set STORE and SHOPIFY_ADMIN_API_ACCESS_TOKEN (run through scripts/setup/with-admin-token.sh).');
  process.exit(2);
}
if (!ALLOWED.split(',').map((s) => s.trim()).includes(STORE)) {
  console.error(`Refused: ${STORE} is not listed in SHOPIFY_ALLOWED_STORES.`);
  process.exit(3);
}

let failed = 0;
for (const entry of ENTRIES) {
  const response = await fetch(`https://${STORE}/admin/api/2026-10/graphql.json`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN},
    body: JSON.stringify({
      query: UPSERT,
      variables: {
        handle: {type: entry.type, handle: entry.handle},
        metaobject: {fields: Object.entries(entry.fields).map(([key, value]) => ({key, value: String(value)}))},
      },
    }),
  });
  const body = await response.json();
  const errors = body.errors ? [{message: JSON.stringify(body.errors).slice(0, 300)}] : (body.data?.metaobjectUpsert?.userErrors ?? []);
  if (errors.length > 0) {
    failed += 1;
    console.error(`FAILED ${entry.type}/${entry.handle}: ${errors.map((e) => e.message).join('; ')}`);
  } else {
    console.log(`ok ${entry.type}/${entry.handle}`);
  }
}
console.log(`${ENTRIES.length - failed} of ${ENTRIES.length} entries written.`);
process.exitCode = failed > 0 ? 1 : 0;
