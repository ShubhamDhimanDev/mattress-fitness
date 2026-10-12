// The importer's only door to Shopify: named GraphQL operations over the Admin client (REQ-CAT-002).
// Reads are used by dry runs; writes need a client created with allowMutations (only after the live guard).
//
// Documentation used (Admin GraphQL 2026-10, read 2026-10-12):
//  productByIdentifier (identifier handle|customId; scope read_products)   shopify.dev/docs/api/admin-graphql/2026-10/queries/productByIdentifier
//  productVariants(query: "sku:...")                                       .../queries/productVariants
//  metaobjectByHandle(handle: { type, handle })  scope read_metaobjects    .../queries/metaobjectByHandle
//  productSet(input, identifier, synchronous)    scope write_products      .../mutations/productSet
//  metafieldsSet (upsert, atomic, max 25 per call)                          .../mutations/metafieldsSet
//  stagedUploadsCreate -> POST multipart -> resourceUrl as originalSource   .../mutations/stagedUploadsCreate
//  publishablePublish(id, input: [{ publicationId }])  scope write_publications   .../mutations/publishablePublish
// UNVERIFIED(V-05): sub-selections not shown on the pages read (SEO { title description },
//  ProductOption { id name position values }, SelectedOption { name value }, MediaImage { image { url } }).
// UNVERIFIED(V-05): productSet userErrors element type; only { field message } is requested.

import { connectionNodes, isRecord, readPayload } from '../lib/shopify-admin.mjs';
import { METAFIELD_NAMESPACE } from './schema.mjs';
import { SIZE_OPTION_NAME } from './map.mjs';

/** Shopify keeps product, metafield and media lists short for a sheet-managed mattress; beyond these we refuse to guess. */
export const READ_LIMITS = Object.freeze({ variants: 20, variantMetafields: 10, metafields: 50, media: 50 });

const METAFIELD_FIELDS = 'namespace key type value';

/** @param {boolean} withPublication */
export function productQuery(withPublication) {
  return `query ProductByHandle($identifier: ProductIdentifierInput!${withPublication ? ', $publicationId: ID!' : ''}) {
  product: productByIdentifier(identifier: $identifier) {
    id handle title descriptionHtml vendor productType tags status
    seo { title description }
    options { id name position values }
    variants(first: ${READ_LIMITS.variants}) {
      pageInfo { hasNextPage }
      nodes {
        id sku price compareAtPrice
        selectedOptions { name value }
        metafields(first: ${READ_LIMITS.variantMetafields}, namespace: "${METAFIELD_NAMESPACE}") { pageInfo { hasNextPage } nodes { ${METAFIELD_FIELDS} } }
      }
    }
    metafields(first: ${READ_LIMITS.metafields}, namespace: "${METAFIELD_NAMESPACE}") { pageInfo { hasNextPage } nodes { ${METAFIELD_FIELDS} } }
    media(first: ${READ_LIMITS.media}) {
      pageInfo { hasNextPage }
      nodes { id alt mediaContentType ... on MediaImage { image { url } } }
    }
    ${withPublication ? 'publishedOnPublication(publicationId: $publicationId)' : ''}
  }
}`;
}

const VARIANTS_BY_SKUS = `query VariantsBySkus($query: String!, $first: Int!) {
  productVariants(first: $first, query: $query) { nodes { id sku product { id handle } } }
}`;

const BRAND_BY_HANDLE = `query BrandByHandle($handle: MetaobjectHandleInput!) {
  metaobjectByHandle(handle: $handle) { id handle }
}`;

const PRODUCT_ID_BY_HANDLE = `query ProductIdByHandle($identifier: ProductIdentifierInput!) {
  product: productByIdentifier(identifier: $identifier) { id handle }
}`;

const PRODUCT_SET = `mutation ProductSet($input: ProductSetInput!, $identifier: ProductSetIdentifiers, $synchronous: Boolean!) {
  productSet(input: $input, identifier: $identifier, synchronous: $synchronous) {
    product { id handle variants(first: ${READ_LIMITS.variants}) { nodes { id sku } } }
    userErrors { field message }
  }
}`;

const METAFIELDS_SET = `mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) { metafields { id } userErrors { field message code } }
}`;

