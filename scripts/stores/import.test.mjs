// End-to-end tests of the store importer through main(), against an in-memory fake of the two Admin calls it makes,
// served through an injected fetch. No network, no token, no store. They prove the safety properties (guards, no write
// without --live, no import on a bad sheet, nothing deleted, token never printed) and idempotency.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FAKE_STORE, FAKE_TOKEN } from '../lib/testing/fake-shopify.mjs';
import { main, planImport } from './import.mjs';
import { createOfflineRemote, createShopifyRemote } from './remote.mjs';
import { createAdminClient } from '../lib/shopify-admin.mjs';
import { GOOD, sheet } from './test-helpers.mjs';

const TWO = sheet([GOOD, { ...GOOD, slug: 'test-store-two', name: 'Test Store Two', address_line_1: '2 Test Road', phone: '312-555-0102' }]);
const baseEnv = () => ({ SHOPIFY_STORE_DOMAIN: FAKE_STORE, SHOPIFY_ALLOWED_STORES: FAKE_STORE, SHOPIFY_ADMIN_API_ACCESS_TOKEN: FAKE_TOKEN });

/** Sleeps cost nothing but still advance time, so retries never slow the suite. */
function fastClock() {
  let now = 1_000_000;
  return { now: () => now, sleep: async (/** @type {number} */ ms) => { now += ms; } };
}

/**
 * @param {{ entries?: { handle: string, fields: Record<string, string> }[], failUpsertFor?: string[], listStatus?: number }} [options]
 */
