// TEST SUPPORT ONLY. An in-memory stand-in for the parts of the Shopify Admin GraphQL API the tooling
// uses, served through an injected `fetch`, so idempotency, guards and failure paths can be tested
// without a store. It mimics the documented semantics that matter for safety, in particular that
// productSet deletes list entries (variants, files, metafields) that are not sent.
// It is NOT evidence of how Shopify behaves: every behaviour here that the docs do not state is a
// V-05 item to confirm on a development store.

import { ADMIN_API_VERSION } from '../shopify-admin.mjs';

export const FAKE_TOKEN = 'test-token-not-real-0123456789abcdef';
export const FAKE_STORE = 'tooling-test.myshopify.com';

/** @param {unknown} body @param {number} [status] @param {Record<string, string>} [headers] */
function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

const cost = (/** @type {number} */ requested) => ({
  cost: { requestedQueryCost: requested, actualQueryCost: Math.max(1, Math.floor(requested / 2)), throttleStatus: { maximumAvailable: 1000, currentlyAvailable: 1000, restoreRate: 100 } },
});

/**
 * @typedef {object} FakeOptions
 * @property {string} [store]
 * @property {string} [token]
 * @property {string[]} [brands]                       brand metaobject handles that exist
 * @property {(call: { operationName: string, variables: Record<string, any> }) => Response | null | undefined} [intercept]  return a Response to fail a call
 */

/**
 * @param {FakeOptions} [options]
 */
