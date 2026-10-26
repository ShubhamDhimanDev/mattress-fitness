// Loads the store list once per request and builds the state > city > store
// index the route loaders look pages up in (REQ-LOC-001). Server side only.

import type {Storefront} from '~/lib/hydrogen/storefront';
import {getStores, type DataSource} from '~/lib/pages/data-source';
import {buildStoreIndex, type StoreIndex} from '~/lib/stores/grouping';
import {logWarn} from '~/lib/logging/logger';

export type StoreIndexResult = {
  readonly source: DataSource;
  readonly index: StoreIndex;
};

/** Pass the request's Storefront client to read the `store` metaobjects; without it the labelled fixtures are used. */
export async function loadStoreIndex(
  storefront?: Storefront,
): Promise<StoreIndexResult> {
  const {source, stores, warnings} = await getStores(storefront);
  if (warnings.length > 0) {
    // Counts only: the warnings themselves can quote admin-entered text.
    logWarn('stores.record_warnings', {count: warnings.length});
  }
  return {source, index: buildStoreIndex(stores)};
}

/** A 404 response with the shell intact (the root error boundary renders it). */
export function notFound(): Response {
  return new Response('Not found', {status: 404});
}
