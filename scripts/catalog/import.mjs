#!/usr/bin/env node
// Idempotent product importer (REQ-CAT-002, REQ-CAT-003, REQ-CAT-009, T-14).
//
//   node scripts/catalog/import.mjs <sheet.csv> --offline                 plan against an empty store, no network
//   node scripts/catalog/import.mjs <sheet.csv> --images <folder>         dry run: reads the store, prints the plan
//   node scripts/catalog/import.mjs <sheet.csv> --images <folder> --live  writes (needs the allow-list, see README)
//
// Why productSet: Shopify documents it for "syncing external data" and large catalogs; a single call
// creates or updates a product with its options, variants, files and metafields atomically per product,
// which is what a sheet-driven, re-runnable import needs. Its list semantics delete entries that are not
// sent, so reconcile.mjs only sends variants/files it can account for and writes metafields separately.
// Future optimisation: bulk operations (bulkOperationRunMutation) for the full 400-product load. The
// sequential, throttled path here is fast enough for a first load (about 400 products x 3 calls).

import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXIT_FAILED, EXIT_OK, EXIT_REFUSED, EXIT_USAGE, isMainModule, parseFlags, renderTable } from '../lib/cli.mjs';
import { ENV_API_VERSION, ENV_STORE_DOMAIN, checkLiveAllowed, checkStoreAllowed, readAdminToken } from '../lib/env.mjs';
import { createLogger, silentLogger } from '../lib/redact.mjs';
import { ADMIN_API_VERSION, createAdminClient } from '../lib/shopify-admin.mjs';
import { inspectImageFiles, mimeTypeFor, uploadToStagedTarget } from './images.mjs';
import { slugify, toDesiredProduct } from './map.mjs';
import { buildCreateInput, buildUpdateInput, diffProduct } from './reconcile.mjs';
import { createOfflineRemote, createShopifyRemote } from './remote.mjs';
import { LIMITS } from './schema.mjs';
import { loadAvailableImages, renderConsoleSummary, validateSheet } from './validate.mjs';

const RELATED_KEYS = /** @type {const} */ ([
  ['related_foundations', 'relatedFoundations'],
  ['related_protectors', 'relatedProtectors'],
  ['related_bedding', 'relatedBedding'],
]);

/**
 * @typedef {{ key: string, field: 'relatedFoundations' | 'relatedProtectors' | 'relatedBedding', handles: string[], resolved: Map<string, string> }} DeferredRelation
 * @typedef {object} PlanItem
 * @property {string} handle
 * @property {string} title
 * @property {'create' | 'update' | 'unchanged' | 'blocked'} action
 * @property {import('./reconcile.mjs').Change[]} changes
 * @property {string[]} blocked
 * @property {string[]} warnings
 * @property {string[]} uploads                 image file names that will be uploaded
 * @property {import('./map.mjs').DesiredProduct} desired
 * @property {import('./remote.mjs').RemoteProduct | null} remote
 * @property {import('./reconcile.mjs').ProductDiff} diff
 * @property {DeferredRelation[]} deferred      related handles that exist only in this sheet and are linked after creation
 * @typedef {{ create: number, update: number, unchanged: number, blocked: number, uploads: number, warnings: number }} PlanSummary
 * @typedef {{ ok: true, items: PlanItem[], summary: PlanSummary, report: import('./validate.mjs').ValidationReport }
 *   | { ok: false, reason: 'validation_failed', report: import('./validate.mjs').ValidationReport }
 *   | { ok: false, reason: 'remote_error', handle: string | null, message: string }
 *   | { ok: false, reason: 'usage', message: string }} PlanResult
 */

/**
 * Builds the plan. Reads only; safe to run any number of times.
 * @param {{
 *   csvText: string,
 *   remote: import('./remote.mjs').Remote,
 *   availableImages?: ReadonlySet<string> | null,
 *   imageDirectory?: string | null,
 *   allowRemovals?: boolean,
 *   publicationId?: string | null,
 *   only?: readonly string[] | null,
 *   logger?: import('../lib/redact.mjs').Logger,
 * }} args
 * @returns {Promise<PlanResult>}
 */
