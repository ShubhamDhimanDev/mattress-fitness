import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startMock } from '../mocks/extend-mock.mjs';
import { EXIT_FAILED, EXIT_OK, EXIT_REFUSED, EXIT_USAGE } from '../lib/cli.mjs';
import { main, readStoredOrders, renderReport } from './reconcile.mjs';

// P5A-14 / P5A-10 / REQ-EXT-003 / T-06: Shopify orders with coverage versus Extend's copy, against the local MOCK.
// A pass here proves our script does what we think the docs say; it is not evidence of Extend's behaviour (ADR-0009).

const STORE = 'test-shop.myshopify.com';
const TOKEN = 'extend-token-fixture-not-real';
const ADMIN_TOKEN = 'admin-token-fixture-not-real';
const PLAN = 'MOCK-MATT-ADH-3Y-C';
const PII = ['jane.testwell@example.test', 'Jane Q. Testwell', '1 Fixture Way'];

const money = (amount) => ({ shopMoney: { amount, currencyCode: 'USD' } });
const address = () => ({ name: PII[1], phone: null, address1: PII[2], address2: null, city: 'Testville', countryCodeV2: 'US', zip: '99999', province: 'California', provinceCode: 'CA' });

function orderNode({ id = '7001', unfulfilled = 1, planPrice = '79.99', status = 'PAID' } = {}) {
  return {
    id: `gid://shopify/Order/${id}`,
    name: '#1001',
    createdAt: '2026-10-10T12:00:00Z',
    cancelledAt: null,
    currencyCode: 'USD',
    displayFinancialStatus: status,
    email: PII[0],
    phone: null,
    totalPriceSet: money('1378.99'),
    billingAddress: address(),
    shippingAddress: address(),
    lineItems: {
      pageInfo: { hasNextPage: false },
      nodes: [
        { id: `gid://shopify/LineItem/${id}1`, title: 'Test Hybrid Mattress', variantTitle: 'Queen', sku: 'MATT', quantity: 1, currentQuantity: 1, unfulfilledQuantity: unfulfilled, originalUnitPriceSet: money('1299.00'), discountedUnitPriceSet: money('1299.00'), customAttributes: [], product: { id: 'gid://shopify/Product/501', metafield: { value: 'mattress' } }, variant: { id: 'gid://shopify/ProductVariant/601' } },
        { id: `gid://shopify/LineItem/${id}2`, title: 'Extend Protection Plan', variantTitle: 'Extend-Protection-Plan-79.99', sku: 'Extend-Protection-Plan-79.99', quantity: 1, currentQuantity: 1, unfulfilledQuantity: unfulfilled, originalUnitPriceSet: money(planPrice), discountedUnitPriceSet: money(planPrice), customAttributes: [{ key: '_extend_plan_id', value: PLAN }, { key: '_extend_covered_product_id', value: '501' }], product: { id: 'gid://shopify/Product/9001', metafield: null }, variant: { id: 'gid://shopify/ProductVariant/9100000006' } },
      ],
    },
  };
}

/** Shopify Admin is scripted; Extend is the mock over real HTTP. */
function harness(mock, nodes, overrides = {}) {
  const adminCalls = [];
  const fetchFn = (url, init) => {
    if (String(url).startsWith(`https://${STORE}/`)) {
      adminCalls.push(JSON.parse(init.body));
      return Promise.resolve(new Response(JSON.stringify({ data: { orders: { pageInfo: { hasNextPage: false, endCursor: null }, nodes } } })));
    }
    return fetch(url, init);
  };
  const lines = [];
  const errors = [];
  const env = {
    SHOPIFY_ADMIN_API_ACCESS_TOKEN: ADMIN_TOKEN,
    SHOPIFY_ALLOWED_STORES: STORE,
    PUBLIC_EXTEND_ENABLED: 'true',
    EXTEND_API_HOST: mock.url,
    EXTEND_STORE_ID: 'store-integration-1',
    EXTEND_ACCESS_TOKEN: TOKEN,
    ...overrides,
  };
  const run = (argv) => main(argv, { env, fetch: fetchFn, out: (t) => lines.push(t), err: (t) => errors.push(t), logWrite: () => {}, now: () => Date.parse('2026-10-14T00:00:00Z') });
  return { run, lines, errors, adminCalls, text: () => [...lines, ...errors].join('\n') };
}

