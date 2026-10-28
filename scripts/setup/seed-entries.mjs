// Seeds sample metaobject ENTRIES (brands, FAQs, homepage sections, site settings) on a DEVELOPMENT store so the
// storefront readers have real content to show. All names, addresses and copy are invented sample text, not the client's.
// Idempotent: each entry is upserted by type and handle, so a second run changes nothing.
//
// Needs STORE, SHOPIFY_ADMIN_API_ACCESS_TOKEN with the `write_metaobjects` scope, and SHOPIFY_ALLOWED_STORES (a live run
// refuses a store that is not listed). Dry run by default: prints what would be written and sends nothing.
//   bash scripts/setup/with-admin-token.sh node scripts/setup/seed-entries.mjs          # dry run
//   bash scripts/setup/with-admin-token.sh node scripts/setup/seed-entries.mjs --live
// After the brands exist, re-run the product import so each product's `custom.brand` is linked (P3A-07).

const live = process.argv.includes('--live');
// --only <type> seeds one entry type (for example `--only brand`), so the sample home blocks are not written.
const onlyIndex = process.argv.indexOf('--only');
const only = onlyIndex >= 0 ? process.argv[onlyIndex + 1] : null;
const {STORE, SHOPIFY_ADMIN_API_ACCESS_TOKEN: TOKEN, SHOPIFY_ALLOWED_STORES: ALLOWED = ''} = process.env;

/** Shopify rich text field value (JSON) for plain paragraphs. */
const rich = (...paragraphs) =>
  JSON.stringify({
    type: 'root',
    children: paragraphs.map((text) => ({type: 'paragraph', children: [{type: 'text', value: text}]})),
  });

const SAMPLE_NOTE = 'Sample text for the development store. Not real product or warranty information.';

/** A field whose value is a list of other entries of this file ("type/handle"); resolved to their ids at write time. */
const refs = (...keys) => ({ refs: keys });

/** @type {{type: string, handle: string, fields: Record<string, string | number | boolean | { refs: string[] }>}[]} */
const ENTRIES = [
  // slug must equal the handle: the product importer finds the brand by it (definitions.json, brand.slug).
  ...[
    // The twelve real brands of scripts/catalog/brand-catalog (the sheet's brand column slugged). Name and slug only: the
    // about and warranty texts are the client's, written in Shopify admin; nothing is invented here.
    ['tempur-pedic', 'Tempur-Pedic'],
    ['stearns-and-foster', 'Stearns & Foster'],
    ['sealy', 'Sealy'],
    ['molecule', 'Molecule'],
    ['serta', 'Serta'],
    ['brooklyn-bedding', 'Brooklyn Bedding'],
    ['helix', 'Helix'],
    ['puffy', 'Puffy'],
    ['beautyrest', 'Beautyrest'],
    ['aireloom', 'Aireloom'],
    ['kingsdown', 'Kingsdown'],
    ['casper', 'Casper'],
  ].map(([slug, name]) => ({type: 'brand', handle: slug, fields: {name, slug}})),
  ...[
    ['how-long-does-delivery-take', 'How long does delivery take?', 'Sample answer: most in-zone orders are delivered within a week. The real answer comes from the client.', 'general'],
    ['can-i-try-before-i-buy', 'Can I try a mattress in the store?', 'Sample answer: yes, visit our store. The real answer comes from the client.', 'general'],
    ['what-is-the-comfort-guarantee', 'What is the comfort guarantee?', 'Sample answer: a protector in the mattress size keeps the guarantee valid. The real terms come from the client.', 'product'],
    ['do-you-remove-my-old-mattress', 'Do you remove my old mattress?', 'Sample answer: yes, for a fee, when we deliver. The real answer comes from the client.', 'product'],
  ].map(([handle, question, answer, scope]) => ({type: 'faq', handle, fields: {question, answer: rich(answer), scope}})),
  // Homepage blocks in the order of the redesign (CR-31). Every text below is SAMPLE text for the development store: the
  // client writes the real wording in admin. [[double brackets]] highlight a phrase in the heading.
  {
    type: 'homepage_section',
    handle: 'home-hero',
    fields: {type: 'hero', heading: 'Find the mattress that [[fits you.]]', body: 'Sample text: browse by size, comfort and brand, or take the sleep quiz.', link: '/quiz', link_label: 'Take the sleep quiz', order: 1, enabled: true},
  },
  {type: 'homepage_section', handle: 'home-brands', fields: {type: 'brands', heading: 'Shop the brands you trust', order: 2, enabled: true}},
  {type: 'homepage_section', handle: 'home-shop-by-size', fields: {type: 'shop-by-size', heading: 'Shop by size', order: 3, enabled: true}},
  {type: 'homepage_section', handle: 'home-featured', fields: {type: 'featured', heading: 'Best sellers', order: 4, enabled: true}},
  {type: 'homepage_section', handle: 'home-categories', fields: {type: 'categories', heading: 'Shop by feel and type', order: 5, enabled: true}},
  // Three consecutive promo banners show as one row of offer cards. Sample wording only: no real offer, price or end date.
  {type: 'homepage_section', handle: 'home-offer-1', fields: {type: 'promo-banner', heading: 'Sample offer one', body: 'Sample text. The real offer wording is written by the client.', link: '/collections/mattresses', link_label: 'View offer', order: 6, enabled: true}},
  {type: 'homepage_section', handle: 'home-offer-2', fields: {type: 'promo-banner', heading: 'Sample offer two', body: 'Sample text. The real offer wording is written by the client.', link: '/collections/mattresses', link_label: 'View offer', order: 7, enabled: true}},
  {type: 'homepage_section', handle: 'home-offer-3', fields: {type: 'promo-banner', heading: 'Sample offer three', body: 'Sample text. The real offer wording is written by the client.', link: '/collections/mattresses', link_label: 'View offer', order: 8, enabled: true}},
  {
    type: 'homepage_section',
    handle: 'home-quiz-band',
    fields: {type: 'quiz-band', heading: 'Take the [[sleep quiz.]]', body: 'Sample text: tell us how you sleep and we will suggest mattresses that match.', link: '/quiz', link_label: 'Start the quiz', order: 9, enabled: true},
  },
  // The three cards of "Complete your sleep setup" and the three steps of "How it works" are homepage_card entries,
  // listed on their section. Cards are written first, so their ids exist when the section refers to them.
  ...[
    ['home-card-setup-1', 'Sample card one', 'Sample text for the first card.', '/collections', 'Shop now'],
    ['home-card-setup-2', 'Sample card two', 'Sample text for the second card.', '/collections', 'Shop now'],
    ['home-card-setup-3', 'Sample card three', 'Sample text for the third card.', '/collections', 'Shop now'],
    ['home-step-1', 'Sample step one', 'Sample text for the first step.'],
    ['home-step-2', 'Sample step two', 'Sample text for the second step.'],
    ['home-step-3', 'Sample step three', 'Sample text for the third step.'],
  ].map(([handle, title, text, link, link_label]) => ({
    type: 'homepage_card',
    handle,
    fields: {title, text, ...(link ? {link, link_label} : {})},
  })),
  {
    type: 'homepage_section',
    handle: 'home-setup-cards',
    fields: {type: 'setup-cards', heading: 'Complete your sleep setup', cards: refs('homepage_card/home-card-setup-1', 'homepage_card/home-card-setup-2', 'homepage_card/home-card-setup-3'), order: 10, enabled: true},
  },
  {
    type: 'homepage_section',
    handle: 'home-how-it-works',
    fields: {type: 'how-it-works', heading: 'How it works', body: 'Sample text: from choosing to sleeping, in three steps.', cards: refs('homepage_card/home-step-1', 'homepage_card/home-step-2', 'homepage_card/home-step-3'), order: 11, enabled: true},
  },
  // Shows the FAQ entries whose scope is "general" (the first two FAQs above).
  {type: 'homepage_section', handle: 'home-faq', fields: {type: 'faq', heading: 'Questions, answered', order: 13, enabled: true}},
  {type: 'homepage_section', handle: 'home-signup', fields: {type: 'signup', order: 14, enabled: true}},
  {
    type: 'site_settings',
    handle: 'site-settings',
    fields: {promo_bar_text: 'Sample promotion: free delivery on orders over $999', promo_bar_link: '/collections/mattresses', support_phone: '1-800-555-0100', haul_away_max: 2},
  },
];

