import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EXIT_FAILED, EXIT_OK, EXIT_REFUSED, EXIT_USAGE } from '../lib/cli.mjs';
import { main, renderReport } from './report.mjs';
import { loadDetectiveLibs } from './ts-loader.mjs';

// P5B-05 / ADR-0006 / E-M3 / REQ-PRE-003 / REQ-PROMO-003: the report judges recent Shopify orders with the storefront's own
// detective check. Shopify is scripted; the checks are the real TypeScript, loaded the way the script loads them.

const STORE = 'test-shop.myshopify.com';
const ADMIN_TOKEN = 'admin-token-fixture-not-real';
const PII = ['Jane Q. Testwell', 'jane.testwell@example.test', '1 Fixture Way', '90210'];
const OFFER_CONFIG = JSON.stringify({
  rules: {
    haulAway: { variantId: 'gid://shopify/ProductVariant/621', maxPieces: 3 },
    gifts: [
      {
        id: 'gift-pillows',
        name: 'Free pillow',
        qualifyingProductIds: ['gid://shopify/Product/501'],
        giftVariantIdsBySize: { Standard: 'gid://shopify/ProductVariant/631' },
        maxQuantity: 1,
      },
    ],
  },
  zone: { name: 'Metro', postalCodes: '606*', feeCents: 14900 },
});

/** The Admin client waits for its cost bucket to refill; tests must not. */
const NO_WAIT = { now: () => 0, sleep: () => Promise.resolve() };

const money = (amount) => ({ shopMoney: { amount, currencyCode: 'USD' } });

function lineNode({ id = 1, product = 'gid://shopify/Product/501', variant = 'gid://shopify/ProductVariant/601', quantity = 1, title = 'Test item' } = {}) {
  return {
    id: `gid://shopify/LineItem/${id}`,
    title: `${title} ${PII[0]}`,
    variantTitle: null,
    sku: null,
    quantity,
    currentQuantity: quantity,
    originalUnitPriceSet: money('100.00'),
    customAttributes: [{ key: 'note', value: PII[1] }],
    product: { id: product, metafield: null },
    variant: { id: variant, selectedOptions: [{ name: 'Size', value: 'Queen' }] },
  };
}

const haul = (id, quantity) => lineNode({ id, product: 'gid://shopify/Product/520', variant: 'gid://shopify/ProductVariant/621', quantity });

function orderNode(id, { lines = [lineNode()], zip = '60645', attributes = [{ key: 'delivery_choice', value: 'in-home' }], hasNextPage = false } = {}) {
  return {
    id: `gid://shopify/Order/${id}`,
    name: `#${id}`,
    createdAt: '2026-10-10T12:00:00Z',
    cancelledAt: null,
    currencyCode: 'USD',
    displayFinancialStatus: 'PAID',
    totalPriceSet: money('100.00'),
    customAttributes: [...attributes, { key: 'note', value: PII[2] }],
    shippingAddress: zip === null ? null : { countryCodeV2: 'US', zip },
    lineItems: { pageInfo: { hasNextPage }, nodes: lines },
  };
}

/** Shopify Admin scripted as pages of order nodes; every request body is kept. */
function harness(pages, overrides = {}) {
  const requests = [];
  const queue = [...pages];
  const fetchFn = (url, init) => {
    assert.ok(String(url).startsWith(`https://${STORE}/`), 'only the shop host is called');
    const body = JSON.parse(init.body);
    requests.push(body);
    const next = queue.shift();
    if (next === undefined) return Promise.resolve(new Response(JSON.stringify({ data: { orders: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } } })));
    if (next.error) return Promise.resolve(new Response(JSON.stringify({ errors: [{ message: 'Query cost is too high', extensions: { code: 'MAX_COST_EXCEEDED' } }] })));
    return Promise.resolve(new Response(JSON.stringify({ data: { orders: { pageInfo: { hasNextPage: next.cursor !== undefined, endCursor: next.cursor ?? null }, nodes: next.nodes } } })));
  };
  const lines = [];
  const errors = [];
  const env = { SHOPIFY_ADMIN_API_ACCESS_TOKEN: ADMIN_TOKEN, SHOPIFY_ALLOWED_STORES: STORE, OFFER_CONFIG_JSON: OFFER_CONFIG, ...overrides };
  const run = (argv) => main(argv, { env, fetch: fetchFn, out: (t) => lines.push(t), err: (t) => errors.push(t), logWrite: () => {}, now: () => Date.parse('2026-10-14T00:00:00Z'), clock: NO_WAIT });
  return { run, lines, errors, requests, text: () => [...lines, ...errors].join('\n') };
}

