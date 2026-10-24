import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {
  buildRequestHeaders,
  createNodeServer,
  isValidHost,
  resolveScheme,
  resolveStaticPath,
  staticCacheControl,
} from './adapter.mjs';
import { createCacheStorage } from './cache.mjs';
import {
  DEFAULTS,
  REQUIRED_NAMES,
  isLoopback,
  readClientIpHeaderWarning,
  readSettings,
  readStorefrontProblems,
} from './config.mjs';

// ---- config ----------------------------------------------------------------------------------------------------

test('readSettings: defaults bind to loopback and do not trust a proxy', () => {
  const { settings, problems } = readSettings({});
  assert.deepEqual(problems, []);
  assert.equal(settings.bindHost, '127.0.0.1');
  assert.equal(settings.port, DEFAULTS.port);
  assert.equal(settings.trustProxy, false);
  assert.equal(settings.maxBodyBytes, 1024 * 1024);
});

test('readSettings: valid values are used', () => {
  const { settings, problems } = readSettings({
    PORT: '3101',
    BIND_HOST: '127.0.0.2',
    TRUST_PROXY: 'true',
    MAX_BODY_BYTES: '2048',
    SHUTDOWN_TIMEOUT_MS: '0',
    CACHE_MAX_ENTRIES: '10',
    CACHE_MAX_BYTES: '2097152',
  });
  assert.deepEqual(problems, []);
  assert.deepEqual(settings, {
    port: 3101,
    bindHost: '127.0.0.2',
    trustProxy: true,
    maxBodyBytes: 2048,
    shutdownTimeoutMs: 0,
    cacheMaxEntries: 10,
    cacheMaxBytes: 2097152,
  });
});

test('readSettings: bad values are reported by name and fall back to safe defaults', () => {
  const { settings, problems } = readSettings({
    PORT: '99999',
    BIND_HOST: '0.0.0.0/0',
    TRUST_PROXY: 'yes',
    MAX_BODY_BYTES: 'big',
  });
  assert.equal(problems.length, 4);
  assert.ok(problems.some((problem) => problem.startsWith('PORT ')));
  assert.ok(problems.some((problem) => problem.startsWith('BIND_HOST ')));
  assert.ok(problems.some((problem) => problem.startsWith('TRUST_PROXY ')));
  assert.ok(problems.some((problem) => problem.startsWith('MAX_BODY_BYTES ')));
  assert.equal(settings.bindHost, '127.0.0.1');
  assert.equal(settings.trustProxy, false);
});

test('readSettings: BIND_HOST must be a real address (Node parser), not just digits and dots', () => {
  for (const bad of ['999.999.999.999', '1.2.3', '1.2.3.4.5', 'localhost', '::g', '0.0.0.0/0', '1:2:3:4:5:6:7:8:9']) {
    const { settings, problems } = readSettings({ BIND_HOST: bad });
    assert.ok(
      problems.some((problem) => problem.startsWith('BIND_HOST ')),
      bad,
    );
    assert.equal(settings.bindHost, '127.0.0.1', bad);
  }
  for (const good of ['0.0.0.0', '10.1.2.3', '::', '::1', 'fe80::1', '2001:db8::1']) {
    assert.deepEqual(readSettings({ BIND_HOST: good }).problems, [], good);
  }
});

test('readSettings: TRUST_PROXY=true is refused unless BIND_HOST is loopback', () => {
  for (const host of ['0.0.0.0', '10.0.0.5', '::', '192.168.1.10', '2001:db8::1']) {
    const { problems } = readSettings({ TRUST_PROXY: 'true', BIND_HOST: host });
    assert.ok(
      problems.some((problem) => problem.startsWith('TRUST_PROXY=true requires BIND_HOST')),
      host,
    );
  }
  for (const host of ['127.0.0.1', '127.5.5.5', '::1', '0:0:0:0:0:0:0:1', '::ffff:127.0.0.1']) {
    assert.deepEqual(readSettings({ TRUST_PROXY: 'true', BIND_HOST: host }).problems, [], host);
  }
  // Unset BIND_HOST is the loopback default.
  assert.deepEqual(readSettings({ TRUST_PROXY: 'true' }).problems, []);
  // Without a trusted proxy any bind address is allowed (a developer machine, a container).
  assert.deepEqual(readSettings({ TRUST_PROXY: 'false', BIND_HOST: '0.0.0.0' }).problems, []);
  assert.deepEqual(readSettings({ BIND_HOST: '0.0.0.0' }).problems, []);
});

