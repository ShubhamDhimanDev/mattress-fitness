import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FAKE_STORE, FAKE_TOKEN, createFakeShopify } from '../lib/testing/fake-shopify.mjs';
import { toDesiredProduct } from '../catalog/map.mjs';
import { BENEFITS, COMFORT_LEVELS, DELIVERY_TYPES, MATTRESS_TYPES, SLEEP_POSITIONS } from '../catalog/schema.mjs';
import { DEFAULT_SPEC_PATH, diffMetafieldDefinition, diffMetaobjectDefinition, encodeValidations, main, planDefinitions, resolveReferences, toMetafieldDefinitionInput, toMetaobjectDefinitionInput, validateSpec } from './apply-definitions.mjs';
import { createAdminClient } from '../lib/shopify-admin.mjs';

const spec = JSON.parse(readFileSync(DEFAULT_SPEC_PATH, 'utf8'));
const clone = () => structuredClone(spec);
const baseEnv = () => ({ SHOPIFY_STORE_DOMAIN: FAKE_STORE, SHOPIFY_ALLOWED_STORES: FAKE_STORE, SHOPIFY_ADMIN_API_ACCESS_TOKEN: FAKE_TOKEN });
const instantClock = () => { let now = 0; return { now: () => now, sleep: async (/** @type {number} */ ms) => { now += ms; } }; };

