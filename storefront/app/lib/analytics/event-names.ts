// The event names a provider adapter will forward. A name outside this list is dropped, so a typo or an injected
// value cannot invent a new event in the client's analytics account.

import type {AnalyticsEventName} from '~/lib/analytics';

const NAMES: readonly AnalyticsEventName[] = [
  'page_view',
  'view_item_list',
  'select_item',
  'view_item',
  'add_to_cart',
  'remove_from_cart',
  'view_cart',
  'begin_checkout',
  'search',
  'quiz_start',
  'quiz_complete',
  'quiz_result_click',
];

export const FORWARDED_EVENT_NAMES: ReadonlySet<string> = new Set(NAMES);
