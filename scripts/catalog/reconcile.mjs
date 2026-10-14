// Pure comparison of the desired product (from the sheet) with what Shopify holds, and the
// mutation inputs that close the gap. No I/O. This is what makes a second run an empty plan (REQ-CAT-002).
//
// Safety design, because productSet "deletes existing entries that aren't included" in list fields
// (variants, metafields, collections) per its documentation (2026-10):
//  - existing products: metafields are NEVER sent through productSet; they go through metafieldsSet
//    (documented upsert), so no metafield can be deleted by an import;
//  - variants and images that exist in Shopify but not in the sheet are a BLOCK unless the operator
//    passes --allow-removals, so nothing disappears silently;
//  - collections are never sent (collections are rule-based, REQ-CAT-005);
//  - tags are merged so the client's own tags survive.

import { MANAGED_TAG_PREFIXES, SIZE_OPTION_NAME, mergeTags, metafieldValuesEqual } from './map.mjs';
import { fileKey } from './remote.mjs';

/**
 * @typedef {{ scope: string, field: string, from: string | null, to: string | null }} Change
 * @typedef {{ ownerId: string, namespace: string, key: string, type: string, value: string }} MetafieldWrite
 * @typedef {{ fileName: string, alt: string, existing: import('./remote.mjs').RemoteMedia | null }} ImageStep
 * @typedef {object} ProductDiff
 * @property {'create' | 'update' | 'unchanged' | 'blocked'} action
 * @property {Change[]} changes
 * @property {string[]} blocked
 * @property {boolean} scalarsChanged
 * @property {boolean} optionsChanged
 * @property {boolean} variantsChanged
 * @property {boolean} imagesChanged
 * @property {boolean} publish
 * @property {MetafieldWrite[]} metafieldWrites   update path only; ownerId is filled in for existing owners
 * @property {Map<string, import('./remote.mjs').RemoteVariant>} variantMatches  desired SKU -> remote variant
 * @property {ImageStep[]} imageSteps
 * @property {string[]} removedVariants
 * @property {string[]} removedMedia
 * @property {string[]} mergedTags
 */

/**
 * "1299.0" and "1299.00" are the same price; compare in cents without floats.
 * @param {string | null} amount
 * @returns {string | null}
 */
export function normaliseMoney(amount) {
  if (amount === null || amount === '') return null;
  const match = /^(\d+)(?:\.(\d+))?$/.exec(amount.trim());
  if (!match) return amount;
  const fraction = (match[2] ?? '').padEnd(2, '0');
  return `${BigInt(match[1])}.${fraction.slice(0, 2)}${/[1-9]/.test(fraction.slice(2)) ? fraction.slice(2) : ''}`;
}

/** @param {string} a @param {string} b */
const sameText = (a, b) => a.trim() === b.trim();

/**
 * @param {readonly string[]} a
 * @param {readonly string[]} b
 */