export async function planImport({ csvText, remote, availableImages = null, imageDirectory = null, allowRemovals = false, publicationId = null, only = null, logger = silentLogger }) {
  const report = validateSheet(csvText, { availableImages });
  if (!report.ok) return { ok: false, reason: 'validation_failed', report };

  let products = [...report.products].sort((a, b) => (a.handle < b.handle ? -1 : a.handle > b.handle ? 1 : 0));
  const sheetHandles = new Set(products.map((product) => product.handle));
  if (only && only.length > 0) {
    const unknown = only.filter((handle) => !sheetHandles.has(handle));
    if (unknown.length > 0) return { ok: false, reason: 'usage', message: `--only names handles that are not in the sheet: ${unknown.join(', ')}` };
    products = products.filter((product) => only.includes(product.handle));
  }

  /** @type {Map<string, string | null>} */
  const brandCache = new Map();
  /** @type {Map<string, string | null>} */
  const productIdCache = new Map();

  /** @param {string} slug @returns {Promise<import('./remote.mjs').Result<string | null>>} */
  async function brandId(slug) {
    if (brandCache.has(slug)) return { ok: true, value: brandCache.get(slug) ?? null };
    const result = await remote.getBrandId(slug);
    if (result.ok) brandCache.set(slug, result.value);
    return result;
  }
  /** @param {string} handle @returns {Promise<import('./remote.mjs').Result<string | null>>} */
  async function productId(handle) {
    if (productIdCache.has(handle)) return { ok: true, value: productIdCache.get(handle) ?? null };
    const result = await remote.getProductId(handle);
    if (result.ok) productIdCache.set(handle, result.value);
    return result;
  }

  /** @type {PlanItem[]} */
  const items = [];
  for (const product of products) {
    /** @type {string[]} */
    const warnings = [];

    const brand = await brandId(slugify(product.brand));
    if (!brand.ok) return { ok: false, reason: 'remote_error', handle: product.handle, message: brand.error.message };
    if (brand.value === null) warnings.push(`No brand metaobject "${slugify(product.brand)}" in Shopify yet; the brand link is skipped (import brands first, P3A-07).`);

    /** @type {import('./map.mjs').MapContext['relatedProductIds']} */
    const relatedProductIds = { relatedFoundations: [], relatedProtectors: [], relatedBedding: [] };
    /** @type {DeferredRelation[]} */
    const deferred = [];
    for (const [key, field] of RELATED_KEYS) {
      const handles = product[field];
      /** @type {Map<string, string>} */
      const resolved = new Map();
      let pending = false;
      for (const handle of handles) {
        const found = await productId(handle);
        if (!found.ok) return { ok: false, reason: 'remote_error', handle: product.handle, message: found.error.message };
        if (found.value) {
          resolved.set(handle, found.value);
          relatedProductIds[field].push(found.value);
        } else if (sheetHandles.has(handle) && handle !== product.handle) {
          pending = true;
        } else {
          warnings.push(`Related product "${handle}" (${key}) was not found in Shopify or in this sheet; it is skipped.`);
        }
      }
      if (pending) deferred.push({ key, field, handles, resolved });
    }

    const desired = toDesiredProduct(product, { brandMetaobjectId: brand.value, relatedProductIds, warnings: [] });
    const existing = await remote.getProductByHandle(product.handle);
    if (!existing.ok) return { ok: false, reason: 'remote_error', handle: product.handle, message: existing.error.message };
    const diff = diffProduct(desired, existing.value, { allowRemovals, publicationId });

    // A SKU that already belongs to a different product is a conflict, whatever the handle says.
    const ownSkus = new Set((existing.value?.variants ?? []).map((variant) => variant.sku));
    const unmatched = desired.variants.filter((variant) => !ownSkus.has(variant.sku)).map((variant) => variant.sku);
    const owners = await remote.findVariantsBySkus(unmatched);
    if (!owners.ok) return { ok: false, reason: 'remote_error', handle: product.handle, message: owners.error.message };
    for (const [sku, owner] of owners.value) {
      if (owner.productHandle !== product.handle) {
        diff.blocked.push(`SKU ${sku} already belongs to the product "${owner.productHandle}". Change the SKU, or the handle if the product was renamed.`);
      }
    }

    const uploads = diff.imageSteps.filter((step) => step.existing === null).map((step) => step.fileName);
    if (uploads.length > 0 && imageDirectory) {
      const checked = await inspectImageFiles(imageDirectory, uploads);
      for (const problem of checked.problems) diff.blocked.push(`Image ${problem}`);
    } else if (uploads.length > 0) {
      warnings.push(`${uploads.length} image(s) still to upload; give --images <folder> so they can be checked and uploaded.`);
    }

    if (deferred.length > 0) {
      diff.changes.push({ scope: 'metafield', field: `custom.${deferred.map((entry) => entry.key).join(', custom.')}`, from: null, to: 'linked after the related products are created' });
    }
    const action = diff.blocked.length > 0 ? 'blocked' : diff.action === 'unchanged' && deferred.length > 0 ? 'update' : diff.action;
    items.push({ handle: product.handle, title: product.model, action, changes: diff.changes, blocked: diff.blocked, warnings, uploads, desired, remote: existing.value, diff, deferred });
    logger.debug('planned product', { handle: product.handle, action });
  }

  const summary = items.reduce(
    (totals, item) => ({
      create: totals.create + (item.action === 'create' ? 1 : 0),
      update: totals.update + (item.action === 'update' ? 1 : 0),
      unchanged: totals.unchanged + (item.action === 'unchanged' ? 1 : 0),
      blocked: totals.blocked + (item.action === 'blocked' ? 1 : 0),
      uploads: totals.uploads + (item.action === 'blocked' ? 0 : item.uploads.length),
      warnings: totals.warnings + item.warnings.length,
    }),
    { create: 0, update: 0, unchanged: 0, blocked: 0, uploads: 0, warnings: 0 },
  );
  return { ok: true, items, summary, report };
}