test('isLoopback: only 127.0.0.0/8, ::1 and its mapped form', () => {
  assert.equal(isLoopback('127.0.0.1'), true);
  assert.equal(isLoopback('::1'), true);
  assert.equal(isLoopback('128.0.0.1'), false);
  assert.equal(isLoopback('::'), false);
  assert.equal(isLoopback('::2'), false);
  assert.equal(isLoopback('::ffff:10.0.0.1'), false);
});

test('readSettings: CACHE_MAX_BYTES defaults to 64 MiB and is range checked', () => {
  assert.equal(readSettings({}).settings.cacheMaxBytes, 64 * 1024 * 1024);
  for (const bad of ['1000', '2000000000', 'lots']) {
    const { settings, problems } = readSettings({ CACHE_MAX_BYTES: bad });
    assert.ok(
      problems.some((problem) => problem.startsWith('CACHE_MAX_BYTES ')),
      bad,
    );
    assert.equal(settings.cacheMaxBytes, DEFAULTS.cacheMaxBytes);
  }
});

test('config: PUBLIC_STOREFRONT_ID is optional (Hydrogen defaults it); four store variables are required', () => {
  assert.ok(!REQUIRED_NAMES.includes('PUBLIC_STOREFRONT_ID'));
  assert.deepEqual([...REQUIRED_NAMES].sort(), [
    'PUBLIC_CHECKOUT_DOMAIN',
    'PUBLIC_STOREFRONT_API_TOKEN',
    'PUBLIC_STORE_DOMAIN',
    'SESSION_SECRET',
  ]);
});

test('readStorefrontProblems: names the missing variables and never prints a value', () => {
  const secret = 'short-secret-value';
  const problems = readStorefrontProblems({ SESSION_SECRET: secret });
  assert.ok(problems.includes('PUBLIC_STORE_DOMAIN is not set'));
  assert.ok(problems.includes('SESSION_SECRET is shorter than 32 characters'));
  assert.ok(!problems.join(' ').includes(secret));
});

test('readStorefrontProblems: a complete environment has no problems', () => {
  assert.deepEqual(
    readStorefrontProblems({
      SESSION_SECRET: 'x'.repeat(32),
      PUBLIC_STORE_DOMAIN: 'example.myshopify.com',
      PUBLIC_STOREFRONT_API_TOKEN: 'y'.repeat(32),
      PUBLIC_CHECKOUT_DOMAIN: 'example.myshopify.com',
    }),
    [],
  );
});

test('readClientIpHeaderWarning: unset or blank warns on any host, naming the setting and the reason', () => {
  for (const trustProxy of [true, false]) {
    for (const env of [{}, { TRUSTED_CLIENT_IP_HEADER: '' }, { TRUSTED_CLIENT_IP_HEADER: '   ' }]) {
      const warning = readClientIpHeaderWarning(env, { trustProxy });
      assert.equal(warning?.setting, 'TRUSTED_CLIENT_IP_HEADER');
      assert.equal(warning?.reason, 'unset');
      assert.match(warning?.effect ?? '', /10 attempts per 15 minutes/);
    }
  }
});

test('readClientIpHeaderWarning: x-real-ip is quiet, in any letter case and with spaces, with or without a proxy', () => {
  for (const trustProxy of [true, false]) {
    for (const value of ['x-real-ip', 'X-Real-IP', '  x-real-ip ']) {
      assert.equal(readClientIpHeaderWarning({ TRUSTED_CLIENT_IP_HEADER: value }, { trustProxy }), null, value);
    }
  }
});

test('readClientIpHeaderWarning: another header warns only while TRUST_PROXY=true', () => {
  for (const value of ['oxygen-buyer-ip', 'cf-connecting-ip', 'true-client-ip', 'x-forwarded-for', 'nonsense']) {
    const warning = readClientIpHeaderWarning({ TRUSTED_CLIENT_IP_HEADER: value }, { trustProxy: true });
    assert.equal(warning?.reason, 'not_x_real_ip', value);
    assert.equal(readClientIpHeaderWarning({ TRUSTED_CLIENT_IP_HEADER: value }, { trustProxy: false }), null, value);
  }
});

test('readClientIpHeaderWarning: never contains the configured value, only the setting name', () => {
  const marker = 'secret-looking-header-value';
  const warning = readClientIpHeaderWarning({ TRUSTED_CLIENT_IP_HEADER: marker }, { trustProxy: true });
  assert.ok(warning !== null);
  assert.ok(!JSON.stringify(warning).includes(marker));
});

test('readClientIpHeaderWarning: a warning is not a problem; readSettings and readStorefrontProblems stay clean', () => {
  const env = {
    TRUST_PROXY: 'true',
    SESSION_SECRET: 'x'.repeat(32),
    PUBLIC_STORE_DOMAIN: 'example.myshopify.com',
    PUBLIC_STOREFRONT_API_TOKEN: 'y'.repeat(32),
    PUBLIC_CHECKOUT_DOMAIN: 'example.myshopify.com',
  };
  assert.deepEqual(readSettings(env).problems, []);
  assert.deepEqual(readStorefrontProblems(env), []);
  assert.equal(readClientIpHeaderWarning(env, readSettings(env).settings)?.reason, 'unset');
});