const base = ['--store', STORE, '--since', '2026-10-01'];

test('reports a haul-away order delivered outside the zone, by id and code, with no customer data', async () => {
  const h = harness([{ nodes: [orderNode(1), orderNode(2, { lines: [lineNode(), haul(2, 1)], zip: '90210' })] }]);
  assert.equal(await h.run(base), EXIT_FAILED);
  assert.match(h.text(), /Checked 2 Shopify orders: 1 clean, 1 with violations, 0 not judged/);
  assert.match(h.text(), /haul-away-outside-zone=1/);
  assert.match(h.text(), /\b2\s+violations\s+haul-away-outside-zone/);
  for (const value of PII) assert.ok(!h.text().includes(value), `report must not contain ${value}`);
  assert.ok(!h.text().includes(ADMIN_TOKEN));
});

test('an all-clean window exits 0', async () => {
  const h = harness([{ nodes: [orderNode(1), orderNode(2, { lines: [lineNode(), haul(2, 3)] })] }]);
  assert.equal(await h.run(base), EXIT_OK, h.text());
  assert.match(h.text(), /2 clean, 0 with violations, 0 not judged/);
});

test('an order that cannot be read completely is counted as not judged and the run is not clean', async () => {
  const h = harness([{ nodes: [orderNode(1), orderNode(2, { hasNextPage: true }), { id: 'gid://shopify/Order/3', lineItems: 'garbage' }, 'not an object'] }]);
  assert.equal(await h.run(base), EXIT_FAILED);
  assert.match(h.text(), /0 with violations, 2 not judged/);
  assert.match(h.text(), /order_unreadable=2/);
});

test('missing delivery attribute, pickup and an over-limit quantity each get their own code', async () => {
  const h = harness([
    {
      nodes: [
        orderNode(1, { lines: [lineNode(), haul(2, 1)], attributes: [] }),
        orderNode(2, { lines: [lineNode(), haul(2, 1)], attributes: [{ key: 'delivery_choice', value: 'pickup' }] }),
        orderNode(3, { lines: [lineNode(), haul(2, 5)] }),
        orderNode(4, { lines: [lineNode({ product: 'gid://shopify/Product/8', variant: 'gid://shopify/ProductVariant/602' }), lineNode({ id: 3, product: 'gid://shopify/Product/9', variant: 'gid://shopify/ProductVariant/631' })] }),
      ],
    },
  ]);
  await h.run([...base, '--json']);
  const { report } = JSON.parse(h.lines.join('\n'));
  const byOrder = Object.fromEntries(report.findings.map((f) => [f.orderId, f.violations.map((v) => v.code)]));
  assert.deepEqual(byOrder, {
    1: ['haul-away-delivery-not-recorded'],
    2: ['haul-away-pickup'],
    3: ['haul-away-over-max'],
    4: ['gift-without-qualifier'],
  });
});

test('reads only: no mutation is ever sent, the token goes in the header only, and pages follow the cursor', async () => {
  const h = harness([{ cursor: 'c1', nodes: [orderNode(1)] }, { nodes: [orderNode(2)] }]);
  assert.equal(await h.run(base), EXIT_OK, h.text());
  assert.equal(h.requests.length, 2);
  assert.equal(h.requests[1].variables.after, 'c1');
  assert.equal(h.requests[0].variables.query, 'created_at:>=2026-10-01');
  for (const request of h.requests) {
    assert.ok(!/\bmutation\b/.test(request.query));
    assert.equal(request.operationName, 'DetectiveOrdersPage');
    assert.ok(!JSON.stringify(request).includes(ADMIN_TOKEN));
  }
});

test('the limit stops the read and says older orders were not checked', async () => {
  const h = harness([{ cursor: 'c1', nodes: [orderNode(1), orderNode(2)] }, { nodes: [orderNode(3)] }]);
  assert.equal(await h.run([...base, '--limit', '1']), EXIT_OK);
  assert.match(h.text(), /Checked 1 Shopify orders/);
  assert.match(h.text(), /order limit was reached/);
  assert.equal(h.requests.length, 1);
});

test('if Shopify rejects the query cost, the page size drops to one order and the same page is asked again', async () => {
  const h = harness([{ error: true }, { nodes: [orderNode(1)] }]);
  assert.equal(await h.run(base), EXIT_OK, h.text());
  assert.equal(h.requests.length, 2);
  assert.ok(h.requests[0].variables.first > 1);
  assert.equal(h.requests[1].variables.first, 1);
  assert.equal(h.requests[1].variables.after, null);
});

