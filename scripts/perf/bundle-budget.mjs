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
// Budgets: the file's "routes" map gives a per-route budget; a route without an entry falls back to its group's
// "maxGzipKb"; a route with neither fails ("no-budget"), so a new route cannot go unchecked.
// Each route row shows its headroom in bytes (budget minus measured). Under 1 kB of headroom prints a WARNING but still
// exits 0; only a route over budget (or without a budget, or missing from the build) fails.
// Exit codes: 0 within budget (warnings allowed), 1 a route failed, 2 bad flags, a bad budgets file or an unreadable build.

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
 * `evaluate` (a renamed route must not silently drop out of the check). `maxGzipKb` is the group's fallback budget for
 * a route without its own entry in the per-route map; a group may omit it when every route has its own.
 * @typedef {{ name: string, routes: string[], maxGzipKb?: number }} BudgetGroup
 * @typedef {Readonly<Record<string, number>>} RouteBudgets route id to budget in kB; overrides the group budget
 * @typedef {{ url: string, raw: number, gzip: number }} AssetSize
 */

/**
 * The budget that applies to a route: its own entry first, then its group's, else none (a failure, so a new route in a
 * group without a fallback cannot go unchecked).
 * @param {BudgetGroup} group
 * @param {string} route
 * @param {RouteBudgets} routeBudgets
 * @returns {{ kb: number, source: 'route' | 'group' } | null}
 */
export function budgetFor(group, route, routeBudgets) {
  const own = routeBudgets[route];
  if (typeof own === 'number') return { kb: own, source: 'route' };
  if (typeof group.maxGzipKb === 'number') return { kb: group.maxGzipKb, source: 'group' };
  return null;
}

/**
 * @param {BuildManifest} manifest
 * @param {(url: string) => AssetSize | null} sizeLookup null when the file is missing from the build
 * @param {readonly BudgetGroup[]} groups
 * @param {RouteBudgets} [routeBudgets] per-route budgets that override the group's
 * @returns {{ groups: Array<{ name: string, route: string, files: number, raw: number, gzip: number, maxGzipKb: number | null, budgetSource: 'route' | 'group' | null, headroom: number | null, tight: boolean, status: 'ok' | 'over' | 'missing-route' | 'missing-file' | 'no-budget', detail?: string }> }}
 */