// ---- cache -----------------------------------------------------------------------------------------------------

test('cache: put then match returns a fresh copy marked HIT, then STALE, then nothing', async () => {
  let now = 1_000_000;
  const store = createCacheStorage({ now: () => now });
  const cache = await store.open('hydrogen');
  const request = new Request('https://example.test/a');
  await cache.put(
    request,
    new Response('body', { headers: { 'cache-control': 'max-age=10, stale-while-revalidate=5' } }),
  );

  const hit = await cache.match(request);
  assert.equal(await hit?.text(), 'body');
  assert.equal(hit?.headers.get('cache'), 'HIT');

  now += 12_000;
  assert.equal((await cache.match(request))?.headers.get('cache'), 'STALE');

  now += 10_000;
  assert.equal(await cache.match(request), undefined);
});

test('cache: reads the real-cache-control header Hydrogen writes', async () => {
  const cache = await createCacheStorage().open('hydrogen');
  const request = new Request('https://example.test/b');
  await cache.put(request, new Response('x', { headers: { 'real-cache-control': 'max-age=60' } }));
  assert.equal((await cache.match(request))?.headers.get('cache'), 'HIT');
});

test('cache: open returns the same cache for a name and a separate one for another name', async () => {
  const store = createCacheStorage();
  const first = await store.open('hydrogen');
  assert.equal(await store.open('hydrogen'), first);
  assert.notEqual(await store.open('extend-webhook-replay'), first);
});

test('cache: is bounded and evicts the oldest entry first', async () => {
  const cache = await createCacheStorage({ maxEntries: 2 }).open('hydrogen');
  const headers = { 'cache-control': 'max-age=60' };
  for (const name of ['a', 'b', 'c']) {
    await cache.put(new Request(`https://example.test/${name}`), new Response(name, { headers }));
  }
  assert.equal(cache.size, 2);
  assert.equal(await cache.match(new Request('https://example.test/a')), undefined);
  assert.equal(await (await cache.match(new Request('https://example.test/c')))?.text(), 'c');
});

test('cache: is bounded by bytes too and evicts the oldest writes first', async () => {
  const cache = await createCacheStorage({ maxEntries: 100, maxBytes: 8000, sweepIntervalMs: 0 }).open('hydrogen');
  const headers = { 'cache-control': 'max-age=60' };
  for (const name of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']) {
    // About 900 bytes of body each: under the one-eighth entry limit (1000), but ten of them exceed 8000 with overhead.
    await cache.put(new Request(`https://example.test/${name}`), new Response(name.repeat(900), { headers }));
  }
  assert.ok(cache.bytes <= 8000, `bytes ${cache.bytes}`);
  assert.ok(cache.size < 10);
  assert.equal(await cache.match(new Request('https://example.test/a')), undefined);
  assert.equal((await (await cache.match(new Request('https://example.test/j')))?.text())?.length, 900);
});

test('cache: an entry over one eighth of the byte limit is not stored and does not flush the others', async () => {
  const cache = await createCacheStorage({ maxBytes: 8000, sweepIntervalMs: 0 }).open('hydrogen');
  const headers = { 'cache-control': 'max-age=60' };
  const small = new Request('https://example.test/small');
  const big = new Request('https://example.test/big');
  await cache.put(small, new Response('s', { headers }));
  await cache.put(big, new Response('b'.repeat(2000), { headers }));
  assert.equal(await cache.match(big), undefined);
  assert.equal(await (await cache.match(small))?.text(), 's');
  assert.ok(cache.bytes < 1000);
});

test('cache: a too-large replacement removes the old copy instead of serving it', async () => {
  const cache = await createCacheStorage({ maxBytes: 8000, sweepIntervalMs: 0 }).open('hydrogen');
  const headers = { 'cache-control': 'max-age=60' };
  const request = new Request('https://example.test/p');
  await cache.put(request, new Response('old', { headers }));
  await cache.put(request, new Response('n'.repeat(2000), { headers }));
  assert.equal(await cache.match(request), undefined);
  assert.equal(cache.size, 0);
  assert.equal(cache.bytes, 0);
});

