// What the store importer needs from Shopify, behind one small interface so the plan logic runs against a fake in tests.
// Admin GraphQL, same endpoint, header and write mutation as scripts/setup/seed-entries.mjs:
//   metaobjects(type: "store")  query, scope read_metaobjects
//   metaobjectUpsert            mutation, scope write_metaobjects; creates the entry or updates the one with this
//                               type and handle (seed-entries.mjs relies on the same behaviour)
// UNVERIFIED(V-05): neither call has run against a real store yet. In particular it is not confirmed that upserting
// only some fields leaves the other fields as they were; the importer is written so that it does not depend on it
// for correctness of what it sends (it sends only the fields it intends to set) and the first run must confirm it.

import { readPayload } from '../lib/shopify-admin.mjs';
import { STORE_TYPE } from './schema.mjs';

const MAX_PAGES = 20;
const PAGE_SIZE = 100;

const LIST_QUERY = `query StoreEntries($type: String!, $first: Int!, $after: String) {
  metaobjects(type: $type, first: $first, after: $after) {
    nodes { id handle fields { key value } }
    pageInfo { hasNextPage endCursor }
  }
}`;

const UPSERT = `mutation StoreUpsert($handle: MetaobjectHandleInput!, $metaobject: MetaobjectUpsertInput!) {
  metaobjectUpsert(handle: $handle, metaobject: $metaobject) { metaobject { id handle } userErrors { field message code } }
}`;

/**
 * @typedef {{ id: string, fields: Record<string, string> }} RemoteStore
 * @typedef {{ ok: true, stores: Map<string, RemoteStore> } | { ok: false, message: string }} ListResult
 * @typedef {{ ok: true, id: string | null } | { ok: false, message: string }} UpsertResult
 * @typedef {{ listStores: () => Promise<ListResult>, upsertStore: (handle: string, fields: { key: string, value: string }[]) => Promise<UpsertResult> }} Remote
 */

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * No network: the store is treated as empty, every row plans as a create. Writing is refused.
 * @returns {Remote}
 */
export function createOfflineRemote() {
  return {
    listStores: async () => ({ ok: true, stores: new Map() }),
    upsertStore: async () => ({ ok: false, message: 'Offline: nothing can be written.' }),
  };
}

/**
 * @param {import('../lib/shopify-admin.mjs').AdminClient} client
 * @returns {Remote}
 */
export function createShopifyRemote(client) {
  return {
    async listStores() {
      /** @type {Map<string, RemoteStore>} */
      const stores = new Map();
      /** @type {string | null} */
      let after = null;
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const result = await client.request(LIST_QUERY, { type: STORE_TYPE, first: PAGE_SIZE, after }, { operationName: 'StoreEntries', estimatedCost: 20 });
        if (!result.ok) return { ok: false, message: result.error.message };
        const connection = result.data.metaobjects;
        if (!isRecord(connection) || !Array.isArray(connection.nodes)) return { ok: false, message: 'Shopify returned an unexpected shape for the store list.' };
        for (const node of connection.nodes) {
          if (!isRecord(node) || typeof node.id !== 'string' || typeof node.handle !== 'string') continue;
          /** @type {Record<string, string>} */
          const fields = {};
          if (Array.isArray(node.fields)) {
            for (const field of node.fields) {
              if (isRecord(field) && typeof field.key === 'string' && typeof field.value === 'string') fields[field.key] = field.value;
            }
          }
          stores.set(node.handle, { id: node.id, fields });
        }
        const info = connection.pageInfo;
        if (!isRecord(info) || info.hasNextPage !== true) return { ok: true, stores };
        if (typeof info.endCursor !== 'string') return { ok: false, message: 'Shopify reported more pages but no cursor.' };
        after = info.endCursor;
      }
      return { ok: false, message: `More than ${MAX_PAGES * PAGE_SIZE} store entries; refusing to plan from a partial list.` };
    },

    async upsertStore(handle, fields) {
      const result = await client.request(UPSERT, { handle: { type: STORE_TYPE, handle }, metaobject: { fields } }, { operationName: 'StoreUpsert', estimatedCost: 10 });
      if (!result.ok) return { ok: false, message: result.error.message };
      const payload = readPayload(result.data, 'metaobjectUpsert');
      if (!payload.ok) return { ok: false, message: payload.error.message };
      const entry = payload.payload.metaobject;
      return { ok: true, id: isRecord(entry) && typeof entry.id === 'string' ? entry.id : null };
    },
  };
}
