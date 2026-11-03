#!/usr/bin/env node
// Creates the three navigation collections the header menu links to (REQ-NAV-001, CR31) as automated collections
// whose rule is "Product type is equal to ...", so a product joins by its type and nobody sorts products by hand.
// Idempotent: a collection whose handle exists is left alone. Dry run is the default; --live needs the same guard as
// the other Shopify scripts (SHOPIFY_ALLOWED_STORES lists the store, SHOPIFY_ADMIN_API_ACCESS_TOKEN is set; the helper
// scripts/setup/with-admin-token.sh sets both for a development store).
//
//   bash scripts/setup/with-admin-token.sh node scripts/shopify/create-collections.mjs            dry run
//   bash scripts/setup/with-admin-token.sh node scripts/shopify/create-collections.mjs --live
//
// A new collection is visible to the storefront only when it is published to the sales channel that serves it, so
// --live publishes each new collection to every channel the existing `mattresses` collection is published to.
// Documentation (Admin GraphQL, read 2026-11-03): collectionCreate(input: CollectionInput) with ruleSet
// { appliesDisjunctively, rules [{ column: TYPE, relation: EQUALS, condition }] }; collectionByIdentifier(identifier:
// { handle }); publishablePublish(id, input: [{ publicationId }]).

import { EXIT_FAILED, EXIT_OK, EXIT_REFUSED, EXIT_USAGE, isMainModule, parseFlags, renderTable } from '../lib/cli.mjs';
import { ENV_API_VERSION, ENV_STORE_DOMAIN, checkLiveAllowed, checkStoreAllowed, readAdminToken } from '../lib/env.mjs';
import { createLogger } from '../lib/redact.mjs';
import { ADMIN_API_VERSION, createAdminClient, isRecord, readPayload } from '../lib/shopify-admin.mjs';

/** The handle every fixed-menu link already uses (lib/navigation.ts), so the header shows these without code changes. */
export const NAV_COLLECTIONS = Object.freeze([
  { handle: 'foundations-and-bases', title: 'Box Springs & Adjustable Beds', productTypes: ['Foundation', 'Adjustable Base'] },
  { handle: 'furniture', title: 'Beds & Furniture', productTypes: ['Bed Frame & Furniture'] },
  { handle: 'bedding', title: 'Bedding', productTypes: ['Bedding', 'Sheets', 'Pillow', 'Mattress Protector', 'Mattress Topper'] },
]);

/** The channel reference collection: it already shows on the storefront, so its channels are the right ones. */
const REFERENCE_HANDLE = 'mattresses';

const EXISTS_QUERY = `#graphql
  query CollectionExists($handle: String!) {
    collectionByIdentifier(identifier: { handle: $handle }) { id handle productsCount { count } }
  }`;

const COUNT_QUERY = `#graphql
  query TypeCount($query: String!) { productsCount(query: $query) { count } }`;

const CHANNELS_QUERY = `#graphql
  query Channels($handle: String!) {
    collectionByIdentifier(identifier: { handle: $handle }) {
      resourcePublications(first: 20) { nodes { isPublished publication { id name } } }
    }
  }`;

const CREATE_MUTATION = `#graphql
  mutation CollectionCreate($input: CollectionInput!) {
    collectionCreate(input: $input) { collection { id handle } userErrors { field message } }
  }`;

const PUBLISH_MUTATION = `#graphql
  mutation Publish($id: ID!, $input: [PublicationInput!]!) {
    publishablePublish(id: $id, input: $input) { userErrors { field message } }
  }`;

/** @param {string} type Shopify search syntax: quote the value so "Bed Frame & Furniture" is one term. */
function typeQuery(type) {
  return `product_type:"${type.replace(/"/g, '')}"`;
}

/** @param {import('../lib/shopify-admin.mjs').AdminClient} client @param {string} query @param {Record<string, unknown>} variables @param {string} operationName */
async function read(client, query, variables, operationName) {
  const result = await client.request(query, variables, { operationName });
  if (!result.ok) throw new Error(`${operationName}: ${result.error.message}`);
  return result.data;
}

/** @param {unknown} value */
function countOf(value) {
  return isRecord(value) && typeof value.count === 'number' ? value.count : 0;
}

const USAGE = `Usage: node scripts/shopify/create-collections.mjs [--store x.myshopify.com] [--live]
Creates the navigation collections that do not exist yet (automated, by product type). Default is a dry run.
Exit code: 0 done or nothing to do; 1 a dry run with collections still to create, or a failure; 2 usage; 3 refused by the guard.`;

/**
 * @param {readonly string[]} argv
 * @param {Record<string, string | undefined>} env
 * @param {{ out?: (text: string) => void, err?: (text: string) => void, fetch?: typeof fetch }} [io]
 * @returns {Promise<number>}
 */