/** True when running the plan would change nothing. */
export function isEmptyPlan(/** @type {PlanSummary} */ summary) {
  return summary.create === 0 && summary.update === 0 && summary.blocked === 0;
}

/**
 * @param {PlanItem[]} items
 * @returns {string}
 */
export function renderPlanTable(items) {
  const rows = items.map((item) => [
    item.handle,
    item.action.toUpperCase(),
    item.changes.length === 0 ? '' : `${item.changes.length}: ${item.changes.slice(0, 3).map((change) => change.field).join('; ')}${item.changes.length > 3 ? '; ...' : ''}`,
    item.uploads.length,
  ]);
  return renderTable(['handle', 'action', 'changes', 'uploads'], rows, { maxCellWidth: 90 });
}

/**
 * Printable plan: no desired/remote payloads, only what an operator needs to review.
 * @param {PlanItem[]} items
 * @param {PlanSummary} summary
 */
export function planToJson(items, summary) {
  return {
    summary,
    items: items.map((item) => ({ handle: item.handle, title: item.title, action: item.action, changes: item.changes, blocked: item.blocked, warnings: item.warnings, uploads: item.uploads })),
  };
}

// ---- execution ----------------------------------------------------------------------------------

/**
 * @typedef {object} Manifest
 * @property {1} version
 * @property {string} runId
 * @property {string} startedAt
 * @property {string | null} finishedAt
 * @property {string} store
 * @property {string} apiVersion
 * @property {{ name: string, sha256: string }} sheet
 * @property {{ handle: string, id: string }[]} created
 * @property {{ handle: string, id: string, changes: import('./reconcile.mjs').Change[], before: Record<string, unknown> }[]} updated
 * @property {{ handle: string, stage: string, message: string }[]} failed
 * @property {{ handle: string, reason: string }[]} skipped
 */

