import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLogger } from './redact.mjs';
import { ADMIN_API_VERSION, connectionNodes, createAdminClient, createCostThrottle, readPayload } from './shopify-admin.mjs';

const STORE = 'client-test.myshopify.com';
const TOKEN = 'test-token-not-real-0123456789abcdef';
const URL_EXPECTED = `https://${STORE}/admin/api/${ADMIN_API_VERSION}/graphql.json`;

/** Fake clock: sleeping advances time instantly and is recorded. */
function fakeClock(start = 1_000_000) {
  let now = start;
  /** @type {number[]} */
  const sleeps = [];
  return {
    clock: { now: () => now, sleep: async (/** @type {number} */ ms) => { sleeps.push(ms); now += ms; } },
    sleeps,
    advance: (/** @type {number} */ ms) => { now += ms; },
    get now() { return now; },
  };
}

const ok = (/** @type {unknown} */ data, /** @type {unknown} */ cost) => new Response(JSON.stringify({ data, ...(cost ? { extensions: { cost } } : {}) }), { status: 200 });
const status = (/** @type {number} */ code, /** @type {Record<string, string>} */ headers = {}) => new Response('{}', { status: code, headers });
const throttleStatus = (/** @type {number} */ currentlyAvailable) => ({ requestedQueryCost: 50, actualQueryCost: 20, throttleStatus: { maximumAvailable: 1000, currentlyAvailable, restoreRate: 100 } });

/** @param {Array<Response | Error | ((init: RequestInit) => Response | Promise<Response>)>} script */
function scripted(script) {
  /** @type {{ url: string, init: RequestInit }[]} */
  const calls = [];
  /** @type {typeof fetch} */
  const fetchImpl = async (input, init = {}) => {
    calls.push({ url: String(input), init });
    const next = script[Math.min(calls.length - 1, script.length - 1)];
    if (next instanceof Error) throw next;
    return typeof next === 'function' ? next(init) : next.clone();
  };
  return { fetch: fetchImpl, calls };
}

function makeClient(script, extra = {}) {
  const time = fakeClock();
  const http = scripted(script);
  const client = createAdminClient({ store: STORE, token: TOKEN, fetch: http.fetch, clock: time.clock, random: () => 0, ...extra });
  return { client, http, time };
}

// ---- request shape and safety ----------------------------------------------------------------

test('sends a POST to the versioned myshopify endpoint with the token in the header and no redirects', async () => {
  const { client, http } = makeClient([ok({ shop: { name: 'x' } })]);
  const result = await client.request('query { shop { name } }', {}, { operationName: 'Shop' });
  assert.equal(result.ok, true);
  assert.equal(http.calls[0].url, URL_EXPECTED);
  assert.equal(http.calls[0].init.method, 'POST');
  assert.equal(http.calls[0].init.redirect, 'error');
  assert.equal(new Headers(http.calls[0].init.headers).get('x-shopify-access-token'), TOKEN);
  assert.equal(JSON.parse(String(http.calls[0].init.body)).operationName, 'Shop');
});

test('rejects a store that is not a myshopify.com domain and a missing token', () => {
  assert.throws(() => createAdminClient({ store: 'evil.example.com', token: TOKEN }), TypeError);
  assert.throws(() => createAdminClient({ store: STORE, token: '' }), TypeError);
});

test('mutations are refused unless the client was created with allowMutations, and nothing is sent', async () => {
  const { client, http } = makeClient([ok({})]);
  const result = await client.request('mutation Do { productDelete { deletedProductId } }', {}, { operationName: 'Do' });
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.error.kind, 'read_only');
  assert.equal(http.calls.length, 0);
  const writable = makeClient([ok({})], { allowMutations: true });
  assert.equal((await writable.client.request('mutation Do { x }', {}, { operationName: 'Do' })).ok, true);
});

// ---- error normalisation -----------------------------------------------------------------------

test('401 and 403 become an auth error without retrying; 404 becomes not_found', async () => {
  for (const [code, kind] of /** @type {const} */ ([[401, 'auth'], [403, 'auth'], [404, 'not_found']])) {
    const { client, http } = makeClient([status(code)]);
    const result = await client.request('query { shop { name } }');
    assert.equal(result.ok === false && result.error.kind, kind);
    assert.equal(http.calls.length, 1, `${code} must not be retried`);
  }
});

test('a non-JSON or malformed body is an invalid_response, not an exception', async () => {
  for (const response of [new Response('<html>oops</html>', { status: 200 }), new Response('[]', { status: 200 }), new Response('{"data":null}', { status: 200 })]) {
    const { client } = makeClient([response]);
    const result = await client.request('query { shop { name } }');
    assert.equal(result.ok === false && result.error.kind, 'invalid_response');
  }
});