export async function main(argv, env, { out = (text) => console.log(text), err = (text) => console.error(text), fetch: doFetch = globalThis.fetch } = {}) {
  const flags = parseFlags(argv, { store: { type: 'string' }, live: { type: 'boolean' }, help: { type: 'boolean' } });
  if (!flags.ok || flags.values.help) {
    err(flags.ok ? USAGE : `${flags.message}\n${USAGE}`);
    return EXIT_USAGE;
  }
  const live = flags.values.live === true;
  const store = typeof flags.values.store === 'string' ? flags.values.store : env[ENV_STORE_DOMAIN];
  const guard = live ? checkLiveAllowed({ live, store, env }) : checkStoreAllowed({ store, env });
  if (!guard.ok) {
    err(`Refused: ${guard.message}`);
    return EXIT_REFUSED;
  }
  const token = readAdminToken(env);
  if (!token.ok) {
    err(`Refused: ${token.message}`);
    return EXIT_REFUSED;
  }
  const logger = createLogger({ write: err, secrets: [token.token] });
  const client = createAdminClient({ store: guard.store, token: token.token, apiVersion: env[ENV_API_VERSION] ?? ADMIN_API_VERSION, allowMutations: live, logger, fetch: doFetch });

  try {
    const rows = [];
    const toCreate = [];
    for (const spec of NAV_COLLECTIONS) {
      const found = await read(client, EXISTS_QUERY, { handle: spec.handle }, 'CollectionExists');
      const existing = isRecord(found.collectionByIdentifier) ? found.collectionByIdentifier : null;
      let matching = 0;
      for (const type of spec.productTypes) {
        const counted = await read(client, COUNT_QUERY, { query: typeQuery(type) }, 'TypeCount');
        matching += countOf(counted.productsCount);
      }
      rows.push([spec.handle, spec.title, existing ? `EXISTS (${countOf(existing.productsCount)} products)` : 'CREATE', matching, spec.productTypes.join(', ')]);
      if (!existing) toCreate.push(spec);
    }
    out(`${live ? 'LIVE RUN' : 'DRY RUN'} on ${guard.store}`);
    out(renderTable(['handle', 'title', 'action', 'products by type', 'product types'], rows));
    if (toCreate.length === 0) {
      out('Nothing to create.');
      return EXIT_OK;
    }
    if (!live) {
      out(`PENDING CHANGES: ${toCreate.length} collection(s) to create. This was a dry run and wrote nothing; run again with --live to apply.`);
      return EXIT_FAILED;
    }

    const channelData = await read(client, CHANNELS_QUERY, { handle: REFERENCE_HANDLE }, 'Channels');
    const reference = isRecord(channelData.collectionByIdentifier) ? channelData.collectionByIdentifier : null;
    const nodes = reference && isRecord(reference.resourcePublications) && Array.isArray(reference.resourcePublications.nodes) ? reference.resourcePublications.nodes : [];
    const publicationIds = nodes
      .filter((node) => isRecord(node) && node.isPublished === true && isRecord(node.publication) && typeof node.publication.id === 'string')
      .map((node) => String(node.publication.id));
    if (publicationIds.length === 0) err(`Warning: "${REFERENCE_HANDLE}" is published to no channel I can read, so new collections will not be published; do that in Shopify admin.`);

    let failures = 0;
    for (const spec of toCreate) {
      const input = {
        title: spec.title,
        handle: spec.handle,
        ruleSet: { appliesDisjunctively: true, rules: spec.productTypes.map((type) => ({ column: 'TYPE', relation: 'EQUALS', condition: type })) },
      };
      const created = await client.request(CREATE_MUTATION, { input }, { operationName: 'CollectionCreate' });
      const payload = created.ok ? readPayload(created.data, 'collectionCreate') : created;
      const collection = payload.ok && 'payload' in payload && isRecord(payload.payload.collection) ? payload.payload.collection : null;
      if (!collection || typeof collection.id !== 'string') {
        failures += 1;
        err(`FAILED ${spec.handle}: ${'error' in payload ? payload.error.message : 'no collection returned'}`);
        continue;
      }
      out(`Created ${spec.handle}.`);
      if (publicationIds.length > 0) {
        const published = await client.request(PUBLISH_MUTATION, { id: collection.id, input: publicationIds.map((publicationId) => ({ publicationId })) }, { operationName: 'Publish' });
        const publishPayload = published.ok ? readPayload(published.data, 'publishablePublish') : published;
        if (!publishPayload.ok) {
          failures += 1;
          err(`FAILED publishing ${spec.handle}: ${publishPayload.error.message}`);
        } else out(`Published ${spec.handle} to ${publicationIds.length} channel(s).`);
      }
    }
    return failures > 0 ? EXIT_FAILED : EXIT_OK;
  } catch (error) {
    err(error instanceof Error ? error.message : String(error));
    return EXIT_FAILED;
  }
}

if (isMainModule(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2), process.env);
}