async function withMock(fn) {
  const mock = await startMock({ accessToken: TOKEN, storeId: 'store-integration-1' });
  try {
    await fn(mock);
  } finally {
    await mock.close();
  }
}

const base = ['--store', STORE, '--since', '2026-10-01', '--extend-source', 'mock'];

test('reports a coverage order that Extend never received, changes nothing, and names no customer data', async () => {
  await withMock(async (mock) => {
    const h = harness(mock, [orderNode()]);
    assert.equal(await h.run(base), EXIT_FAILED);
    assert.match(h.text(), /missing_sync/);
    assert.match(h.text(), /Dry run/);
    assert.equal(mock.state.requests.filter((r) => r.method === 'PUT').length, 0);
    for (const value of PII) assert.ok(!h.text().includes(value), `report must not contain ${value}`);
    assert.ok(!h.text().includes(ADMIN_TOKEN) && !h.text().includes(TOKEN));
  });
});

test('--resend --live sends the missing order, a second run is clean, and a replay changes nothing', async () => {
  await withMock(async (mock) => {
    const h = harness(mock, [orderNode()]);
    assert.equal(await h.run([...base, '--resend', '--live']), EXIT_FAILED); // issues were found this run
    assert.match(h.text(), /Re-sent 1 order/);
    assert.equal(mock.state.storedOrders().length, 1);

    const again = harness(mock, [orderNode()]);
    assert.equal(await again.run(base), EXIT_OK, again.text());
    assert.match(again.text(), /0 issue/);

    const before = mock.state.events.length;
    await harness(mock, [orderNode()]).run([...base, '--resend', '--live']);
    assert.equal(mock.state.events.length, before);
  });
});

test('detects a missing contract after fulfilment, and a status mismatch after a refund', async () => {
  await withMock(async (mock) => {
    await harness(mock, [orderNode()]).run([...base, '--resend', '--live']);
    const fulfilled = harness(mock, [orderNode({ unfulfilled: 0 })]);
    assert.equal(await fulfilled.run(base), EXIT_FAILED);
    assert.match(fulfilled.text(), /quantity_mismatch|contract_missing|status_mismatch|missing_sync|price_mismatch/);
    await fulfilled.run([...base, '--resend', '--live']);
    assert.equal(mock.state.contracts('7001').length, 1);
    assert.equal(await harness(mock, [orderNode({ unfulfilled: 0 })]).run(base), EXIT_OK);

    const refunded = harness(mock, [orderNode({ unfulfilled: 0, status: 'REFUNDED' })]);
    assert.equal(await refunded.run(base), EXIT_FAILED);
    assert.match(refunded.text(), /status_mismatch/);
  });
});

test('a coverage line charged at the wrong price is reported and never re-sent', async () => {
  await withMock(async (mock) => {
    const h = harness(mock, [orderNode({ planPrice: '59.99' })]);
    assert.equal(await h.run([...base, '--resend', '--live']), EXIT_FAILED);
    assert.match(h.text(), /price_mismatch/);
    assert.equal(mock.state.requests.filter((r) => r.method === 'PUT').length, 0);
  });
});

test('an Extend order for something Shopify does not list is unexpected', async () => {
  await withMock(async (mock) => {
    await harness(mock, [orderNode({ id: '7002' })]).run([...base, '--resend', '--live']);
    const h = harness(mock, [orderNode({ id: '7001' })]);
    await h.run(base);
    assert.match(h.text(), /unexpected_extend_order/);
  });
});

test('Extend outage while asking for quotes sets the order aside instead of reporting false drift', async () => {
  await withMock(async (mock) => {
    mock.setFault({ path: '/offers', status: 503 });
    const h = harness(mock, [orderNode()]);
    assert.equal(await h.run(base), EXIT_FAILED);
    assert.match(h.text(), /Not judged \(Extend quotes unavailable\): 7001/);
    assert.ok(!/flagged_coverage|price_mismatch/.test(h.text()));
  });
});

