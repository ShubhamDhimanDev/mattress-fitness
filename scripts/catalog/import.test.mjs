// End-to-end tests of the importer through main(), against an in-memory fake of the Admin API served by a
// mocked fetch. They prove the safety properties (guards, no write without --live, no import on bad data,
// nothing deleted silently, token never printed) and idempotency (a second run is an empty plan).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FAKE_STORE, FAKE_TOKEN, createFakeShopify } from '../lib/testing/fake-shopify.mjs';
import { parseCsv, stringifyCsv } from './csv.mjs';
import { executePlan, createManifest, isEmptyPlan, main, planImport, planToJson, renderPlanTable } from './import.mjs';
import { createOfflineRemote } from './remote.mjs';
import { COLUMNS } from './schema.mjs';
import { validateSheet } from './validate.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE = readFileSync(path.join(here, 'sample/mattresses.csv'), 'utf8');
const INVALID = readFileSync(path.join(here, 'sample/invalid.csv'), 'utf8');
const BRANDS = ['quillmoor-sleep', 'brindlewood-bedding', 'oakhollow-mattress-co', 'tessaly-home'];

const baseEnv = () => ({ SHOPIFY_STORE_DOMAIN: FAKE_STORE, SHOPIFY_ALLOWED_STORES: FAKE_STORE, SHOPIFY_ADMIN_API_ACCESS_TOKEN: FAKE_TOKEN });

/** A clock whose sleeps cost nothing but still advance time, so retries and throttling never slow the suite. */
function fastClock() {
  let now = 1_000_000;
  return { now: () => now, sleep: async (/** @type {number} */ ms) => { now += ms; } };
}

/** @param {string} text @param {(rows: string[][], index: Record<string, number>) => string[][] | void} change */
function edit(text, change) {
  const parsed = parseCsv(text);
  assert.ok(parsed.ok);
  const [header, ...rows] = parsed.records.map((record) => record.fields);
  const index = Object.fromEntries(header.map((name, position) => [name, position]));
  return stringifyCsv([header, ...(change(rows, index) ?? rows)]);
}