test('cache: byte count follows put, replace, delete and expiry back to zero', async () => {
  let now = 0;
  const cache = await createCacheStorage({ now: () => now, sweepIntervalMs: 0 }).open('hydrogen');
  const headers = { 'cache-control': 'max-age=1' };
  const request = new Request('https://example.test/p');
  await cache.put(request, new Response('abc', { headers }));
  const one = cache.bytes;
  assert.ok(one > 3);
  await cache.put(request, new Response('abc', { headers }));
  assert.equal(cache.bytes, one);
  await cache.delete(request);
  assert.equal(cache.bytes, 0);
  await cache.put(request, new Response('abc', { headers }));
  now = 5000;
  assert.equal(await cache.match(request), undefined);
  assert.equal(cache.bytes, 0);
});

test('cache: a write sweeps expired entries that nobody asked for again', async () => {
  let now = 0;
  const cache = await createCacheStorage({ now: () => now, sweepIntervalMs: 1000 }).open('hydrogen');
  const headers = { 'cache-control': 'max-age=1' };
  await cache.put(new Request('https://example.test/old'), new Response('o', { headers }));
  await cache.put(new Request('https://example.test/old2'), new Response('o', { headers }));
  assert.equal(cache.size, 2);
  now = 10_000;
  await cache.put(
    new Request('https://example.test/new'),
    new Response('n', { headers: { 'cache-control': 'max-age=100' } }),
  );
  assert.equal(cache.size, 1);
  assert.equal(await cache.match(new Request('https://example.test/old')), undefined);
});

test('cache: sweepAll removes expired entries in every named cache without a write; the timer can be stopped', async () => {
  let now = 0;
  const store = createCacheStorage({ now: () => now, sweepIntervalMs: 60_000 });
  const cache = await store.open('hydrogen');
  const other = await store.open('replay');
  const headers = { 'cache-control': 'max-age=1' };
  await cache.put(new Request('https://example.test/a'), new Response('a', { headers }));
  await other.put(new Request('https://example.test/b'), new Response('b', { headers }));
  now = 10_000;
  assert.equal(store.sweepAll(), 2);
  assert.equal(cache.size + other.size, 0);
  store.stop();
});

