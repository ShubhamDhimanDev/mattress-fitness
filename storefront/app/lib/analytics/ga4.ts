// Google Analytics 4 (REQ-ANL-001): the pure event mapping and a thin adapter around gtag.js.
//
// Event and parameter names follow Google's GA4 ecommerce reference
// (developers.google.com/analytics/devguides/collection/ga4/ecommerce, read 2026-10-23): `currency`, `value` and an
// `items` array of `item_id`, `item_name`, `item_brand`, `item_variant`, `price`, `quantity`, `index`, plus
// `item_list_id` and `item_list_name` on list events. Nothing here has been seen in GA4 DebugView (UNVERIFIED).
//
// Settings sent with the config call: no automatic page_view (we send one per navigation), no Google signals and
// no ad personalisation (we run no ads). Consent is enforced before this file is reached: the script is not even
// loaded until analytics consent exists (NFR-011).

import type {AnalyticsEvent, AnalyticsItem} from '~/lib/analytics';
import type {
  CookieClearer,
  Globals,
  ProviderAdapter,
  ProviderLoadResult,
  ScriptLoader,
} from '~/lib/analytics/adapter';
import {FORWARDED_EVENT_NAMES} from '~/lib/analytics/event-names';
import {ANALYTICS_CURRENCY} from '~/lib/analytics/item-basics';
import type {PageContext} from '~/lib/analytics/page-context';
import {dollarsFromCents} from '~/lib/analytics/money';
import {sanitizeParams} from '~/lib/analytics/privacy';

const MAX_GA4_ITEMS = 200;

export type Ga4Call = {
  readonly name: string;
  readonly params: Readonly<Record<string, unknown>>;
};

/** An item whose price cannot be written as dollars is left out: a made-up price would be worse than none. */
function toGa4Item(item: AnalyticsItem): Record<string, unknown>[] {
  const price = dollarsFromCents(item.priceCents);
  if (price === undefined) return [];
  return [
    {
      item_id: item.id,
      item_name: item.name,
      ...(item.brand ? {item_brand: item.brand} : {}),
      ...(item.variant ? {item_variant: item.variant} : {}),
      ...(item.category ? {item_category: item.category} : {}),
      price,
      quantity: item.quantity,
      ...(item.index === undefined ? {} : {index: item.index}),
    },
  ];
}

/** The `gtag('event', name, params)` call for an event, or null when the event is not one we forward. */
export function toGa4Call(event: AnalyticsEvent): Ga4Call | null {
  if (!FORWARDED_EVENT_NAMES.has(event.name)) return null;
  const params: Record<string, unknown> = sanitizeParams(event.params);
  const ecommerce = event.ecommerce;
  if (ecommerce) {
    params.currency = ANALYTICS_CURRENCY;
    if (ecommerce.valueCents !== undefined) {
      const value = dollarsFromCents(ecommerce.valueCents);
      if (value !== undefined) params.value = value;
    }
    params.items = ecommerce.items.slice(0, MAX_GA4_ITEMS).flatMap(toGa4Item);
    if (ecommerce.listId) params.item_list_id = ecommerce.listId;
    if (ecommerce.listName) params.item_list_name = ecommerce.listName;
  }
  // These two are followed at once by a page navigation; a beacon survives the unload, a normal request may not.
  if (event.name === 'begin_checkout' || event.name === 'select_item') {
    params.transport_type = 'beacon';
  }
  return {name: event.name, params};
}

export function ga4ScriptUrl(measurementId: string): string {
  return `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
}

type Gtag = (...args: unknown[]) => void;

// Which measurement ids have had their `js` and `config` calls on a given data layer: a second adapter on the same
// page (a remounted layer, a module loaded twice) adopts the running tag instead of configuring it again.
const configured = new WeakMap<object, Set<string>>();

function ensureGtag(globals: Globals): {call: Gtag; dataLayer: unknown[]} {
  const existing = globals.get('dataLayer');
  const dataLayer: unknown[] = Array.isArray(existing) ? existing : [];
  globals.set('dataLayer', dataLayer);
  const resident = globals.get('gtag');
  if (typeof resident === 'function' && Array.isArray(existing)) {
    return {
      dataLayer,
      call: (...args) => {
        Reflect.apply(resident, undefined, args);
      },
    };
  }
  // gtag.js reads `Arguments` objects off the data layer and ignores plain arrays, so this keeps Google's
  // documented snippet shape on purpose.
  const gtag: Gtag = function gtag() {
    // eslint-disable-next-line prefer-rest-params
    dataLayer.push(arguments);
  };
  globals.set('gtag', gtag);
  return {call: gtag, dataLayer};
}

export type Ga4AdapterOptions = {
  readonly measurementId: string;
  readonly globals: Globals;
  readonly loadScript: ScriptLoader;
  readonly clearCookies?: CookieClearer;
};

export function createGa4Adapter(options: Ga4AdapterOptions): ProviderAdapter {
  const {measurementId, globals, loadScript, clearCookies} = options;
  const disableFlag = `ga-disable-${measurementId}`;
  // `gtag` exists from the start of `load` (calls queue on the data layer); `ready` flips when the script is in.
  let gtag: Gtag | null = null;
  let ready = false;
  let granted = true;
  let paused = false;
  let page: PageContext | null = null;

  function applyPage(call: Gtag): void {
    if (!page) return;
    // Sanitised address, referrer and title; every later event, the automatic ones included, should inherit them.
    // Whether GA4 applies them to its automatic events is UNVERIFIED (DebugView).
    call('set', {
      page_location: page.pageLocation,
      page_referrer: page.pageReferrer,
      page_title: page.pageTitle,
    });
  }

  function clearStored(): void {
    try {
      clearCookies?.(['_ga', `_ga_${measurementId.replace(/^G-/, '')}`]);
    } catch {
      // Best effort; see cookies.ts.
    }
  }

  return {
    id: 'ga4',
    category: 'analytics',
    async load(): Promise<ProviderLoadResult> {
      try {
        // Google's documented opt-out flag, cleared before the tag starts (unless this page sends nothing).
        globals.set(disableFlag, paused);
        const {call, dataLayer} = ensureGtag(globals);
        gtag = call;
        const done = configured.get(dataLayer) ?? new Set<string>();
        configured.set(dataLayer, done);
        const first = !done.has(measurementId);
        done.add(measurementId);
        if (first) call('js', new Date());
        applyPage(call);
        if (first) {
          call('config', measurementId, {
            send_page_view: false,
            allow_google_signals: false,
            allow_ad_personalization_signals: false,
          });
        }
        const result = await loadScript(ga4ScriptUrl(measurementId));
        if (result.status === 'failed') {
          return {status: 'failed', reason: result.reason};
        }
        ready = true;
        return {status: 'ready'};
      } catch {
        return {status: 'failed', reason: 'unavailable'};
      }
    },
    send(event) {
      if (!granted || paused || !ready) return;
      try {
        const call = toGa4Call(event);
        if (call && gtag) gtag('event', call.name, call.params);
      } catch {
        // A provider error must never reach the page (NFR-013).
      }
    },
    setPage(context) {
      page = context;
      try {
        if (gtag) applyPage(gtag);
      } catch {
        // See above.
      }
    },
    pause() {
      paused = true;
      globals.set(disableFlag, true);
    },
    resume() {
      paused = false;
      if (granted) globals.set(disableFlag, false);
    },
    grant() {
      granted = true;
      globals.set(disableFlag, paused);
    },
    revoke() {
      granted = false;
      globals.set(disableFlag, true);
      clearStored();
    },
    clearStored,
  };
}