async function workspace(/** @type {string} */ csv) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'import-test-'));
  const images = path.join(dir, 'images');
  await mkdir(images);
  const names = new Set(validateSheet(csv).products.flatMap((product) => product.images));
  for (const name of names) await writeFile(path.join(images, name), 'tiny fake image bytes');
  const sheet = path.join(dir, 'sheet.csv');
  await writeFile(sheet, csv);
  return {
    dir, images, sheet, manifests: path.join(dir, 'runs'),
    async setSheet(/** @type {string} */ text) { await writeFile(sheet, text); },
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

/**
 * @param {string[]} argv
 * @param {{ fake: ReturnType<typeof createFakeShopify>, env?: Record<string, string | undefined>, fetch?: typeof fetch, maxAttempts?: number }} setup
 */
async function run(argv, { fake, env = baseEnv(), fetch: fetchImpl = fake.fetch, maxAttempts = 3 }) {
  /** @type {string[]} */
  const out = [];
  /** @type {string[]} */
  const err = [];
  const code = await main(argv, env, { out: (text) => out.push(text), err: (text) => err.push(text), fetch: fetchImpl, clock: fastClock(), maxAttempts });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

const byHandle = (/** @type {ReturnType<typeof createFakeShopify>} */ fake, /** @type {string} */ handle) => [...fake.state.products.values()].find((product) => product.handle === handle);
const live = (/** @type {{ sheet: string, images: string, manifests: string }} */ ws, /** @type {string[]} */ extra = []) => [ws.sheet, '--images', ws.images, '--live', '--manifest-dir', ws.manifests, ...extra];
const dry = (/** @type {{ sheet: string, images: string }} */ ws, /** @type {string[]} */ extra = []) => [ws.sheet, '--images', ws.images, '--json', ...extra];
const manifestPath = (/** @type {string} */ out) => /Run manifest: (.+)$/m.exec(out)?.[1] ?? '';

/** A minimal product already in the store, as if created by hand. */
function seedProduct(fake, { handle, sku, title = 'Seeded' }) {
  const id = `gid://shopify/Product/${900000 + fake.state.products.size}`;
  fake.state.products.set(id, {
    id, handle, title, descriptionHtml: '', vendor: 'Seed', productType: 'Mattress', tags: [], status: 'ACTIVE', seo: { title: '', description: '' },
    options: [{ id: `${id}/opt`, name: 'Size', position: 1, values: ['Queen'] }],
    variants: [{ id: `${id}/v1`, sku, price: '10.00', compareAtPrice: null, selectedOptions: [{ name: 'Size', value: 'Queen' }], metafields: [] }], metafields: [], media: [], published: false,
  });
  return id;
}

// ---- guards ---------------------------------------------------------------------------------------------

test('without --live the tool never writes: the plan is built from reads only', async () => {
  const fake = createFakeShopify({ brands: BRANDS });
  const ws = await workspace(SAMPLE);
  try {
    const result = await run(dry(ws), { fake });
    assert.equal(result.code, 0, result.err);
    const plan = JSON.parse(result.out);
    assert.equal(plan.summary.create, 14);
    assert.equal(plan.summary.uploads, 28);
    assert.equal(fake.mutations().length, 0, 'a dry run must send no mutation');
    assert.equal(fake.state.products.size, 0);
    const text = await run([ws.sheet, '--images', ws.images], { fake });
    assert.match(text.out, /^DRY RUN \(the store was only read\)/);
    assert.match(text.out, /Plan: 14 to create, 0 to update, 0 unchanged, 0 blocked, 28 image\(s\) to upload\./);
  } finally {
    await ws.cleanup();
  }
});

test('--live is refused (exit 3) when the store is not allow-listed, the list is empty, or the token is missing, before any request', async () => {
  const ws = await workspace(SAMPLE);
  try {
    const cases = /** @type {const} */ ([
      ['store not in the list', { ...baseEnv(), SHOPIFY_ALLOWED_STORES: 'another-store.myshopify.com' }, /not in SHOPIFY_ALLOWED_STORES/],
      ['empty allow-list', { ...baseEnv(), SHOPIFY_ALLOWED_STORES: '' }, /empty or unset/],
      ['no allow-list at all', { SHOPIFY_STORE_DOMAIN: FAKE_STORE, SHOPIFY_ADMIN_API_ACCESS_TOKEN: FAKE_TOKEN }, /empty or unset/],
      ['no store', { SHOPIFY_ALLOWED_STORES: FAKE_STORE, SHOPIFY_ADMIN_API_ACCESS_TOKEN: FAKE_TOKEN }, /No store given/],
      ['custom domain', { ...baseEnv(), SHOPIFY_STORE_DOMAIN: 'shop.example.com' }, /myshopify\.com/],
      ['no token', { SHOPIFY_STORE_DOMAIN: FAKE_STORE, SHOPIFY_ALLOWED_STORES: FAKE_STORE }, /SHOPIFY_ADMIN_API_ACCESS_TOKEN is not set/],
    ]);
    for (const [label, env, message] of cases) {
      const fake = createFakeShopify();
      const result = await run(live(ws), { fake, env });
      assert.equal(result.code, 3, label);
      assert.match(result.err, message, label);
      assert.equal(fake.state.calls.length, 0, `${label}: no request may be sent`);
      assert.equal(result.err.includes(FAKE_TOKEN) || result.out.includes(FAKE_TOKEN), false);
    }
  } finally {
    await ws.cleanup();
  }
});

test('even a dry run needs an allow-listed store, because reading the wrong store is also a mistake (T-14)', async () => {
  const fake = createFakeShopify();
  const ws = await workspace(SAMPLE);
  try {
    const result = await run(dry(ws), { fake, env: { ...baseEnv(), SHOPIFY_ALLOWED_STORES: 'another-store.myshopify.com' } });
    assert.equal(result.code, 3);
    assert.equal(fake.state.calls.length, 0);
  } finally {
    await ws.cleanup();
  }
});

test('--live cannot be combined with --offline, and unknown flags are rejected', async () => {
  const fake = createFakeShopify();
  const ws = await workspace(SAMPLE);
  try {
    assert.equal((await run([ws.sheet, '--live', '--offline'], { fake })).code, 2);
    assert.equal((await run([ws.sheet, '--lve'], { fake })).code, 2);
    assert.equal((await run([], { fake })).code, 2);
    assert.equal(fake.state.calls.length, 0);
  } finally {
    await ws.cleanup();
  }
});

test('no import runs on failing data: the invalid sheet stops with exit 1 before any request, even with --live', async () => {
  const fake = createFakeShopify();
  const ws = await workspace(INVALID);
  try {
    const result = await run(live(ws), { fake });
    assert.equal(result.code, 1);
    assert.match(result.err, /Nothing was imported/);
    assert.equal(fake.state.calls.length, 0, 'validation happens before the store is contacted');
    assert.equal(fake.state.products.size, 0);
  } finally {
    await ws.cleanup();
  }
});

test('--offline plans against an empty store with no network and no credentials', async () => {
  const ws = await workspace(SAMPLE);
  try {
    const noNetwork = /** @type {typeof fetch} */ (async () => { throw new Error('network must not be used'); });
    const fake = createFakeShopify();
    const result = await run([ws.sheet, '--offline', '--json'], { fake, env: {}, fetch: noNetwork });
    assert.equal(result.code, 0, result.err);
    assert.equal(JSON.parse(result.out).summary.create, 14);
  } finally {
    await ws.cleanup();
  }
});

// ---- first run, idempotent second run --------------------------------------------------------------------

test('a live first run creates every product, and a second run produces an empty plan and no writes', async () => {
  const fake = createFakeShopify({ brands: BRANDS });
  const foundationId = seedProduct(fake, { handle: 'sample-foundation', sku: 'SEED-1' });
  const ws = await workspace(SAMPLE);
  try {
    const first = await run(live(ws), { fake });
    assert.equal(first.code, 0, first.err);
    assert.match(first.out, /Done: 14 created, 0 updated, 0 failed, 0 skipped\./);

    // what landed in the store
    assert.equal(fake.state.products.size, 15, '14 products plus the seeded one');
    const created = [...fake.state.products.values()].filter((product) => product.vendor !== 'Seed');
    assert.equal(created.reduce((sum, product) => sum + product.variants.length, 0), 80);
    assert.equal(created.filter((product) => product.status === 'ACTIVE').length, 9);
    assert.equal(created.filter((product) => product.status === 'DRAFT').length, 5);
    assert.ok(created.every((product) => product.media.length === 2 && product.media.every((item) => item.alt.startsWith(product.title))));
    assert.equal(fake.state.uploads.length, 28);
    assert.ok(fake.state.uploads.every((upload) => upload.fields.at(-1) === 'file'), 'the file goes last in the multipart body');
    assert.ok(fake.state.urls.every((url) => new URL(url).hostname === FAKE_STORE || new URL(url).hostname.endsWith('storage.googleapis.com')));

    const plush = byHandle(fake, 'cloudmere-plush');
    assert.ok(plush.variants.every((variant) => Number(variant.compareAtPrice) - Number(variant.price) === 100), 'sale price is the price, regular price is compare-at');
    const hybrid = byHandle(fake, 'cloudmere-hybrid');
    assert.deepEqual(hybrid.variants.map((variant) => variant.selectedOptions[0].value), ['Twin', 'Twin XL', 'Full', 'Queen', 'King', 'California King', 'Split California King']);
    const metafield = (/** @type {string} */ key) => hybrid.metafields.find((item) => item.key === key);
    assert.equal(metafield('comfort_level').value, 'Medium');
    assert.equal(metafield('brand').type, 'metaobject_reference');
    assert.equal(metafield('related_foundations').value, JSON.stringify([foundationId]));
    assert.equal(hybrid.variants[0].metafields[0].key, 'dimensions');
    assert.ok(hybrid.tags.includes('brand:Quillmoor Sleep'));
    assert.equal(fake.mutations().filter((call) => call.operationName === 'MetafieldsSet').length, 0, 'creates carry their metafields inline');

    // manifest
    const manifest = JSON.parse(await readFile(manifestPath(first.out), 'utf8'));
    assert.equal(manifest.created.length, 14);
    assert.deepEqual(new Set(manifest.created.map((entry) => entry.id)), new Set(created.map((product) => product.id)));
    assert.equal(manifest.store, FAKE_STORE);
    assert.match(manifest.sheet.sha256, /^[0-9a-f]{64}$/);
    assert.ok(manifest.finishedAt);
    assert.equal(JSON.stringify(manifest).includes(FAKE_TOKEN), false);

    // second run: nothing to do
    const second = await run(dry(ws), { fake });
    assert.equal(second.code, 0, second.err);
    const plan = JSON.parse(second.out);
    assert.deepEqual({ create: plan.summary.create, update: plan.summary.update, unchanged: plan.summary.unchanged, blocked: plan.summary.blocked, uploads: plan.summary.uploads }, { create: 0, update: 0, unchanged: 14, blocked: 0, uploads: 0 });
    fake.reset();
    const secondLive = await run(live(ws), { fake });
    assert.equal(secondLive.code, 0, secondLive.err);
    assert.match(secondLive.out, /Nothing to do: the store already matches the sheet\./);
    assert.equal(fake.mutations().length, 0, 'a no-op run must not send a single mutation');
    assert.equal(fake.state.uploads.length, 0);
    assert.equal(JSON.parse(await readFile(manifestPath(secondLive.out), 'utf8')).created.length, 0);
  } finally {
    await ws.cleanup();
  }
});

test('missing brand and related products are notes, not failures, and are linked once they exist', async () => {
  const fake = createFakeShopify();
  const ws = await workspace(SAMPLE);
  try {
    const first = await run(live(ws), { fake });
    assert.equal(first.code, 0, first.err);
    assert.match(first.out, /note \(\d+ products\): No brand metaobject "quillmoor-sleep" in Shopify yet/);
    assert.match(first.out, /note \(\d+ products\): Related product "sample-foundation" \(related_foundations\) was not found/);
    assert.equal(first.out.split('\n').filter((line) => line.includes('"sample-foundation"')).length, 1, 'a repeated note is printed once');
    assert.equal(byHandle(fake, 'cloudmere-hybrid').metafields.some((item) => item.key === 'brand'), false);
  } finally {
    await ws.cleanup();
  }
});

// ---- updates change only what was edited ------------------------------------------------------------------

test('editing one price updates exactly one product, with a minimal request, a before-snapshot, and no deletions', async () => {
  const fake = createFakeShopify({ brands: BRANDS });
  const ws = await workspace(SAMPLE);
  try {
    assert.equal((await run(live(ws), { fake })).code, 0);
    const before = byHandle(fake, 'cloudmere-hybrid');
    const idsBefore = before.variants.map((variant) => variant.id);
    const mediaBefore = before.media.map((item) => item.id);

    await ws.setSheet(edit(SAMPLE, (rows, i) => {
      const queen = rows.find((entry) => entry[i.sku] === 'CH01-Q');
      queen[i.price] = '1499.00';
      queen[i.sale_price] = '1349.00';
    }));
    fake.reset();
    const plan = JSON.parse((await run(dry(ws), { fake })).out);
    assert.equal(plan.summary.update, 1);
    assert.equal(plan.summary.unchanged, 13);
    assert.deepEqual(plan.items.find((item) => item.action === 'update').changes.map((change) => change.field), ['Queen price', 'Queen compare-at price']);

    fake.reset();
    const result = await run(live(ws), { fake });
    assert.equal(result.code, 0, result.err);
    assert.match(result.out, /Done: 0 created, 1 updated, 0 failed, 0 skipped\./);
    assert.equal(fake.mutations().length, 1);
    const input = fake.mutations()[0].variables.input;
    for (const forbidden of ['metafields', 'collections', 'files', 'productOptions', 'title', 'tags']) {
      assert.equal(forbidden in input, false, `${forbidden} must not be sent when it did not change`);
    }
    assert.equal(fake.state.uploads.length, 0);

    const after = byHandle(fake, 'cloudmere-hybrid');
    const queen = after.variants.find((variant) => variant.sku === 'CH01-Q');
    assert.deepEqual([queen.price, queen.compareAtPrice], ['1349.00', '1499.00']);
    assert.deepEqual(after.variants.map((variant) => variant.id), idsBefore, 'variant ids are stable');
    assert.deepEqual(after.media.map((item) => item.id), mediaBefore);

    const manifest = JSON.parse(await readFile(manifestPath(result.out), 'utf8'));
    assert.equal(manifest.updated.length, 1);
    assert.equal(manifest.updated[0].before.variants.find((variant) => variant.sku === 'CH01-Q').price, '1299.00', 'the manifest holds the old value for revert');

    // ending the sale clears compare-at (null, not omitted)
    await ws.setSheet(edit(SAMPLE, (rows, i) => { rows.find((entry) => entry[i.sku] === 'CH01-Q')[i.price] = '1499.00'; }));
    assert.equal((await run(live(ws), { fake })).code, 0);
    const ended = byHandle(fake, 'cloudmere-hybrid').variants.find((variant) => variant.sku === 'CH01-Q');
    assert.deepEqual([ended.price, ended.compareAtPrice], ['1499.00', null]);
  } finally {
    await ws.cleanup();
  }
});

test('an update never deletes the client\'s own tags or metafields that the sheet does not manage', async () => {
  const fake = createFakeShopify({ brands: BRANDS });
  const ws = await workspace(SAMPLE);
  try {
    assert.equal((await run(live(ws), { fake })).code, 0);
    const product = byHandle(fake, 'cloudmere-hybrid');
    product.tags.push('Clearance', 'staff-pick');
    product.metafields.push({ namespace: 'custom', key: 'faqs', type: 'list.metaobject_reference', value: '["gid://shopify/Metaobject/5"]' });
    product.metafields.find((item) => item.key === 'comfort_level').value = 'Firm'; // a stale value for a managed field

    // the model name is on the first size row only; the others inherit it
    await ws.setSheet(edit(SAMPLE, (rows, i) => { for (const entry of rows) if (entry[i.handle] === 'cloudmere-hybrid' && entry[i.model]) entry[i.model] = 'Cloudmere Hybrid Renamed'; }));
    const result = await run(live(ws), { fake });
    assert.equal(result.code, 0, result.err);
    const after = byHandle(fake, 'cloudmere-hybrid');
    assert.equal(after.title, 'Cloudmere Hybrid Renamed');
    assert.ok(after.tags.includes('Clearance') && after.tags.includes('staff-pick'));
    assert.ok(after.metafields.some((item) => item.key === 'faqs'), 'unmanaged metafield survives');
    assert.equal(after.metafields.find((item) => item.key === 'comfort_level').value, 'Medium', 'managed metafield is corrected through metafieldsSet');
    assert.equal(fake.mutations().filter((call) => call.operationName === 'MetafieldsSet').length, 1);
  } finally {
    await ws.cleanup();
  }
});

test('a new size on an existing product is added without disturbing the existing variants', async () => {
  const fake = createFakeShopify({ brands: BRANDS });
  const ws = await workspace(SAMPLE);
  try {
    assert.equal((await run(live(ws), { fake })).code, 0);
    const before = byHandle(fake, 'cloudmere-firm');
    assert.equal(before.variants.length, 5);
    const idsBefore = before.variants.map((variant) => variant.id);

    const productColumns = COLUMNS.filter((column) => column.level === 'product' && column.name !== 'handle').map((column) => column.name);
    await ws.setSheet(edit(SAMPLE, (rows, i) => {
      const queen = rows.find((entry) => entry[i.handle] === 'cloudmere-firm' && entry[i.size] === 'Queen');
      const twin = [...queen];
      for (const name of productColumns) twin[i[name]] = '';
      Object.assign(twin, { [i.size]: 'Twin', [i.sku]: 'CF-NEW-T', [i.price]: '599.00', [i.sale_price]: '', [i.dimensions]: '38 in x 75 in' });
      return [...rows, twin];
    }));
    fake.reset();
    const plan = JSON.parse((await run(dry(ws), { fake })).out);
    assert.equal(plan.summary.update, 1);
    const result = await run(live(ws), { fake });
    assert.equal(result.code, 0, result.err);
    const after = byHandle(fake, 'cloudmere-firm');
    assert.equal(after.variants.length, 6);
    assert.deepEqual(idsBefore.every((id) => after.variants.some((variant) => variant.id === id)), true);
    const twin = after.variants.find((variant) => variant.sku === 'CF-NEW-T');
    assert.equal(twin.price, '599.00');
    assert.deepEqual(twin.metafields.map((item) => item.value), ['38 in x 75 in']);
    const productSet = fake.mutations().find((call) => call.operationName === 'ProductSet');
    assert.equal(productSet.variables.identifier.id, after.id);
    assert.ok(productSet.variables.input.productOptions[0].id, 'the existing option is extended, not recreated');
  } finally {
    await ws.cleanup();
  }
});

// ---- nothing disappears silently --------------------------------------------------------------------------

test('a size that is in Shopify but not in the sheet blocks that product unless --allow-removals is given', async () => {
  const fake = createFakeShopify({ brands: BRANDS });
  const ws = await workspace(SAMPLE);
  try {
    assert.equal((await run(live(ws), { fake })).code, 0);
    await ws.setSheet(edit(SAMPLE, (rows, i) => rows.filter((entry) => entry[i.sku] !== 'CH01-K')));

    fake.reset();
    const dryRun = await run([ws.sheet, '--images', ws.images], { fake });
    assert.equal(dryRun.code, 1);
    assert.match(dryRun.out, /BLOCKED cloudmere-hybrid: Shopify has size\(s\) that are not in the sheet: King \(CH01-K\)/);

    const liveRun = await run(live(ws), { fake });
    assert.equal(liveRun.code, 1, 'skipped products must not look like success');
    assert.equal(fake.mutations().length, 0, 'nothing is written for a blocked product');
    assert.equal(byHandle(fake, 'cloudmere-hybrid').variants.length, 7);
    assert.equal(JSON.parse(await readFile(manifestPath(liveRun.out), 'utf8')).skipped.length, 1);

    const allowed = await run(live(ws, ['--allow-removals']), { fake });
    assert.equal(allowed.code, 0, allowed.err);
    assert.equal(byHandle(fake, 'cloudmere-hybrid').variants.length, 6);
    assert.equal(byHandle(fake, 'cloudmere-hybrid').variants.some((variant) => variant.sku === 'CH01-K'), false);
  } finally {
    await ws.cleanup();
  }
});

test('images in Shopify that are not in the sheet are protected the same way', async () => {
  const fake = createFakeShopify({ brands: BRANDS });
  const ws = await workspace(SAMPLE);
  try {
    assert.equal((await run(live(ws), { fake })).code, 0);
    byHandle(fake, 'tidewell-foam').media.push({ id: 'gid://shopify/MediaImage/handmade', alt: 'Added in admin', url: 'https://cdn.shopify.invalid/s/files/handmade.jpg' });
    fake.reset();
    const result = await run([ws.sheet, '--images', ws.images], { fake });
    assert.equal(result.code, 1);
    assert.match(result.out, /BLOCKED tidewell-foam: Shopify has media that is not in the sheet: handmade\.jpg/);
    assert.equal(fake.mutations().length, 0);
  } finally {
    await ws.cleanup();
  }
});

test('a SKU that already belongs to another product blocks the create', async () => {
  const fake = createFakeShopify({ brands: BRANDS });
  seedProduct(fake, { handle: 'someone-elses-product', sku: 'CH01-Q' });
  const ws = await workspace(SAMPLE);
  try {
    const dryRun = JSON.parse((await run(dry(ws), { fake })).out);
    const blocked = dryRun.items.find((item) => item.handle === 'cloudmere-hybrid');
    assert.equal(blocked.action, 'blocked');
    assert.match(blocked.blocked[0], /SKU CH01-Q already belongs to the product "someone-elses-product"/);
    const liveRun = await run(live(ws), { fake });
    assert.equal(liveRun.code, 1);
    assert.equal(byHandle(fake, 'cloudmere-hybrid'), undefined);
    assert.equal(fake.state.products.size, 14, '13 created plus the seeded product');
  } finally {
    await ws.cleanup();
  }
});

// ---- failures ---------------------------------------------------------------------------------------------

/** @param {Record<string, unknown>} data */
const okResponse = (data) => new Response(JSON.stringify({ data, extensions: { cost: { requestedQueryCost: 10, actualQueryCost: 5, throttleStatus: { maximumAvailable: 1000, currentlyAvailable: 1000, restoreRate: 100 } } } }), { status: 200 });

test('one product failing does not stop the others; the manifest records it; a re-run completes only that product', async () => {
  let broken = true;
  const fake = createFakeShopify({
    brands: BRANDS,
    intercept: ({ operationName, variables }) => (broken && operationName === 'ProductSet' && variables.input.handle === 'tidewell-foam'
      ? okResponse({ productSet: { product: null, userErrors: [{ field: ['input', 'title'], message: 'Title is invalid' }] } })
      : null),
  });
  const ws = await workspace(SAMPLE);
  try {
    const first = await run(live(ws), { fake });
    assert.equal(first.code, 1);
    assert.match(first.err, /FAILED tidewell-foam \(create\): productSet rejected: input\.title: Title is invalid/);
    assert.match(first.out, /Done: 13 created, 0 updated, 1 failed, 0 skipped\./);
    const manifest = JSON.parse(await readFile(manifestPath(first.out), 'utf8'));
    assert.deepEqual(manifest.failed.map((entry) => [entry.handle, entry.stage]), [['tidewell-foam', 'create']]);
    assert.equal(fake.state.products.size, 13);

    broken = false;
    fake.reset();
    const plan = JSON.parse((await run(dry(ws), { fake })).out);
    assert.deepEqual([plan.summary.create, plan.summary.unchanged], [1, 13]);
    const second = await run(live(ws), { fake });
    assert.equal(second.code, 0, second.err);
    assert.equal(fake.mutations().filter((call) => call.operationName === 'ProductSet').length, 1, 'only the failed product is retried');
    assert.equal(fake.state.products.size, 14);
  } finally {
    await ws.cleanup();
  }
});

test('a credential failure mid-run aborts the rest of the run instead of hammering the API', async () => {
  const fake = createFakeShopify({
    brands: BRANDS,
    intercept: ({ operationName }) => (operationName === 'ProductSet' ? new Response('{}', { status: 401 }) : null),
  });
  const ws = await workspace(SAMPLE);
  try {
    const result = await run(live(ws), { fake });
    assert.equal(result.code, 1);
    assert.equal(fake.mutations().filter((call) => call.operationName === 'ProductSet').length, 1, 'stopped after the first refusal');
    const manifest = JSON.parse(await readFile(manifestPath(result.out), 'utf8'));
    assert.equal(manifest.failed.length, 1);
    assert.equal(manifest.skipped.length, 13);
    assert.match(manifest.skipped[0].reason, /aborted/);
  } finally {
    await ws.cleanup();
  }
});

test('when Shopify is down the dry run fails cleanly after a bounded number of attempts', async () => {
  const fake = createFakeShopify({ intercept: () => new Response('{}', { status: 503 }) });
  const ws = await workspace(SAMPLE);
  try {
    const result = await run(dry(ws), { fake, maxAttempts: 3 });
    assert.equal(result.code, 1);
    assert.match(result.err, /Could not read the store while checking/);
    assert.equal(fake.state.calls.length, 3, 'exactly maxAttempts requests, then give up');
  } finally {
    await ws.cleanup();
  }
});

test('the token never appears in output, errors or the manifest, whatever fails', async () => {
  const ws = await workspace(SAMPLE);
  try {
    // 1: the network layer throws an error that quotes the header
    const leaky = /** @type {typeof fetch} */ (async () => { throw new Error(`connect failed with X-Shopify-Access-Token: ${FAKE_TOKEN}`); });
    const down = await run(dry(ws), { fake: createFakeShopify(), fetch: leaky });
    assert.equal(down.code, 1);
    assert.equal(`${down.out}\n${down.err}`.includes(FAKE_TOKEN), false);

    // 2: userErrors that echo the token back
    const echo = createFakeShopify({
      brands: BRANDS,
      intercept: ({ operationName }) => (operationName === 'ProductSet'
        ? okResponse({ productSet: { product: null, userErrors: [{ field: null, message: `bad credential ${FAKE_TOKEN}` }] } })
        : null),
    });
    const failed = await run(live(ws), { fake: echo });
    assert.equal(failed.code, 1);
    const manifestText = await readFile(manifestPath(failed.out), 'utf8');
    assert.match(manifestText, /bad credential \[REDACTED\]/, 'the message is kept, with the token replaced');
    assert.equal(`${failed.out}\n${failed.err}\n${manifestText}`.includes(FAKE_TOKEN), false);
  } finally {
    await ws.cleanup();
  }
});

test('error text that a provider echoes back is redacted before it reaches the console or the manifest', async () => {
  const ws = await workspace(SAMPLE);
  try {
    const echo = createFakeShopify({
      brands: BRANDS,
      intercept: ({ operationName }) => (operationName === 'ProductSet'
        ? new Response(JSON.stringify({ errors: [{ message: `bad credential ${FAKE_TOKEN}`, extensions: { code: 'ACCESS_DENIED' } }] }), { status: 200 })
        : null),
    });
    const failed = await run(live(ws), { fake: echo });
    assert.equal(failed.code, 1);
    const manifestText = await readFile(manifestPath(failed.out), 'utf8');
    assert.equal(`${failed.out}\n${failed.err}\n${manifestText}`.includes(FAKE_TOKEN), false);
  } finally {
    await ws.cleanup();
  }
});

// ---- images -----------------------------------------------------------------------------------------------

test('an image named in the sheet but absent from the folder fails validation, so nothing is imported', async () => {
  const fake = createFakeShopify({ brands: BRANDS });
  const ws = await workspace(SAMPLE);
  try {
    await rm(path.join(ws.images, 'tidewell-foam-2.jpg'));
    const result = await run(live(ws), { fake });
    assert.equal(result.code, 1);
    assert.match(result.err, /E_MISSING_IMAGE/);
    assert.equal(fake.state.calls.length, 0);
  } finally {
    await ws.cleanup();
  }
});

test('--images may be a list of file names for planning, but a live run needs the real folder', async () => {
  const list = path.join(here, 'sample/images.txt');
  const planning = await run([path.join(here, 'sample/mattresses.csv'), '--offline', '--images', list, '--json'], { fake: createFakeShopify(), env: {} });
  assert.equal(planning.code, 0, planning.err);
  const plan = JSON.parse(planning.out);
  assert.deepEqual([plan.summary.create, plan.summary.blocked], [14, 0]);
  assert.equal(plan.summary.uploads, 28);

  const fake = createFakeShopify();
  const refused = await run([path.join(here, 'sample/mattresses.csv'), '--images', list, '--live'], { fake });
  assert.equal(refused.code, 3);
  assert.match(refused.err, /needs --images to be a folder/);
  assert.equal(fake.state.calls.length, 0);
});

test('an empty image file blocks only that product before anything is uploaded', async () => {
  const fake = createFakeShopify({ brands: BRANDS });
  const ws = await workspace(SAMPLE);
  try {
    await writeFile(path.join(ws.images, 'ashgrove-spring-1.jpg'), '');
    const dryRun = JSON.parse((await run(dry(ws), { fake })).out);
    const blocked = dryRun.items.find((item) => item.handle === 'ashgrove-spring');
    assert.equal(blocked.action, 'blocked');
    assert.match(blocked.blocked[0], /ashgrove-spring-1\.jpg: file is empty/);
    assert.equal(dryRun.summary.blocked, 1);
    const liveRun = await run(live(ws), { fake });
    assert.equal(liveRun.code, 1);
    assert.equal(fake.state.products.size, 13);
    assert.equal(byHandle(fake, 'ashgrove-spring'), undefined);
    assert.equal(fake.state.uploads.length, 26, 'the blocked product uploaded nothing');
  } finally {
    await ws.cleanup();
  }
});

test('file bytes are only ever sent to allow-listed storage hosts; a hostile upload target is refused', async () => {
  const fake = createFakeShopify({
    brands: BRANDS,
    intercept: ({ operationName, variables }) => (operationName === 'StagedUploadsCreate'
      ? okResponse({ stagedUploadsCreate: { stagedTargets: variables.input.map((file) => ({ url: 'https://evil.example.com/upload', resourceUrl: `https://evil.example.com/${file.filename}`, parameters: [{ name: 'policy', value: 'x' }] })), userErrors: [] } })
      : null),
  });
  const ws = await workspace(SAMPLE);
  try {
    const result = await run(live(ws, ['--only', 'cloudmere-hybrid']), { fake });
    assert.equal(result.code, 1);
    assert.match(result.err, /refusing to upload to a host that is not on the allow-list/);
    assert.equal(fake.state.urls.some((url) => url.includes('evil.example.com')), false, 'no request may reach the hostile host');
    assert.equal(fake.state.products.size, 0);
  } finally {
    await ws.cleanup();
  }
});

test('an upload error never echoes the signed upload parameters', async () => {
  const fake = createFakeShopify({ brands: BRANDS });
  const flaky = /** @type {typeof fetch} */ (async (input, init) => {
    if (new URL(String(input)).hostname.endsWith('storage.googleapis.com')) throw new Error('boom signed-policy-fake-value');
    return fake.fetch(input, init);
  });
  const ws = await workspace(SAMPLE);
  try {
    const result = await run(live(ws, ['--only', 'cloudmere-hybrid']), { fake, fetch: flaky });
    assert.equal(result.code, 1);
    assert.equal(`${result.out}\n${result.err}`.includes('signed-policy-fake-value'), false);
    assert.match(result.err, /upload failed/);
  } finally {
    await ws.cleanup();
  }
});

// ---- selection, related products, publishing ---------------------------------------------------------------

test('--only restricts the run to the named handles and rejects unknown ones', async () => {
  const fake = createFakeShopify({ brands: BRANDS });
  const ws = await workspace(SAMPLE);
  try {
    const result = await run(live(ws, ['--only', 'tidewell-foam,verdant-latex']), { fake });
    assert.equal(result.code, 0, result.err);
    assert.deepEqual([...fake.state.products.values()].map((product) => product.handle).sort(), ['tidewell-foam', 'verdant-latex']);
    const unknown = await run(dry(ws, ['--only', 'no-such-handle']), { fake });
    assert.equal(unknown.code, 2);
    assert.match(unknown.err, /not in the sheet: no-such-handle/);
  } finally {
    await ws.cleanup();
  }
});

test('related products that live in the same sheet are linked after they are created, and the next run is empty', async () => {
  const csv = edit(SAMPLE, (rows, i) => {
    const kept = rows.filter((entry) => ['cloudmere-firm', 'tidewell-foam'].includes(entry[i.handle]));
    for (const entry of kept) if (entry[i.handle] === 'cloudmere-firm' && entry[i.related_foundations]) entry[i.related_foundations] = 'tidewell-foam';
    return kept;
  });
  const fake = createFakeShopify({ brands: BRANDS });
  const ws = await workspace(csv);
  try {
    const first = await run(live(ws), { fake });
    assert.equal(first.code, 0, first.err);
    const target = byHandle(fake, 'tidewell-foam');
    const firm = byHandle(fake, 'cloudmere-firm');
    assert.equal(firm.metafields.find((item) => item.key === 'related_foundations').value, JSON.stringify([target.id]));
    assert.equal(fake.mutations().filter((call) => call.operationName === 'MetafieldsSet').length, 1, 'one relink call');

    fake.reset();
    const plan = JSON.parse((await run(dry(ws), { fake })).out);
    assert.deepEqual([plan.summary.create, plan.summary.update, plan.summary.unchanged], [0, 0, 2]);
  } finally {
    await ws.cleanup();
  }
});

test('with --publication only approved (ACTIVE) products are published, and re-runs do not republish', async () => {
  const fake = createFakeShopify({ brands: BRANDS });
  const ws = await workspace(SAMPLE);
  const publication = 'gid://shopify/Publication/1';
  try {
    const first = await run(live(ws, ['--publication', publication]), { fake });
    assert.equal(first.code, 0, first.err);
    const products = [...fake.state.products.values()];
    assert.ok(products.filter((product) => product.status === 'ACTIVE').every((product) => product.published));
    assert.ok(products.filter((product) => product.status === 'DRAFT').every((product) => !product.published));
    fake.reset();
    const second = await run(live(ws, ['--publication', publication]), { fake });
    assert.equal(second.code, 0, second.err);
    assert.equal(fake.mutations().length, 0);
  } finally {
    await ws.cleanup();
  }
});

// ---- library level -----------------------------------------------------------------------------------------------

test('planImport refuses failing data and never calls the remote', async () => {
  let called = false;
  const remote = new Proxy(createOfflineRemote(), { get: (target, property) => { called = true; return Reflect.get(target, property); } });
  const plan = await planImport({ csvText: INVALID, remote });
  assert.equal(plan.ok === false && plan.reason, 'validation_failed');
  assert.equal(called, false);
});

test('plan helpers: an all-unchanged plan is empty, tables and JSON omit payloads', async () => {
  const plan = await planImport({ csvText: SAMPLE, remote: createOfflineRemote(), availableImages: null });
  assert.ok(plan.ok);
  assert.equal(isEmptyPlan(plan.summary), false);
  assert.equal(isEmptyPlan({ create: 0, update: 0, unchanged: 5, blocked: 0, uploads: 0, warnings: 3 }), true);
  assert.equal(isEmptyPlan({ create: 0, update: 0, unchanged: 5, blocked: 1, uploads: 0, warnings: 0 }), false);
  assert.match(renderPlanTable(plan.items), /handle\s+action\s+changes\s+uploads/);
  const json = planToJson(plan.items, plan.summary);
  assert.equal('desired' in json.items[0], false);
  assert.equal('remote' in json.items[0], false);
});

test('executePlan on an offline remote records failures instead of throwing', async () => {
  const plan = await planImport({ csvText: SAMPLE, remote: createOfflineRemote(), availableImages: null });
  assert.ok(plan.ok);
  const ws = await workspace(SAMPLE);
  try {
    const manifest = createManifest({ store: FAKE_STORE, apiVersion: '2026-10', sheetName: 'sheet.csv', sheetText: SAMPLE });
    const result = await executePlan({ items: plan.items.slice(0, 2), remote: createOfflineRemote(), manifest, imageDirectory: ws.images });
    assert.equal(result.created.length, 0);
    assert.equal(result.failed.length, 2);
    assert.ok(result.finishedAt);
  } finally {
    await ws.cleanup();
  }
});
