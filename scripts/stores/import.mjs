#!/usr/bin/env node
// Idempotent store importer (REQ-LOC-001, REQ-LOC-002, P3A-07, P3B-16, CLR-015).
//
//   node scripts/stores/import.mjs <sheet.csv> --check                  validate only: no store, no token, no network
//   node scripts/stores/import.mjs <sheet.csv> --offline                plan against an empty store, no network
//   bash scripts/setup/with-admin-token.sh node scripts/stores/import.mjs <sheet.csv>          dry run (reads the store)
//   bash scripts/setup/with-admin-token.sh node scripts/stores/import.mjs <sheet.csv> --live   writes
//
// Each row is upserted into the `store` metaobject by handle (= the slug), so running the same sheet twice changes
// nothing the second time. Entries that are in Shopify but not in the sheet are never touched or deleted. Same guards as
// scripts/catalog/import.mjs (T-14): dry run by default, --live to write, the store must be in SHOPIFY_ALLOWED_STORES,
// the Admin token comes from the environment only and is never printed.

import { readFile, stat } from 'node:fs/promises';
import { EXIT_FAILED, EXIT_OK, EXIT_REFUSED, EXIT_USAGE, isMainModule, parseFlags, renderTable } from '../lib/cli.mjs';
import { ENV_API_VERSION, ENV_STORE_DOMAIN, checkLiveAllowed, checkStoreAllowed, readAdminToken } from '../lib/env.mjs';
import { createLogger } from '../lib/redact.mjs';
import { ADMIN_API_VERSION, createAdminClient } from '../lib/shopify-admin.mjs';
import { diffStore } from './map.mjs';
import { createOfflineRemote, createShopifyRemote } from './remote.mjs';
import { LIMITS } from './schema.mjs';
import { renderReport, validateStoreSheet } from './validate.mjs';

/**
 * @typedef {object} PlanItem
 * @property {string} handle
 * @property {number} row
 * @property {'create' | 'update' | 'unchanged' | 'blocked'} action
 * @property {string[]} changed      field keys that will be written
 * @property {string[]} leftAlone    fields filled in Shopify but blank in the sheet (not erased)
 * @property {string[]} blocked
 * @property {{ key: string, value: string }[]} send
 * @typedef {{ create: number, update: number, unchanged: number, blocked: number }} PlanSummary
 * @typedef {{ ok: true, items: PlanItem[], summary: PlanSummary, notInSheet: string[], report: import('./validate.mjs').ValidationReport }
 *   | { ok: false, reason: 'validation_failed', report: import('./validate.mjs').ValidationReport }
 *   | { ok: false, reason: 'remote_error', message: string }
 *   | { ok: false, reason: 'usage', message: string }} PlanResult
 */

/**
 * Builds the plan. Reads only; safe to run any number of times.
 * @param {{ csvText: string, remote: import('./remote.mjs').Remote, only?: string[] | null }} args
 * @returns {Promise<PlanResult>}
 */
export async function planImport({ csvText, remote, only = null }) {
  const report = validateStoreSheet(csvText);
  if (!report.ok) return { ok: false, reason: 'validation_failed', report };
  const known = new Set(report.stores.map((store) => store.handle));
  const unknown = (only ?? []).filter((handle) => !known.has(handle));
  if (unknown.length > 0) return { ok: false, reason: 'usage', message: `--only names stores that are not in the sheet: ${unknown.join(', ')}` };

  const listed = await remote.listStores();
  if (!listed.ok) return { ok: false, reason: 'remote_error', message: listed.message };

  /** @type {PlanItem[]} */
  const items = [];
  for (const store of report.stores) {
    if (only && !only.includes(store.handle)) continue;
    const existing = listed.stores.get(store.handle) ?? null;
    // A different entry that already uses this slug would give two stores the same web address.
    const clash = [...listed.stores].find(([handle, remote_]) => handle !== store.handle && remote_.fields.slug === store.fields.slug);
    if (clash) {
      items.push({ handle: store.handle, row: store.row, action: 'blocked', changed: [], leftAlone: [], send: [], blocked: [`The Shopify entry "${clash[0]}" already has the slug "${store.fields.slug}". Fix one of them in Shopify admin first.`] });
      continue;
    }
    const diff = diffStore(store.fields, existing ? existing.fields : null);
    const action = !existing ? 'create' : diff.send.length > 0 ? 'update' : 'unchanged';
    items.push({ handle: store.handle, row: store.row, action, changed: diff.changed, leftAlone: diff.leftAlone, blocked: [], send: diff.send });
  }
  const sheetHandles = new Set(report.stores.map((store) => store.handle));
  const notInSheet = [...listed.stores.keys()].filter((handle) => !sheetHandles.has(handle));
  const summary = { create: 0, update: 0, unchanged: 0, blocked: 0 };
  for (const item of items) summary[item.action] += 1;
  return { ok: true, items, summary, notInSheet, report };
}