export function evaluate(manifest, sizeLookup, groups, routeBudgets = {}) {
  const rows = [];
  for (const group of groups) {
    for (const route of group.routes) {
      const budget = budgetFor(group, route, routeBudgets);
      const maxGzipKb = budget ? budget.kb : null;
      const budgetSource = budget ? budget.source : null;
      if (!manifest.routes[route]) {
        rows.push({ name: group.name, route, files: 0, raw: 0, gzip: 0, maxGzipKb, budgetSource, headroom: null, tight: false, status: /** @type {const} */ ('missing-route') });
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
      const headroom = budget ? headroomBytes(gzip, budget.kb) : null;
      /** @type {'ok' | 'over' | 'missing-file' | 'no-budget'} */
      let status = 'ok';
      if (missing) status = 'missing-file';
      else if (!budget) status = 'no-budget';
      else if (headroom !== null && headroom < 0) status = 'over';
      rows.push({
        name: group.name,
        route,
        files,
        raw,
        gzip,
        maxGzipKb,
        budgetSource,
        headroom: missing ? null : headroom,
        tight: !missing && headroom !== null && isTight(headroom),
        status,
        ...(missing ? { detail: missing } : {}),
      });
    }
  }
  return { groups: rows };
}

const kb = (/** @type {number} */ bytes) => (bytes / 1024).toFixed(1);

/**
 * Below this many bytes of room a route is "tight": still a pass, but the next feature will probably break the check,
 * so the report warns (exit code stays 0). Gzip of a content-hashed file set moves by tens of bytes on any edit, so a
 * margin of a few hundred bytes cannot be relied on. A feature that needs more room splits code or justifies a new
 * budget with a recorded decision (docs/testing/PERFORMANCE.md).
 */
export const WARN_HEADROOM_BYTES = 1024;

/**
 * Bytes left under the budget (negative when over). Rounded because a budget such as 130.5 kB is not always a whole
 * number of bytes.
 * @param {number} gzipBytes
 * @param {number} maxGzipKb
 */
export function headroomBytes(gzipBytes, maxGzipKb) {
  return Math.round(maxGzipKb * 1024 - gzipBytes);
}

/** @param {number} headroom */
export function isTight(headroom) {
  return headroom >= 0 && headroom < WARN_HEADROOM_BYTES;
}

/**
 * What the exit code and the closing message depend on. Only an over-budget route, a route missing from the build or a
 * missing file fails; a tight route only warns.
 * @param {ReturnType<typeof evaluate>} result
 */
export function summarise(result) {
  const failed = result.groups.some((row) => row.status !== 'ok');
  const tight = result.groups.filter((row) => row.status === 'ok' && row.tight);
  return { failed, tight };
}

/** @param {ReturnType<typeof evaluate>} result */
export function formatReport(result) {
  const lines = ['group        route                          files  raw kB   gzip kB  budget kB  headroom B  status'];
  for (const row of result.groups) {
    const status = row.status === 'ok' && row.tight ? 'WARNING tight' : row.status;
    lines.push(
      [
        row.name.padEnd(12),
        row.route.replace(/^routes\//, '').padEnd(30),
        String(row.files).padStart(5),
        kb(row.raw).padStart(8),
        kb(row.gzip).padStart(9),
        (row.maxGzipKb === null ? '-' : String(row.maxGzipKb)).padStart(10),
        (row.headroom === null ? '-' : String(row.headroom)).padStart(11),
        `  ${status}${row.detail ? ` (${row.detail})` : ''}`,
      ].join(' '),
    );
  }
  return lines.join('\n');
}

/**
 * The closing lines of the text report.
 * @param {ReturnType<typeof summarise>} summary
 */
export function formatSummary(summary) {
  if (summary.failed) return '\nOver budget, a route has no budget, or a route or file is missing from the build.';
  const lines = ['\nAll routes within the proposed budgets.'];
  if (summary.tight.length > 0) {
    const names = summary.tight.map((row) => row.route.replace(/^routes\//, '')).join(', ');
    lines.push(
      `WARNING: ${summary.tight.length} route(s) have under ${WARN_HEADROOM_BYTES} bytes of headroom (${names}). The next feature may fail this check: split code, or justify and re-baseline the budget with a recorded decision.`,
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
      (group.maxGzipKb !== undefined && !isPositiveNumber(group.maxGzipKb))
    ) {
      throw new Error(`Budgets group ${index} needs a name, routes (strings) and, when present, a positive maxGzipKb`);
    }
    return {
      name: group.name,
      routes: group.routes,
      ...(typeof group.maxGzipKb === 'number' ? { maxGzipKb: group.maxGzipKb } : {}),
    };
  });
}

/** @param {unknown} value @returns {value is number} */
function isPositiveNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * Reads the optional per-route budgets (`routes`: route id to kB). An entry for a route that no group lists would never
 * be checked, so it is refused rather than ignored.
 * @param {unknown} data the parsed budgets file
 * @param {readonly BudgetGroup[]} groups
 * @returns {Record<string, number>}
 */
export function parseRouteBudgets(data, groups) {
  const raw = isRecord(data) ? data.routes : undefined;
  if (raw === undefined) return {};
  if (!isRecord(raw)) throw new Error('Budgets "routes" must be an object of route id to kB');
  const listed = new Set(groups.flatMap((group) => group.routes));
  /** @type {Record<string, number>} */
  const budgets = {};
  for (const [route, value] of Object.entries(raw)) {
    if (!isPositiveNumber(value)) throw new Error(`Budget for route "${route}" must be a positive number of kB`);
    if (!listed.has(route)) throw new Error(`Budget for route "${route}" is not listed in any group, so it would never be checked`);
    budgets[route] = value;
  }
  return budgets;
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
    const budgetData = JSON.parse(readFileSync(budgetsFile, 'utf8'));
    const groups = parseBudgets(budgetData);
    const routeBudgets = parseRouteBudgets(budgetData, groups);
    const { manifest, sizeLookup } = loadBuild(distDir);
    const result = evaluate(manifest, sizeLookup, groups, routeBudgets);
    const summary = summarise(result);
    if (parsed.values.json === true) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(formatReport(result));
      const sheets = stylesheetsFor(manifest, distDir, 'root');
      for (const sheet of sheets) console.log(`css (all routes)  ${sheet.url}  raw ${kb(sheet.raw)} kB  gzip ${kb(sheet.gzip)} kB`);
      console.log(formatSummary(summary));
    }
    return summary.failed ? EXIT_FAILED : EXIT_OK;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return EXIT_USAGE;
  }
}

if (isMainModule(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
