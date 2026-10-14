// Loads the store list once per request and builds the state > city > store
// index the route loaders look pages up in (REQ-LOC-001). Server side only.

import {getStores, type DataSource} from '~/lib/pages/data-source';
import {buildStoreIndex, type StoreIndex} from '~/lib/stores/grouping';

export type StoreIndexResult = {
  readonly source: DataSource;
  readonly index: StoreIndex;
};

export async function loadStoreIndex(): Promise<StoreIndexResult> {
  const {source, stores, warnings} = await getStores();
  if (warnings.length > 0) {
    // Counts only: the warnings themselves can quote admin-entered text.
    console.warn(`[stores] ${warnings.length} store record warning(s)`);
  }
  return {source, index: buildStoreIndex(stores)};
}

/** A 404 response with the shell intact (the root error boundary renders it). */
export function notFound(): Response {
  return new Response('Not found', {status: 404});
}