/** @param {import('./remote.mjs').RemoteProduct} remote */
function snapshotForRevert(remote) {
  return {
    title: remote.title,
    descriptionHtml: remote.descriptionHtml,
    vendor: remote.vendor,
    productType: remote.productType,
    status: remote.status,
    tags: remote.tags,
    seo: { title: remote.seoTitle, description: remote.seoDescription },
    variants: remote.variants.map((variant) => ({ id: variant.id, sku: variant.sku, size: variant.size, price: variant.price, compareAtPrice: variant.compareAtPrice })),
    metafields: remote.metafields,
    media: remote.media.map((item) => ({ id: item.id, alt: item.alt, fileName: item.fileName })),
  };
}

/**
 * Uploads the images one product needs and returns file name -> resourceUrl.
 * @param {PlanItem} item
 * @param {import('./remote.mjs').Remote} remote
 * @param {string | null} imageDirectory
 * @param {typeof fetch} uploadFetch
 * @returns {Promise<{ ok: true, urls: Map<string, string> } | { ok: false, message: string }>}
 */
async function uploadImages(item, remote, imageDirectory, uploadFetch) {
  /** @type {Map<string, string>} */
  const urls = new Map();
  if (item.uploads.length === 0) return { ok: true, urls };
  if (!imageDirectory) return { ok: false, message: 'An images folder is required to upload images (--images).' };
  const checked = await inspectImageFiles(imageDirectory, item.uploads);
  if (checked.problems.length > 0) return { ok: false, message: checked.problems.join('; ') };
  const requests = item.uploads.map((name) => ({ filename: name, mimeType: mimeTypeFor(name) ?? 'application/octet-stream' }));
  const targets = await remote.stagedUploadsCreate(requests);
  if (!targets.ok) return { ok: false, message: targets.error.message };
  for (const [index, name] of item.uploads.entries()) {
    const target = targets.value[index];
    const file = checked.files.get(name);
    if (!file || !target) return { ok: false, message: `No upload target for ${name}` };
    const sent = await uploadToStagedTarget(target, { name, path: file.path }, { fetch: uploadFetch });
    if (!sent.ok) return { ok: false, message: sent.message };
    urls.set(name, target.resourceUrl);
  }
  return { ok: true, urls };
}

/**
 * Applies a plan. Per-product failures are recorded and the run continues (re-running is safe);
 * credential and store failures stop the run.
 * @param {{
 *   items: PlanItem[],
 *   remote: import('./remote.mjs').Remote,
 *   manifest: Manifest,
 *   imageDirectory?: string | null,
 *   uploadFetch?: typeof fetch,
 *   onProgress?: (manifest: Manifest) => Promise<void> | void,
 *   logger?: import('../lib/redact.mjs').Logger,
 * }} args
 * @returns {Promise<Manifest>}
 */
