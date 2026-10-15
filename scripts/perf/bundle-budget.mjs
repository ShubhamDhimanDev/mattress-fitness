#!/usr/bin/env node
// Client JavaScript weight per route, from a production build, compared with proposed budgets (P7-06, NFR-002).
//
// What it measures: the files a browser must download to start a route on a cold load. React Router's build writes a
// manifest (`assets/manifest-*.js`) that lists, for the entry and for every route, the module and the static chunks
// it imports. A route's initial JavaScript is the entry plus the root route plus the route and each parent layout
// between them. Chunks loaded later (dynamic `import()`: quiz scoring, maps and so on) are not counted, which is the
// point of lazy loading them. Sizes are gzip level 9 of the file bytes, close to what a CDN sends.
//
// This is a LOCAL size check, not Lighthouse: it says nothing about LCP, INP or CLS. Zero dependencies: node: builtins
// only. Usage:  node ../scripts/perf/bundle-budget.mjs [--dist dist/client] [--budgets <file>] [--json]
// Exit codes: 0 within budget, 1 a route is over budget, 2 bad flags or an unreadable build.

import { readFileSync, readdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXIT_FAILED, EXIT_OK, EXIT_USAGE, isMainModule, parseFlags } from '../lib/cli.mjs';

const MANIFEST_PREFIX = /^window\.__reactRouterManifest\s*=\s*/;
const ASSET_URL = /\/assets\/[A-Za-z0-9_.$@%+~-]+\.css/g;

/**
 * @typedef {{ module: string, imports: string[], css: string[], parentId?: string }} RouteEntry
 * @typedef {{ entry: { module: string, imports: string[], css: string[] }, routes: Record<string, RouteEntry> }} BuildManifest
 */

/**
 * @param {string} text contents of `manifest-*.js`
 * @returns {BuildManifest}
 */
