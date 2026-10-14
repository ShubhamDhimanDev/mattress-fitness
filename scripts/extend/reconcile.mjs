#!/usr/bin/env node
// Extend reconciliation (P5A-14, P5A-10, REQ-EXT-003, T-03, T-06): compares Shopify orders that carry coverage lines with
// what Extend holds, reports every mismatch, and can re-send the missing syncs. It is the safety net for the webhook
// route, which answers 200 before its background sync finishes (ADR-0009 addendum).
//
//   node scripts/extend/reconcile.mjs --store shop.myshopify.com --since 2026-10-01 --extend-source mock
//   node scripts/extend/reconcile.mjs --store shop.myshopify.com --extend-source file --extend-file extend-orders.json
//   ... --resend --live      re-send the orders that are missing or out of step (otherwise a dry run only reports)
//
// Safety: read-only by default; contact with a store needs SHOPIFY_ALLOWED_STORES; --resend needs --live AND an Extend host
// that is the local mock or the demo host (production is refused: it needs the owner's written authorisation, so it is
// not offered here). Output holds order, line and plan ids and short reasons only, never names, emails or addresses.
// Extend documents NO way to read orders back (EXTEND.md 7.5 item 7), so the Extend side is the MOCK's stored state
// (GET /__mock/orders, invented by the mock) or a JSON export a person obtained from Extend (--extend-file).
// Zero dependencies; the comparison itself is the storefront's own reconcile.ts, loaded through ts-loader.mjs.

import { readFile } from 'node:fs/promises';
import { EXIT_FAILED, EXIT_OK, EXIT_REFUSED, EXIT_USAGE, isMainModule, parseFlags, renderTable } from '../lib/cli.mjs';
import { checkLiveAllowed, checkStoreAllowed, readAdminToken, ENV_STORE_DOMAIN } from '../lib/env.mjs';
import { createLogger } from '../lib/redact.mjs';
import { connectionNodes, createAdminClient, isRecord } from '../lib/shopify-admin.mjs';
import { loadExtendLibs } from './ts-loader.mjs';

const PAGE_SIZE = 5; // five orders x 100 line items keeps one page under Shopify's single query cost limit
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;
const DEFAULT_DAYS = 14;
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
const RESEND_KINDS = new Set(['missing_sync', 'status_mismatch', 'contract_missing', 'quantity_mismatch', 'price_mismatch']);

const USAGE = `Usage: node scripts/extend/reconcile.mjs --store <shop>.myshopify.com [--since YYYY-MM-DD] [--limit ${DEFAULT_LIMIT}]
         --extend-source mock|file [--extend-file <export.json>] [--json] [--resend --live]
Environment: SHOPIFY_ADMIN_API_ACCESS_TOKEN, SHOPIFY_ALLOWED_STORES, EXTEND_API_HOST, EXTEND_STORE_ID, EXTEND_ACCESS_TOKEN.`;