export async function executePlan({ items, remote, manifest, imageDirectory = null, uploadFetch = globalThis.fetch, onProgress = () => {}, logger = silentLogger }) {
  /** @type {Map<string, string>} */
  const ids = new Map();
  /** @type {{ item: PlanItem, ownerId: string }[]} */
  const relink = [];
  let aborted = false;

  /** @param {string} handle @param {string} stage @param {{ kind?: string, message: string }} error */
  const fail = async (handle, stage, error) => {
    manifest.failed.push({ handle, stage, message: error.message });
    logger.error('import step failed', { handle, stage, kind: error.kind ?? null });
    if (error.kind === 'auth' || error.kind === 'not_found') aborted = true;
    await onProgress(manifest);
  };

  for (const item of items) {
    if (aborted) {
      manifest.skipped.push({ handle: item.handle, reason: 'run aborted after a credential or store error' });
      continue;
    }
    if (item.action === 'unchanged') continue;
    if (item.action === 'blocked') {
      manifest.skipped.push({ handle: item.handle, reason: item.blocked.join(' ') });
      continue;
    }
    const uploaded = await uploadImages(item, remote, imageDirectory, uploadFetch);
    if (!uploaded.ok) {
      await fail(item.handle, 'images', { message: uploaded.message });
      continue;
    }

    /** @type {string | null} */
    let productId = item.remote?.id ?? null;
    if (item.action === 'create') {
      const created = await remote.productSet({ input: buildCreateInput(item.desired, uploaded.urls), productId: null });
      if (!created.ok) {
        await fail(item.handle, 'create', created.error);
        continue;
      }
      productId = created.value.id;
      manifest.created.push({ handle: item.handle, id: created.value.id });
    } else if (item.remote) {
      const input = buildUpdateInput(item.desired, item.remote, item.diff, uploaded.urls);
      if (Object.keys(input).length > 0) {
        const updated = await remote.productSet({ input, productId: item.remote.id });
        if (!updated.ok) {
          await fail(item.handle, 'update', updated.error);
          continue;
        }
      }
      if (item.diff.metafieldWrites.length > 0) {
        const written = await remote.metafieldsSet(item.diff.metafieldWrites);
        if (!written.ok) {
          await fail(item.handle, 'metafields', written.error);
          continue;
        }
      }
      manifest.updated.push({ handle: item.handle, id: item.remote.id, changes: item.changes, before: snapshotForRevert(item.remote) });
    }
    if (productId) {
      ids.set(item.handle, productId);
      if (item.diff.publish) {
        const published = await remote.publish(productId);
        if (!published.ok) await fail(item.handle, 'publish', published.error);
      }
      if (item.deferred.length > 0) relink.push({ item, ownerId: productId });
    }
    await onProgress(manifest);
  }

  // Related products that live in the same sheet only have an id once they exist.
  for (const { item, ownerId } of relink) {
    if (aborted) break;
    for (const entry of item.deferred) {
      const finalIds = entry.handles.flatMap((handle) => {
        const id = entry.resolved.get(handle) ?? ids.get(handle);
        return id ? [id] : [];
      });
      if (finalIds.length === 0) continue;
      const written = await remote.metafieldsSet([{ ownerId, namespace: 'custom', key: entry.key, type: 'list.product_reference', value: JSON.stringify(finalIds) }]);
      if (!written.ok) await fail(item.handle, 'relink', written.error);
    }
  }
  manifest.finishedAt = new Date().toISOString();
  await onProgress(manifest);
  return manifest;
}

/**
 * @param {{ store: string, apiVersion: string, sheetName: string, sheetText: string }} args
 * @returns {Manifest}
 */
export function createManifest({ store, apiVersion, sheetName, sheetText }) {
  return {
    version: 1,
    runId: randomUUID(),
    startedAt: new Date().toISOString(),
    finishedAt: null,
    store,
    apiVersion,
    sheet: { name: sheetName, sha256: createHash('sha256').update(sheetText).digest('hex') },
    created: [],
    updated: [],
    failed: [],
    skipped: [],
  };
}

// ---- CLI ----------------------------------------------------------------------------------------

const USAGE = `Usage: node scripts/catalog/import.mjs <sheet.csv> [options]

  --offline              plan against an empty store; no network, no credentials
  --images <folder|list> folder holding the image files named in the sheet (a live run needs the folder;
                         a .txt list of file names is enough for --offline planning)
  --store <domain>       <name>.myshopify.com (default: $${ENV_STORE_DOMAIN})
  --publication <gid>    publish ACTIVE products to this publication (needs write_publications)
  --only <h1,h2>         only these product handles (good for a first live test)
  --allow-removals       allow deleting sizes/images that are in Shopify but not in the sheet
  --manifest-dir <dir>   where run manifests are written (default scripts/catalog/.runs)
  --json                 print the plan as JSON
  --live                 WRITE to the store. Default is a dry run. Needs SHOPIFY_ALLOWED_STORES.
Exit code: 0 ok, 1 errors or blocked items, 2 usage or file problem, 3 refused by the guard.`;