export function parseManifest(text) {
  const body = text.trim().replace(MANIFEST_PREFIX, '').replace(/;\s*$/, '');
  const data = JSON.parse(body);
  if (!isRecord(data) || !isRecord(data.entry) || !isRecord(data.routes)) {
    throw new Error('Not a React Router build manifest');
  }
  /** @type {Record<string, RouteEntry>} */
  const routes = {};
  for (const [id, route] of Object.entries(data.routes)) {
    if (!isRecord(route) || typeof route.module !== 'string') continue;
    routes[id] = {
      module: route.module,
      imports: stringList(route.imports),
      css: stringList(route.css),
      ...(typeof route.parentId === 'string' ? { parentId: route.parentId } : {}),
    };
  }
  return {
    entry: {
      module: typeof data.entry.module === 'string' ? data.entry.module : '',
      imports: stringList(data.entry.imports),
      css: stringList(data.entry.css),
    },
    routes,
  };
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** @param {unknown} value @returns {string[]} */
function stringList(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
}

/**
 * The route ids from the root down to this route. An id whose parent is missing ends the chain (a malformed manifest
 * must not loop).
 * @param {BuildManifest} manifest
 * @param {string} routeId
 * @returns {string[]}
 */
export function routeChain(manifest, routeId) {
  /** @type {string[]} */
  const chain = [];
  const seen = new Set();
  let current = manifest.routes[routeId] ? routeId : undefined;
  while (current && !seen.has(current)) {
    seen.add(current);
    chain.unshift(current);
    current = manifest.routes[current]?.parentId;
  }
  return chain;
}

/**
 * Every JavaScript asset URL needed to start the route, each once, entry first.
 * @param {BuildManifest} manifest
 * @param {string} routeId
 * @returns {string[]}
 */
export function initialScripts(manifest, routeId) {
  const urls = new Set();
  const add = (/** @type {string} */ url) => {
    if (url) urls.add(url);
  };
  add(manifest.entry.module);
  manifest.entry.imports.forEach(add);
  for (const id of routeChain(manifest, routeId)) {
    const route = manifest.routes[id];
    if (!route) continue;
    add(route.module);
    route.imports.forEach(add);
  }
  return [...urls];
}

/**
 * Sizes of one file in bytes: raw and gzip.
 * @param {Buffer} bytes
 */
export function sizeOf(bytes) {
  return { raw: bytes.length, gzip: gzipSync(bytes, { level: 9 }).length };
}

/**
 * Route ids a budget group covers. A group lists exact route ids; an id that is not in the build is reported by
 * `evaluate` (a renamed route must not silently drop out of the check).
 * @typedef {{ name: string, routes: string[], maxGzipKb: number }} BudgetGroup
 * @typedef {{ url: string, raw: number, gzip: number }} AssetSize
 */

/**
 * @param {BuildManifest} manifest
 * @param {(url: string) => AssetSize | null} sizeLookup null when the file is missing from the build
 * @param {readonly BudgetGroup[]} groups
 * @returns {{ groups: Array<{ name: string, route: string, files: number, raw: number, gzip: number, maxGzipKb: number, status: 'ok' | 'over' | 'missing-route' | 'missing-file', detail?: string }> }}
 */
export function evaluate(manifest, sizeLookup, groups) {
  const rows = [];
  for (const group of groups) {
    for (const route of group.routes) {
      if (!manifest.routes[route]) {
        rows.push({ name: group.name, route, files: 0, raw: 0, gzip: 0, maxGzipKb: group.maxGzipKb, status: /** @type {const} */ ('missing-route') });
        continue;
      }
      let raw = 0;
      let gzip = 0;
      let files = 0;
      /** @type {string | undefined} */
      let missing;
      for (const url of initialScripts(manifest, route)) {
        const size = sizeLookup(url);
        if (!size) {
          missing = url;
          continue;
        }
        files += 1;
        raw += size.raw;
        gzip += size.gzip;
      }
      const over = gzip > group.maxGzipKb * 1024;
      rows.push({
        name: group.name,
        route,
        files,
        raw,
        gzip,
        maxGzipKb: group.maxGzipKb,
        status: missing ? 'missing-file' : over ? 'over' : 'ok',
        ...(missing ? { detail: missing } : {}),
      });
    }
  }
  return { groups: rows };
}

const kb = (/** @type {number} */ bytes) => (bytes / 1024).toFixed(1);

/** @param {ReturnType<typeof evaluate>} result */
export function formatReport(result) {
  const lines = ['group        route                          files  raw kB   gzip kB  budget kB  status'];
  for (const row of result.groups) {
    lines.push(
      [
        row.name.padEnd(12),
        row.route.replace(/^routes\//, '').padEnd(30),
        String(row.files).padStart(5),
        kb(row.raw).padStart(8),
        kb(row.gzip).padStart(9),
        String(row.maxGzipKb).padStart(10),
        `  ${row.status}${row.detail ? ` (${row.detail})` : ''}`,
      ].join(' '),
    );
  }
  return lines.join('\n');
}

/**
 * Reads the budgets file and checks its shape; throws a plain Error naming the problem.
 * @param {unknown} data
 * @returns {BudgetGroup[]}
 */
export function parseBudgets(data) {
  if (!isRecord(data) || !Array.isArray(data.groups) || data.groups.length === 0) {
    throw new Error('Budgets file needs a non-empty "groups" array');
  }
  return data.groups.map((group, index) => {
    if (
      !isRecord(group) ||
      typeof group.name !== 'string' ||
      !Array.isArray(group.routes) ||
      group.routes.length === 0 ||
      !group.routes.every((route) => typeof route === 'string') ||
      typeof group.maxGzipKb !== 'number' ||
      !Number.isFinite(group.maxGzipKb) ||
      group.maxGzipKb <= 0
    ) {
      throw new Error(`Budgets group ${index} needs a name, routes (strings) and a positive maxGzipKb`);
    }
    return { name: group.name, routes: group.routes, maxGzipKb: group.maxGzipKb };
  });
}

/**
 * @param {string} distDir the client build directory (contains `assets/`)
 */
export function loadBuild(distDir) {
  const assets = path.join(distDir, 'assets');
  const manifestFile = readdirSync(assets).find((name) => /^manifest-.*\.js$/.test(name));
  if (!manifestFile) throw new Error(`No manifest-*.js in ${assets}; run "npm run build" first`);
  const manifest = parseManifest(readFileSync(path.join(assets, manifestFile), 'utf8'));
  /** @type {Map<string, AssetSize | null>} */
  const cache = new Map();
  /** @param {string} url */
  const sizeLookup = (url) => {
    if (cache.has(url)) return cache.get(url) ?? null;
    // The manifest URLs are "/assets/<file>"; resolve inside the build directory only.
    const file = path.resolve(distDir, `.${url}`);
    let size = null;
    if (file.startsWith(path.resolve(distDir) + path.sep)) {
      try {
        size = { url, ...sizeOf(readFileSync(file)) };
      } catch {
        size = null;
      }
    }
    cache.set(url, size);
    return size;
  };
  return { manifest, sizeLookup, assets };
}

/**
 * The CSS a route loads is linked from the root module (`?url` imports), so it is not in the manifest: find the
 * stylesheet URLs named inside the route's scripts.
 * @param {BuildManifest} manifest
 * @param {string} distDir
 * @param {string} routeId
 * @returns {{ url: string, raw: number, gzip: number }[]}
 */
export function stylesheetsFor(manifest, distDir, routeId) {
  const found = new Set();
  for (const url of initialScripts(manifest, routeId)) {
    const file = path.resolve(distDir, `.${url}`);
    if (!file.startsWith(path.resolve(distDir) + path.sep)) continue;
    try {
      for (const match of readFileSync(file, 'utf8').matchAll(ASSET_URL)) found.add(match[0]);
    } catch {
      // A missing script is reported by evaluate().
    }
  }
  const sheets = [];
  for (const url of found) {
    try {
      sheets.push({ url, ...sizeOf(readFileSync(path.resolve(distDir, `.${url}`))) });
    } catch {
      // Not a file in this build.
    }
  }
  return sheets;
}

/** @param {readonly string[]} argv */
export function main(argv) {
  const parsed = parseFlags(argv, {
    dist: { type: 'string' },
    budgets: { type: 'string' },
    json: { type: 'boolean' },
  });
  if (!parsed.ok) {
    console.error(parsed.message);
    return EXIT_USAGE;
  }
  const here = path.dirname(fileURLToPath(import.meta.url));
  const distDir = path.resolve(typeof parsed.values.dist === 'string' ? parsed.values.dist : 'dist/client');
  const budgetsFile = typeof parsed.values.budgets === 'string' ? parsed.values.budgets : path.join(here, 'bundle-budgets.json');
  try {
    const groups = parseBudgets(JSON.parse(readFileSync(budgetsFile, 'utf8')));
    const { manifest, sizeLookup } = loadBuild(distDir);
    const result = evaluate(manifest, sizeLookup, groups);
    const failed = result.groups.some((row) => row.status !== 'ok');
    if (parsed.values.json === true) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(formatReport(result));
      const sheets = stylesheetsFor(manifest, distDir, 'root');
      for (const sheet of sheets) console.log(`css (all routes)  ${sheet.url}  raw ${kb(sheet.raw)} kB  gzip ${kb(sheet.gzip)} kB`);
      console.log(failed ? '\nOver budget, or a route or file is missing from the build.' : '\nAll routes within the proposed budgets.');
    }
    return failed ? EXIT_FAILED : EXIT_OK;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return EXIT_USAGE;
  }
}

if (isMainModule(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
