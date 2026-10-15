import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { evaluate, formatReport, initialScripts, loadBuild, main, parseBudgets, parseManifest, routeChain, sizeOf } from './bundle-budget.mjs';

// P7-06 groundwork (NFR-002): the bundle size check reads React Router's build manifest and compares the JavaScript a
// route needs with budgets. These tests build a tiny fake build directory; no real build is needed.

const MANIFEST = {
  entry: { module: '/assets/entry.js', imports: ['/assets/react.js'], css: [] },
  routes: {
    root: { id: 'root', module: '/assets/root.js', imports: ['/assets/react.js', '/assets/ui.js'], css: [] },
    'routes/account': { id: 'routes/account', parentId: 'root', module: '/assets/account.js', imports: ['/assets/ui.js'], css: [] },
    'routes/account.orders': { id: 'routes/account.orders', parentId: 'routes/account', module: '/assets/orders.js', imports: ['/assets/table.js'], css: [] },
    'routes/home': { id: 'routes/home', parentId: 'root', module: '/assets/home.js', imports: [], css: [] },
  },
};
const manifestText = `window.__reactRouterManifest=${JSON.stringify(MANIFEST)};`;
const FILES = {
  'entry.js': 'e'.repeat(1000),
  'react.js': 'r'.repeat(4000),
  'root.js': 'o'.repeat(2000),
  'ui.js': 'u'.repeat(3000),
  'account.js': 'a'.repeat(500),
  'orders.js': 'x'.repeat(700),
  'table.js': 't'.repeat(900),
  'home.js': 'h'.repeat(300),
};

/** @returns {string} a fake client build directory */
function fakeBuild() {
  const dir = mkdtempSync(path.join(tmpdir(), 'bundle-budget-'));
  mkdirSync(path.join(dir, 'assets'));
  writeFileSync(path.join(dir, 'assets', 'manifest-abc.js'), manifestText);
  for (const [name, text] of Object.entries(FILES)) writeFileSync(path.join(dir, 'assets', name), text);
  return dir;
}

test('parseManifest reads the window assignment and keeps only usable routes', () => {
  const manifest = parseManifest(manifestText);
  assert.equal(manifest.entry.module, '/assets/entry.js');
  assert.deepEqual(Object.keys(manifest.routes).sort(), ['root', 'routes/account', 'routes/account.orders', 'routes/home']);
  assert.equal(manifest.routes['routes/account'].parentId, 'root');
  assert.throws(() => parseManifest('window.__reactRouterManifest={"nope":1};'), /Not a React Router build manifest/);
  assert.throws(() => parseManifest('not json'));
});

test('routeChain walks from the root to the route and cannot loop', () => {
  const manifest = parseManifest(manifestText);
  assert.deepEqual(routeChain(manifest, 'routes/account.orders'), ['root', 'routes/account', 'routes/account.orders']);
  assert.deepEqual(routeChain(manifest, 'missing'), []);
  manifest.routes.root.parentId = 'routes/home'; // a malformed cycle
  assert.ok(routeChain(manifest, 'routes/home').length <= 2);
});

test('initialScripts is the entry, the root and every layout up to the route, each file once', () => {
  const manifest = parseManifest(manifestText);
  assert.deepEqual(initialScripts(manifest, 'routes/account.orders'), [
    '/assets/entry.js',
    '/assets/react.js',
    '/assets/root.js',
    '/assets/ui.js',
    '/assets/account.js',
    '/assets/orders.js',
    '/assets/table.js',
  ]);
  assert.deepEqual(initialScripts(manifest, 'routes/home').slice(-1), ['/assets/home.js']);
});

test('sizeOf reports raw bytes and gzip bytes', () => {
  const bytes = Buffer.from('a'.repeat(5000));
  assert.deepEqual(sizeOf(bytes), { raw: 5000, gzip: gzipSync(bytes, { level: 9 }).length });
});

test('evaluate sums a route, flags one over budget, and reports a missing route or file', () => {
  const dir = fakeBuild();
  try {
    const { manifest, sizeLookup } = loadBuild(dir);
    const expected = initialScripts(manifest, 'routes/home').reduce((sum, url) => sum + (sizeLookup(url)?.gzip ?? 0), 0);
    const ok = evaluate(manifest, sizeLookup, [{ name: 'home', routes: ['routes/home'], maxGzipKb: 100 }]);
    assert.equal(ok.groups[0].status, 'ok');
    assert.equal(ok.groups[0].gzip, expected);
    assert.equal(ok.groups[0].files, 5);

    const tiny = evaluate(manifest, sizeLookup, [{ name: 'home', routes: ['routes/home'], maxGzipKb: 0.01 }]);
    assert.equal(tiny.groups[0].status, 'over');

    const gone = evaluate(manifest, sizeLookup, [{ name: 'old', routes: ['routes/renamed'], maxGzipKb: 100 }]);
    assert.equal(gone.groups[0].status, 'missing-route');

    const none = evaluate(manifest, () => null, [{ name: 'home', routes: ['routes/home'], maxGzipKb: 100 }]);
    assert.equal(none.groups[0].status, 'missing-file');
    assert.match(formatReport(ok), /home\s+5/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadBuild refuses a manifest URL that climbs out of the build directory', () => {
  const dir = fakeBuild();
  try {
    const { sizeLookup } = loadBuild(dir);
    assert.equal(sizeLookup('/../../etc/passwd'), null);
    assert.equal(sizeLookup('/assets/../../outside.js'), null);
    assert.notEqual(sizeLookup('/assets/home.js'), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('parseBudgets accepts the shipped shape and rejects malformed groups', () => {
  assert.equal(parseBudgets({ groups: [{ name: 'a', routes: ['x'], maxGzipKb: 10 }] })[0].maxGzipKb, 10);
  const bad = [
    null,
    {},
    { groups: [] },
    { groups: [{ name: 'a', routes: [], maxGzipKb: 1 }] },
    { groups: [{ name: 'a', routes: ['x'], maxGzipKb: 0 }] },
    { groups: [{ name: 'a', routes: [1], maxGzipKb: 1 }] },
    { groups: [{ routes: ['x'], maxGzipKb: 1 }] },
  ];
  for (const data of bad) assert.throws(() => parseBudgets(data), /Budgets/);
});

test('main exits 0 within budget, 1 over budget, 2 for bad flags or a missing build', () => {
  const dir = fakeBuild();
  const budgets = (kb) => {
    const file = path.join(dir, `budgets-${kb}.json`);
    writeFileSync(file, JSON.stringify({ groups: [{ name: 'home', routes: ['routes/home'], maxGzipKb: kb }] }));
    return file;
  };
  const log = console.log;
  const error = console.error;
  console.log = () => {};
  console.error = () => {};
  try {
    assert.equal(main(['--dist', dir, '--budgets', budgets(100)]), 0);
    assert.equal(main(['--dist', dir, '--budgets', budgets(0.01), '--json']), 1);
    assert.equal(main(['--dist', dir, '--nonsense']), 2);
    assert.equal(main(['--dist', path.join(dir, 'nope'), '--budgets', budgets(100)]), 2);
  } finally {
    console.log = log;
    console.error = error;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the shipped budgets file is well formed', () => {
  const text = readFileSync(new URL('./bundle-budgets.json', import.meta.url), 'utf8');
  const groups = parseBudgets(JSON.parse(text));
  assert.ok(groups.length >= 5);
  assert.ok(groups.every((group) => group.routes.every((route) => route.startsWith('routes/'))));
});