function createFake({ entries = [], failUpsertFor = [], listStatus = 200 } = {}) {
  let counter = 0;
  /** @type {Map<string, { id: string, fields: Record<string, string> }>} */
  const stored = new Map(entries.map((entry) => [entry.handle, { id: `gid://shopify/Metaobject/${(counter += 1)}`, fields: { ...entry.fields } }]));
  /** @type {{ url: string, token: string | null, query: string, variables: any, kind: 'query' | 'mutation' }[]} */
  const calls = [];
  const fetch = async (/** @type {string} */ url, /** @type {RequestInit} */ init) => {
    const body = JSON.parse(String(init.body));
    const headers = /** @type {Record<string, string>} */ (init.headers);
    const kind = /\bmutation\b/.test(body.query) ? 'mutation' : 'query';
    calls.push({ url, token: headers['X-Shopify-Access-Token'] ?? null, query: body.query, variables: body.variables, kind });
    const json = (/** @type {unknown} */ data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
    if (kind === 'query') {
      if (listStatus !== 200) return json({}, listStatus);
      return json({
        data: { metaobjects: { nodes: [...stored].map(([handle, entry]) => ({ id: entry.id, handle, fields: Object.entries(entry.fields).map(([key, value]) => ({ key, value })) })), pageInfo: { hasNextPage: false, endCursor: null } } },
      });
    }
    const { handle, type } = body.variables.handle;
    assert.equal(type, 'store');
    if (failUpsertFor.includes(handle)) {
      return json({ data: { metaobjectUpsert: { metaobject: null, userErrors: [{ field: ['metaobject'], message: 'Simulated rejection', code: 'INVALID' }] } } });
    }
    const entry = stored.get(handle) ?? { id: `gid://shopify/Metaobject/${(counter += 1)}`, fields: {} };
    for (const { key, value } of body.variables.metaobject.fields) entry.fields[key] = value;
    stored.set(handle, entry);
    return json({ data: { metaobjectUpsert: { metaobject: { id: entry.id, handle }, userErrors: [] } } });
  };
  return { fetch, calls, stored, mutations: () => calls.filter((call) => call.kind === 'mutation'), reads: () => calls.filter((call) => call.kind === 'query') };
}

async function run(/** @type {string[]} */ args, /** @type {Record<string, string | undefined>} */ env, /** @type {ReturnType<typeof createFake>} */ fake, /** @type {string} */ csv = TWO) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'stores-test-'));
  try {
    const file = path.join(dir, 'stores.csv');
    await writeFile(file, csv);
    /** @type {string[]} */ const out = [];
    /** @type {string[]} */ const err = [];
    const code = await main([file, ...args], env, { out: (text) => out.push(text), err: (text) => err.push(text), fetch: /** @type {typeof globalThis.fetch} */ (/** @type {unknown} */ (fake.fetch)), clock: fastClock(), maxAttempts: 2 });
    return { code, out: out.join('\n'), err: err.join('\n') };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('--check validates without any store, token or network', async () => {
  const fake = createFake();
  const good = await run(['--check'], {}, fake);
  assert.equal(good.code, 0);
  assert.match(good.out, /OK: 2 store/);
  const bad = await run(['--check'], {}, fake, sheet([{ ...GOOD, state: 'Nope' }]));
  assert.equal(bad.code, 1);
  assert.match(bad.out, /row 2 \[state\]/);
  assert.equal(fake.calls.length, 0);
});

test('--offline plans every row as a create and sends nothing', async () => {
  const fake = createFake();
  const result = await run(['--offline'], {}, fake);
  assert.equal(result.code, 0);
  assert.match(result.out, /2 to create, 0 to update/);
  assert.equal(fake.calls.length, 0);
});

test('the default is a dry run: the store is read, never written', async () => {
  const fake = createFake();
  const result = await run([], baseEnv(), fake);
  assert.equal(result.code, 0);
  assert.match(result.out, /DRY RUN \(the store was only read\)/);
  assert.equal(fake.mutations().length, 0);
  assert.equal(fake.reads().length, 1);
  assert.equal(fake.stored.size, 0);
});

test('guards: a store that is not allow-listed, a missing list or a missing token are refused before any call', async () => {
  for (const [label, env, args] of /** @type {[string, Record<string, string | undefined>, string[]][]} */ ([
    ['not listed', { ...baseEnv(), SHOPIFY_ALLOWED_STORES: 'other-shop.myshopify.com' }, ['--live']],
    ['empty list', { ...baseEnv(), SHOPIFY_ALLOWED_STORES: '' }, ['--live']],
    ['no store', { SHOPIFY_ALLOWED_STORES: FAKE_STORE, SHOPIFY_ADMIN_API_ACCESS_TOKEN: FAKE_TOKEN }, ['--live']],
    ['custom domain', { ...baseEnv(), SHOPIFY_STORE_DOMAIN: 'shop.example.com' }, []],
    ['no token', { SHOPIFY_STORE_DOMAIN: FAKE_STORE, SHOPIFY_ALLOWED_STORES: FAKE_STORE }, ['--live']],
  ])) {
    const fake = createFake();
    const result = await run(args, env, fake);
    assert.equal(result.code, 3, label);
    assert.equal(fake.calls.length, 0, label);
  }
});

test('the store may come from $STORE, which with-admin-token.sh exports', async () => {
  const fake = createFake();
  const env = { STORE: FAKE_STORE, SHOPIFY_ALLOWED_STORES: FAKE_STORE, SHOPIFY_ADMIN_API_ACCESS_TOKEN: FAKE_TOKEN };
  const result = await run([], env, fake);
  assert.equal(result.code, 0);
  assert.equal(fake.reads()[0].url, `https://${FAKE_STORE}/admin/api/2026-10/graphql.json`);
});

test('--live creates the entries, and a second run is an empty plan (idempotent)', async () => {
  const fake = createFake();
  const first = await run(['--live'], baseEnv(), fake);
  assert.equal(first.code, 0, first.err);
  assert.match(first.out, /Done: 2 created, 0 updated, 0 failed/);
  assert.equal(fake.mutations().length, 2);
  assert.deepEqual([...fake.stored.keys()].sort(), ['test-store-one', 'test-store-two']);
  assert.equal(fake.stored.get('test-store-one')?.fields.state, 'IL');

  const second = await run(['--live'], baseEnv(), fake);
  assert.equal(second.code, 0);
  assert.match(second.out, /0 to create, 0 to update, 2 unchanged/);
  assert.match(second.out, /Nothing to do/);
  assert.equal(fake.mutations().length, 2, 'no new writes on the second run');
});

test('a changed cell updates only that field; a blank cell never erases', async () => {
  const fake = createFake();
  await run(['--live'], baseEnv(), fake);
  const before = fake.mutations().length;
  const changed = sheet([{ ...GOOD, city: 'Newtown', phone: '' }, { ...GOOD, slug: 'test-store-two', name: 'Test Store Two', address_line_1: '2 Test Road', phone: '312-555-0102' }]);
  const result = await run(['--live'], baseEnv(), fake, changed);
  assert.equal(result.code, 0);
  assert.match(result.out, /0 to create, 1 to update, 1 unchanged/);
  assert.match(result.out, /left as it is: phone/);
  const writes = fake.mutations().slice(before);
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].variables.metaobject.fields, [{ key: 'city', value: 'Newtown' }]);
  assert.equal(fake.stored.get('test-store-one')?.fields.phone, '(312) 555-0101');
});

test('entries in Shopify that are not in the sheet are reported and never touched', async () => {
  const fake = createFake({ entries: [{ handle: 'manual-store', fields: { name: 'Typed in admin', slug: 'manual-store' } }] });
  const result = await run(['--live'], baseEnv(), fake);
  assert.equal(result.code, 0);
  assert.match(result.out, /1 store entry is in Shopify but not in the sheet.*manual-store/);
  assert.deepEqual(fake.mutations().map((call) => call.variables.handle.handle).sort(), ['test-store-one', 'test-store-two']);
  assert.equal(fake.stored.get('manual-store')?.fields.name, 'Typed in admin');
});