const STAGED_UPLOADS_CREATE = `mutation StagedUploadsCreate($input: [StagedUploadInput!]!) {
  stagedUploadsCreate(input: $input) { stagedTargets { url resourceUrl parameters { name value } } userErrors { field message } }
}`;

const PUBLISH = `mutation PublishProduct($id: ID!, $input: [PublicationInput!]!) {
  publishablePublish(id: $id, input: $input) { publishable { __typename } userErrors { field message } }
}`;

/**
 * @template T
 * @typedef {{ ok: true, value: T } | { ok: false, error: import('../lib/shopify-admin.mjs').AdminError }} Result
 */

/** @param {unknown} value @returns {string} */
const str = (value) => (typeof value === 'string' ? value : '');

/**
 * Shopify may change the case, spaces and add a uuid suffix when it stores a file name, so compare keys.
 * @param {string} name
 * @returns {string}
 */
export function fileKey(name) {
  const base = name.toLowerCase().replace(/_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\.[a-z0-9]+$)/, '');
  const match = /^(.*?)(\.[a-z0-9]+)?$/.exec(base);
  const stem = (match?.[1] ?? base).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `${stem}${match?.[2] ?? ''}`;
}

/** @param {unknown} url @returns {string} */
function fileNameFromUrl(url) {
  if (typeof url !== 'string') return '';
  try {
    const last = new URL(url).pathname.split('/').pop() ?? '';
    return decodeURIComponent(last);
  } catch {
    return '';
  }
}

/**
 * @typedef {{ namespace: string, key: string, type: string, value: string }} RemoteMetafield
 * @typedef {{ id: string, sku: string, price: string, compareAtPrice: string | null, size: string | null, metafields: RemoteMetafield[] }} RemoteVariant
 * @typedef {{ id: string, alt: string, fileName: string }} RemoteMedia
 * @typedef {object} RemoteProduct
 * @property {string} id
 * @property {string} handle
 * @property {string} title
 * @property {string} descriptionHtml
 * @property {string} vendor
 * @property {string} productType
 * @property {string[]} tags
 * @property {string} status
 * @property {string} seoTitle
 * @property {string} seoDescription
 * @property {{ id: string, name: string, values: string[] }[]} options
 * @property {RemoteVariant[]} variants
 * @property {RemoteMetafield[]} metafields
 * @property {RemoteMedia[]} media
 * @property {boolean | null} publishedOnPublication  null when no publication was asked about
 * @property {string[]} truncated  lists that had more entries than we read; the planner then refuses to write
 */

/** @param {unknown} connection @returns {RemoteMetafield[]} */
function readMetafields(connection) {
  return connectionNodes(connection).map((node) => ({ namespace: str(node.namespace), key: str(node.key), type: str(node.type), value: str(node.value) }));
}

/** @param {unknown} connection */
function hasNextPage(connection) {
  return isRecord(connection) && isRecord(connection.pageInfo) && connection.pageInfo.hasNextPage === true;
}

/**
 * Defensive reader: a malformed answer from Shopify becomes null fields, never an exception.
 * @param {unknown} node
 * @returns {RemoteProduct | null}
 */
export function normaliseRemoteProduct(node) {
  if (!isRecord(node) || typeof node.id !== 'string') return null;
  /** @type {string[]} */
  const truncated = [];
  if (hasNextPage(node.variants)) truncated.push('variants');
  if (hasNextPage(node.metafields)) truncated.push('metafields');
  if (hasNextPage(node.media)) truncated.push('media');
  const variants = connectionNodes(node.variants).map((variant) => {
    if (hasNextPage(variant.metafields)) truncated.push('variant metafields');
    const selected = Array.isArray(variant.selectedOptions) ? variant.selectedOptions.filter(isRecord) : [];
    const size = selected.find((option) => option.name === SIZE_OPTION_NAME);
    return {
      id: str(variant.id),
      sku: str(variant.sku),
      price: str(variant.price),
      compareAtPrice: typeof variant.compareAtPrice === 'string' ? variant.compareAtPrice : null,
      size: size ? str(size.value) : null,
      metafields: readMetafields(variant.metafields),
    };
  });
  const media = connectionNodes(node.media).map((item) => {
    const image = isRecord(item.image) ? item.image : null;
    return { id: str(item.id), alt: str(item.alt), fileName: fileNameFromUrl(image?.url) };
  });
  const seo = isRecord(node.seo) ? node.seo : {};
  const options = Array.isArray(node.options)
    ? node.options.filter(isRecord).map((option) => ({
        id: str(option.id),
        name: str(option.name),
        values: Array.isArray(option.values) ? option.values.filter((value) => typeof value === 'string') : [],
      }))
    : [];
  return {
    id: node.id,
    handle: str(node.handle),
    title: str(node.title),
    descriptionHtml: str(node.descriptionHtml),
    vendor: str(node.vendor),
    productType: str(node.productType),
    tags: Array.isArray(node.tags) ? node.tags.filter((tag) => typeof tag === 'string') : [],
    status: str(node.status),
    seoTitle: str(seo.title),
    seoDescription: str(seo.description),
    options,
    variants,
    metafields: readMetafields(node.metafields),
    media,
    publishedOnPublication: typeof node.publishedOnPublication === 'boolean' ? node.publishedOnPublication : null,
    truncated,
  };
}