/** @param {number} days @param {() => number} now */
function defaultSince(days, now) {
  return new Date(now() - days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Pages through orders created since the date, newest first as Shopify returns them, up to the limit.
 * An order whose line items do not fit one page cannot be summarised completely and is listed as unparsed, never guessed.
 * @param {import('../lib/shopify-admin.mjs').AdminClient} client
 * @param {Awaited<ReturnType<typeof loadExtendLibs>>} libs
 * @param {{ since: string, limit: number }} options
 */
export async function fetchShopifyOrders(client, libs, { since, limit }) {
  /** @type {import('../../storefront/app/lib/extend/orders').ShopifyOrderLike[]} */
  const orders = [];
  /** @type {{ orderId: string, reason: string }[]} */
  const unparsed = [];
  let after = null;
  let truncated = false;
  for (;;) {
    const result = await client.request(
      libs.EXTEND_ORDERS_PAGE_QUERY,
      { first: PAGE_SIZE, after, query: `created_at:>=${since}` },
      { operationName: 'ExtendOrdersPage', estimatedCost: 600 },
    );
    if (!result.ok) return { ok: false, error: result.error.message };
    const connection = result.data.orders;
    for (const node of connectionNodes(connection)) {
      if (orders.length + unparsed.length >= limit) {
        truncated = true;
        break;
      }
      const parsed = libs.parseAdminOrder(node);
      if (parsed.status === 'ok') orders.push(parsed.order);
      else unparsed.push({ orderId: libs.normalizeShopifyId(isRecord(node) ? String(node.id) : '') ?? 'unknown', reason: parsed.reason });
    }
    const page = isRecord(connection) && isRecord(connection.pageInfo) ? connection.pageInfo : {};
    if (truncated) break;
    if (page.hasNextPage !== true || typeof page.endCursor !== 'string') break;
    after = page.endCursor;
  }
  return { ok: true, orders, unparsed, truncated };
}

/** @param {unknown} value @returns {value is import('../../storefront/app/lib/extend/reconcile').ExtendStoredOrder} */
function isStoredOrder(value) {
  return (
    isRecord(value) &&
    isRecord(value.snapshot) &&
    typeof value.snapshot.transactionId === 'string' &&
    Array.isArray(value.snapshot.lineItems) &&
    Array.isArray(value.contracts)
  );
}

/** @param {unknown} json */
export function readStoredOrders(json) {
  const list = Array.isArray(json) ? json : isRecord(json) && Array.isArray(json.orders) ? json.orders : null;
  if (list === null) return { ok: false, error: 'The Extend export must be a list of orders or { "orders": [...] }.' };
  const bad = list.findIndex((entry) => !isStoredOrder(entry));
  if (bad >= 0) return { ok: false, error: `Extend export entry ${bad} does not have snapshot.transactionId, snapshot.lineItems and contracts.` };
  return { ok: true, orders: /** @type {import('../../storefront/app/lib/extend/reconcile').ExtendStoredOrder[]} */ (list) };
}

/**
 * @param {{ source: string, file?: string, env: Record<string, string | undefined>, fetch: typeof fetch }} options
 * @param {Awaited<ReturnType<typeof loadExtendLibs>>} libs
 */
export async function readExtendOrders(options, libs) {
  if (options.source === 'file') {
    if (!options.file) return { ok: false, error: '--extend-file is required with --extend-source file.' };
    try {
      return readStoredOrders(JSON.parse(await readFile(options.file, 'utf8')));
    } catch {
      return { ok: false, error: 'The Extend export file could not be read as JSON.' };
    }
  }
  // source === 'mock'
  const host = libs.parseExtendHost(options.env.EXTEND_API_HOST ?? '');
  const token = options.env.EXTEND_ACCESS_TOKEN;
  if (host === null || !LOOPBACK.has(new URL(host).hostname)) {
    return { ok: false, error: 'The mock source reads only a loopback EXTEND_API_HOST. Extend documents no read-back; use --extend-source file with an export.' };
  }
  if (!token) return { ok: false, error: 'EXTEND_ACCESS_TOKEN is not set.' };
  try {
    const response = await options.fetch(`${host}/__mock/orders`, {
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
      headers: { 'X-Extend-Access-Token': token, Accept: 'application/json;version=2022-02-01' },
    });
    if (!response.ok) return { ok: false, error: `The mock answered HTTP ${response.status}.` };
    return readStoredOrders(await response.json());
  } catch {
    return { ok: false, error: 'The mock could not be reached.' };
  }
}

/**
 * Real quotes for each order's coverage lines, asked of the Offers API before the pure comparison runs.
 * An order whose quotes cannot be obtained is set aside, not judged: an unverifiable price must not look like drift.
 * @param {import('../../storefront/app/lib/extend/orders').ShopifyOrderLike[]} orders
 * @param {Awaited<ReturnType<typeof loadExtendLibs>>} libs
 * @param {ReturnType<Awaited<ReturnType<typeof loadExtendLibs>>['parseExtendConfig']>} config
 * @param {typeof fetch} fetchFn
 */
export async function collectQuotes(orders, libs, config, fetchFn) {
  /** @type {Map<string, Map<string, unknown>>} */
  const quotes = new Map();
  /** @type {string[]} */
  const skipped = [];
  for (const order of orders) {
    const perLine = new Map();
    let failed = false;
    for (const { lineId, query } of libs.listQuoteQueries(order)) {
      try {
        const lookup = libs.createOffersQuoteLookup({ config, fetch: (url, init) => fetchFn(url, init), eligibleCategories: [query.category] });
        perLine.set(lineId, await lookup(query));
      } catch {
        failed = true;
        break;
      }
    }
    if (failed) skipped.push(libs.normalizeShopifyId(order.id) ?? 'unknown');
    else quotes.set(order.id, perLine);
  }
  return { quotes, skipped };
}

/** @param {{ checkedOrders: number, issues: any[], summary: Record<string, number> }} report @param {{ skipped: string[], unparsed: any[], truncated: boolean }} extra */
export function renderReport(report, extra) {
  const lines = [`Checked ${report.checkedOrders} Shopify orders: ${report.issues.length} issue(s).`];
  const counts = Object.entries(report.summary).filter(([, count]) => count > 0);
  if (counts.length > 0) lines.push(counts.map(([kind, count]) => `${kind}=${count}`).join('  '));
  if (report.issues.length > 0) {
    lines.push('', renderTable(['kind', 'order', 'line', 'plan', 'detail'], report.issues.map((i) => [i.kind, i.orderId, i.lineId ?? '', i.planId ?? '', i.detail])));
  }
  if (extra.skipped.length > 0) lines.push('', `Not judged (Extend quotes unavailable): ${extra.skipped.join(', ')}`);
  if (extra.unparsed.length > 0) lines.push('', `Not judged (could not be read completely): ${extra.unparsed.map((u) => `${u.orderId} (${u.reason})`).join(', ')}`);
  if (extra.truncated) lines.push('', 'The order limit was reached: Extend orders outside the checked set are not reported as unexpected.');
  return lines.join('\n');
}

/**
 * Re-sends the orders the report says Extend is missing or out of step on, through the same syncOrder the webhook uses.
 * @param {Awaited<ReturnType<typeof loadExtendLibs>>} libs
 */
async function resendOrders(libs, orders, issues, config, fetchFn, log) {
  const wanted = new Set(issues.filter((issue) => RESEND_KINDS.has(issue.kind)).map((issue) => issue.orderId));
  /** @type {{ orderId: string, status: string }[]} */
  const results = [];
  for (const order of orders) {
    const id = libs.normalizeShopifyId(order.id);
    if (id === null || !wanted.has(id)) continue;
    const result = await libs.syncOrder(order, {
      config,
      fetch: (url, init) => fetchFn(url, init),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      now: () => Date.now(),
      // The covered product's own category makes it eligible here, exactly as in the webhook processor.
      lookupQuote: (query) => libs.createOffersQuoteLookup({ config, fetch: (url, init) => fetchFn(url, init), eligibleCategories: [query.category] })(query),
      log: (event) => log.info('extend sync', event),
    });
    results.push({ orderId: id, status: result.status });
  }
  return results;
}

/**
 * @param {readonly string[]} argv
 * @param {{ env?: Record<string, string | undefined>, fetch?: typeof fetch, now?: () => number, out?: (text: string) => void, err?: (text: string) => void, logWrite?: (line: string) => void }} [io]
 */
export async function main(argv, io = {}) {
  const env = io.env ?? process.env;
  const fetchFn = io.fetch ?? globalThis.fetch;
  const now = io.now ?? Date.now;
  const out = io.out ?? ((text) => console.log(text));
  const err = io.err ?? ((text) => console.error(text));
  const flags = parseFlags(argv, {
    store: { type: 'string' },
    since: { type: 'string' },
    limit: { type: 'string' },
    'extend-source': { type: 'string' },
    'extend-file': { type: 'string' },
    json: { type: 'boolean' },
    resend: { type: 'boolean' },
    live: { type: 'boolean' },
    help: { type: 'boolean' },
  });
  if (!flags.ok) {
    err(`${flags.message}\n${USAGE}`);
    return EXIT_USAGE;
  }
  const v = flags.values;
  if (v.help) {
    out(USAGE);
    return EXIT_OK;
  }
  const source = v['extend-source'];
  if (source !== 'mock' && source !== 'file') {
    err(`--extend-source must be "mock" or "file".\n${USAGE}`);
    return EXIT_USAGE;
  }
  const limit = v.limit === undefined ? DEFAULT_LIMIT : Number(v.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    err(`--limit must be a whole number from 1 to ${MAX_LIMIT}.`);
    return EXIT_USAGE;
  }
  const since = typeof v.since === 'string' ? v.since : defaultSince(DEFAULT_DAYS, now);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(since)) {
    err('--since must be a date such as 2026-10-01.');
    return EXIT_USAGE;
  }

  const store = typeof v.store === 'string' ? v.store : env[ENV_STORE_DOMAIN];
  const guard = v.resend ? checkLiveAllowed({ live: v.live === true, store, env }) : checkStoreAllowed({ store, env });
  if (!guard.ok) {
    err(guard.message);
    return guard.reason === 'live_flag_missing' ? EXIT_USAGE : EXIT_REFUSED;
  }
  const token = readAdminToken(env);
  if (!token.ok) {
    err(token.message);
    return EXIT_USAGE;
  }

  const libs = await loadExtendLibs();
  const config = libs.parseExtendConfig(env, { requireFlag: false });
  if (config.status !== 'enabled') {
    err(`Extend is not configured (${config.reason}${config.missing.length ? `: ${config.missing.join(', ')}` : ''}).`);
    return EXIT_USAGE;
  }
  if (v.resend && !LOOPBACK.has(new URL(config.config.apiHost).hostname) && config.config.apiHost !== 'https://api-demo.helloextend.com') {
    err('--resend is limited to the local mock and the demo host. Production needs the owner\'s written authorisation and is not offered by this script.');
    return EXIT_REFUSED;
  }

  const logger = createLogger({ write: io.logWrite ?? ((line) => process.stderr.write(`${line}\n`)), secrets: [token.token, env.EXTEND_ACCESS_TOKEN ?? ''] });
  const client = createAdminClient({ store: guard.store, token: token.token, fetch: fetchFn, logger });
  const shopify = await fetchShopifyOrders(client, libs, { since, limit });
  if (!shopify.ok) {
    err(`Shopify read failed: ${shopify.error}`);
    return EXIT_FAILED;
  }
  const extendOrders = await readExtendOrders({ source, file: v['extend-file'], env, fetch: fetchFn }, libs);
  if (!extendOrders.ok) {
    err(extendOrders.error);
    return EXIT_FAILED;
  }

  const quoted = await collectQuotes(shopify.orders, libs, config, fetchFn);
  const judged = shopify.orders.filter((order) => quoted.quotes.has(order.id));
  const sinceMs = Date.parse(`${since}T00:00:00Z`);
  const skippedIds = new Set([...quoted.skipped, ...shopify.unparsed.map((u) => u.orderId)]);
  // Extend orders outside the window, or for orders set aside above, are not "unexpected".
  const extendInWindow = extendOrders.orders.filter((record) => record.snapshot.transactionDate >= sinceMs && !skippedIds.has(record.snapshot.transactionId));
  const report = libs.reconcile(judged, extendInWindow, {
    storeId: config.config.storeId,
    quotesForOrder: (order) => quoted.quotes.get(order.id) ?? new Map(),
  });
  if (shopify.truncated) {
    report.issues = report.issues.filter((issue) => issue.kind !== 'unexpected_extend_order');
    report.summary.unexpected_extend_order = 0;
  }
  const extra = { skipped: quoted.skipped, unparsed: shopify.unparsed, truncated: shopify.truncated };

  /** @type {{ orderId: string, status: string }[] | null} */
  let resent = null;
  if (v.resend) resent = await resendOrders(libs, judged, report.issues, config, fetchFn, logger);

  const clean = report.issues.length === 0 && extra.skipped.length === 0 && extra.unparsed.length === 0;
  if (v.json) out(JSON.stringify({ report: { checkedOrders: report.checkedOrders, issues: report.issues, summary: report.summary }, ...extra, resent }, null, 2));
  else {
    out(renderReport(report, extra));
    if (resent) out(`\nRe-sent ${resent.length} order(s): ${resent.map((r) => `${r.orderId}=${r.status}`).join(', ') || 'none'}`);
    else if (report.issues.some((i) => RESEND_KINDS.has(i.kind))) out('\nDry run. Add --resend --live to re-send the orders that are missing or out of step.');
  }
  return clean ? EXIT_OK : EXIT_FAILED;
}

if (isMainModule(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
