// Where a failed chat call-out sends the shopper (P7-03). Lives with the chat code, not in `~/lib/navigation`, so the
// initial JavaScript of a store with no chat provider carries none of it (bundle budget, scripts/perf).

import type {UtilityLink} from '~/lib/navigation';

/** The contact page's path when the links hold it (so the page exists, P6-09), else null. */
export function contactFallback(links: readonly UtilityLink[]): string | null {
  return links.find((link) => link.id === 'contact')?.to ?? null;
}