/**
 * @typedef {object} Remote
 * @property {(handle: string) => Promise<Result<RemoteProduct | null>>} getProductByHandle
 * @property {(skus: readonly string[]) => Promise<Result<Map<string, { variantId: string, productId: string, productHandle: string }>>>} findVariantsBySkus
 * @property {(brandSlug: string) => Promise<Result<string | null>>} getBrandId
 * @property {(handle: string) => Promise<Result<string | null>>} getProductId
 * @property {(args: { input: Record<string, unknown>, productId: string | null }) => Promise<Result<{ id: string, handle: string, variants: { id: string, sku: string }[] }>>} productSet
 * @property {(metafields: { ownerId: string, namespace: string, key: string, type: string, value: string }[]) => Promise<Result<null>>} metafieldsSet
 * @property {(files: { filename: string, mimeType: string }[]) => Promise<Result<{ url: string, resourceUrl: string, parameters: { name: string, value: string }[] }[]>>} stagedUploadsCreate
 * @property {(productId: string) => Promise<Result<null>>} publish
 */

/**
 * @param {import('../lib/shopify-admin.mjs').AdminClient} client
 * @param {{ publicationId?: string | null }} [options]
 * @returns {Remote}
 */
export function createShopifyRemote(client, { publicationId = null } = {}) {
  /** @type {Remote} */
  const remote = {
    async getProductByHandle(handle) {
      const variables = { identifier: { handle }, ...(publicationId ? { publicationId } : {}) };
      const result = await client.request(productQuery(Boolean(publicationId)), variables, { operationName: 'ProductByHandle' });
      if (!result.ok) return result;
      return { ok: true, value: normaliseRemoteProduct(result.data.product) };
    },
    async findVariantsBySkus(skus) {
      /** @type {Map<string, { variantId: string, productId: string, productHandle: string }>} */
      const found = new Map();
      if (skus.length === 0) return { ok: true, value: found };
      // SKUs are validated to [A-Za-z0-9._/-] by the sheet validator; quoting and escaping stay as defence in depth.
      const query = skus.map((sku) => `sku:"${sku.replace(/["\\]/g, '\\$&')}"`).join(' OR ');
      const result = await client.request(VARIANTS_BY_SKUS, { query, first: Math.min(250, Math.max(5, skus.length * 5)) }, { operationName: 'VariantsBySkus', estimatedCost: 30 });
      if (!result.ok) return result;
      const nodes = isRecord(result.data.productVariants) ? connectionNodes(result.data.productVariants) : [];
      // The search can match more loosely than equality, so compare ourselves (SKUs are case-sensitive in Shopify).
      for (const node of nodes) {
        if (typeof node.sku !== 'string' || !skus.includes(node.sku) || !isRecord(node.product)) continue;
        found.set(node.sku, { variantId: str(node.id), productId: str(node.product.id), productHandle: str(node.product.handle) });
      }
      return { ok: true, value: found };
    },
    async getBrandId(brandSlug) {
      const result = await client.request(BRAND_BY_HANDLE, { handle: { type: 'brand', handle: brandSlug } }, { operationName: 'BrandByHandle', estimatedCost: 10 });
      if (!result.ok) return result;
      const node = result.data.metaobjectByHandle;
      return { ok: true, value: isRecord(node) && typeof node.id === 'string' ? node.id : null };
    },
    async getProductId(handle) {
      const result = await client.request(PRODUCT_ID_BY_HANDLE, { identifier: { handle } }, { operationName: 'ProductIdByHandle', estimatedCost: 10 });
      if (!result.ok) return result;
      const node = result.data.product;
      return { ok: true, value: isRecord(node) && typeof node.id === 'string' ? node.id : null };
    },
    async productSet({ input, productId }) {
      const variables = { input, synchronous: true, ...(productId ? { identifier: { id: productId } } : {}) };
      const result = await client.request(PRODUCT_SET, variables, { operationName: 'ProductSet', estimatedCost: 100 });
      if (!result.ok) return result;
      const payload = readPayload(result.data, 'productSet');
      if (!payload.ok) return payload;
      const product = payload.payload.product;
      if (!isRecord(product) || typeof product.id !== 'string') {
        return { ok: false, error: { kind: 'invalid_response', message: 'productSet returned no product' } };
      }
      return {
        ok: true,
        value: {
          id: product.id,
          handle: str(product.handle),
          variants: connectionNodes(product.variants).map((node) => ({ id: str(node.id), sku: str(node.sku) })),
        },
      };
    },
    async metafieldsSet(metafields) {
      // metafieldsSet takes at most 25 per call and is atomic per call.
      for (let start = 0; start < metafields.length; start += 25) {
        const result = await client.request(METAFIELDS_SET, { metafields: metafields.slice(start, start + 25) }, { operationName: 'MetafieldsSet', estimatedCost: 30 });
        if (!result.ok) return result;
        const payload = readPayload(result.data, 'metafieldsSet');
        if (!payload.ok) return payload;
      }
      return { ok: true, value: null };
    },
    async stagedUploadsCreate(files) {
      const input = files.map((file) => ({ resource: 'IMAGE', filename: file.filename, mimeType: file.mimeType, httpMethod: 'POST' }));
      const result = await client.request(STAGED_UPLOADS_CREATE, { input }, { operationName: 'StagedUploadsCreate', estimatedCost: 20 });
      if (!result.ok) return result;
      const payload = readPayload(result.data, 'stagedUploadsCreate');
      if (!payload.ok) return payload;
      const targets = Array.isArray(payload.payload.stagedTargets) ? payload.payload.stagedTargets.filter(isRecord) : [];
      if (targets.length !== files.length) {
        return { ok: false, error: { kind: 'invalid_response', message: `stagedUploadsCreate returned ${targets.length} targets for ${files.length} files` } };
      }
      return {
        ok: true,
        value: targets.map((target) => ({
          url: str(target.url),
          resourceUrl: str(target.resourceUrl),
          parameters: Array.isArray(target.parameters) ? target.parameters.filter(isRecord).map((p) => ({ name: str(p.name), value: str(p.value) })) : [],
        })),
      };
    },
    async publish(productId) {
      if (!publicationId) return { ok: true, value: null };
      const result = await client.request(PUBLISH, { id: productId, input: [{ publicationId }] }, { operationName: 'PublishProduct', estimatedCost: 20 });
      if (!result.ok) return result;
      const payload = readPayload(result.data, 'publishablePublish');
      return payload.ok ? { ok: true, value: null } : payload;
    },
  };
  return remote;
}

/**
 * Plans against an empty store without touching the network (--offline). Every product is a create.
 * @returns {Remote}
 */
export function createOfflineRemote() {
  const refuse = () => Promise.resolve({ ok: /** @type {const} */ (false), error: { kind: /** @type {const} */ ('read_only'), message: 'Offline mode cannot write.' } });
  return {
    getProductByHandle: () => Promise.resolve({ ok: true, value: null }),
    findVariantsBySkus: () => Promise.resolve({ ok: true, value: new Map() }),
    getBrandId: () => Promise.resolve({ ok: true, value: null }),
    getProductId: () => Promise.resolve({ ok: true, value: null }),
    productSet: refuse,
    metafieldsSet: refuse,
    stagedUploadsCreate: refuse,
    publish: refuse,
  };
}
