// Head tags shared by the pages that still run on preview data.

import type {DataSource} from '~/lib/pages/data-source';

/**
 * Pages built from fixtures (fictional stores and mattresses, DEC-023) must never be indexed: a crawler would
 * publish invented addresses and prices. Once the live loaders replace the fixtures `source` becomes
 * 'shopify' and the tag disappears without any page change.
 */
export function previewRobotsMeta(
  source: DataSource | undefined,
): Array<{name: string; content: string}> {
  return source === 'fixtures'
    ? [{name: 'robots', content: 'noindex,nofollow'}]
    : [];
}