test('cache: the sweep timer does not keep the process alive', () => {
  // A child process creates a storage with the default timer and must exit by itself well within the timeout.
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import { createCacheStorage } from ${JSON.stringify(new URL('./cache.mjs', import.meta.url).href)};
       const store = createCacheStorage(); await store.open('x');`,
    ],
    { timeout: 10_000 },
  );
  assert.equal(result.status, 0);
  assert.equal(result.error, undefined);
});

test('cache: refuses what the Workers cache refuses', async () => {
  const cache = await createCacheStorage().open('hydrogen');
  await assert.rejects(
    cache.put(new Request('https://example.test/p', { method: 'POST' }), new Response('x')),
    TypeError,
  );
  await assert.rejects(
    cache.put(new Request('https://example.test/v'), new Response('x', { headers: { vary: '*' } })),
    TypeError,
  );
  await assert.rejects(cache.put(new Request('https://example.test/r'), new Response('x', { status: 206 })), TypeError);
  assert.equal(await cache.match(new Request('https://example.test/p', { method: 'POST' })), undefined);
});

test('cache: delete reports whether something was removed', async () => {
  const cache = await createCacheStorage().open('hydrogen');
  const request = new Request('https://example.test/d');
  await cache.put(request, new Response('x', { headers: { 'cache-control': 'max-age=60' } }));
  assert.equal(await cache.delete(request), true);
  assert.equal(await cache.delete(request), false);
});

// ---- pure helpers ----------------------------------------------------------------------------------------------

test('resolveScheme: a forwarded value counts only when the proxy is trusted, and only the first one', () => {
  assert.equal(resolveScheme({ trustProxy: true, forwardedProto: 'https', encrypted: false }), 'https');
  assert.equal(resolveScheme({ trustProxy: true, forwardedProto: 'https, http', encrypted: false }), 'https');
  assert.equal(resolveScheme({ trustProxy: true, forwardedProto: 'http, https', encrypted: false }), 'http');
  assert.equal(resolveScheme({ trustProxy: false, forwardedProto: 'https', encrypted: false }), 'http');
  assert.equal(resolveScheme({ trustProxy: true, forwardedProto: 'javascript', encrypted: false }), 'http');
  assert.equal(resolveScheme({ trustProxy: true, forwardedProto: undefined, encrypted: false }), 'http');
  assert.equal(resolveScheme({ trustProxy: false, forwardedProto: undefined, encrypted: true }), 'https');
});

test('isValidHost: accepts names, ports and bracketed IPv6; rejects injection', () => {
  for (const ok of ['example.com', 'shop.example.com:3000', 'localhost:3100', '127.0.0.1:80', '[::1]:3000']) {
    assert.equal(isValidHost(ok), true, ok);
  }
  for (const bad of [
    undefined,
    '',
    'a b',
    'example.com/x',
    'a@b.com',
    'example.com:99999x',
    '-bad.example',
    'x\r\nSet-Cookie: a=b',
  ]) {
    assert.equal(isValidHost(bad), false, String(bad));
  }
});

test('resolveStaticPath: serves known build files and rejects traversal, dotfiles and unknown types', () => {
  const root = path.resolve(os.tmpdir(), 'client-root');
  assert.equal(resolveStaticPath(root, '/assets/app-ab12.js'), path.join(root, 'assets', 'app-ab12.js'));
  assert.equal(resolveStaticPath(root, '/brand/logo.svg'), path.join(root, 'brand', 'logo.svg'));
  for (const bad of [
    '/',
    '/assets',
    '/assets/app.js.map',
    '/.gitkeep',
    '/../secret.txt',
    '/assets/../../secret.txt',
    '/%2e%2e/secret.txt',
    '/assets/%2e%2e/%2e%2e/secret.txt',
    '/assets/a%00.js',
    '/assets\\app.js',
    '/assets/%E0%A4%A.js',
    '/index.html',
    '/assets/noextension',
  ]) {
    assert.equal(resolveStaticPath(root, bad), null, bad);
  }
});

test('staticCacheControl: hashed assets are immutable, other files are not', () => {
  assert.match(staticCacheControl('/assets/a-1.js'), /immutable/);
  assert.doesNotMatch(staticCacheControl('/brand/logo.svg'), /immutable/);
});

// ---- the server, with a fake storefront handler ----------------------------------------------------------------

let clientDir;
let outsideFile;

before(() => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'node-server-test-'));
  clientDir = path.join(base, 'client');
  fs.mkdirSync(path.join(clientDir, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(clientDir, 'assets', 'app-ab12.js'), 'console.log(1)');
  fs.writeFileSync(path.join(clientDir, 'assets', 'app-ab12.js.map'), '{}');
  fs.writeFileSync(path.join(clientDir, '.gitkeep'), '');
  outsideFile = path.join(base, 'secret.txt');
  fs.writeFileSync(outsideFile, 'secret');
});

after(() => {
  fs.rmSync(path.dirname(clientDir), { recursive: true, force: true });
});

async function withServer(handler, overrides = {}, run) {
  const logs = [];
  const settings = { trustProxy: false, maxBodyBytes: 1024, shutdownTimeoutMs: 500, ...overrides };
  const instance = createNodeServer({
    handler: { fetch: handler },
    env: { PUBLIC_STORE_DOMAIN: 'example.test' },
    clientDir,
    settings,
    log: (level, event, fields) => logs.push({ level, event, fields }),
  });
  await new Promise((resolve) => instance.server.listen(0, '127.0.0.1', resolve));
  const { port } = instance.server.address();
  try {
    await run({ port, base: `http://127.0.0.1:${port}`, logs, instance });
  } finally {
    await instance.close();
  }
}

function rawRequest(port, options) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, ...options }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () =>
        resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }),
      );
    });
    req.on('error', reject);
    req.end(options.body);
  });
}

test('server: passes the request to the handler with the env and answers with status, headers and body', async () => {
  let seen;
  await withServer(
    async (request, env) => {
      seen = { url: request.url, method: request.method, env, accept: request.headers.get('accept') };
      return new Response('hello', { status: 201, headers: { 'content-type': 'text/plain', 'x-test': '1' } });
    },
    {},
    async ({ base }) => {
      const res = await fetch(`${base}/products/a?x=1`, { headers: { accept: 'text/html' } });
      assert.equal(res.status, 201);
      assert.equal(res.headers.get('x-test'), '1');
      assert.equal(await res.text(), 'hello');
    },
  );
  assert.match(seen.url, /^http:\/\/127\.0\.0\.1:\d+\/products\/a\?x=1$/);
  assert.equal(seen.method, 'GET');
  assert.equal(seen.accept, 'text/html');
  assert.deepEqual(seen.env, { PUBLIC_STORE_DOMAIN: 'example.test' });
});

test('server: several Set-Cookie headers stay separate lines', async () => {
  await withServer(
    async () => {
      const headers = new Headers();
      headers.append('set-cookie', 'cart=1; Path=/; HttpOnly');
      headers.append('set-cookie', 'delivery=2; Path=/; HttpOnly');
      headers.append('set-cookie', 'session=3; Path=/; HttpOnly');
      return new Response('ok', { headers });
    },
    {},
    async ({ port }) => {
      const res = await rawRequest(port, { path: '/', headers: { host: 'shop.example.com' } });
      assert.deepEqual(res.headers['set-cookie'], [
        'cart=1; Path=/; HttpOnly',
        'delivery=2; Path=/; HttpOnly',
        'session=3; Path=/; HttpOnly',
      ]);
    },
  );
});