/**
 * @param {readonly string[]} argv
 * @param {Record<string, string | undefined>} env
 * @param {{ out?: (text: string) => void, err?: (text: string) => void, fetch?: typeof fetch, clock?: import('../lib/shopify-admin.mjs').Clock, maxAttempts?: number }} [io]
 * @returns {Promise<number>}
 */
export async function main(argv, env, { out = (text) => console.log(text), err = (text) => console.error(text), fetch: doFetch = globalThis.fetch, clock, maxAttempts } = {}) {
  const flags = parseFlags(
    argv,
    { offline: { type: 'boolean' }, images: { type: 'string' }, store: { type: 'string' }, publication: { type: 'string' }, only: { type: 'string' }, 'allow-removals': { type: 'boolean' }, 'manifest-dir': { type: 'string' }, json: { type: 'boolean' }, live: { type: 'boolean' }, help: { type: 'boolean' } },
    { allowPositionals: true },
  );
  if (!flags.ok || flags.values.help || flags.positionals.length !== 1) {
    err(flags.ok ? USAGE : `${flags.message}\n${USAGE}`);
    return EXIT_USAGE;
  }
  const live = flags.values.live === true;
  const offline = flags.values.offline === true;
  if (live && offline) {
    err('--live and --offline cannot be combined.');
    return EXIT_USAGE;
  }
  const sheetPath = flags.positionals[0];
  const store = typeof flags.values.store === 'string' ? flags.values.store : env[ENV_STORE_DOMAIN];

  // Guards run before any file or network access beyond the sheet itself.
  /** @type {string | null} */
  let guardedStore = null;
  if (!offline) {
    const guard = live ? checkLiveAllowed({ live, store, env }) : checkStoreAllowed({ store, env });
    if (!guard.ok) {
      err(`Refused: ${guard.message}`);
      return EXIT_REFUSED;
    }
    guardedStore = guard.store;
  }

  try {
    const info = await stat(sheetPath);
    if (info.size > LIMITS.maxFileBytes) {
      err('The sheet is larger than the 5 MB limit.');
      return EXIT_USAGE;
    }
    const csvText = await readFile(sheetPath, 'utf8');
    // --images may be a folder (checked and uploaded) or a .txt list of file names (existence check only,
    // useful for planning before the files are to hand). A list can never be uploaded from.
    const imagesArgument = typeof flags.values.images === 'string' ? flags.values.images : null;
    const imagesAreFolder = imagesArgument !== null && (await stat(imagesArgument)).isDirectory();
    const imageDirectory = imagesAreFolder ? imagesArgument : null;
    const availableImages = imagesArgument ? await loadAvailableImages(imagesArgument) : null;
    if (live && imagesArgument !== null && !imagesAreFolder) {
      err('Refused: a live run needs --images to be a folder of image files, not a list of names.');
      return EXIT_REFUSED;
    }
    const logger = createLogger({ write: err, secrets: [env.SHOPIFY_ADMIN_API_ACCESS_TOKEN ?? ''] });

    /** @type {import('./remote.mjs').Remote} */
    let remote = createOfflineRemote();
    const apiVersion = env[ENV_API_VERSION] ?? ADMIN_API_VERSION;
    const publicationId = typeof flags.values.publication === 'string' ? flags.values.publication : null;
    if (guardedStore) {
      const token = readAdminToken(env);
      if (!token.ok) {
        err(`Refused: ${token.message}`);
        return EXIT_REFUSED;
      }
      const client = createAdminClient({ store: guardedStore, token: token.token, apiVersion, allowMutations: live, logger, fetch: doFetch, ...(clock ? { clock } : {}), ...(maxAttempts ? { maxAttempts } : {}) });
      remote = createShopifyRemote(client, { publicationId });
    }

    const only = typeof flags.values.only === 'string' ? flags.values.only.split(',').map((handle) => handle.trim()).filter(Boolean) : null;
    const allowRemovals = flags.values['allow-removals'] === true;
    const plan = await planImport({ csvText, remote, availableImages, imageDirectory, allowRemovals, publicationId, only, logger });
    if (!plan.ok) {
      if (plan.reason === 'validation_failed') {
        err('The sheet has errors. Nothing was imported. Fix them and run again (see scripts/catalog/README.md).');
        err(renderConsoleSummary(plan.report));
        return EXIT_FAILED;
      }
      err(plan.reason === 'usage' ? plan.message : `Could not read the store${plan.handle ? ` while checking ${plan.handle}` : ''}: ${plan.message}`);
      return plan.reason === 'usage' ? EXIT_USAGE : EXIT_FAILED;
    }

    if (flags.values.json === true) out(JSON.stringify(planToJson(plan.items, plan.summary), null, 2));
    else {
      out(`${live ? 'LIVE RUN' : offline ? 'DRY RUN (offline: planned against an empty store)' : 'DRY RUN (the store was only read)'} for ${guardedStore ?? 'no store'}`);
      out(renderPlanTable(plan.items));
      /** @type {Map<string, string[]>} identical notes are shown once, with the products they apply to */
      const notes = new Map();
      for (const item of plan.items) {
        for (const reason of item.blocked) out(`BLOCKED ${item.handle}: ${reason}`);
        for (const warning of item.warnings) notes.set(warning, [...(notes.get(warning) ?? []), item.handle]);
      }
      for (const [message, handles] of notes) out(`note (${handles.length === 1 ? handles[0] : `${handles.length} products`}): ${message}`);
      const { summary } = plan;
      out(`Plan: ${summary.create} to create, ${summary.update} to update, ${summary.unchanged} unchanged, ${summary.blocked} blocked, ${summary.uploads} image(s) to upload.`);
      if (isEmptyPlan(summary)) out('Nothing to do: the store already matches the sheet.');
    }

    if (!live) return plan.summary.blocked > 0 ? EXIT_FAILED : EXIT_OK;

    if (plan.summary.uploads > 0 && !imageDirectory) {
      err('Refused: this plan uploads images but --images <folder> was not given.');
      return EXIT_REFUSED;
    }
    const manifestDir = typeof flags.values['manifest-dir'] === 'string' ? flags.values['manifest-dir'] : fileURLToPath(new URL('./.runs', import.meta.url));
    await mkdir(manifestDir, { recursive: true });
    const manifest = createManifest({ store: guardedStore ?? '', apiVersion, sheetName: path.basename(sheetPath), sheetText: csvText });
    const manifestFile = path.join(manifestDir, `${manifest.startedAt.replace(/[:.]/g, '-')}-${manifest.runId.slice(0, 8)}.json`);
    const finished = await executePlan({
      items: plan.items,
      remote,
      manifest,
      imageDirectory,
      uploadFetch: doFetch,
      logger,
      onProgress: (current) => writeFile(manifestFile, `${JSON.stringify(current, null, 2)}\n`, 'utf8'),
    });
    out(`Done: ${finished.created.length} created, ${finished.updated.length} updated, ${finished.failed.length} failed, ${finished.skipped.length} skipped.`);
    out(`Run manifest: ${manifestFile}`);
    for (const failure of finished.failed) err(`FAILED ${failure.handle} (${failure.stage}): ${failure.message}`);
    // Blocked products were skipped on purpose; the sheet and the store still disagree, so do not report success.
    return finished.failed.length > 0 || plan.summary.blocked > 0 ? EXIT_FAILED : EXIT_OK;
  } catch (error) {
    err(`Stopped: ${error instanceof Error ? error.message : String(error)}`);
    return EXIT_USAGE;
  }
}

if (isMainModule(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2), process.env);
}
