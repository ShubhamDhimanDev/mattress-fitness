import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FAKE_STORE, FAKE_TOKEN, createFakeShopify } from '../lib/testing/fake-shopify.mjs';
import { toDesiredProduct } from '../catalog/map.mjs';
import { BENEFITS, COMFORT_LEVELS, DELIVERY_TYPES, MATTRESS_TYPES, SLEEP_POSITIONS } from '../catalog/schema.mjs';
import { DEFAULT_SPEC_PATH, diffMetafieldDefinition, diffMetaobjectDefinition, encodeValidations, main, planDefinitions, toMetafieldDefinitionInput, toMetaobjectDefinitionInput, validateSpec } from './apply-definitions.mjs';
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

test('definitions.json is valid and declares the ten metaobject types of the data model', () => {
  const checked = validateSpec(spec);
  assert.deepEqual(checked.ok ? [] : checked.errors, []);
  assert.deepEqual(spec.metaobjectDefinitions.map((definition) => definition.type).sort(), ['brand', 'delivery_zone', 'faq', 'homepage_section', 'offer_rule', 'promo_tile', 'quiz_option', 'quiz_question', 'site_settings', 'store']);
  assert.equal(spec.metafieldDefinitions.length, 17, '16 product metafields and the variant dimensions field');
  assert.equal(TOTAL, 27);
});

test('every definition the storefront reads has Storefront API access enabled (PUBLIC_READ)', () => {
  for (const definition of [...spec.metaobjectDefinitions, ...spec.metafieldDefinitions]) {
    assert.equal(definition.storefrontAccess, 'PUBLIC_READ', definition.type ?? `${definition.namespace}.${definition.key}`);
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
  assert.ok(['haul_away_max', 'extend_enabled', 'promo_bar_text'].every((key) => fields('site_settings').includes(key)));
  assert.ok(!fields('site_settings').includes('free_delivery_threshold'), 'free-delivery threshold has one source: delivery_zone.free_over');
  const offerType = spec.metaobjectDefinitions.find((definition) => definition.type === 'offer_rule').fieldDefinitions.find((field) => field.key === 'type');
  assert.deepEqual(offerType.validations[0].value, ['comfort_protector', 'haul_away', 'matching_protector', 'pillow', 'bedding', 'gift', 'bundle']);
  const postal = spec.metaobjectDefinitions.find((definition) => definition.type === 'delivery_zone').fieldDefinitions.find((field) => field.key === 'postal_codes');
  assert.equal(postal.validations[0].value, 3000, 'matches the Local delivery limit (F-28)');
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
  assert.match(result.out, /kind\s+definition\s+action\s+differences/);
  assert.match(result.out, new RegExp(`Plan: ${TOTAL} to create, 0 already in sync, 0 differ`));
  assert.equal(noNetwork.state.calls.length, 0);
});

test('a dry run reads the store, shows what would be created, and cannot write', async () => {
  const fake = createFakeShopify();
  const result = await run([], { fake });
  assert.equal(result.code, 0, result.err);
  assert.match(result.out, new RegExp(`${TOTAL} to create`));
  assert.equal(fake.mutations().length, 0);
  assert.equal(fake.state.metaobjectDefinitions.size + fake.state.metafieldDefinitions.size, 0);
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
  fake.state.metaobjectDefinitions.get('store').fieldDefinitions.pop();
  fake.state.metaobjectDefinitions.get('brand').fieldDefinitions.push({ key: 'extra_field', name: 'Extra', description: null, required: false, type: { name: 'single_line_text_field' }, validations: [] });
  fake.reset();
  const result = await run(['--live'], { fake });
  assert.equal(result.code, 1);
  assert.match(result.out, /DIFF product custom\.comfort_level: Storefront API access is NONE in Shopify, PUBLIC_READ in the spec/);
  assert.match(result.out, /DIFF product custom\.mattress_type: validations: validation choices differs/);
  assert.match(result.out, /DIFF store: field location_handle is missing in Shopify/);
  assert.match(result.out, /DIFF brand: Shopify has an extra field extra_field/);
  assert.match(result.out, /4 differ \(reported, never changed by this tool\)/);
  assert.equal(fake.mutations().length, 0, 'existing definitions are never modified');
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
  assert.match(first.out, new RegExp(`Created ${TOTAL - 1} definition`));
  assert.match(first.err, /FAILED faq: metaobjectDefinitionCreate rejected: definition\.type: Type has already been taken \[TAKEN\]/);
  broken = false;
  fake.reset();
  const second = await run(['--live'], { fake });
  assert.equal(second.code, 0, second.err);
  assert.equal(fake.mutations().length, 1);
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