test('another entry with the same slug blocks that store and nothing is written for it', async () => {
  const fake = createFake({ entries: [{ handle: 'older-entry', fields: { slug: 'test-store-one' } }] });
  const result = await run(['--live'], baseEnv(), fake);
  assert.equal(result.code, 1);
  assert.match(result.out, /BLOCKED test-store-one: .*older-entry/);
  assert.deepEqual(fake.mutations().map((call) => call.variables.handle.handle), ['test-store-two']);
});

test('a sheet with errors imports nothing, even with --live, and lists every error', async () => {
  const fake = createFake();
  const bad = sheet([{ ...GOOD, postal_code: '12' }, { ...GOOD, slug: 'ok-store', time_zone: 'EST' }]);
  const result = await run(['--live'], baseEnv(), fake, bad);
  assert.equal(result.code, 1);
  assert.match(result.err, /row 2 \[postal_code\]/);
  assert.match(result.err, /row 3 \[time_zone\]/);
  assert.equal(fake.calls.length, 0);
});

test('one rejected store does not stop the others; a rerun retries only the failed one', async () => {
  const failing = createFake({ failUpsertFor: ['test-store-one'] });
  const first = await run(['--live'], baseEnv(), failing);
  assert.equal(first.code, 1);
  assert.match(first.err, /FAILED test-store-one: .*Simulated rejection/);
  assert.match(first.out, /Done: 1 created, 0 updated, 1 failed/);
  assert.deepEqual([...failing.stored.keys()], ['test-store-two']);

  const healthy = createFake({ entries: [{ handle: 'test-store-two', fields: { ...failing.stored.get('test-store-two')?.fields } }] });
  const rerun = await run(['--live'], baseEnv(), healthy);
  assert.equal(rerun.code, 0);
  assert.deepEqual(healthy.mutations().map((call) => call.variables.handle.handle), ['test-store-one']);
});

test('when Shopify cannot be read nothing is planned or written', async () => {
  const denied = createFake({ listStatus: 403 });
  const result = await run(['--live'], baseEnv(), denied);
  assert.equal(result.code, 1);
  assert.match(result.err, /Could not read the store.*refused the credentials/);
  assert.equal(denied.mutations().length, 0);

  const down = createFake({ listStatus: 500 });
  const outage = await run(['--live'], baseEnv(), down);
  assert.equal(outage.code, 1);
  assert.equal(down.mutations().length, 0);
});

test('--only restricts the run; an unknown slug is a usage error', async () => {
  const fake = createFake();
  const some = await run(['--live', '--only', 'test-store-two'], baseEnv(), fake);
  assert.equal(some.code, 0);
  assert.deepEqual(fake.mutations().map((call) => call.variables.handle.handle), ['test-store-two']);
  const unknown = await run(['--only', 'nope'], baseEnv(), createFake());
  assert.equal(unknown.code, 2);
});

test('bad flags and a missing file are usage errors', async () => {
  const fake = createFake();
  assert.equal((await run(['--bogus'], baseEnv(), fake)).code, 2);
  assert.equal((await run(['--live', '--offline'], baseEnv(), fake)).code, 2);
  assert.equal(await main(['/definitely/not/here.csv', '--offline'], {}, { out() {}, err() {} }), 2);
});

test('the token goes only to the allow-listed https host and never into any output', async () => {
  const fake = createFake({ failUpsertFor: ['test-store-one'] });
  const result = await run(['--live'], baseEnv(), fake);
  assert.ok(fake.calls.length > 0);
  for (const call of fake.calls) {
    assert.equal(call.url, `https://${FAKE_STORE}/admin/api/2026-10/graphql.json`);
    assert.equal(call.token, FAKE_TOKEN);
  }
  assert.equal(`${result.out}\n${result.err}`.includes(FAKE_TOKEN), false);
});

test('planImport with the offline remote and the read-only client behave as documented', async () => {
  const plan = await planImport({ csvText: TWO, remote: createOfflineRemote() });
  assert.ok(plan.ok);
  assert.deepEqual(plan.summary, { create: 2, update: 0, unchanged: 0, blocked: 0 });
  assert.equal((await createOfflineRemote().upsertStore('x', [])).ok, false);

  // A client built without allowMutations refuses the write itself, whatever the caller does.
  const fake = createFake();
  const client = createAdminClient({ store: FAKE_STORE, token: FAKE_TOKEN, fetch: /** @type {typeof globalThis.fetch} */ (/** @type {unknown} */ (fake.fetch)), clock: fastClock() });
  const refused = await createShopifyRemote(client).upsertStore('test-store-one', [{ key: 'name', value: 'x' }]);
  assert.equal(refused.ok, false);
  assert.equal(fake.calls.length, 0);
});