test('server: the request URL is http by default and https behind a trusted proxy that says so', async () => {
  const urls = [];
  const handler = async (request) => {
    urls.push(request.url);
    return new Response('ok');
  };
  await withServer(handler, { trustProxy: false }, async ({ port }) => {
    await rawRequest(port, { path: '/a', headers: { host: 'shop.example.com', 'x-forwarded-proto': 'https' } });
  });
  await withServer(handler, { trustProxy: true }, async ({ port }) => {
    await rawRequest(port, { path: '/b', headers: { host: 'shop.example.com', 'x-forwarded-proto': 'https' } });
  });
  assert.deepEqual(urls, ['http://shop.example.com/a', 'https://shop.example.com/b']);
});

test('server: a target that looks like another host cannot change the host', async () => {
  const urls = [];
  await withServer(
    async (request) => {
      urls.push(request.url);
      return new Response('ok');
    },
    {},
    async ({ port }) => {
      await rawRequest(port, { path: '//evil.example/x', headers: { host: 'shop.example.com' } });
    },
  );
  assert.equal(new URL(urls[0]).hostname, 'shop.example.com');
});

test('server: a missing or malformed Host header is a 400 and never reaches the handler', async () => {
  let called = 0;
  await withServer(
    async () => {
      called += 1;
      return new Response('ok');
    },
    {},
    async ({ port }) => {
      const res = await rawRequest(port, { path: '/', headers: { host: 'bad host' } });
      assert.equal(res.status, 400);
      const absolute = await rawRequest(port, { path: 'http://evil.example/', headers: { host: 'shop.example.com' } });
      assert.equal(absolute.status, 400);
      assert.equal(absolute.headers['x-frame-options'], 'DENY');
      assert.equal(absolute.headers['x-content-type-options'], 'nosniff');
    },
  );
  assert.equal(called, 0);
});

test('server: serves build assets with long caching, nosniff, ETag and 304; HEAD has no body', async () => {
  let called = 0;
  await withServer(
    async () => {
      called += 1;
      return new Response('app');
    },
    {},
    async ({ base }) => {
      const res = await fetch(`${base}/assets/app-ab12.js`);
      assert.equal(res.status, 200);
      assert.equal(await res.text(), 'console.log(1)');
      assert.match(res.headers.get('content-type') ?? '', /^text\/javascript/);
      assert.match(res.headers.get('cache-control') ?? '', /immutable/);
      assert.equal(res.headers.get('x-content-type-options'), 'nosniff');

      const etag = res.headers.get('etag');
      assert.ok(etag);
      const again = await fetch(`${base}/assets/app-ab12.js`, { headers: { 'if-none-match': etag } });
      assert.equal(again.status, 304);

      const head = await fetch(`${base}/assets/app-ab12.js`, { method: 'HEAD' });
      assert.equal(head.status, 200);
      assert.equal(head.headers.get('content-length'), '14');
    },
  );
  assert.equal(called, 0);
});

test('server: source maps, dotfiles and traversal are not served from disk; the handler decides', async () => {
  const paths = [];
  await withServer(
    async (request) => {
      paths.push(new URL(request.url).pathname);
      return new Response('app', { status: 404 });
    },
    {},
    async ({ port }) => {
      for (const target of [
        '/assets/app-ab12.js.map',
        '/.gitkeep',
        '/assets/%2e%2e/secret.txt',
        '/assets/missing.js',
      ]) {
        const res = await rawRequest(port, { path: target, headers: { host: 'shop.example.com' } });
        assert.equal(res.status, 404, target);
        assert.equal(res.body, 'app', target);
      }
    },
  );
  assert.equal(paths.length, 4);
  assert.ok(fs.existsSync(outsideFile));
});

test('server: /healthz answers without the handler, only for GET and HEAD', async () => {
  let called = 0;
  await withServer(
    async () => {
      called += 1;
      return new Response('app');
    },
    {},
    async ({ base }) => {
      const res = await fetch(`${base}/healthz`);
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { status: 'ok' });
      assert.equal(res.headers.get('cache-control'), 'no-store');
      const post = await fetch(`${base}/healthz`, { method: 'POST', body: 'x' });
      assert.equal(await post.text(), 'app');
    },
  );
  assert.equal(called, 1);
});

test('server: forwards a small POST body and rejects a declared oversized one with 413', async () => {
  let received;
  let called = 0;
  await withServer(
    async (request) => {
      called += 1;
      received = await request.text();
      return new Response('ok');
    },
    { maxBodyBytes: 1024 },
    async ({ base }) => {
      const small = await fetch(`${base}/cart`, { method: 'POST', body: 'a=1&b=2' });
      assert.equal(small.status, 200);
      const big = await fetch(`${base}/cart`, { method: 'POST', body: 'x'.repeat(2048) });
      assert.equal(big.status, 413);
    },
  );
  assert.equal(received, 'a=1&b=2');
  assert.equal(called, 1);
});