test('guards: unknown store, missing source, resend without --live, bad limit and bad date', async () => {
  await withMock(async (mock) => {
    assert.equal(await harness(mock, []).run(['--store', 'other.myshopify.com', '--extend-source', 'mock']), EXIT_REFUSED);
    assert.equal(await harness(mock, []).run(['--store', STORE]), EXIT_USAGE);
    assert.equal(await harness(mock, []).run([...base, '--resend']), EXIT_USAGE);
    assert.equal(await harness(mock, []).run([...base, '--limit', '0']), EXIT_USAGE);
    assert.equal(await harness(mock, []).run([...base, '--since', 'yesterday']), EXIT_USAGE);
    assert.equal(await harness(mock, []).run([...base, '--bogus']), EXIT_USAGE);
    assert.equal(await harness(mock, [], { SHOPIFY_ALLOWED_STORES: '' }).run(base), EXIT_REFUSED);
    assert.equal(await harness(mock, [], { SHOPIFY_ADMIN_API_ACCESS_TOKEN: '' }).run(base), EXIT_USAGE);
    assert.equal(await harness(mock, [], { EXTEND_ACCESS_TOKEN: '' }).run(base), EXIT_USAGE);
  });
});

test('--resend is refused for the production host, and the mock source for any non-loopback host', async () => {
  await withMock(async (mock) => {
    const prod = harness(mock, [orderNode()], { EXTEND_API_HOST: 'https://api.helloextend.com' });
    assert.equal(await prod.run([...base, '--resend', '--live']), EXIT_REFUSED);
    assert.match(prod.text(), /written authorisation/);
    assert.equal(prod.adminCalls.length, 0);

    const demo = harness(mock, [orderNode()], { EXTEND_API_HOST: 'https://api-demo.helloextend.com' });
    assert.equal(await demo.run(base), EXIT_FAILED);
    assert.match(demo.text(), /loopback/);
  });
});

test('the file source reads an export from Extend, and rejects a malformed one', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'extend-reconcile-'));
  try {
    await withMock(async (mock) => {
      await harness(mock, [orderNode()]).run([...base, '--resend', '--live']);
      const exported = path.join(dir, 'export.json');
      await writeFile(exported, JSON.stringify({ orders: mock.state.storedOrders() }));
      // Quotes still come from the Offers API at EXTEND_API_HOST (the mock here); only the order copy comes from the file.
      const h = harness(mock, [orderNode()]);
      assert.equal(await h.run(['--store', STORE, '--since', '2026-10-01', '--extend-source', 'file', '--extend-file', exported]), EXIT_OK, h.text());

      const bad = path.join(dir, 'bad.json');
      await writeFile(bad, '{"orders":[{"snapshot":{}}]}');
      const b = harness(mock, [orderNode()]);
      assert.equal(await b.run(['--store', STORE, '--extend-source', 'file', '--extend-file', bad]), EXIT_FAILED);
      assert.match(b.text(), /entry 0/);
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('--json prints a machine-readable report with ids only', async () => {
  await withMock(async (mock) => {
    const h = harness(mock, [orderNode()]);
    await h.run([...base, '--json']);
    const parsed = JSON.parse(h.lines.join('\n'));
    assert.equal(parsed.report.checkedOrders, 1);
    assert.equal(parsed.report.issues[0].kind, 'missing_sync');
  });
});

test('readStoredOrders and renderReport handle odd input', () => {
  assert.equal(readStoredOrders('x').ok, false);
  assert.equal(readStoredOrders([]).ok, true);
  const text = renderReport({ checkedOrders: 0, issues: [], summary: {} }, { skipped: [], unparsed: [{ orderId: '9', reason: 'truncated' }], truncated: true });
  assert.match(text, /9 \(truncated\)/);
  assert.match(text, /order limit/);
});