test('GraphQL errors are surfaced (and redacted); MAX_COST_EXCEEDED has its own kind', async () => {
  const leaky = new Response(JSON.stringify({ errors: [{ message: `Bad thing with ${TOKEN}`, extensions: { code: 'SOMETHING' } }] }), { status: 200 });
  const first = await makeClient([leaky]).client.request('query { x }');
  assert.equal(first.ok === false && first.error.kind, 'graphql');
  assert.equal(JSON.stringify(first).includes(TOKEN), false);
  const tooBig = new Response(JSON.stringify({ errors: [{ message: 'Query cost is 2003, which exceeds the single query max cost limit (1000).', extensions: { code: 'MAX_COST_EXCEEDED' } }] }), { status: 200 });
  const second = await makeClient([tooBig]).client.request('query { x }');
  assert.equal(second.ok === false && second.error.kind, 'cost_exceeded');
});

test('userErrors on a 200 response become a typed user_errors failure with field paths and codes', () => {
  const data = { productSet: { product: null, userErrors: [{ field: ['input', 'handle'], message: 'Handle has already been taken', code: 'TAKEN' }, { field: null, message: 'Other' }] } };
  const result = readPayload(data, 'productSet');
  assert.equal(result.ok, false);
  assert.ok(result.ok === false && result.error.kind === 'user_errors');
  assert.equal(result.ok === false && result.error.errors?.length, 2);
  assert.equal(result.ok === false && result.error.errors?.[0].code, 'TAKEN');
  assert.match(result.ok === false ? result.error.message : '', /input\.handle: Handle has already been taken \[TAKEN\]/);
  assert.equal(readPayload({ productSet: { userErrors: [] } }, 'productSet').ok, true);
  assert.equal(readPayload({}, 'productSet').ok, false);
});

test('a successful response that echoes the token in a userError is scrubbed before the caller sees it', async () => {
  const echoed = ok({ productSet: { product: null, userErrors: [{ field: null, message: `bad credential ${TOKEN}` }] } });
  const result = await makeClient([echoed], { allowMutations: true }).client.request('mutation M { productSet { userErrors { message } } }', {}, { operationName: 'M' });
  assert.ok(result.ok);
  assert.equal(JSON.stringify(result).includes(TOKEN), false);
  const payload = readPayload(result.ok ? result.data : {}, 'productSet');
  assert.match(payload.ok ? '' : payload.error.message, /bad credential \[REDACTED\]/);
});

test('connectionNodes reads nodes or edges and ignores junk', () => {
  assert.deepEqual(connectionNodes({ nodes: [{ id: 1 }, null, 'x'] }), [{ id: 1 }]);
  assert.deepEqual(connectionNodes({ edges: [{ node: { id: 2 } }, {}] }), [{ id: 2 }]);
  assert.deepEqual(connectionNodes(null), []);
});

// ---- retries -----------------------------------------------------------------------------------

test('retries on THROTTLED with backoff and then succeeds', async () => {
  const throttled = new Response(JSON.stringify({ errors: [{ message: 'Throttled', extensions: { code: 'THROTTLED' } }] }), { status: 200 });
  const { client, http, time } = makeClient([throttled, throttled, ok({ shop: 1 }, throttleStatus(900))]);
  const result = await client.request('query { shop { name } }');
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.attempts, 3);
  assert.equal(http.calls.length, 3);
  // backoff doubles from one second, matching Shopify's recommended one-second minimum
  const backoffs = time.sleeps.filter((ms) => ms >= 1000);
  assert.deepEqual(backoffs.slice(0, 2), [1000, 2000]);
});

test('retries are bounded: always-throttled gives up after maxAttempts with a typed error', async () => {
  const { client, http } = makeClient([status(429)], { maxAttempts: 3 });
  const result = await client.request('query { shop { name } }');
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.error.kind, 'throttled');
  assert.match(result.ok === false ? result.error.message : '', /gave up after 3 attempts/);
  assert.equal(http.calls.length, 3);
});

test('retries 5xx, respects Retry-After on 429, never retries other 4xx', async () => {
  const flaky = makeClient([status(502), status(503), ok({ a: 1 })]);
  assert.equal((await flaky.client.request('query { a }')).ok, true);
  assert.equal(flaky.http.calls.length, 3);

  const retryAfter = makeClient([status(429, { 'retry-after': '4' }), ok({ a: 1 })]);
  await retryAfter.client.request('query { a }');
  assert.ok(retryAfter.time.sleeps.includes(4000), `sleeps: ${retryAfter.time.sleeps}`);

  const bad = makeClient([status(422)]);
  const result = await bad.client.request('query { a }');
  assert.equal(result.ok === false && result.error.kind, 'http');
  assert.equal(bad.http.calls.length, 1);
});

test('network failures are retried and then reported as network errors with the token redacted', async () => {
  const { client, http } = makeClient([new TypeError(`fetch failed while sending X-Shopify-Access-Token: ${TOKEN}`)], { maxAttempts: 2 });
  const result = await client.request('query { a }');
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.error.kind, 'network');
  assert.equal(http.calls.length, 2);
  assert.equal(JSON.stringify(result).includes(TOKEN), false);
});

test('a request that exceeds the timeout is aborted and reported as a timeout', async () => {
  const hang = (/** @type {RequestInit} */ init) => new Promise((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  });
  const { client } = makeClient([hang], { timeoutMs: 20, maxAttempts: 1 });
  const result = await client.request('query { a }');
  assert.equal(result.ok === false && result.error.kind, 'timeout');
});

