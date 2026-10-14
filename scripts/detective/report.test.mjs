import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EXIT_FAILED, EXIT_OK, EXIT_REFUSED, EXIT_USAGE } from '../lib/cli.mjs';
import { EXIT_UNJUDGED, main, renderReport } from './report.mjs';
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

function orderNode(id, { lines = [lineNode()], zip = '60645', attributes = [{ key: 'delivery_choice', value: 'in-home' }], hasNextPage = false, createdAt = '2026-10-10T12:00:00Z' } = {}) {
  return {
    id: `gid://shopify/Order/${id}`,
    name: `#${id}`,
    createdAt,
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

/**
 * A Shopify Admin that actually orders and pages its orders, so a test can tell WHICH orders a limited run read.
 * Shopify's default direction is oldest first; only `reverse: true` in the query document flips it. Page size and cursor
 * follow the request variables. Order ids are checked by createdAt, not by position in the array.
 */
function orderedShopify(allOrders, overrides = {}) {
  const requests = [];
  const fetchFn = (url, init) => {
    assert.ok(String(url).startsWith(`https://${STORE}/`), 'only the shop host is called');
    const body = JSON.parse(init.body);
    requests.push(body);
    const reverse = /\breverse:\s*true\b/.test(body.query);
    const sorted = [...allOrders].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    if (reverse) sorted.reverse();
    const start = body.variables.after === null ? 0 : Number(body.variables.after);
    const nodes = sorted.slice(start, start + body.variables.first);
    const end = start + nodes.length;
    const page = { pageInfo: { hasNextPage: end < sorted.length, endCursor: String(end) }, nodes };
    return Promise.resolve(new Response(JSON.stringify({ data: { orders: page } })));
  };
  const lines = [];
  const errors = [];
  const env = { SHOPIFY_ADMIN_API_ACCESS_TOKEN: ADMIN_TOKEN, SHOPIFY_ALLOWED_STORES: STORE, OFFER_CONFIG_JSON: OFFER_CONFIG, ...overrides };
  const run = (argv) => main(argv, { env, fetch: fetchFn, out: (t) => lines.push(t), err: (t) => errors.push(t), logWrite: () => {}, now: () => Date.parse('2026-10-14T00:00:00Z'), clock: NO_WAIT });
  return { run, lines, errors, requests, text: () => [...lines, ...errors].join('\n') };
}

/** Five orders, order N placed on October N; the lone violation is on the NEWEST (5) and the OLDEST (1) is clean. */
function fiveDatedOrders() {
  const placed = (id, options = {}) => orderNode(id, { createdAt: `2026-10-0${id}T12:00:00Z`, ...options });
  return [
    placed(3),
    placed(1),
    placed(5, { lines: [lineNode(), haul(2, 9)] }),
    placed(2),
    placed(4),
  ];
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
  assert.equal(await h.run(base), EXIT_UNJUDGED);
  assert.match(h.text(), /0 with violations, 2 not judged/);
  assert.match(h.text(), /order_unreadable=2/);
});

test('an order with protection is counted as not judged for price and plan, never clean, and the report says what was not checked', async () => {
  const mattress = { ...lineNode({ id: 1 }), product: { id: 'gid://shopify/Product/501', metafield: { value: 'mattress' } }, originalUnitPriceSet: money('2000.00') };
  // A $5 price point on a $2,000 mattress passes every structural check; only Extend's quote would catch it.
  const cheapCoverage = {
    ...lineNode({ id: 2, product: 'gid://shopify/Product/900', variant: 'gid://shopify/ProductVariant/900' }),
    sku: 'Extend-Protection-Plan-5.00',
    originalUnitPriceSet: money('5.00'),
    customAttributes: [
      { key: '_extend_plan_id', value: 'MOCK-MATT-ADH-3Y-C' },
      { key: '_extend_covered_product_id', value: '501' },
    ],
  };
  const h = harness([{ nodes: [orderNode(1, { lines: [mattress, cheapCoverage] }), orderNode(2)] }]);
  assert.equal(await h.run([...base, '--json']), EXIT_UNJUDGED, h.text());
  const { report } = JSON.parse(h.lines.join('\n'));
  assert.equal(report.counts.clean, 1, 'only the order with no protection is clean');
  assert.equal(report.counts.unjudgeable, 1);
  assert.deepEqual(report.unjudgedByReason, [{ reason: 'coverage_price_unjudged', orders: 1 }]);
  assert.deepEqual(report.findings.map((f) => [f.orderId, f.unjudged]), [['1', ['coverage_price_unjudged']]]);

  const text = harness([{ nodes: [orderNode(1, { lines: [mattress, cheapCoverage] })] }]);
  await text.run(base);
  assert.match(text.text(), /not judged: coverage_price_unjudged=1/);
  assert.match(text.text(), /price and plan were NOT compared with Extend/);
  assert.match(text.text(), /Result: no violation found, but some orders could not be fully judged \(exit 4\)/);
});

/** A protected order (structurally fine, price never judged) and helpers for the exit-code tests. */
function protectedLines() {
  const mattress = { ...lineNode({ id: 1 }), product: { id: 'gid://shopify/Product/501', metafield: { value: 'mattress' } } };
  const coverage = {
    ...lineNode({ id: 2, product: 'gid://shopify/Product/900', variant: 'gid://shopify/ProductVariant/900' }),
    sku: 'Extend-Protection-Plan-79.99',
    customAttributes: [
      { key: '_extend_plan_id', value: 'MOCK-MATT-ADH-3Y-C' },
      { key: '_extend_covered_product_id', value: '501' },
    ],
  };
  return [mattress, coverage];
}

test('exit codes: 1 is only for a violation, 4 only for "could not judge", and a violation wins over unjudged noise', async () => {
  // Only unjudged: 4, not 1.
  const onlyUnjudged = harness([{ nodes: [orderNode(1, { lines: protectedLines() })] }]);
  assert.equal(await onlyUnjudged.run(base), EXIT_UNJUDGED);

  // A violation (order 3) beside an unjudged order (order 1): 1.
  const both = harness([{ nodes: [orderNode(1, { lines: protectedLines() }), orderNode(3, { lines: [lineNode(), haul(2, 9)] })] }]);
  assert.equal(await both.run([...base, '--json']), EXIT_FAILED, both.text());
  const document = JSON.parse(both.lines.join('\n'));
  assert.equal(document.outcome, 'violations');
  assert.equal(document.report.counts.violations, 1);
  assert.equal(document.report.counts.unjudgeable, 1);

  // A single order with both a violation and the unjudged note: 1.
  const mixed = harness([{ nodes: [orderNode(4, { lines: [...protectedLines(), haul(3, 9)] })] }]);
  assert.equal(await mixed.run(base), EXIT_FAILED);
  assert.match(mixed.text(), /haul-away-over-max/);
  assert.match(mixed.text(), /Result: VIOLATIONS found \(exit 1\)/);
});

test('--accept-unjudged coverage_price_unjudged: that reason alone stops raising 4, is echoed and still counted; violations still exit 1', async () => {
  const flag = [...base, '--accept-unjudged', 'coverage_price_unjudged'];
  const accepted = harness([{ nodes: [orderNode(1, { lines: protectedLines() }), orderNode(2)] }]);
  assert.equal(await accepted.run([...flag, '--json']), EXIT_OK, accepted.text());
  const document = JSON.parse(accepted.lines.join('\n'));
  assert.deepEqual(document.acceptedUnjudged, ['coverage_price_unjudged']);
  assert.equal(document.outcome, 'clean');
  assert.deepEqual(document.report.unjudgedByReason, [{ reason: 'coverage_price_unjudged', orders: 1 }], 'still counted, not hidden');

  const text = harness([{ nodes: [orderNode(1, { lines: protectedLines() })] }]);
  assert.equal(await text.run(flag), EXIT_OK);
  assert.match(text.text(), /accepted by --accept-unjudged .*: coverage_price_unjudged/);
  assert.match(text.text(), /not judged: coverage_price_unjudged=1/);

  // Another unjudged reason is not covered by the acceptance.
  const other = harness([{ nodes: [orderNode(1, { lines: protectedLines() }), { id: 'gid://shopify/Order/9', lineItems: 'garbage' }] }]);
  assert.equal(await other.run(flag), EXIT_UNJUDGED);

  // A violation is never accepted away.
  const violation = harness([{ nodes: [orderNode(1, { lines: protectedLines() }), orderNode(3, { lines: [lineNode(), haul(2, 9)] })] }]);
  assert.equal(await violation.run(flag), EXIT_FAILED);
});

test('--accept-unjudged takes only reasons that are limits of the check, never faults', async () => {
  for (const reason of ['order_unreadable', 'rules_unavailable', 'nonsense']) {
    const h = harness([]);
    assert.equal(await h.run([...base, '--accept-unjudged', reason]), EXIT_USAGE, reason);
    assert.equal(h.requests.length, 0);
  }
  const comma = harness([{ nodes: [orderNode(1)] }]);
  assert.equal(await comma.run([...base, '--accept-unjudged', 'coverage_price_unjudged,coverage_price_unjudged']), EXIT_OK);
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
  assert.match(h.text(), /The limit of 1 orders was reached\. The 1 newest orders created since 2026-10-01 were checked; the older orders in that window were NOT checked/);
  assert.equal(h.requests.length, 1);
});

test('when the limit cuts the read short, the NEWEST orders are the ones checked and the oldest are dropped', async () => {
  // Order 5 (newest) holds the only violation. Read oldest-first with limit 2, the run would check orders 1 and 2, report
  // "clean", and say older orders were skipped when the opposite was true.
  const h = orderedShopify(fiveDatedOrders());
  assert.equal(await h.run([...base, '--limit', '2', '--json']), EXIT_FAILED, h.text());
  const document = JSON.parse(h.lines.join('\n'));
  assert.equal(document.truncated, true);
  assert.equal(document.limit, 2);
  assert.equal(document.order, 'newest_first');
  assert.equal(document.report.checkedOrders, 2);
  assert.deepEqual(document.report.findings.map((f) => f.orderId), ['5'], 'the newest order must be judged');
  assert.deepEqual(document.report.findings[0].violations.map((v) => v.code), ['haul-away-over-max']);
  for (const request of h.requests) assert.match(request.query, /sortKey: CREATED_AT, reverse: true/);
});

test('the truncation message names which orders were skipped (the older ones) and how many were checked', async () => {
  const h = orderedShopify(fiveDatedOrders());
  await h.run([...base, '--limit', '3']);
  assert.match(h.text(), /Checked 3 Shopify orders/);
  assert.match(h.text(), /The 3 newest orders created since 2026-10-01 were checked; the older orders in that window were NOT checked\./);
  assert.ok(!/newer orders/.test(h.text()));
});

test('a limit that covers the whole window is not truncated and checks every order, the oldest included', async () => {
  const h = orderedShopify(fiveDatedOrders());
  assert.equal(await h.run([...base, '--limit', '5', '--json']), EXIT_FAILED);
  const document = JSON.parse(h.lines.join('\n'));
  assert.equal(document.truncated, false);
  assert.equal(document.report.checkedOrders, 5);
  assert.deepEqual(document.report.findings.map((f) => f.orderId), ['5']);
  assert.ok(!/NOT checked/.test(h.text()));
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
  const text = renderReport({ checkedOrders: 0, counts: { clean: 0, violations: 0, unjudgeable: 0 }, byCode: [], unjudgedByReason: [], findings: [], clean: true }, { truncated: false, warnings: ['zone: ignored, invalid'], limit: 200, since: '2026-10-01' });
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