export function createFakeShopify({ store = FAKE_STORE, token = FAKE_TOKEN, brands = [], intercept } = {}) {
  let counter = 1000;
  const nextId = (/** @type {string} */ type) => `gid://shopify/${type}/${(counter += 1)}`;
  /** @type {Map<string, any>} */
  const products = new Map();
  /** @type {Map<string, string>} */
  const brandIds = new Map(brands.map((handle) => [handle, nextId('Metaobject')]));
  /** @type {Map<string, any>} */
  const metafieldDefinitions = new Map();
  /** @type {Map<string, any>} */
  const metaobjectDefinitions = new Map();
  /** @type {{ operationName: string, kind: 'query' | 'mutation', variables: Record<string, any> }[]} */
  const calls = [];
  /** @type {{ url: string, fields: string[] }[]} */
  const uploads = [];
  /** @type {string[]} every outgoing URL, for host assertions */
  const urls = [];

  const state = { products, brandIds, metafieldDefinitions, metaobjectDefinitions, calls, uploads, urls };

  /** @param {any} product */
  function productNode(product, withPublication) {
    return {
      id: product.id, handle: product.handle, title: product.title, descriptionHtml: product.descriptionHtml, vendor: product.vendor, productType: product.productType,
      tags: product.tags, status: product.status, seo: product.seo,
      options: product.options.map((option) => ({ id: option.id, name: option.name, position: option.position, values: option.values })),
      variants: {
        pageInfo: { hasNextPage: false },
        nodes: product.variants.map((variant) => ({
          id: variant.id, sku: variant.sku, price: variant.price, compareAtPrice: variant.compareAtPrice, selectedOptions: variant.selectedOptions,
          metafields: { pageInfo: { hasNextPage: false }, nodes: variant.metafields },
        })),
      },
      metafields: { pageInfo: { hasNextPage: false }, nodes: product.metafields },
      media: { pageInfo: { hasNextPage: false }, nodes: product.media.map((item) => ({ id: item.id, alt: item.alt, mediaContentType: 'IMAGE', image: { url: item.url } })) },
      ...(withPublication ? { publishedOnPublication: product.published } : {}),
    };
  }

  const money = (/** @type {unknown} */ value) => (value === null || value === undefined ? null : Number(value).toFixed(2));
  const toMetafield = (/** @type {any} */ input) => ({ namespace: input.namespace, key: input.key, type: input.type, value: input.value });

  /** @param {any[]} list @param {any} incoming */
  function upsertMetafield(list, incoming) {
    const existing = list.find((item) => item.namespace === incoming.namespace && item.key === incoming.key);
    if (existing) Object.assign(existing, toMetafield(incoming));
    else list.push(toMetafield(incoming));
  }

  function productSet(/** @type {Record<string, any>} */ variables) {
    const { input, identifier } = variables;
    /** @type {any} */
    let product;
    if (identifier?.id) {
      product = products.get(identifier.id);
      if (!product) return { productSet: { product: null, userErrors: [{ field: ['identifier'], message: 'Product does not exist' }] } };
    } else {
      if ([...products.values()].some((item) => item.handle === input.handle)) {
        return { productSet: { product: null, userErrors: [{ field: ['input', 'handle'], message: 'Handle has already been taken' }] } };
      }
      product = { id: nextId('Product'), handle: input.handle, title: '', descriptionHtml: '', vendor: '', productType: '', tags: [], status: 'ACTIVE', seo: { title: '', description: '' }, options: [], variants: [], metafields: [], media: [], published: false };
    }
    for (const key of ['title', 'descriptionHtml', 'vendor', 'productType', 'status']) if (key in input) product[key] = input[key];
    if (input.tags) product.tags = [...input.tags];
    if (input.seo) product.seo = { title: input.seo.title ?? product.seo.title, description: input.seo.description ?? product.seo.description };
    if (input.productOptions) {
      for (const option of input.productOptions) {
        const existing = option.id ? product.options.find((item) => item.id === option.id) : product.options.find((item) => item.name === option.name);
        const values = (option.values ?? []).map((value) => value.name);
        if (existing) Object.assign(existing, { name: option.name, values });
        else product.options.push({ id: nextId('ProductOption'), name: option.name, position: option.position ?? product.options.length + 1, values });
      }
    }
    if (input.variants) {
      const next = [];
      for (const variant of input.variants) {
        for (const value of variant.optionValues) {
          const option = product.options.find((item) => item.name === value.optionName);
          if (!option || !option.values.includes(value.name)) {
            return { productSet: { product: null, userErrors: [{ field: ['input', 'variants'], message: `Option value ${value.name} does not exist on ${value.optionName}` }] } };
          }
        }
        const current = variant.id ? product.variants.find((item) => item.id === variant.id) : null;
        const metafields = current ? current.metafields : [];
        for (const metafield of variant.metafields ?? []) upsertMetafield(metafields, metafield);
        next.push({
          id: current?.id ?? nextId('ProductVariant'), sku: variant.sku, price: money(variant.price), compareAtPrice: money(variant.compareAtPrice),
          selectedOptions: variant.optionValues.map((value) => ({ name: value.optionName, value: value.name })), metafields,
        });
      }
      product.variants = next; // documented list semantics: variants not sent are deleted
    }
    if (input.files) {
      const next = [];
      for (const file of input.files) {
        const current = file.id ? product.media.find((item) => item.id === file.id) : null;
        if (!current && !file.originalSource) return { productSet: { product: null, userErrors: [{ field: ['input', 'files'], message: 'File source is missing' }] } };
        next.push(current ? { ...current, alt: file.alt ?? current.alt } : { id: nextId('MediaImage'), alt: file.alt ?? '', url: `https://cdn.shopify.invalid/s/files/${file.filename}` });
      }
      product.media = next; // list semantics: files not sent are deleted
    }
    if (input.metafields) product.metafields = input.metafields.map(toMetafield); // list semantics: metafields not sent are deleted
    products.set(product.id, product);
    return { productSet: { product: { id: product.id, handle: product.handle, variants: { nodes: product.variants.map((variant) => ({ id: variant.id, sku: variant.sku })) } }, userErrors: [] } };
  }

  function metafieldsSet(/** @type {Record<string, any>} */ variables) {
    for (const input of variables.metafields) {
      const owner = [...products.values()].find((product) => product.id === input.ownerId);
      if (owner) {
        upsertMetafield(owner.metafields, input);
        continue;
      }
      const variant = [...products.values()].flatMap((product) => product.variants).find((item) => item.id === input.ownerId);
      if (variant) upsertMetafield(variant.metafields, input);
      else return { metafieldsSet: { metafields: null, userErrors: [{ field: ['metafields'], message: 'Owner not found', code: 'INVALID' }] } };
    }
    return { metafieldsSet: { metafields: variables.metafields.map(() => ({ id: nextId('Metafield') })), userErrors: [] } };
  }

  /** @param {string} operationName @param {Record<string, any>} variables @param {string} query */
  function execute(operationName, variables, query) {
    switch (operationName) {
      case 'ProductByHandle': {
        const product = [...products.values()].find((item) => item.handle === variables.identifier.handle);
        return { product: product ? productNode(product, 'publicationId' in variables) : null };
      }
      case 'VariantsBySkus': {
        // the search string travels in the $query variable, not in the document text
        const wanted = [...String(variables.query).matchAll(/sku:"((?:[^"\\]|\\.)*)"/g)].map((match) => match[1].replace(/\\(.)/g, '$1'));
        const nodes = [...products.values()].flatMap((product) => product.variants.filter((variant) => wanted.includes(variant.sku)).map((variant) => ({ id: variant.id, sku: variant.sku, product: { id: product.id, handle: product.handle } })));
        return { productVariants: { nodes } };
      }
      case 'BrandByHandle': {
        const id = brandIds.get(variables.handle.handle);
        return { metaobjectByHandle: id ? { id, handle: variables.handle.handle } : null };
      }
      case 'ProductIdByHandle': {
        const product = [...products.values()].find((item) => item.handle === variables.identifier.handle);
        return { product: product ? { id: product.id, handle: product.handle } : null };
      }
      case 'ProductSet':
        return productSet(variables);
      case 'MetafieldsSet':
        return metafieldsSet(variables);
      case 'StagedUploadsCreate':
        return {
          stagedUploadsCreate: {
            stagedTargets: variables.input.map((file) => ({
              url: 'https://storage.googleapis.com/shopify-staged-uploads-fake/',
              resourceUrl: `https://shopify-staged-uploads.storage.googleapis.com/tmp/${file.filename}`,
              parameters: [{ name: 'key', value: `tmp/${file.filename}` }, { name: 'policy', value: 'signed-policy-fake-value' }],
            })),
            userErrors: [],
          },
        };
      case 'PublishProduct': {
        const product = products.get(variables.id);
        if (product) product.published = true;
        return { publishablePublish: { publishable: { __typename: 'Product' }, userErrors: product ? [] : [{ field: ['id'], message: 'Not found' }] } };
      }
      case 'ExistingMetafieldDefinitions': {
        const nodes = [...metafieldDefinitions.values()].filter((item) => item.ownerType === variables.ownerType && item.namespace === variables.namespace);
        return { metafieldDefinitions: { nodes } };
      }
      case 'ExistingMetaobjectDefinition':
        return { metaobjectDefinitionByType: metaobjectDefinitions.get(variables.type) ?? null };
      case 'CreateMetafieldDefinition': {
        const input = variables.definition;
        const id = nextId('MetafieldDefinition');
        metafieldDefinitions.set(`${input.ownerType}:${input.namespace}.${input.key}`, {
          id, ownerType: input.ownerType, name: input.name, namespace: input.namespace, key: input.key, description: input.description ?? null, type: { name: input.type },
          validations: input.validations ?? [], access: { storefront: input.access?.storefront ?? 'NONE' },
          capabilities: { smartCollectionCondition: { enabled: input.capabilities?.smartCollectionCondition?.enabled === true } },
        });
        return { metafieldDefinitionCreate: { createdDefinition: { id, namespace: input.namespace, key: input.key }, userErrors: [] } };
      }
      case 'CreateMetaobjectDefinition': {
        const input = variables.definition;
        const id = nextId('MetaobjectDefinition');
        metaobjectDefinitions.set(input.type, {
          id, type: input.type, name: input.name, description: input.description ?? null, displayNameKey: input.displayNameKey, access: { storefront: input.access?.storefront ?? 'NONE' },
          fieldDefinitions: input.fieldDefinitions.map((field) => ({ key: field.key, name: field.name, description: field.description ?? null, required: field.required === true, type: { name: field.type }, validations: field.validations ?? [] })),
        });
        return { metaobjectDefinitionCreate: { metaobjectDefinition: { id, type: input.type }, userErrors: [] } };
      }
      case 'AddMetaobjectDefinitionFields': {
        // Documented semantics: fieldDefinitions is a list of operations (exactly one of create, update, delete);
        // resetFieldOrder defaults to false, so created fields are appended. Only `create` is modelled, because
        // the tooling must never send anything else, and any other operation fails the test loudly.
        const definition = [...metaobjectDefinitions.values()].find((item) => item.id === variables.id);
        if (!definition) return { metaobjectDefinitionUpdate: { metaobjectDefinition: null, userErrors: [{ field: ['id'], message: 'Definition not found', code: 'NOT_FOUND' }] } };
        const operations = variables.definition.fieldDefinitions ?? [];
        for (const operation of operations) {
          const keys = Object.keys(operation);
          if (keys.length !== 1 || keys[0] !== 'create') throw new Error(`fake-shopify: unexpected field operation ${keys.join(',')}`);
        }
        for (const key of Object.keys(variables.definition)) if (key !== 'fieldDefinitions') throw new Error(`fake-shopify: unexpected definition change ${key}`);
        const taken = operations.find((operation) => definition.fieldDefinitions.some((field) => field.key === operation.create.key));
        if (taken) return { metaobjectDefinitionUpdate: { metaobjectDefinition: null, userErrors: [{ field: ['definition', 'fieldDefinitions'], message: 'Key is already in use', code: 'TAKEN' }] } };
        for (const { create: field } of operations) {
          definition.fieldDefinitions.push({ key: field.key, name: field.name, description: field.description ?? null, required: field.required === true, type: { name: field.type }, validations: field.validations ?? [] });
        }
        return { metaobjectDefinitionUpdate: { metaobjectDefinition: { id: definition.id, type: definition.type }, userErrors: [] } };
      }
      default:
        throw new Error(`fake-shopify: unhandled operation ${operationName}`);
    }
  }

  /** @type {typeof fetch} */
  const fetchImpl = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    urls.push(url);
    const host = new URL(url).hostname;
    if (host.endsWith('storage.googleapis.com')) {
      const form = init.body;
      uploads.push({ url, fields: form instanceof FormData ? [...form.keys()] : [] });
      return new Response(null, { status: 204 });
    }
    if (url !== `https://${store}/admin/api/${ADMIN_API_VERSION}/graphql.json`) return json({ errors: 'Not Found' }, 404);
    const headers = new Headers(init.headers);
    if (headers.get('x-shopify-access-token') !== token) return json({ errors: '[API] Invalid API key or access token' }, 401);
    const body = JSON.parse(String(init.body));
    const operationName = body.operationName ?? 'anonymous';
    const variables = body.variables ?? {};
    const kind = /(^|[\s}])mutation\b/.test(body.query) ? 'mutation' : 'query';
    calls.push({ operationName, kind, variables });
    const injected = intercept?.({ operationName, variables });
    if (injected) return injected;
    try {
      return json({ data: execute(operationName, variables, body.query), extensions: cost(60) });
    } catch (error) {
      return json({ errors: [{ message: error instanceof Error ? error.message : 'error' }] });
    }
  };

  return {
    fetch: fetchImpl,
    state,
    store,
    token,
    mutations: () => calls.filter((call) => call.kind === 'mutation'),
    reset: () => {
      calls.length = 0;
      uploads.length = 0;
      urls.length = 0;
    },
  };
}
