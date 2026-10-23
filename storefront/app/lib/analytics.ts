// The single place every analytics event passes through (P2-08; REQ-QZ-006 for the quiz events, REQ-ANL-001 for
// page views and ecommerce events). The provider and the consent gate arrive in Phase 7: until then no sink is
// registered, so nothing leaves the browser. Registering the sink there is the only change needed for events to
// reach Google Analytics, and that sink is responsible for sending nothing without analytics consent (NFR-011).
//
// Privacy (threat T-05): parameters are counts, handles, sizes and a fixed vocabulary. Never names, emails, ZIP
// codes, customer ids or free text. Each builder (see `~/lib/quiz/events`) documents and caps its own parameters.

import type {QuizEventName} from '~/lib/quiz/events';

/**
 * GA4 recommended names reserved for the ecommerce events Phase 7 emits. They are listed now so call sites are
 * type-checked from the start; the parameters of each are documented where its builder is written (P7-01).
 */
export type EcommerceEventName =
  | 'view_item_list'
  | 'select_item'
  | 'view_item'
  | 'add_to_cart'
  | 'remove_from_cart'
  | 'view_cart'
  | 'begin_checkout'
  | 'search';

export type AnalyticsEventName =
  'page_view' | EcommerceEventName | QuizEventName;

export type AnalyticsParamValue = string | number;

/**
 * One product line of an ecommerce event. Money is an integer in cents (Shopify's amounts are converted once, in
 * `~/lib/analytics/hydrogen-events`); the provider adapters turn it into dollars through the shared money helper.
 * `id` is the numeric Shopify product id: it is the same in every event, so provider reports join up.
 */
export type AnalyticsItem = {
  readonly id: string;
  readonly name: string;
  readonly brand?: string;
  readonly variant?: string;
  readonly category?: string;
  readonly priceCents: number;
  readonly quantity: number;
  readonly index?: number;
};

/** Everything an ecommerce event adds to the flat `params`. Currency is always USD (NFR-008). */
export type EcommerceData = {
  readonly valueCents?: number;
  readonly items: readonly AnalyticsItem[];
  readonly listId?: string;
  readonly listName?: string;
};

export type AnalyticsEvent = {
  readonly name: AnalyticsEventName;
  readonly params: Readonly<Record<string, AnalyticsParamValue>>;
  readonly ecommerce?: EcommerceData;
};

export type TrackSink = (event: AnalyticsEvent) => void;

let sink: TrackSink | null = null;

// The consent layer is a lazy chunk (it keeps the initial JavaScript small, scripts/perf), so the first events of a
// page (page views, the listing, a Hydrogen view) can arrive before it has registered its sink. Those events are
// held in memory, bounded, and replayed in order the moment the sink exists; the runtime behind it still drops
// whatever consent does not allow, so holding sends nothing anywhere. With no provider configured no sink ever
// arrives and the few held events are simply never used. Unregistering the sink empties the hold.
const MAX_HELD_EVENTS = 25;
let held: AnalyticsEvent[] = [];

/** The consent layer registers its sender here; tests register a spy. Pass null to unregister. */
export function setTrackSink(next: TrackSink | null): void {
  sink = next;
  const replay = held;
  held = [];
  if (!next) return;
  for (const event of replay) {
    try {
      next(event);
    } catch {
      // Swallowed on purpose; see `track`.
    }
  }
}

/** Sends an event to the registered sink, if any. Never throws: analytics must not break the page (NFR-013). */
export function track(event: AnalyticsEvent): void {
  if (!sink) {
    if (held.length >= MAX_HELD_EVENTS) held.shift();
    held.push(event);
  }
  try {
    sink?.(event);
  } catch {
    // Swallowed on purpose; see above.
  }
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console -- development-only visibility until the provider exists
    console.debug('[track]', event.name, event.params);
  }
}