test('server: a body over the limit without a declared length is cut off', async () => {
  await withServer(
    async (request) => {
      await request.text();
      return new Response('ok');
    },
    { maxBodyBytes: 1024 },
    async ({ port }) => {
      const res = await rawRequest(port, {
        method: 'POST',
        path: '/cart',
        headers: { host: 'shop.example.com', 'transfer-encoding': 'chunked' },
        body: 'x'.repeat(4096),
      });
      // Reaches the client as 413 when the handler lets the error out; the storefront's own catch would turn it into its
      // generic 500, which still refuses the body. The reverse proxy limit is the first line (VPS_RUNBOOK).
      assert.equal(res.status, 413);
    },
  );
});

test('server: a handler that throws gives a plain 500 and the log has the error name only', async () => {
  await withServer(
    async () => {
      throw new TypeError('secret query text must not be logged');
    },
    {},
    async ({ base, logs }) => {
      const res = await fetch(`${base}/x`);
      assert.equal(res.status, 500);
      assert.equal(await res.text(), 'An unexpected error occurred');
      assert.deepEqual(logs, [{ level: 'error', event: 'node_server.request_failed', fields: { error: 'TypeError' } }]);
    },
  );
});

test('server: streams a response body in several chunks', async () => {
  await withServer(
    async () => {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          controller.enqueue(encoder.encode('one,'));
          await new Promise((resolve) => setTimeout(resolve, 20));
          controller.enqueue(encoder.encode('two'));
          controller.close();
        },
      });
      return new Response(stream);
    },
    {},
    async ({ base }) => {
      assert.equal(await (await fetch(`${base}/stream`)).text(), 'one,two');
    },
  );
});

test('server: waitUntil keeps background work alive, and shutdown waits for it', async () => {
  let finished = false;
  const logs = [];
  const instance = createNodeServer({
    handler: {
      fetch: async (_request, _env, ctx) => {
        ctx.waitUntil(
          new Promise((resolve) => {
            setTimeout(() => {
              finished = true;
              resolve();
            }, 100);
          }),
        );
        ctx.waitUntil(Promise.reject(new RangeError('background secret')));
        return new Response('ok');
      },
    },
    env: {},
    clientDir,
    settings: { trustProxy: false, maxBodyBytes: 1024, shutdownTimeoutMs: 2000 },
    log: (level, event, fields) => logs.push({ level, event, fields }),
  });
  await new Promise((resolve) => instance.server.listen(0, '127.0.0.1', resolve));
  const { port } = instance.server.address();
  const res = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(await res.text(), 'ok');
  assert.equal(finished, false);
  await instance.close();
  assert.equal(finished, true);
  assert.deepEqual(logs, [{ level: 'error', event: 'node_server.background_failed', fields: { error: 'RangeError' } }]);
});

test('server: a client that leaves before the first byte cancels the request signal given to the handler', async () => {
  let signalAborted;
  const started = Promise.withResolvers();
  const aborted = Promise.withResolvers();
  await withServer(
    async (request) => {
      started.resolve();
      request.signal.addEventListener('abort', () => {
        signalAborted = true;
        aborted.resolve();
      });
      await new Promise((resolve) => setTimeout(resolve, 1000));
      return new Response('late');
    },
    {},
    async ({ base }) => {
      const controller = new AbortController();
      const pending = fetch(`${base}/slow`, { signal: controller.signal }).catch(() => 'aborted');
      await started.promise;
      controller.abort();
      assert.equal(await pending, 'aborted');
      await aborted.promise;
    },
  );
  assert.equal(signalAborted, true);
});

test('server: a client that leaves after the response started does not abort the signal (no false render error)', async () => {
  let aborted = false;
  const started = Promise.withResolvers();
  const finished = Promise.withResolvers();
  await withServer(
    async (request) => {
      request.signal.addEventListener('abort', () => {
        aborted = true;
      });
      const encoder = new TextEncoder();
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode('first'));
            started.resolve();
          },
          cancel() {
            finished.resolve();
          },
        }),
      );
    },
    {},
    async ({ base }) => {
      const controller = new AbortController();
      const res = await fetch(`${base}/stream`, { signal: controller.signal });
      const reader = res.body.getReader();
      await reader.read();
      await started.promise;
      controller.abort();
      await finished.promise;
    },
  );
  assert.equal(aborted, false);
});

// ---- client-address headers (security review M-1, T-09, T-13) ------------------------------------------------------

