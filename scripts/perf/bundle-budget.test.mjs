import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { WARN_HEADROOM_BYTES, evaluate, formatReport, formatSummary, headroomBytes, initialScripts, isTight, loadBuild, main, parseBudgets, parseManifest, routeChain, sizeOf, summarise } from './bundle-budget.mjs';

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

// Headroom and warning logic, with fake measurements (a lookup that returns chosen gzip sizes; no files).

const ONE_ROUTE = parseManifest(
  `window.__reactRouterManifest=${JSON.stringify({
    entry: { module: '/assets/e.js', imports: [], css: [] },
    routes: { 'routes/home': { id: 'routes/home', module: '/assets/h.js', imports: [], css: [] } },
  })};`,
);
/** @param {number} gzip total gzip bytes, split over the two files of the route */
const fakeSizes = (gzip) => (url) => ({ url, raw: gzip * 3, gzip: url === '/assets/e.js' ? gzip - 100 : 100 });
const kbBytes = (kb) => kb * 1024;

test('headroomBytes is budget minus measured, negative when over, rounded for fractional budgets', () => {
  assert.equal(headroomBytes(1000, 2), 1048);
  assert.equal(headroomBytes(2048, 2), 0);
  assert.equal(headroomBytes(2049, 2), -1);
  assert.equal(headroomBytes(133000, 130.5), 632);
});

test('isTight is true only below the warning threshold and not for a failing route', () => {
  assert.equal(WARN_HEADROOM_BYTES, 1024);
  assert.equal(isTight(0), true);
  assert.equal(isTight(WARN_HEADROOM_BYTES - 1), true);
  assert.equal(isTight(WARN_HEADROOM_BYTES), false);
  assert.equal(isTight(5000), false);
  assert.equal(isTight(-1), false);
});

test('evaluate reports headroom per route and marks a tight route without failing it', () => {
  const groups = [{ name: 'home', routes: ['routes/home'], maxGzipKb: 100 }];
  const roomy = evaluate(ONE_ROUTE, fakeSizes(kbBytes(100) - 2000), groups).groups[0];
  assert.deepEqual([roomy.status, roomy.headroom, roomy.tight], ['ok', 2000, false]);

  const tight = evaluate(ONE_ROUTE, fakeSizes(kbBytes(100) - 80), groups).groups[0];
  assert.deepEqual([tight.status, tight.headroom, tight.tight], ['ok', 80, true]);

  const exact = evaluate(ONE_ROUTE, fakeSizes(kbBytes(100)), groups).groups[0];
  assert.deepEqual([exact.status, exact.headroom, exact.tight], ['ok', 0, true]);

  const over = evaluate(ONE_ROUTE, fakeSizes(kbBytes(100) + 1), groups).groups[0];
  assert.deepEqual([over.status, over.headroom, over.tight], ['over', -1, false]);

  const missingFile = evaluate(ONE_ROUTE, () => null, groups).groups[0];
  assert.deepEqual([missingFile.status, missingFile.headroom, missingFile.tight], ['missing-file', null, false]);
  const missingRoute = evaluate(ONE_ROUTE, fakeSizes(1), [{ name: 'x', routes: ['routes/gone'], maxGzipKb: 1 }]).groups[0];
  assert.deepEqual([missingRoute.status, missingRoute.headroom, missingRoute.tight], ['missing-route', null, false]);
});

test('summarise fails only when a route is over or missing, and lists tight routes as warnings', () => {
  const groups = [
    { name: 'home', routes: ['routes/home'], maxGzipKb: 100 },
    { name: 'again', routes: ['routes/home'], maxGzipKb: 120 },
  ];
  const result = evaluate(ONE_ROUTE, fakeSizes(kbBytes(100) - 500), groups);
  const summary = summarise(result);
  assert.equal(summary.failed, false);
  assert.equal(summary.tight.length, 1);
  assert.match(formatSummary(summary), /All routes within/);
  assert.match(formatSummary(summary), /WARNING: 1 route\(s\) have under 1024 bytes of headroom \(home\)/);
  assert.match(formatReport(result), /headroom B/);
  assert.match(formatReport(result), /500\s+WARNING tight/);

  const fine = summarise(evaluate(ONE_ROUTE, fakeSizes(kbBytes(100) - 5000), [groups[0]]));
  assert.deepEqual([fine.failed, fine.tight.length], [false, 0]);
  assert.doesNotMatch(formatSummary(fine), /WARNING/);

  const failing = summarise(evaluate(ONE_ROUTE, fakeSizes(kbBytes(100) + 10), [groups[0]]));
  assert.equal(failing.failed, true);
  assert.match(formatSummary(failing), /Over budget/);
});

test('main exits 0 with a warning for a tight route and prints headroom in --json', () => {
  const dir = fakeBuild();
  const logs = [];
  const log = console.log;
  console.log = (message) => logs.push(String(message));
  try {
    const { manifest, sizeLookup } = loadBuild(dir);
    const gzip = initialScripts(manifest, 'routes/home').reduce((sum, url) => sum + (sizeLookup(url)?.gzip ?? 0), 0);
    const file = path.join(dir, 'tight.json');
    writeFileSync(file, JSON.stringify({ groups: [{ name: 'home', routes: ['routes/home'], maxGzipKb: (gzip + 200) / 1024 }] }));
    assert.equal(main(['--dist', dir, '--budgets', file]), 0);
    assert.ok(logs.some((line) => line.includes('WARNING: 1 route(s)')));
    logs.length = 0;
    assert.equal(main(['--dist', dir, '--budgets', file, '--json']), 0);
    const row = JSON.parse(logs.join('\n')).groups[0];
    assert.deepEqual([row.headroom, row.tight], [200, true]);
  } finally {
    console.log = log;
    rmSync(dir, { recursive: true, force: true });
  }
});
