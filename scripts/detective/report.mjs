#!/usr/bin/env node
// Detective order report (P5B-05, ADR-0006 decision 3, REQ-PRE-003, REQ-PROMO-003, security review E-M3 / M-4): reads
// recent Shopify orders and reports every rule violation that slipped past the cart gate, because Shopify's public
// Storefront API can build carts our server never saw. It is the reconciliation fallback behind the webhook check
// (app/lib/extend/webhook-processor.ts) and the way to judge orders placed before that check was running.
//
//   node scripts/detective/report.mjs --store shop.myshopify.com --since 2026-10-01
//   node scripts/detective/report.mjs --store shop.myshopify.com --offer-config-file offers.json --json --out report.json
//
// It judges against the CURRENT offer rules and delivery zone (OFFER_CONFIG_JSON, or --offer-config-file), so an order
// placed under an older haul-away maximum can show a difference that is not a defect; the runbook says how to read it.
//
// Safety: it only reads. The Admin client is created without mutation rights, so no Shopify write is possible; the only
// file written is the optional --out report, and an existing file is never overwritten. Contact with a store needs the
// domain in SHOPIFY_ALLOWED_STORES. The Admin token comes from the environment only. Output holds order ids, line ids and
// codes: never a name, email, phone, address or ZIP. The read asks Shopify for the shipping ZIP and country only to answer
// yes or no (app/lib/extend/admin-order.ts), and nothing in a result can carry them.
// Zero dependencies; the checks are the storefront's own detect.ts, loaded through ts-loader.mjs, so this report and the
// webhook can never disagree.

import { readFile, writeFile } from 'node:fs/promises';
import { EXIT_FAILED, EXIT_OK, EXIT_REFUSED, EXIT_USAGE, isMainModule, parseFlags, renderTable } from '../lib/cli.mjs';
import { checkStoreAllowed, readAdminToken, ENV_STORE_DOMAIN } from '../lib/env.mjs';
import { createLogger } from '../lib/redact.mjs';
import { connectionNodes, createAdminClient, isRecord } from '../lib/shopify-admin.mjs';
import { loadDetectiveLibs } from './ts-loader.mjs';

/**
 * Exit 4: no violation was found, but at least one order could not be fully judged (and that was not accepted with
 * --accept-unjudged). Kept apart from EXIT_FAILED (1 = a violation, or the read failed) so an alert wrapper can page on
 * 1 and merely ticket 4: "cannot judge" must never hide, or be mistaken for, "violation found" (review M3).
 */
export const EXIT_UNJUDGED = 4;

/**
 * Unjudged reasons an operator may knowingly accept. Only a reason that is a standing limit of the check, not a fault:
 * accepting `order_unreadable` or `rules_unavailable` would hide a broken run.
 */
export const ACCEPTABLE_UNJUDGED = ['coverage_price_unjudged'];

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;
const DEFAULT_DAYS = 14;
/** Rough points per order of the detective document (50 lines x about 8 objects), for the client's throttle only. */
const ESTIMATED_COST_PER_ORDER = 420;

const USAGE = `Usage: node scripts/detective/report.mjs --store <shop>.myshopify.com [--since YYYY-MM-DD] [--limit ${DEFAULT_LIMIT}]
         [--offer-config-file <offers.json>] [--accept-unjudged coverage_price_unjudged] [--json] [--out <report.json>]
Reads orders only; nothing is written to Shopify. --out writes the report to a new local file (an existing file is refused).
Exit codes: 0 every order judged and clean (or only accepted unjudged reasons); 1 a violation was found or the Shopify read
failed; 2 usage; 3 store refused; 4 no violation, but some order could not be fully judged. --accept-unjudged (repeatable or
comma separated; only: ${ACCEPTABLE_UNJUDGED.join(', ')}) stops that reason alone from raising 4; it is still counted and printed.
Environment: SHOPIFY_ADMIN_API_ACCESS_TOKEN, SHOPIFY_ALLOWED_STORES, and OFFER_CONFIG_JSON unless --offer-config-file is given.`;