const spoofed = [
  'Oxygen-Buyer-IP',
  '10.9.9.9',
  'CF-Connecting-IP',
  '10.9.9.8',
  'True-Client-IP',
  '10.9.9.7',
  'X-Real-IP',
  '10.9.9.6',
  'X-Forwarded-For',
  '10.9.9.5',
  'User-Agent',
  'test',
];

test('buildRequestHeaders: the three platform address headers never pass, in any letter case', () => {
  for (const trustProxy of [true, false]) {
    const headers = buildRequestHeaders(
      ['oxygen-buyer-ip', '1.1.1.1', 'CF-CONNECTING-IP', '2.2.2.2', 'True-Client-Ip', '3.3.3.3', 'Accept', 'x'],
      { trustProxy, remoteAddress: '198.51.100.7' },
    );
    assert.equal(headers.get('oxygen-buyer-ip'), null);
    assert.equal(headers.get('cf-connecting-ip'), null);
    assert.equal(headers.get('true-client-ip'), null);
    assert.equal(headers.get('accept'), 'x');
  }
});

test('buildRequestHeaders: without a trusted proxy x-real-ip comes from the socket and x-forwarded-for is dropped', () => {
  const headers = buildRequestHeaders(spoofed, { trustProxy: false, remoteAddress: '198.51.100.7' });
  assert.equal(headers.get('x-real-ip'), '198.51.100.7');
  assert.equal(headers.get('x-forwarded-for'), null);
  assert.equal(headers.get('user-agent'), 'test');
  // Two spoofed copies still end as the one socket value.
  const twice = buildRequestHeaders(['X-Real-IP', '1.1.1.1', 'x-real-ip', '2.2.2.2'], {
    trustProxy: false,
    remoteAddress: '198.51.100.7',
  });
  assert.equal(twice.get('x-real-ip'), '198.51.100.7');
});

test('buildRequestHeaders: an IPv4-mapped socket address is shown as plain IPv4; no socket address sets nothing', () => {
  assert.equal(
    buildRequestHeaders([], { trustProxy: false, remoteAddress: '::ffff:203.0.113.5' }).get('x-real-ip'),
    '203.0.113.5',
  );
  assert.equal(
    buildRequestHeaders([], { trustProxy: false, remoteAddress: '2001:db8::1' }).get('x-real-ip'),
    '2001:db8::1',
  );
  assert.equal(buildRequestHeaders(['x-real-ip', '9.9.9.9'], { trustProxy: false }).get('x-real-ip'), null);
});

test('buildRequestHeaders: with a trusted proxy its x-real-ip and x-forwarded-for pass unchanged', () => {
  const headers = buildRequestHeaders(spoofed, { trustProxy: true, remoteAddress: '127.0.0.1' });
  assert.equal(headers.get('x-real-ip'), '10.9.9.6');
  assert.equal(headers.get('x-forwarded-for'), '10.9.9.5');
});

test('adapter: spoofed address headers never reach the handler; x-real-ip is the socket address', async () => {
  let seen;
  const handler = async (request) => {
    seen = Object.fromEntries(request.headers);
    return new Response('ok');
  };
  await withServer(handler, { trustProxy: false }, async ({ port }) => {
    const res = await rawRequest(port, {
      path: '/',
      headers: {
        host: 'shop.example.com',
        'oxygen-buyer-ip': '10.1.1.1',
        'cf-connecting-ip': '10.1.1.2',
        'true-client-ip': '10.1.1.3',
        'x-real-ip': '10.1.1.4',
        'x-forwarded-for': '10.1.1.5',
      },
    });
    assert.equal(res.status, 200);
  });
  assert.equal(seen['oxygen-buyer-ip'], undefined);
  assert.equal(seen['cf-connecting-ip'], undefined);
  assert.equal(seen['true-client-ip'], undefined);
  assert.equal(seen['x-forwarded-for'], undefined);
  assert.equal(seen['x-real-ip'], '127.0.0.1');
});

test('adapter: behind a trusted proxy the proxy x-real-ip arrives and spoofed platform headers still do not', async () => {
  let seen;
  const handler = async (request) => {
    seen = Object.fromEntries(request.headers);
    return new Response('ok');
  };
  await withServer(handler, { trustProxy: true }, async ({ port }) => {
    await rawRequest(port, {
      path: '/',
      headers: {
        host: 'shop.example.com',
        'x-real-ip': '203.0.113.9',
        'oxygen-buyer-ip': '10.1.1.1',
        'true-client-ip': '10.1.1.3',
      },
    });
  });
  assert.equal(seen['x-real-ip'], '203.0.113.9');
  assert.equal(seen['oxygen-buyer-ip'], undefined);
  assert.equal(seen['true-client-ip'], undefined);
});