/**
 * Writes the changed entries one by one. A failure on one store is recorded and the others still run; because every
 * write is an upsert by handle, running the command again finishes the job.
 * @param {{ items: PlanItem[], remote: import('./remote.mjs').Remote, logger?: import('../lib/redact.mjs').Logger }} args
 * @returns {Promise<{ written: { handle: string, action: string, changed: string[] }[], failed: { handle: string, message: string }[] }>}
 */
export async function executePlan({ items, remote, logger }) {
  /** @type {{ handle: string, action: string, changed: string[] }[]} */
  const written = [];
  /** @type {{ handle: string, message: string }[]} */
  const failed = [];
  for (const item of items) {
    if (item.action !== 'create' && item.action !== 'update') continue;
    const result = await remote.upsertStore(item.handle, item.send);
    if (result.ok) {
      written.push({ handle: item.handle, action: item.action, changed: item.changed });
      logger?.info('store written', { handle: item.handle, action: item.action, fields: item.changed });
    } else {
      failed.push({ handle: item.handle, message: result.message });
      logger?.error('store write failed', { handle: item.handle });
    }
  }
  return { written, failed };
}

/** @param {PlanItem[]} items */
export function renderPlanTable(items) {
  return renderTable(['row', 'store', 'action', 'fields to write'], items.map((item) => [item.row, item.handle, item.action, item.changed.join(', ')]));
}

const USAGE = `Usage: node scripts/stores/import.mjs <sheet.csv> [options]

  --check            validate the sheet only: no store, token or network needed
  --offline          plan against an empty store; no network, no credentials
  --store <domain>   <name>.myshopify.com (default: $${ENV_STORE_DOMAIN}, then $STORE)
  --only <h1,h2>     only these store slugs (good for a first live test)
  --live             WRITE to the store. Default is a dry run. Needs SHOPIFY_ALLOWED_STORES.
Run live through: bash scripts/setup/with-admin-token.sh node scripts/stores/import.mjs <sheet.csv> --live
Exit code: 0 ok, 1 errors in the sheet or failed writes, 2 usage or file problem, 3 refused by the guard.`;

/**
 * @param {readonly string[]} argv
 * @param {Record<string, string | undefined>} env
 * @param {{ out?: (text: string) => void, err?: (text: string) => void, fetch?: typeof fetch, clock?: import('../lib/shopify-admin.mjs').Clock, maxAttempts?: number }} [io]
 * @returns {Promise<number>}
 */