// ---- cost-based throttling (fake clock) ---------------------------------------------------------

test('the cost throttle starts with a full bucket and waits when it would overdraw', async () => {
  const time = fakeClock();
  const throttle = createCostThrottle({ clock: time.clock, restoreRate: 100, bucketSize: 1000 });
  assert.equal(await throttle.acquire(1000), 0, 'a full bucket pays for one maximal query immediately');
  assert.equal(await throttle.acquire(100), 1000, '100 points at 100/s needs one second');
  assert.deepEqual(time.sleeps, [1000]);
});

test('the bucket refills with elapsed time, capped at its size', async () => {
  const time = fakeClock();
  const throttle = createCostThrottle({ clock: time.clock, restoreRate: 100, bucketSize: 1000 });
  await throttle.acquire(1000);
  time.advance(500);
  assert.equal(await throttle.acquire(50), 0, '500 ms restores 50 points');
  time.advance(60_000);
  assert.equal(throttle.snapshot().available, 1000);
});

test('observed throttleStatus from a response replaces the local estimate', async () => {
  const time = fakeClock();
  const throttle = createCostThrottle({ clock: time.clock });
  throttle.observe({ maximumAvailable: 1000, currentlyAvailable: 50, restoreRate: 100 });
  assert.equal(await throttle.acquire(100), 500, 'needs 50 more points at 100/s');
  throttle.observe({ maximumAvailable: 2000, currentlyAvailable: 2000, restoreRate: 200 });
  assert.deepEqual({ max: throttle.snapshot().max, rate: throttle.snapshot().rate }, { max: 2000, rate: 200 });
});

test('a query costing more than the bucket waits only for what the bucket can ever hold', async () => {
  const time = fakeClock();
  const throttle = createCostThrottle({ clock: time.clock, restoreRate: 100, bucketSize: 1000 });
  await throttle.acquire(1000);
  assert.equal(await throttle.acquire(5000), 10_000, 'capped at the bucket size (1000 points = 10 s)');
});

test('the client slows down when the response says the bucket is almost empty, with no real sleeping', async () => {
  const { client, time } = makeClient([ok({ a: 1 }, throttleStatus(0)), ok({ a: 1 }, throttleStatus(1000))]);
  await client.request('query { a }', {}, { operationName: 'A' });
  const second = await client.request('query { a }', {}, { operationName: 'A' });
  assert.equal(second.ok, true);
  // The first response said 0 points were left and that this operation requests 50, so the second
  // request waits 50 / 100 per second = 500 ms.
  assert.deepEqual(time.sleeps, [500]);
});

test('the larger of the caller estimate and the reported cost paces the next request', async () => {
  const { client, time } = makeClient([ok({ a: 1 }, throttleStatus(0)), ok({ a: 1 }, throttleStatus(1000))]);
  await client.request('query { a }', {}, { operationName: 'A' });
  await client.request('query { a }', {}, { operationName: 'A', estimatedCost: 200 });
  assert.deepEqual(time.sleeps, [2000]);
});

test('a sustained run stays within 100 points per second', async () => {
  const time = fakeClock();
  const http = scripted([ok({ a: 1 })]); // no throttleStatus, so the local model alone has to pace us
  const client = createAdminClient({ store: STORE, token: TOKEN, fetch: http.fetch, clock: time.clock, random: () => 0 });
  const started = time.now;
  for (let i = 0; i < 50; i += 1) await client.request('query { a }', {}, { operationName: 'A', estimatedCost: 100 });
  const elapsedSeconds = (time.now - started) / 1000;
  const points = 50 * 100;
  // 1000 points are free from the full bucket; the other 4000 are paid at 100/s
  assert.ok(points / elapsedSeconds <= 100 * (points / (points - 1000)) + 1, `rate was ${points / elapsedSeconds} points/s`);
  assert.ok(elapsedSeconds >= 39.9 && elapsedSeconds <= 40.5, `took ${elapsedSeconds}s`);
});

// ---- redaction in logs --------------------------------------------------------------------------

test('the token never appears in captured logs, even when requests fail in every way', async () => {
  /** @type {string[]} */
  const lines = [];
  const logger = createLogger({ write: (line) => lines.push(line), secrets: [TOKEN], level: 'debug' });
  const scripts = [
    [status(500)],
    [status(401)],
    [new Error(`socket hang up (${TOKEN})`)],
    [new Response(JSON.stringify({ errors: [{ message: `token ${TOKEN} rejected`, extensions: { code: 'X' } }] }), { status: 200 })],
    [ok({ a: 1 }, throttleStatus(1000))],
  ];
  const results = [];
  for (const script of scripts) {
    const { client } = makeClient(script, { logger, maxAttempts: 2 });
    results.push(await client.request('query { a }', {}, { operationName: 'A' }));
  }
  assert.ok(lines.length > 0, 'something should have been logged');
  assert.equal(lines.join('\n').includes(TOKEN), false);
  assert.equal(JSON.stringify(results).includes(TOKEN), false);
});