/** @param {string[]} argv @param {{ fake: ReturnType<typeof createFakeShopify>, env?: Record<string, string | undefined>, maxAttempts?: number }} setup */
async function run(argv, { fake, env = baseEnv(), maxAttempts = 3 }) {
  /** @type {string[]} */
  const out = [];
  /** @type {string[]} */
  const err = [];
  const code = await main(argv, env, { out: (text) => out.push(text), err: (text) => err.push(text), fetch: fake.fetch, clock: instantClock(), maxAttempts });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

const TOTAL = spec.metaobjectDefinitions.length + spec.metafieldDefinitions.length;

// ---- the shipped spec ------------------------------------------------------------------------------------

test('definitions.json is valid and declares the eleven metaobject types of the data model', () => {
  const checked = validateSpec(spec);
  assert.deepEqual(checked.ok ? [] : checked.errors, []);
  assert.deepEqual(spec.metaobjectDefinitions.map((definition) => definition.type).sort(), ['brand', 'delivery_zone', 'faq', 'homepage_section', 'offer_rule', 'promo_tile', 'quiz_option', 'quiz_question', 'quiz_scoring_rule', 'site_settings', 'store']);
  assert.equal(spec.metafieldDefinitions.length, 19, '16 product metafields, the variant dimensions field, the collection FAQs and the customer quiz result');
  assert.equal(TOTAL, 30);
});

test('custom.faqs is defined for products and for collections with the same shape (REQ-COL-004)', () => {
  const faqs = spec.metafieldDefinitions.filter((definition) => definition.namespace === 'custom' && definition.key === 'faqs');
  assert.deepEqual(faqs.map((definition) => definition.ownerType).sort(), ['COLLECTION', 'PRODUCT']);
  const [first, second] = faqs;
  for (const definition of faqs) {
    assert.equal(definition.type, 'list.metaobject_reference');
    assert.deepEqual(definition.validations, [{ name: 'metaobject_definition_type', value: 'faq' }]);
    assert.equal(definition.storefrontAccess, 'PUBLIC_READ');
    assert.ok(definition.description && definition.description.length > 10, 'has a description');
  }
  assert.equal(first.name, second.name);
});

test('every definition the storefront reads has Storefront API access enabled (PUBLIC_READ)', () => {
  for (const definition of [...spec.metaobjectDefinitions, ...spec.metafieldDefinitions]) {
    // The customer's quiz result is private: Customer Account API only, never the Storefront API.
    const expected = definition.ownerType === 'CUSTOMER' ? 'NONE' : 'PUBLIC_READ';
    assert.equal(definition.storefrontAccess, expected, definition.type ?? `${definition.namespace}.${definition.key}`);
  }
});

test('definitions are ordered so a metaobject is declared before anything that references it', () => {
  const types = spec.metaobjectDefinitions.map((definition) => definition.type);
  assert.ok(types.indexOf('quiz_option') < types.indexOf('quiz_question'));
  assert.ok(spec.metafieldDefinitions.length > 0);
});

test('product attributes in the spec use exactly the values the sheet schema allows (one source of truth)', () => {
  const find = (/** @type {string} */ key) => spec.metafieldDefinitions.find((definition) => definition.key === key);
  const choices = (/** @type {string} */ key) => JSON.stringify(find(key).validations.find((validation) => validation.name === 'choices').value);
  assert.equal(choices('comfort_level'), JSON.stringify(COMFORT_LEVELS));
  assert.equal(choices('mattress_type'), JSON.stringify(MATTRESS_TYPES));
  assert.equal(choices('delivery_type'), JSON.stringify(DELIVERY_TYPES));
  // Shopify has no choices validation on list types, so the lists are enforced by the sheet validator
  for (const key of ['sleep_positions', 'benefits']) {
    assert.equal(find(key).type, 'list.single_line_text_field');
    assert.equal(find(key).validations, undefined);
  }
  for (const value of SLEEP_POSITIONS) assert.match(find('sleep_positions').description, new RegExp(value));
  for (const value of BENEFITS) assert.match(find('benefits').description, new RegExp(value));
});

test('every metafield the importer can write has a matching definition with the same type', () => {
  const product = {
    handle: 'x', model: 'X', brand: 'B', productLine: 'L', productType: 'Mattress', description: 'd', bullets: ['a'], specifications: [{ label: 'a', value: 'b' }], seoTitle: 't', seoDescription: 'd',
    comfortLevel: 'Medium', mattressType: 'Hybrid', sleepPositions: ['Back'], benefits: ['Cooling'], heightInches: '10', deliveryType: 'both', images: [], extendCategory: 'm', relatedFoundations: [], relatedProtectors: [],
    relatedBedding: [], compareGroup: 'g', copyApproved: true, firstRow: 2, variants: [{ size: 'Queen', dimensions: '60 in x 80 in', sku: 'X', priceCents: 100, salePriceCents: null, row: 2 }],
  };
  const desired = toDesiredProduct(product, {
    brandMetaobjectId: 'gid://shopify/Metaobject/1',
    relatedProductIds: { relatedFoundations: ['gid://shopify/Product/1'], relatedProtectors: ['gid://shopify/Product/2'], relatedBedding: ['gid://shopify/Product/3'] },
  });
  const written = [
    ...desired.metafields.map((metafield) => ({ ownerType: 'PRODUCT', ...metafield })),
    ...desired.variants.flatMap((variant) => variant.metafields.map((metafield) => ({ ownerType: 'PRODUCTVARIANT', ...metafield }))),
  ];
  assert.ok(written.length >= 15);
  for (const metafield of written) {
    const definition = spec.metafieldDefinitions.find((candidate) => candidate.ownerType === metafield.ownerType && candidate.namespace === metafield.namespace && candidate.key === metafield.key);
    assert.ok(definition, `${metafield.ownerType} ${metafield.namespace}.${metafield.key} has no definition`);
    assert.equal(definition.type, metafield.type, `${metafield.key} type`);
  }
});

test('the data model fields that other work packages depend on are present', () => {
  const fields = (/** @type {string} */ type) => spec.metaobjectDefinitions.find((definition) => definition.type === type).fieldDefinitions.map((field) => field.key);
  assert.deepEqual(fields('brand'), ['name', 'slug', 'logo', 'about', 'warranty_terms']);
  assert.ok(['pickup_enabled', 'location_handle', 'latitude', 'longitude', 'hours', 'photo'].every((key) => fields('store').includes(key)));
  assert.ok(['postal_codes', 'free_over', 'fee_text'].every((key) => fields('delivery_zone').includes(key)));
  assert.ok(['haul_away_max', 'extend_enabled', 'promo_bar_text', 'promo_bar_link', 'support_phone'].every((key) => fields('site_settings').includes(key)));
  // The storefront reads these three as plain text (site-settings.ts); a different type would change what the read returns.
  const settings = spec.metaobjectDefinitions.find((definition) => definition.type === 'site_settings');
  for (const key of ['promo_bar_text', 'promo_bar_link', 'support_phone']) {
    assert.equal(settings.fieldDefinitions.find((field) => field.key === key).type, 'single_line_text_field', key);
  }
  assert.equal(settings.storefrontAccess, 'PUBLIC_READ');
  assert.ok(!fields('site_settings').includes('free_delivery_threshold'), 'free-delivery threshold has one source: delivery_zone.free_over');
  const offerType = spec.metaobjectDefinitions.find((definition) => definition.type === 'offer_rule').fieldDefinitions.find((field) => field.key === 'type');
  assert.deepEqual(offerType.validations[0].value, ['comfort_protector', 'haul_away', 'matching_protector', 'pillow', 'bedding', 'gift', 'bundle']);
  const postal = spec.metaobjectDefinitions.find((definition) => definition.type === 'delivery_zone').fieldDefinitions.find((field) => field.key === 'postal_codes');
  assert.equal(postal.validations[0].value, 3000, 'matches the Local delivery limit (F-28)');
});

test('homepage_section fixes its section types and promo_tile its grid position (P3B-13, P3B-05)', () => {
  const definition = (/** @type {string} */ type) => spec.metaobjectDefinitions.find((candidate) => candidate.type === type);
  const field = (/** @type {string} */ type, /** @type {string} */ key) => definition(type).fieldDefinitions.find((candidate) => candidate.key === key);
  // The storefront lists the same values in HOMEPAGE_SECTION_TYPES (tests/unit/catalog/home-sections.test.ts).
  assert.deepEqual(field('homepage_section', 'type').validations, [{ name: 'choices', value: ['hero', 'promo-banner', 'shop-by-size', 'featured', 'brands', 'categories', 'financing', 'signup'] }]);
  assert.deepEqual(definition('homepage_section').fieldDefinitions.map((candidate) => candidate.key), ['type', 'heading', 'body', 'image', 'link', 'link_label', 'order', 'enabled']);
  assert.equal(field('homepage_section', 'link_label').required, undefined, 'the label is optional: without it the heading is the link');
  assert.deepEqual(field('promo_tile', 'position').validations, [{ name: 'min', value: 1 }]);
  assert.equal(field('promo_tile', 'collection').type, 'collection_reference');
  assert.equal(field('promo_tile', 'collection').required, true);
});

// ---- spec validation ------------------------------------------------------------------------------------

test('validateSpec catches structural mistakes before any live run', () => {
  const cases = /** @type {[string, (copy: any) => void, RegExp][]} */ ([
    ['duplicate type', (copy) => copy.metaobjectDefinitions.push(structuredClone(copy.metaobjectDefinitions[0])), /declared twice/],
    ['bad type name', (copy) => { copy.metaobjectDefinitions[0].type = 'No Spaces!'; }, /invalid type/],
    ['displayNameKey not a field', (copy) => { copy.metaobjectDefinitions[0].displayNameKey = 'nope'; }, /displayNameKey/],
    ['bad access value', (copy) => { copy.metaobjectDefinitions[0].storefrontAccess = 'EVERYONE'; }, /storefrontAccess/],
    ['field declared twice', (copy) => copy.metaobjectDefinitions[0].fieldDefinitions.push(structuredClone(copy.metaobjectDefinitions[0].fieldDefinitions[0])), /declared twice/],
    ['invalid field key', (copy) => { copy.metaobjectDefinitions[0].fieldDefinitions[0].key = 'x'; }, /invalid key/],
    ['reference to a later type', (copy) => { copy.metaobjectDefinitions.find((d) => d.type === 'quiz_question').fieldDefinitions.find((f) => f.key === 'options').validations[0].value = 'brand_not_declared'; }, /not declared before it/],
    ['unknown owner type', (copy) => { copy.metafieldDefinitions[0].ownerType = 'ORDER'; }, /ownerType/],
    ['choices on a list type', (copy) => { copy.metafieldDefinitions.find((d) => d.key === 'sleep_positions').validations = [{ name: 'choices', value: ['Back'] }]; }, /choices validation only on single_line_text_field/],
    ['metafield duplicate', (copy) => copy.metafieldDefinitions.push(structuredClone(copy.metafieldDefinitions[0])), /declared twice/],
    ['metafield references undeclared metaobject', (copy) => { copy.metafieldDefinitions.find((d) => d.key === 'brand').validations[0].value = 'ghost'; }, /does not declare/],
    ['wrong version', (copy) => { copy.specVersion = 2; }, /specVersion 1/],
  ]);
  for (const [label, change, message] of cases) {
    const copy = clone();
    change(copy);
    const checked = validateSpec(copy);
    assert.equal(checked.ok, false, label);
    assert.match(checked.ok ? '' : checked.errors.join('\n'), message, label);
  }
  assert.equal(validateSpec(null).ok, false);
  assert.equal(validateSpec('text').ok, false);
});

// ---- request shapes ---------------------------------------------------------------------------------------

test('validation values are sent as strings; lists are JSON-encoded as the Admin API requires', () => {
  assert.deepEqual(encodeValidations([{ name: 'choices', value: ['A', 'B'] }, { name: 'min', value: 0 }, { name: 'metaobject_definition_type', value: 'brand' }, { name: 'x', value: true }]), [
    { name: 'choices', value: '["A","B"]' }, { name: 'min', value: '0' }, { name: 'metaobject_definition_type', value: 'brand' }, { name: 'x', value: 'true' },
  ]);
  assert.deepEqual(encodeValidations(undefined), []);
});

test('metafield definition input carries ownerType, namespace, access and the smart-collection capability', () => {
  const definition = spec.metafieldDefinitions.find((candidate) => candidate.key === 'comfort_level');
  const input = toMetafieldDefinitionInput(definition);
  assert.equal(input.ownerType, 'PRODUCT');
  assert.equal(input.namespace, 'custom');
  assert.deepEqual(input.access, { storefront: 'PUBLIC_READ' });
  assert.deepEqual(input.capabilities, { smartCollectionCondition: { enabled: true } });
  assert.equal(input.validations[0].value, JSON.stringify(COMFORT_LEVELS));
  const plain = toMetafieldDefinitionInput(spec.metafieldDefinitions.find((candidate) => candidate.key === 'specifications'));
  assert.equal('capabilities' in plain, false);
  assert.equal('validations' in plain, false);
});

test('metaobject definition input lists fields with required flags and storefront access', () => {
  const input = toMetaobjectDefinitionInput(spec.metaobjectDefinitions.find((candidate) => candidate.type === 'brand'));
  assert.equal(input.type, 'brand');
  assert.deepEqual(input.access, { storefront: 'PUBLIC_READ' });
  assert.equal(input.displayNameKey, 'name');
  assert.deepEqual(input.fieldDefinitions.map((field) => [field.key, field.required]), [['name', true], ['slug', true], ['logo', false], ['about', false], ['warranty_terms', false]]);
  assert.equal(input.fieldDefinitions[2].validations[0].value, '["Image"]');
});

// ---- planning and applying ----------------------------------------------------------------------------------

test('planning against an empty store makes every definition a create, metaobjects first', async () => {
  const plan = await planDefinitions({ spec, client: null });
  assert.ok(plan.ok);
  assert.equal(plan.items.length, TOTAL);
  assert.ok(plan.items.every((item) => item.action === 'create'));
  assert.equal(plan.items.findIndex((item) => item.kind === 'metafield') > plan.items.findLastIndex((item) => item.kind === 'metaobject'), true);
});

test('--offline prints the plan as a table with no network and no credentials', async () => {
  const noNetwork = createFakeShopify({ intercept: () => { throw new Error('network must not be used'); } });
  const result = await run(['--offline'], { fake: noNetwork, env: {} });
  assert.equal(result.code, 0, result.err);
  assert.match(result.out, /^DRY RUN \(offline: planned against an empty store\)/);
  // Offline reads no store, so it says that and does not report "pending changes" for a store it never looked at.
  assert.match(result.out, /OFFLINE: no store was read/);
  assert.doesNotMatch(result.out, /PENDING CHANGES/);
  assert.match(result.out, /kind\s+definition\s+action\s+differences/);
  assert.match(result.out, new RegExp(`Plan: ${TOTAL} to create, 0 already in sync, 0 differ`));
  assert.equal(noNetwork.state.calls.length, 0);
});

test('a dry run reads the store, shows what would be created, cannot write, and does not read as in sync (exit 1, PENDING CHANGES)', async () => {
  const fake = createFakeShopify();
  const result = await run([], { fake });
  assert.equal(result.code, 1, 'definitions still to create are pending changes, not "in sync"');
  assert.match(result.out, new RegExp(`${TOTAL} to create`));
  assert.match(result.out, new RegExp(`PENDING CHANGES: ${TOTAL} definition\\(s\\) to create and 0 field\\(s\\) to add\\.`));
  assert.match(result.out, /wrote nothing/);
  assert.equal(fake.mutations().length, 0);
  assert.equal(fake.state.metaobjectDefinitions.size + fake.state.metafieldDefinitions.size, 0);
});

test('a dry run on a store that is fully in sync exits 0 and prints no PENDING CHANGES line', async () => {
  const fake = createFakeShopify();
  assert.equal((await run(['--live'], { fake })).code, 0);
  fake.reset();
  const result = await run([], { fake });
  assert.equal(result.code, 0, result.err);
  assert.match(result.out, new RegExp(`Plan: 0 to create, ${TOTAL} already in sync, 0 differ`));
  assert.doesNotMatch(result.out, /PENDING CHANGES/);
  assert.equal(fake.mutations().length, 0);
});

test('a dry run that only lacks one definition is pending, and --live clears it (exit 1, then 0)', async () => {
  const fake = createFakeShopify();
  assert.equal((await run(['--live'], { fake })).code, 0);
  fake.state.metaobjectDefinitions.delete('faq');
  fake.reset();
  const dry = await run([], { fake });
  assert.equal(dry.code, 1);
  assert.match(dry.out, /PENDING CHANGES: 1 definition\(s\) to create and 0 field\(s\) to add\./);
  fake.reset();
  const live = await run(['--live'], { fake });
  assert.equal(live.code, 0, live.err);
  assert.doesNotMatch(live.out, /PENDING CHANGES/, 'a live run applies the changes instead of leaving them pending');
  fake.reset();
  assert.equal((await run([], { fake })).code, 0);
});

test('the usage text states the exit codes, including the pending dry run', async () => {
  const fake = createFakeShopify();
  const result = await run(['--help'], { fake, env: {} });
  assert.equal(result.code, 2);
  assert.match(result.err, /Exit code: 0 in sync/);
  assert.match(result.err, /PENDING\s+CHANGES/);
  assert.match(result.err, /--offline reads no store/);
});

test('--live is refused without an allow-listed store or a token, and cannot be combined with --offline', async () => {
  const cases = /** @type {const} */ ([
    [{ ...baseEnv(), SHOPIFY_ALLOWED_STORES: 'other-store.myshopify.com' }, ['--live'], 3],
    [{ ...baseEnv(), SHOPIFY_ALLOWED_STORES: '' }, ['--live'], 3],
    [{ SHOPIFY_STORE_DOMAIN: FAKE_STORE, SHOPIFY_ALLOWED_STORES: FAKE_STORE }, ['--live'], 3],
    [{ ...baseEnv(), SHOPIFY_STORE_DOMAIN: undefined }, ['--live'], 3],
    [baseEnv(), ['--live', '--offline'], 2],
    [baseEnv(), ['--bogus'], 2],
  ]);
  for (const [env, argv, expected] of cases) {
    const fake = createFakeShopify();
    const result = await run([...argv], { fake, env });
    assert.equal(result.code, expected, JSON.stringify(argv));
    assert.equal(fake.state.calls.length, 0);
    assert.equal(`${result.out}${result.err}`.includes(FAKE_TOKEN), false);
  }
});

test('a live run creates every definition once, and a second run finds everything in sync and writes nothing', async () => {
  const fake = createFakeShopify();
  const first = await run(['--live'], { fake });
  assert.equal(first.code, 0, first.err);
  assert.match(first.out, new RegExp(`Created ${TOTAL} definition\\(s\\)\\.`));
  assert.equal(fake.mutations().length, TOTAL);
  const order = fake.mutations().map((call) => call.operationName);
  assert.equal(order.indexOf('CreateMetafieldDefinition') > order.lastIndexOf('CreateMetaobjectDefinition'), true, 'metaobjects are created first');
  assert.equal(fake.state.metaobjectDefinitions.get('brand').access.storefront, 'PUBLIC_READ');
  assert.equal(fake.state.metafieldDefinitions.get('PRODUCT:custom.comfort_level').capabilities.smartCollectionCondition.enabled, true);

  fake.reset();
  const second = await run(['--live'], { fake });
  assert.equal(second.code, 0, second.err);
  assert.match(second.out, new RegExp(`Plan: 0 to create, ${TOTAL} already in sync, 0 differ`));
  assert.equal(fake.mutations().length, 0);
});

test('differences are reported with specifics and never changed; the exit code is non-zero', async () => {
  const fake = createFakeShopify();
  assert.equal((await run(['--live'], { fake })).code, 0);
  fake.state.metafieldDefinitions.get('PRODUCT:custom.comfort_level').access.storefront = 'NONE';
  fake.state.metafieldDefinitions.get('PRODUCT:custom.mattress_type').validations = [{ name: 'choices', value: '["Hybrid","Foam"]' }];
  fake.state.metaobjectDefinitions.get('brand').fieldDefinitions.push({ key: 'extra_field', name: 'Extra', description: null, required: false, type: { name: 'single_line_text_field' }, validations: [] });
  fake.reset();
  const result = await run(['--live'], { fake });
  assert.equal(result.code, 1);
  assert.match(result.out, /DIFF product custom\.comfort_level: Storefront API access is NONE in Shopify, PUBLIC_READ in the spec/);
  assert.match(result.out, /DIFF product custom\.mattress_type: validations: validation choices differs/);
  assert.match(result.out, /DIFF brand: Shopify has an extra field extra_field/);
  assert.match(result.out, /3 differ \(reported, never changed by this tool\)/);
  assert.equal(fake.mutations().length, 0, 'existing definitions are never modified');
});

/** Removes one field from the fake store's copy of a definition, as if it had been created from an older spec. */
function dropField(fake, type, key) {
  const definition = fake.state.metaobjectDefinitions.get(type);
  const index = definition.fieldDefinitions.findIndex((field) => field.key === key);
  assert.ok(index >= 0, `${type}.${key} exists in the fake store`);
  return definition.fieldDefinitions.splice(index, 1)[0];
}

test('an existing definition that only lacks a spec field is extended in a live run, never in a dry run (site_settings.support_phone)', async () => {
  const fake = createFakeShopify();
  assert.equal((await run(['--live'], { fake })).code, 0);
  dropField(fake, 'site_settings', 'support_phone');
  const before = structuredClone(fake.state.metaobjectDefinitions.get('site_settings'));
  fake.reset();

  const dry = await run([], { fake });
  assert.equal(dry.code, 1, 'a field still to add is a pending change, not "in sync"');
  assert.match(dry.out, /PENDING CHANGES: 0 definition\(s\) to create and 1 field\(s\) to add\./);
  assert.match(dry.out, /ADD site_settings: field support_phone \(single_line_text_field\) is missing in Shopify and would be added/);
  assert.match(dry.out, /1 missing field\(s\) in 1 existing metaobject definition\(s\) would be added/);
  assert.doesNotMatch(dry.out, /DIFF site_settings/);
  assert.equal(fake.mutations().length, 0, 'a dry run writes nothing');

  fake.reset();
  const live = await run(['--live'], { fake });
  assert.equal(live.code, 0, live.err);
  assert.match(live.out, /Added missing fields to 1 existing definition\(s\)\./);
  assert.deepEqual(fake.mutations().map((call) => call.operationName), ['AddMetaobjectDefinitionFields']);
  const sent = fake.mutations()[0].variables;
  assert.equal(sent.id, before.id);
  assert.deepEqual(Object.keys(sent.definition), ['fieldDefinitions'], 'only fields are sent: no name, access, display name or order change');
  assert.deepEqual(sent.definition.fieldDefinitions.map((operation) => Object.keys(operation)), [['create']]);
  assert.equal(sent.definition.fieldDefinitions[0].create.key, 'support_phone');

  const after = fake.state.metaobjectDefinitions.get('site_settings');
  assert.deepEqual(after.fieldDefinitions.slice(0, -1), before.fieldDefinitions, 'existing fields are untouched and keep their order');
  assert.equal(after.fieldDefinitions.at(-1).key, 'support_phone');

  fake.reset();
  const again = await run(['--live'], { fake });
  assert.equal(again.code, 0, again.err);
  assert.equal(fake.mutations().length, 0, 'the second run finds it in sync');
});

test('missing fields are still added when something else also differs, but the other difference is only reported and the run fails', async () => {
  const fake = createFakeShopify();
  assert.equal((await run(['--live'], { fake })).code, 0);
  dropField(fake, 'store', 'location_handle');
  fake.state.metaobjectDefinitions.get('store').name = 'Renamed in admin';
  fake.reset();
  const result = await run(['--live'], { fake });
  assert.equal(result.code, 1);
  assert.match(result.out, /DIFF store: name is "Renamed in admin"/);
  assert.match(result.out, /ADD store: field location_handle/);
  assert.deepEqual(fake.mutations().map((call) => call.operationName), ['AddMetaobjectDefinitionFields']);
  assert.equal(fake.state.metaobjectDefinitions.get('store').name, 'Renamed in admin', 'the name is never changed');
});

test('a definition id that is not a metaobject definition gid is never sent back; the missing field is reported as a difference', async () => {
  const fake = createFakeShopify();
  assert.equal((await run(['--live'], { fake })).code, 0);
  dropField(fake, 'site_settings', 'support_phone');
  fake.state.metaobjectDefinitions.get('site_settings').id = 'gid://shopify/Product/1';
  fake.reset();
  const result = await run(['--live'], { fake });
  assert.equal(result.code, 1);
  assert.match(result.out, /DIFF site_settings: field support_phone is missing in Shopify/);
  assert.equal(fake.mutations().length, 0);
});

test('a definition whose returned type is not the requested one gets nothing added, and the difference is reported (S-L7)', async () => {
  const fake = createFakeShopify();
  assert.equal((await run(['--live'], { fake })).code, 0);
  dropField(fake, 'site_settings', 'support_phone');
  fake.state.metaobjectDefinitions.get('site_settings').type = 'something_else';
  fake.reset();
  const result = await run(['--live'], { fake });
  assert.equal(result.code, 1);
  assert.match(result.out, /DIFF site_settings: type is "something_else" in Shopify, "site_settings" in the spec; nothing is added to it/);
  assert.equal(fake.mutations().length, 0, 'no field is sent to the definition Shopify named');
  const dry = await run([], { fake });
  assert.equal(dry.code, 1);
  assert.doesNotMatch(dry.out, /ADD site_settings/, 'a dry run does not promise to add fields either');
});

test('a rejected field addition is listed as failed and the exit code is non-zero', async () => {
  const fake = createFakeShopify({
    intercept: ({ operationName }) => (operationName === 'AddMetaobjectDefinitionFields'
      ? new Response(JSON.stringify({ data: { metaobjectDefinitionUpdate: { metaobjectDefinition: null, userErrors: [{ field: ['definition'], message: 'Cannot add field', code: 'INVALID' }] } } }), { status: 200 })
      : null),
  });
  assert.equal((await run(['--live'], { fake })).code, 0);
  dropField(fake, 'site_settings', 'support_phone');
  fake.reset();
  const result = await run(['--live'], { fake });
  assert.equal(result.code, 1);
  assert.match(result.err, /FAILED site_settings: metaobjectDefinitionUpdate rejected: definition: Cannot add field \[INVALID\]/);
});

test('diff helpers ignore validation order and treat id and type references as equivalent', () => {
  const definition = spec.metafieldDefinitions.find((candidate) => candidate.key === 'brand');
  const actual = {
    name: definition.name, type: { name: 'metaobject_reference' }, access: { storefront: 'PUBLIC_READ' }, capabilities: { smartCollectionCondition: { enabled: false } },
    validations: [{ name: 'metaobject_definition_id', value: 'gid://shopify/MetaobjectDefinition/77' }],
  };
  assert.deepEqual(diffMetafieldDefinition(definition, actual), []);
  const choices = spec.metafieldDefinitions.find((candidate) => candidate.key === 'comfort_level');
  const reordered = {
    name: choices.name, type: { name: 'single_line_text_field' }, access: { storefront: 'PUBLIC_READ' }, capabilities: { smartCollectionCondition: { enabled: true } },
    validations: [{ name: 'choices', value: '[ "Ultra Plush", "Plush", "Medium", "Firm", "Extra Firm" ]' }],
  };
  assert.deepEqual(diffMetafieldDefinition(choices, reordered), []);
  assert.deepEqual(diffMetaobjectDefinition(spec.metaobjectDefinitions[0], { name: 'Wrong', displayNameKey: 'name', access: { storefront: 'PUBLIC_READ' }, fieldDefinitions: [] }).length > 1, true);
});

test('one definition failing does not stop the rest, and the failure is listed; the re-run creates only what is missing', async () => {
  let broken = true;
  const fake = createFakeShopify({
    intercept: ({ operationName, variables }) => (broken && operationName === 'CreateMetaobjectDefinition' && variables.definition.type === 'faq'
      ? new Response(JSON.stringify({ data: { metaobjectDefinitionCreate: { metaobjectDefinition: null, userErrors: [{ field: ['definition', 'type'], message: 'Type has already been taken', code: 'TAKEN' }] } } }), { status: 200 })
      : null),
  });
  const first = await run(['--live'], { fake });
  assert.equal(first.code, 1);
  assert.match(first.out, new RegExp(`Created ${TOTAL - 3} definition`));
  assert.match(first.err, /FAILED faq: metaobjectDefinitionCreate rejected: definition\.type: Type has already been taken \[TAKEN\]/);
  // The two FAQ metafields point at faq, so they are held back (not sent with a broken reference) until it exists.
  assert.match(first.err, /FAILED product custom.faqs: references metaobject type "faq"/);
  broken = false;
  fake.reset();
  const second = await run(['--live'], { fake });
  assert.equal(second.code, 0, second.err);
  assert.equal(fake.mutations().length, 3);
});

test('an authentication failure stops the run at the first write', async () => {
  const fake = createFakeShopify({ intercept: ({ operationName }) => (operationName.startsWith('Create') ? new Response('{}', { status: 401 }) : null) });
  const result = await run(['--live'], { fake });
  assert.equal(result.code, 1);
  assert.equal(fake.mutations().length, 1);
  assert.match(result.err, /refused the credentials/);
});

test('when Shopify is down the plan fails with a bounded number of attempts and no token in the output', async () => {
  const fake = createFakeShopify({ intercept: () => new Response('{}', { status: 502 }) });
  const result = await run([], { fake, maxAttempts: 2 });
  assert.equal(result.code, 1);
  assert.equal(fake.state.calls.length, 2);
  assert.equal(`${result.out}${result.err}`.includes(FAKE_TOKEN), false);
});

test('a custom --spec file is validated before anything else, and unreadable files exit with 2', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'defs-test-'));
  try {
    const bad = path.join(dir, 'bad.json');
    await writeFile(bad, JSON.stringify({ specVersion: 1, metaobjectDefinitions: [{ type: 'x' }], metafieldDefinitions: [] }));
    const fake = createFakeShopify();
    const invalid = await run(['--offline', '--spec', bad], { fake, env: {} });
    assert.equal(invalid.code, 2);
    assert.match(invalid.err, /definitions file is invalid/);
    const missing = await run(['--offline', '--spec', path.join(dir, 'nope.json')], { fake, env: {} });
    assert.equal(missing.code, 2);
    const notJson = path.join(dir, 'not.json');
    await writeFile(notJson, '{');
    assert.equal((await run(['--offline', '--spec', notJson], { fake, env: {} })).code, 2);
    assert.equal(fake.state.calls.length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('planDefinitions with a read-only client cannot write even if asked to', async () => {
  const fake = createFakeShopify();
  const client = createAdminClient({ store: FAKE_STORE, token: FAKE_TOKEN, fetch: fake.fetch, clock: instantClock() });
  const plan = await planDefinitions({ spec, client });
  assert.ok(plan.ok);
  const refused = await client.request('mutation M { x }', {}, { operationName: 'M' });
  assert.equal(refused.ok === false && refused.error.kind, 'read_only');
  assert.equal(fake.mutations().length, 0);
});

// ---- references and description length (found by the first live run, V-05) --------------------------------

test('a type reference becomes the definition id Shopify requires, in a metafield and in a metaobject field', () => {
  const ids = new Map([['faq', 'gid://shopify/MetaobjectDefinition/5']]);
  const metafield = resolveReferences({ name: 'FAQs', validations: [{ name: 'metaobject_definition_type', value: 'faq' }] }, ids);
  assert.deepEqual(metafield.ok && metafield.input.validations, [{ name: 'metaobject_definition_id', value: 'gid://shopify/MetaobjectDefinition/5' }]);
  const metaobject = resolveReferences({ type: 'x', fieldDefinitions: [{ key: 'a', validations: [{ name: 'metaobject_definition_type', value: 'faq' }] }, { key: 'b' }] }, ids);
  assert.deepEqual(metaobject.ok && metaobject.input.fieldDefinitions, [{ key: 'a', validations: [{ name: 'metaobject_definition_id', value: 'gid://shopify/MetaobjectDefinition/5' }] }, { key: 'b' }]);
});

test('a reference to a type that does not exist yet is reported, not sent', () => {
  const result = resolveReferences({ validations: [{ name: 'metaobject_definition_type', value: 'brand' }] }, new Map());
  assert.equal(result.ok, false);
  assert.match(result.ok ? '' : result.message, /brand/);
});

test('validateSpec rejects a description longer than Shopify allows', () => {
  const bad = clone();
  bad.metaobjectDefinitions[0].fieldDefinitions[0].description = 'x'.repeat(256);
  const checked = validateSpec(bad);
  assert.equal(checked.ok, false);
  assert.match(checked.ok ? '' : checked.errors.join(' '), /255/);
});