export async function main(argv, env, { out = (text) => console.log(text), err = (text) => console.error(text), fetch: doFetch = globalThis.fetch, clock, maxAttempts } = {}) {
  const flags = parseFlags(
    argv,
    { check: { type: 'boolean' }, offline: { type: 'boolean' }, store: { type: 'string' }, only: { type: 'string' }, live: { type: 'boolean' }, help: { type: 'boolean' } },
    { allowPositionals: true },
  );
  if (!flags.ok || flags.values.help || flags.positionals.length !== 1) {
    err(flags.ok ? USAGE : `${flags.message}\n${USAGE}`);
    return EXIT_USAGE;
  }
  const live = flags.values.live === true;
  const offline = flags.values.offline === true;
  const check = flags.values.check === true;
  if (live && (offline || check)) {
    err('--live cannot be combined with --offline or --check.');
    return EXIT_USAGE;
  }
  const store = typeof flags.values.store === 'string' ? flags.values.store : (env[ENV_STORE_DOMAIN] ?? env.STORE);

  // Guards run before the sheet is read and before any network access.
  /** @type {string | null} */
  let guardedStore = null;
  if (!offline && !check) {
    const guard = live ? checkLiveAllowed({ live, store, env }) : checkStoreAllowed({ store, env });
    if (!guard.ok) {
      err(`Refused: ${guard.message}`);
      return EXIT_REFUSED;
    }
    guardedStore = guard.store;
  }

  try {
    const sheetPath = flags.positionals[0];
    const info = await stat(sheetPath);
    if (info.size > LIMITS.maxFileBytes) {
      err('The sheet is larger than the 1 MB limit.');
      return EXIT_USAGE;
    }
    const csvText = await readFile(sheetPath, 'utf8');
    const logger = createLogger({ write: err, secrets: [env.SHOPIFY_ADMIN_API_ACCESS_TOKEN ?? ''] });

    if (check) {
      const report = validateStoreSheet(csvText);
      out(renderReport(report));
      return report.ok ? EXIT_OK : EXIT_FAILED;
    }

    /** @type {import('./remote.mjs').Remote} */
    let remote = createOfflineRemote();
    const apiVersion = env[ENV_API_VERSION] ?? ADMIN_API_VERSION;
    if (guardedStore) {
      const token = readAdminToken(env);
      if (!token.ok) {
        err(`Refused: ${token.message}`);
        return EXIT_REFUSED;
      }
      const client = createAdminClient({ store: guardedStore, token: token.token, apiVersion, allowMutations: live, logger, fetch: doFetch, ...(clock ? { clock } : {}), ...(maxAttempts ? { maxAttempts } : {}) });
      remote = createShopifyRemote(client);
    }

    const only = typeof flags.values.only === 'string' ? flags.values.only.split(',').map((handle) => handle.trim()).filter(Boolean) : null;
    const plan = await planImport({ csvText, remote, only });
    if (!plan.ok) {
      if (plan.reason === 'validation_failed') {
        err('The sheet has errors. Nothing was imported.');
        err(renderReport(plan.report));
        return EXIT_FAILED;
      }
      err(plan.reason === 'usage' ? plan.message : `Could not read the store: ${plan.message}`);
      return plan.reason === 'usage' ? EXIT_USAGE : EXIT_FAILED;
    }

    out(`${live ? 'LIVE RUN' : offline ? 'DRY RUN (offline: planned against an empty store)' : 'DRY RUN (the store was only read)'} for ${guardedStore ?? 'no store'}`);
    out(renderPlanTable(plan.items));
    for (const issue of plan.report.warnings) out(`note row ${issue.row}${issue.column ? ` [${issue.column}]` : ''}: ${issue.message}`);
    for (const item of plan.items) {
      for (const reason of item.blocked) out(`BLOCKED ${item.handle}: ${reason}`);
      if (item.leftAlone.length > 0) out(`note ${item.handle}: blank in the sheet but filled in Shopify, left as it is: ${item.leftAlone.join(', ')}`);
    }
    if (plan.notInSheet.length > 0) out(`note: ${plan.notInSheet.length} store entr${plan.notInSheet.length === 1 ? 'y is' : 'ies are'} in Shopify but not in the sheet and will not be touched: ${plan.notInSheet.join(', ')}`);
    const { summary } = plan;
    out(`Plan: ${summary.create} to create, ${summary.update} to update, ${summary.unchanged} unchanged, ${summary.blocked} blocked.`);
    if (summary.create + summary.update === 0 && summary.blocked === 0) out('Nothing to do: Shopify already matches the sheet.');

    if (!live) return summary.blocked > 0 ? EXIT_FAILED : EXIT_OK;

    const finished = await executePlan({ items: plan.items, remote, logger });
    out(`Done: ${finished.written.filter((entry) => entry.action === 'create').length} created, ${finished.written.filter((entry) => entry.action === 'update').length} updated, ${finished.failed.length} failed.`);
    for (const failure of finished.failed) err(`FAILED ${failure.handle}: ${failure.message}`);
    if (finished.failed.length > 0) err('Run the same command again: stores that were written are now unchanged and only the failed ones are retried.');
    return finished.failed.length > 0 || summary.blocked > 0 ? EXIT_FAILED : EXIT_OK;
  } catch (error) {
    err(`Stopped: ${error instanceof Error ? error.message : String(error)}`);
    return EXIT_USAGE;
  }
}

if (isMainModule(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2), process.env);
}