const SELECTED = only ? ENTRIES.filter((entry) => entry.type === only) : ENTRIES;

const UPSERT = `mutation($handle: MetaobjectHandleInput!, $metaobject: MetaobjectUpsertInput!) {
  metaobjectUpsert(handle: $handle, metaobject: $metaobject) { metaobject { id handle } userErrors { field message code } }
}`;

if (!live) {
  const known = new Set(ENTRIES.map((entry) => `${entry.type}/${entry.handle}`));
  for (const entry of SELECTED) {
    console.log(`DRY RUN ${entry.type}/${entry.handle}: ${Object.keys(entry.fields).join(', ')}`);
    // A list reference to an entry this file does not define would fail on a live run: say so in the dry run.
    for (const value of Object.values(entry.fields)) {
      if (typeof value === 'object') for (const key of value.refs) if (!known.has(key)) console.error(`  MISSING reference ${key}`);
    }
  }
  console.log(`${SELECTED.length} entries would be upserted. Nothing was sent. Add --live to write them.`);
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

/** Ids of the entries written so far ("type/handle" -> gid), for the list references of later entries. */
const writtenIds = new Map();

/** The text Shopify expects for a field: a list reference becomes a JSON array of ids; null when one is not written yet. */
function fieldValue(value) {
  if (typeof value === 'object' && value !== null) {
    const ids = value.refs.map((key) => writtenIds.get(key));
    return ids.every(Boolean) ? JSON.stringify(ids) : null;
  }
  return String(value);
}

let failed = 0;
for (const entry of SELECTED) {
  const fields = Object.entries(entry.fields).map(([key, value]) => ({key, value: fieldValue(value)}));
  const unresolved = fields.filter((field) => field.value === null).map((field) => field.key);
  if (unresolved.length > 0) {
    failed += 1;
    console.error(`FAILED ${entry.type}/${entry.handle}: the entries referenced by ${unresolved.join(', ')} were not written first.`);
    continue;
  }
  const response = await fetch(`https://${STORE}/admin/api/2026-10/graphql.json`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN},
    body: JSON.stringify({
      query: UPSERT,
      variables: {
        handle: {type: entry.type, handle: entry.handle},
        metaobject: {fields},
      },
    }),
  });
  const body = await response.json();
  const errors = body.errors ? [{message: JSON.stringify(body.errors).slice(0, 300)}] : (body.data?.metaobjectUpsert?.userErrors ?? []);
  if (errors.length > 0) {
    failed += 1;
    console.error(`FAILED ${entry.type}/${entry.handle}: ${errors.map((e) => e.message).join('; ')}`);
  } else {
    const id = body.data?.metaobjectUpsert?.metaobject?.id;
    if (id) writtenIds.set(`${entry.type}/${entry.handle}`, id);
    console.log(`ok ${entry.type}/${entry.handle}`);
  }
}
console.log(`${SELECTED.length - failed} of ${SELECTED.length} entries written.`);
process.exitCode = failed > 0 ? 1 : 0;