function sameSet(a, b) {
  const left = [...new Set(a)].sort();
  const right = [...new Set(b)].sort();
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/**
 * @param {import('./map.mjs').DesiredProduct} desired
 * @param {import('./remote.mjs').RemoteProduct | null} remote
 * @param {{ allowRemovals?: boolean, publicationId?: string | null }} [options]
 * @returns {ProductDiff}
 */
export function diffProduct(desired, remote, { allowRemovals = false, publicationId = null } = {}) {
  /** @type {ProductDiff} */
  const diff = {
    action: 'unchanged',
    changes: [],
    blocked: [],
    scalarsChanged: false,
    optionsChanged: false,
    variantsChanged: false,
    imagesChanged: false,
    publish: false,
    metafieldWrites: [],
    variantMatches: new Map(),
    imageSteps: desired.images.map((image) => ({ ...image, existing: null })),
    removedVariants: [],
    removedMedia: [],
    mergedTags: desired.tags,
  };

  if (remote === null) {
    diff.action = 'create';
    diff.scalarsChanged = diff.optionsChanged = diff.variantsChanged = true;
    diff.imagesChanged = desired.images.length > 0;
    diff.publish = Boolean(publicationId) && desired.status === 'ACTIVE';
    diff.changes.push({ scope: 'product', field: 'new product', from: null, to: `${desired.variants.length} size(s), ${desired.images.length} image(s), ${desired.metafields.length} metafield(s), status ${desired.status}` });
    return diff;
  }

  if (remote.truncated.length > 0) {
    diff.blocked.push(`Shopify holds more ${remote.truncated.join(', ')} than this tool reads; refusing to update so nothing is lost.`);
  }
  const otherOptions = remote.options.filter((option) => option.name !== SIZE_OPTION_NAME);
  if (otherOptions.length > 0) {
    diff.blocked.push(`The product has option(s) other than ${SIZE_OPTION_NAME} (${otherOptions.map((option) => option.name).join(', ')}); the tool only manages the Size option.`);
  }

  // ---- scalars ---------------------------------------------------------------------------------
  /** @param {string} field @param {string} from @param {string} to */
  const scalar = (field, from, to) => {
    diff.scalarsChanged = true;
    diff.changes.push({ scope: 'product', field, from, to });
  };
  if (!sameText(remote.title, desired.title)) scalar('title', remote.title, desired.title);
  if (desired.descriptionHtml !== '' && !sameText(remote.descriptionHtml, desired.descriptionHtml)) scalar('description', remote.descriptionHtml, desired.descriptionHtml);
  if (!sameText(remote.vendor, desired.vendor)) scalar('vendor', remote.vendor, desired.vendor);
  if (!sameText(remote.productType, desired.productType)) scalar('product type', remote.productType, desired.productType);
  if (remote.status !== desired.status) scalar('status', remote.status, desired.status);
  // A live product silently going back to DRAFT would unpublish it from the store: never do that without the explicit flag.
  if (remote.status === 'ACTIVE' && desired.status === 'DRAFT') {
    if (allowRemovals) diff.changes.push({ scope: 'product', field: 'WARNING', from: 'live product', to: 'will be UNPUBLISHED (copy_approved is no)' });
    else diff.blocked.push('This live (ACTIVE) product would be set back to DRAFT because its copy is not approved in the sheet, which unpublishes it. Approve the copy, or pass --allow-removals to unpublish on purpose.');
  }
  if (desired.seoTitle !== null && !sameText(remote.seoTitle, desired.seoTitle)) scalar('SEO title', remote.seoTitle, desired.seoTitle);
  if (desired.seoDescription !== null && !sameText(remote.seoDescription, desired.seoDescription)) scalar('SEO description', remote.seoDescription, desired.seoDescription);
  diff.mergedTags = mergeTags(remote.tags, desired.tags);
  if (!sameSet(remote.tags, diff.mergedTags)) {
    const ours = (/** @type {string} */ tag) => MANAGED_TAG_PREFIXES.some((prefix) => tag.toLowerCase().startsWith(prefix));
    scalar('tags', remote.tags.filter(ours).join(', '), diff.mergedTags.filter(ours).join(', '));
  }

  // ---- options and variants --------------------------------------------------------------------
  const sizeOption = remote.options.find((option) => option.name === SIZE_OPTION_NAME);
  if (sizeOption && desired.sizes.some((size) => !sizeOption.values.includes(size))) {
    diff.optionsChanged = true;
    diff.changes.push({ scope: 'options', field: SIZE_OPTION_NAME, from: sizeOption.values.join(', '), to: desired.sizes.join(', ') });
  }

  const usedRemote = new Set();
  for (const variant of desired.variants) {
    const bySku = remote.variants.find((candidate) => candidate.sku === variant.sku && !usedRemote.has(candidate.id));
    const bySize = bySku ?? remote.variants.find((candidate) => candidate.size === variant.size && !usedRemote.has(candidate.id));
    const label = `${variant.size}`;
    if (!bySize) {
      diff.variantsChanged = true;
      diff.changes.push({ scope: 'variant', field: `${label} (new size)`, from: null, to: `${variant.sku} at ${variant.price}` });
      continue;
    }
    usedRemote.add(bySize.id);
    diff.variantMatches.set(variant.sku, bySize);
    /** @param {string} field @param {string | null} from @param {string | null} to */
    const variantChange = (field, from, to) => {
      diff.variantsChanged = true;
      diff.changes.push({ scope: 'variant', field: `${label} ${field}`, from, to });
    };
    if (bySize.sku !== variant.sku) variantChange('sku', bySize.sku, variant.sku);
    if (bySize.size !== variant.size) variantChange('size', bySize.size, variant.size);
    if (normaliseMoney(bySize.price) !== normaliseMoney(variant.price)) variantChange('price', bySize.price, variant.price);
    if (normaliseMoney(bySize.compareAtPrice) !== normaliseMoney(variant.compareAtPrice)) variantChange('compare-at price', bySize.compareAtPrice, variant.compareAtPrice);
    for (const wanted of variant.metafields) {
      const current = bySize.metafields.find((item) => item.namespace === wanted.namespace && item.key === wanted.key);
      if (!current || !metafieldValuesEqual(current, wanted)) {
        diff.changes.push({ scope: 'metafield', field: `${label} ${wanted.namespace}.${wanted.key}`, from: current?.value ?? null, to: wanted.value });
        diff.metafieldWrites.push({ ownerId: bySize.id, ...wanted });
      }
    }
  }
  for (const variant of remote.variants) {
    if (usedRemote.has(variant.id)) continue;
    diff.removedVariants.push(`${variant.size ?? 'unknown size'} (${variant.sku || 'no sku'})`);
  }
  if (diff.removedVariants.length > 0) {
    if (allowRemovals) {
      diff.variantsChanged = true;
      diff.changes.push({ scope: 'variant', field: 'removed sizes', from: diff.removedVariants.join(', '), to: null });
    } else {
      diff.blocked.push(`Shopify has size(s) that are not in the sheet: ${diff.removedVariants.join(', ')}. Updating would delete them. Add them to the sheet, or pass --allow-removals.`);
    }
  }

  // ---- product metafields (written with metafieldsSet, never deleted) --------------------------
  for (const wanted of desired.metafields) {
    const current = remote.metafields.find((item) => item.namespace === wanted.namespace && item.key === wanted.key);
    if (!current || !metafieldValuesEqual(current, wanted)) {
      diff.changes.push({ scope: 'metafield', field: `${wanted.namespace}.${wanted.key}`, from: current?.value ?? null, to: wanted.value });
      diff.metafieldWrites.push({ ownerId: remote.id, ...wanted });
    }
  }

  // ---- images ----------------------------------------------------------------------------------
  const mediaPool = [...remote.media];
  diff.imageSteps = desired.images.map((image) => {
    const index = mediaPool.findIndex((item) => fileKey(item.fileName) === fileKey(image.fileName));
    const existing = index >= 0 ? mediaPool.splice(index, 1)[0] : null;
    return { ...image, existing };
  });
  const uploads = diff.imageSteps.filter((step) => step.existing === null);
  const altChanges = diff.imageSteps.filter((step) => step.existing !== null && !sameText(step.existing.alt, step.alt));
  const keptOrder = diff.imageSteps.flatMap((step) => (step.existing ? [step.existing.id] : []));
  const remoteOrder = remote.media.filter((item) => keptOrder.includes(item.id)).map((item) => item.id);
  const reordered = keptOrder.length === remoteOrder.length && keptOrder.some((id, index) => id !== remoteOrder[index]);
  diff.removedMedia = mediaPool.map((item) => item.fileName || item.id);
  if (desired.images.length > 0) {
    if (uploads.length > 0) diff.changes.push({ scope: 'images', field: 'upload', from: null, to: uploads.map((step) => step.fileName).join(', ') });
    if (altChanges.length > 0) diff.changes.push({ scope: 'images', field: 'alt text', from: `${altChanges.length} image(s)`, to: 'updated' });
    if (reordered) diff.changes.push({ scope: 'images', field: 'order', from: null, to: desired.images.map((image) => image.fileName).join(', ') });
    if (diff.removedMedia.length > 0) {
      if (allowRemovals) diff.changes.push({ scope: 'images', field: 'remove', from: diff.removedMedia.join(', '), to: null });
      else diff.blocked.push(`Shopify has media that is not in the sheet: ${diff.removedMedia.join(', ')}. Updating images would delete it. Add it to the sheet, or pass --allow-removals.`);
    }
    diff.imagesChanged = uploads.length > 0 || altChanges.length > 0 || reordered || (allowRemovals && diff.removedMedia.length > 0);
  }

  // ---- publishing ------------------------------------------------------------------------------
  if (publicationId && desired.status === 'ACTIVE' && remote.publishedOnPublication === false) {
    diff.publish = true;
    diff.changes.push({ scope: 'publish', field: 'publication', from: 'not published', to: 'published' });
  }

  if (diff.blocked.length > 0) diff.action = 'blocked';
  else diff.action = diff.changes.length > 0 ? 'update' : 'unchanged';
  return diff;
}

/** @param {import('./map.mjs').MetafieldValue[]} list */
const metafieldInputs = (list) => list.map(({ namespace, key, type, value }) => ({ namespace, key, type, value }));

/**
 * Create path: nothing exists yet, so nothing can be deleted; metafields go inline.
 * @param {import('./map.mjs').DesiredProduct} desired
 * @param {ReadonlyMap<string, string>} uploadUrls image file name -> resourceUrl
 * @returns {Record<string, unknown>}
 */
export function buildCreateInput(desired, uploadUrls) {
  return {
    title: desired.title,
    handle: desired.handle,
    ...(desired.descriptionHtml ? { descriptionHtml: desired.descriptionHtml } : {}),
    vendor: desired.vendor,
    productType: desired.productType,
    status: desired.status,
    tags: desired.tags,
    ...(desired.seoTitle || desired.seoDescription ? { seo: { ...(desired.seoTitle ? { title: desired.seoTitle } : {}), ...(desired.seoDescription ? { description: desired.seoDescription } : {}) } } : {}),
    productOptions: [{ name: SIZE_OPTION_NAME, position: 1, values: desired.sizes.map((name) => ({ name })) }],
    variants: desired.variants.map((variant) => ({
      optionValues: [{ optionName: SIZE_OPTION_NAME, name: variant.size }],
      sku: variant.sku,
      price: variant.price,
      ...(variant.compareAtPrice ? { compareAtPrice: variant.compareAtPrice } : {}),
      ...(variant.metafields.length > 0 ? { metafields: metafieldInputs(variant.metafields) } : {}),
    })),
    ...(desired.images.length > 0
      ? {
          files: desired.images.map((image) => ({
            originalSource: uploadUrls.get(image.fileName),
            alt: image.alt,
            filename: image.fileName,
            contentType: 'IMAGE',
          })),
        }
      : {}),
    ...(desired.metafields.length > 0 ? { metafields: metafieldInputs(desired.metafields) } : {}),
  };
}

/**
 * Update path: scalars, tags, variants (with ids) and, only when changed, options and files.
 * Metafields and collections are deliberately absent (see the header).
 * @param {import('./map.mjs').DesiredProduct} desired
 * @param {import('./remote.mjs').RemoteProduct} remote
 * @param {ProductDiff} diff
 * @param {ReadonlyMap<string, string>} uploadUrls
 * @returns {Record<string, unknown>}
 */
export function buildUpdateInput(desired, remote, diff, uploadUrls) {
  /** @type {Record<string, unknown>} */
  const input = {};
  if (diff.scalarsChanged) {
    input.title = desired.title;
    if (desired.descriptionHtml) input.descriptionHtml = desired.descriptionHtml;
    input.vendor = desired.vendor;
    input.productType = desired.productType;
    input.status = desired.status;
    input.tags = diff.mergedTags;
    if (desired.seoTitle || desired.seoDescription) {
      input.seo = { ...(desired.seoTitle ? { title: desired.seoTitle } : {}), ...(desired.seoDescription ? { description: desired.seoDescription } : {}) };
    }
  }
  if (diff.optionsChanged) {
    const option = remote.options.find((item) => item.name === SIZE_OPTION_NAME);
    input.productOptions = [{ ...(option ? { id: option.id } : {}), name: SIZE_OPTION_NAME, values: desired.sizes.map((name) => ({ name })) }];
  }
  if (diff.variantsChanged) {
    input.variants = desired.variants.map((variant) => {
      const match = diff.variantMatches.get(variant.sku);
      return {
        ...(match ? { id: match.id } : {}),
        optionValues: [{ optionName: SIZE_OPTION_NAME, name: variant.size }],
        sku: variant.sku,
        price: variant.price,
        // null clears a finished sale; omitted would leave the old compare-at price in place.
        compareAtPrice: variant.compareAtPrice,
        ...(!match && variant.metafields.length > 0 ? { metafields: metafieldInputs(variant.metafields) } : {}),
      };
    });
  }
  if (diff.imagesChanged) {
    input.files = diff.imageSteps.map((step) => (step.existing ? { id: step.existing.id, alt: step.alt } : { originalSource: uploadUrls.get(step.fileName), alt: step.alt, filename: step.fileName, contentType: 'IMAGE' }));
  }
  return input;
}