test('a cost failure that persists at one order is reported as a failed read, not as a clean window', async () => {
  const h = harness([{ error: true }, { error: true }]);
  assert.equal(await h.run(base), EXIT_FAILED);
  assert.match(h.text(), /Shopify read failed/);
});

test('--out writes the same ids-and-codes report to a new file and never overwrites one', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'detective-report-'));
  try {
    const file = path.join(dir, 'report.json');
    const h = harness([{ nodes: [orderNode(2, { lines: [lineNode(), haul(2, 9)], zip: '90210' })] }]);
    assert.equal(await h.run([...base, '--out', file]), EXIT_FAILED);
    const written = await readFile(file, 'utf8');
    const parsed = JSON.parse(written);
    assert.equal(parsed.store, STORE);
    assert.equal(parsed.report.findings[0].orderId, '2');
    for (const value of PII) assert.ok(!written.includes(value), `file must not contain ${value}`);
    assert.ok(!written.includes(ADMIN_TOKEN));

    const again = harness([{ nodes: [orderNode(1)] }]);
    assert.equal(await again.run([...base, '--out', file]), EXIT_USAGE);
    assert.equal(JSON.parse(await readFile(file, 'utf8')).report.findings[0].orderId, '2');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('offer rules can come from a file; a missing, unreadable or invalid configuration stops the run before any Shopify call', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'detective-rules-'));
  try {
    const file = path.join(dir, 'offers.json');
    await writeFile(file, OFFER_CONFIG);
    const fromFile = harness([{ nodes: [orderNode(2, { lines: [lineNode(), haul(2, 9)] })] }], { OFFER_CONFIG_JSON: '' });
    assert.equal(await fromFile.run([...base, '--offer-config-file', file]), EXIT_FAILED);
    assert.match(fromFile.text(), /haul-away-over-max/);

    const none = harness([], { OFFER_CONFIG_JSON: '' });
    assert.equal(await none.run(base), EXIT_USAGE);
    assert.match(none.text(), /No offer rules/);
    assert.equal(none.requests.length, 0);

    const invalid = harness([], { OFFER_CONFIG_JSON: '[1,2]' });
    assert.equal(await invalid.run(base), EXIT_USAGE);
    assert.equal(invalid.requests.length, 0);

    const notJson = harness([], { OFFER_CONFIG_JSON: '{nope' });
    assert.equal(await notJson.run(base), EXIT_USAGE);

    const missingFile = harness([]);
    assert.equal(await missingFile.run([...base, '--offer-config-file', path.join(dir, 'absent.json')]), EXIT_USAGE);
    assert.equal(missingFile.requests.length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('guards: unknown store, empty allow-list, missing token, bad limit, bad date and unknown flag', async () => {
  const other = harness([]);
  assert.equal(await other.run(['--store', 'other.myshopify.com']), EXIT_REFUSED);
  assert.equal(await harness([], { SHOPIFY_ALLOWED_STORES: '' }).run(base), EXIT_REFUSED);
  assert.equal(await harness([], { SHOPIFY_ADMIN_API_ACCESS_TOKEN: '' }).run(base), EXIT_USAGE);
  assert.equal(await harness([]).run([...base, '--limit', '0']), EXIT_USAGE);
  assert.equal(await harness([]).run([...base, '--limit', '5000']), EXIT_USAGE);
  assert.equal(await harness([]).run(['--store', STORE, '--since', 'yesterday']), EXIT_USAGE);
  assert.equal(await harness([]).run([...base, '--bogus']), EXIT_USAGE);
  assert.equal(await harness([]).run(['--help']), EXIT_OK);
  assert.equal(other.requests.length, 0);
});

test('renderReport lists a clean window and the caveat about what the delivery method means', () => {
  const text = renderReport({ checkedOrders: 0, counts: { clean: 0, violations: 0, unjudgeable: 0 }, byCode: [], unjudgedByReason: [], findings: [], clean: true }, { truncated: false, warnings: ['zone: ignored, invalid'] });
  assert.match(text, /Checked 0 Shopify orders/);
  assert.match(text, /offer rules: zone: ignored, invalid/);
  assert.match(text, /shopper-writable claim/);
});

test('the script and the webhook share one implementation: the loader exposes the storefront functions', async () => {
  const libs = await loadDetectiveLibs();
  assert.equal(typeof libs.detectWithConfig, 'function');
  assert.equal(libs.DETECTIVE_ORDERS_PAGE_SIZE, 2);
  assert.match(libs.DETECTIVE_ORDERS_PAGE_QUERY, /fragment DetectiveOrderFields/);
  assert.equal(libs.normalizeShopifyId('gid://shopify/Order/9'), '9');
});