/** @param {number} days @param {() => number} now */
function defaultSince(days, now) {
  return new Date(now() - days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Offer rules and zone, from a file or the environment, parsed by the storefront's own parser. A missing or unreadable
 * configuration stops the report: without rules every order would be "not judged", which says nothing.
 * @param {{ file?: string, env: Record<string, string | undefined> }} options
 * @param {Awaited<ReturnType<typeof loadDetectiveLibs>>} libs
 */
export async function readRules(options, libs) {
  /** @type {import('../../storefront/app/lib/offers-runtime/config').OfferConfigLoad} */
  let load;
  if (options.file) {
    try {
      load = libs.parseOfferConfig(JSON.parse(await readFile(options.file, 'utf8')));
    } catch {
      return { ok: false, error: 'The offer configuration file could not be read as JSON.' };
    }
  } else {
    load = libs.readOfferConfig({ OFFER_CONFIG_JSON: options.env.OFFER_CONFIG_JSON });
  }
  if (load.status !== 'ok') {
    return {
      ok: false,
      error: load.status === 'none'
        ? 'No offer rules: set OFFER_CONFIG_JSON or pass --offer-config-file. Without them no order can be judged.'
        : `The offer rules are not usable (${load.warnings.join('; ') || 'invalid'}).`,
    };
  }
  return { ok: true, config: libs.detectiveConfigFromOffers(load), warnings: load.warnings };
}

/**
 * Pages through orders created since the date, NEWEST FIRST (the query sets reverse: true), up to the limit, and judges
 * each one. When the limit cuts the read short it is the oldest orders in the window that are left unchecked. An order that cannot be read
 * completely is recorded as not judged, never skipped and never clean. If Shopify refuses the page because its requested
 * query cost is over the limit, the page size drops to one order and the same page is asked again (V-20: the cost figures
 * are estimates until a real response shows extensions.cost).
 * @param {import('../lib/shopify-admin.mjs').AdminClient} client
 * @param {Awaited<ReturnType<typeof loadDetectiveLibs>>} libs
 * @param {import('../../storefront/app/lib/detective/types').DetectiveConfig} config
 * @param {{ since: string, limit: number }} options
 */
export async function judgeRecentOrders(client, libs, config, { since, limit }) {
  /** @type {import('../../storefront/app/lib/detective/types').DetectiveResult[]} */
  const results = [];
  let after = null;
  let truncated = false;
  let pageSize = libs.DETECTIVE_ORDERS_PAGE_SIZE;
  for (;;) {
    const result = await client.request(
      libs.DETECTIVE_ORDERS_PAGE_QUERY,
      { first: pageSize, after, query: `created_at:>=${since}` },
      { operationName: 'DetectiveOrdersPage', estimatedCost: Math.min(1000, pageSize * ESTIMATED_COST_PER_ORDER) },
    );
    if (!result.ok) {
      if (result.error.kind === 'cost_exceeded' && pageSize > 1) {
        pageSize = 1;
        continue;
      }
      return { ok: false, error: result.error.message };
    }
    const connection = result.data.orders;
    for (const node of connectionNodes(connection)) {
      if (results.length >= limit) {
        truncated = true;
        break;
      }
      const parsed = libs.parseDetectiveOrder(node);
      results.push(
        parsed.status === 'ok'
          ? libs.detectWithConfig(parsed.order, config)
          : libs.unreadableOrderResult(isRecord(node) ? String(node.id) : ''),
      );
    }
    const page = isRecord(connection) && isRecord(connection.pageInfo) ? connection.pageInfo : {};
    if (truncated) break;
    if (page.hasNextPage !== true || typeof page.endCursor !== 'string') break;
    after = page.endCursor;
  }
  return { ok: true, results, truncated };
}

/**
 * What the run found, for the exit code and for wrappers: a violation always wins over unjudged noise.
 * `unjudged_only` = no violation, and some order has an unjudged reason that was not accepted.
 * @param {import('../../storefront/app/lib/detective/report').DetectiveReport} report
 * @param {readonly string[]} accepted
 * @returns {'clean' | 'violations' | 'unjudged_only'}
 */
export function reportOutcome(report, accepted) {
  if (report.counts.violations > 0) return 'violations';
  const unaccepted = report.findings.some((finding) => finding.unjudged.some((reason) => !accepted.includes(reason)));
  return unaccepted ? 'unjudged_only' : 'clean';
}

/** @param {import('../../storefront/app/lib/detective/report').DetectiveReport} report @param {{ truncated: boolean, warnings: readonly string[], limit: number, since: string, accepted?: readonly string[] }} extra */
export function renderReport(report, extra) {
  const { counts } = report;
  const accepted = extra.accepted ?? [];
  const lines = [
    `Checked ${report.checkedOrders} Shopify orders: ${counts.clean} clean, ${counts.violations} with violations, ${counts.unjudgeable} not judged.`,
  ];
  if (report.byCode.length > 0) lines.push(report.byCode.map((entry) => `${entry.code}=${entry.orders}`).join('  '));
  if (report.unjudgedByReason.length > 0) {
    lines.push(`not judged: ${report.unjudgedByReason.map((entry) => `${entry.reason}=${entry.orders}`).join('  ')}`);
  }
  if (report.findings.length > 0) {
    lines.push(
      '',
      renderTable(
        ['order', 'status', 'codes', 'lines', 'not judged'],
        report.findings.map((finding) => [
          finding.orderId,
          finding.status,
          finding.violations.map((v) => v.code).join(', '),
          [...new Set(finding.violations.flatMap((v) => v.lineIds))].join(', '),
          finding.unjudged.join(', '),
        ]),
        { maxCellWidth: 80 },
      ),
    );
  }
  if (report.unjudgedByReason.some((entry) => entry.reason === 'coverage_price_unjudged')) {
    lines.push(
      '',
      'coverage_price_unjudged: these orders have protection lines. Only their structure was checked (valid plan id, covered item on the order, one per item, quantity). Their price and plan were NOT compared with Extend, so a wrong price is not caught here. They are counted as not judged, never clean.',
    );
  }
  if (extra.truncated) {
    lines.push(
      '',
      `The limit of ${extra.limit} orders was reached. The ${report.checkedOrders} newest orders created since ${extra.since} were checked; the older orders in that window were NOT checked. Raise --limit (up to ${MAX_LIMIT}) or narrow --since to cover them.`,
    );
  }
  if (accepted.length > 0) {
    lines.push('', `accepted by --accept-unjudged (still counted above, not alerting): ${accepted.join(', ')}`);
  }
  for (const warning of extra.warnings) lines.push(`offer rules: ${warning}`);
  lines.push('', 'Judged against the current offer rules and delivery zone. Delivery method is read from the order attribute delivery_choice (a shopper-writable claim).');
  const outcome = reportOutcome(report, accepted);
  lines.push(
    outcome === 'violations'
      ? 'Result: VIOLATIONS found (exit 1).'
      : outcome === 'unjudged_only'
        ? `Result: no violation found, but some orders could not be fully judged (exit ${EXIT_UNJUDGED}).`
        : 'Result: clean (exit 0).',
  );
  return lines.join('\n');
}

/**
 * @param {readonly string[]} argv
 * @param {{ env?: Record<string, string | undefined>, fetch?: typeof fetch, clock?: import('../lib/shopify-admin.mjs').Clock, now?: () => number, out?: (text: string) => void, err?: (text: string) => void, logWrite?: (line: string) => void }} [io]
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
    'offer-config-file': { type: 'string' },
    'accept-unjudged': { type: 'string', multiple: true },
    json: { type: 'boolean' },
    out: { type: 'string' },
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
  const limit = v.limit === undefined ? DEFAULT_LIMIT : Number(v.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    err(`--limit must be a whole number from 1 to ${MAX_LIMIT}.`);
    return EXIT_USAGE;
  }
  const accepted = [...new Set((Array.isArray(v['accept-unjudged']) ? v['accept-unjudged'] : []).flatMap((value) => String(value).split(',').map((part) => part.trim()).filter(Boolean)))];
  const unacceptable = accepted.filter((reason) => !ACCEPTABLE_UNJUDGED.includes(reason));
  if (unacceptable.length > 0) {
    err(`--accept-unjudged accepts only: ${ACCEPTABLE_UNJUDGED.join(', ')}. Other reasons hide a broken run.`);
    return EXIT_USAGE;
  }
  const since = typeof v.since === 'string' ? v.since : defaultSince(DEFAULT_DAYS, now);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(since)) {
    err('--since must be a date such as 2026-10-01.');
    return EXIT_USAGE;
  }

  const store = typeof v.store === 'string' ? v.store : env[ENV_STORE_DOMAIN];
  const guard = checkStoreAllowed({ store, env });
  if (!guard.ok) {
    err(guard.message);
    return EXIT_REFUSED;
  }
  const token = readAdminToken(env);
  if (!token.ok) {
    err(token.message);
    return EXIT_USAGE;
  }

  const libs = await loadDetectiveLibs();
  const rules = await readRules({ file: typeof v['offer-config-file'] === 'string' ? v['offer-config-file'] : undefined, env }, libs);
  if (!rules.ok) {
    err(rules.error);
    return EXIT_USAGE;
  }

  const logger = createLogger({ write: io.logWrite ?? ((line) => process.stderr.write(`${line}\n`)), secrets: [token.token] });
  // allowMutations stays false: this tool has no write path to Shopify at all.
  const client = createAdminClient({ store: guard.store, token: token.token, fetch: fetchFn, logger, ...(io.clock ? { clock: io.clock } : {}) });
  const judged = await judgeRecentOrders(client, libs, rules.config, { since, limit });
  if (!judged.ok) {
    err(`Shopify read failed: ${judged.error}`);
    return EXIT_FAILED;
  }

  const report = libs.summarizeResults(judged.results);
  const extra = { truncated: judged.truncated, warnings: rules.warnings, limit, since, accepted };
  const outcome = reportOutcome(report, accepted);
  // order: orders are read newest first, so a truncated run holds the newest `limit` orders and skipped the OLDER ones.
  const document = { generatedAt: new Date(now()).toISOString(), store: guard.store, since, limit, order: 'newest_first', truncated: judged.truncated, acceptedUnjudged: accepted, outcome, report };
  if (typeof v.out === 'string') {
    try {
      // 'wx': never overwrite an earlier report.
      await writeFile(v.out, `${JSON.stringify(document, null, 2)}\n`, { flag: 'wx' });
    } catch {
      err('The report file could not be created (it may already exist).');
      return EXIT_USAGE;
    }
  }
  if (v.json) out(JSON.stringify(document, null, 2));
  else out(renderReport(report, extra));
  if (outcome === 'violations') return EXIT_FAILED;
  return outcome === 'unjudged_only' ? EXIT_UNJUDGED : EXIT_OK;
}

if (isMainModule(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
