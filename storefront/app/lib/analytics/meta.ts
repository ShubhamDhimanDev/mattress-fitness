// Meta (Facebook) pixel (REQ-ANL-002): the pure event mapping and a thin adapter around fbevents.js.
//
// Standard events only: PageView, ViewContent, AddToCart, InitiateCheckout, Search. Parameter names (`value`,
// `currency`, `content_ids`, `content_type`, `content_name`, `contents` with `id` and `quantity`, `num_items`,
// `search_string`) are from Meta's "Conversion tracking" page (developers.facebook.com/docs/meta-pixel, read
// 2026-10-23). Meta's documentation is silent on Content Security Policy hosts, and nothing here has been seen in
// Meta's Test Events tool (UNVERIFIED).
//
// No personal data: no email, phone, name, ZIP or order number is ever passed, and advanced matching (hashed
// identifiers) is deliberately NOT implemented. `autoConfig` is turned off so the pixel does not scrape form
// fields or buttons on its own (Meta's "Automatic Advanced Matching" and button-click autotracking).
// Quiz events, select_item, view_item_list and remove_from_cart have no standard Meta event and are not forwarded.

import type {AnalyticsEvent, AnalyticsItem} from '~/lib/analytics';
import type {
  CookieClearer,
  Globals,
  ProviderAdapter,
  ProviderLoadResult,
  ScriptLoader,
} from '~/lib/analytics/adapter';
import {ANALYTICS_CURRENCY} from '~/lib/analytics/hydrogen-events';
import {dollarsFromCents} from '~/lib/analytics/money';
import {sanitizeSearchTerm} from '~/lib/analytics/privacy';

export const META_SCRIPT_URL = 'https://connect.facebook.net/en_US/fbevents.js';

export type MetaCall = {
  readonly name:
    'PageView' | 'ViewContent' | 'AddToCart' | 'InitiateCheckout' | 'Search';
  readonly params: Readonly<Record<string, unknown>>;
};

function contents(items: readonly AnalyticsItem[]): Record<string, unknown>[] {
  return items.map((item) => ({
    id: item.id,
    quantity: item.quantity,
    item_price: dollarsFromCents(item.priceCents) ?? 0,
  }));
}

function commerceParams(event: AnalyticsEvent): Record<string, unknown> | null {
  const data = event.ecommerce;
  if (!data || data.items.length === 0) return null;
  const params: Record<string, unknown> = {
    content_type: 'product',
    content_ids: data.items.map((item) => item.id),
    contents: contents(data.items),
    currency: ANALYTICS_CURRENCY,
  };
  if (data.valueCents !== undefined) {
    const value = dollarsFromCents(data.valueCents);
    if (value !== undefined) params.value = value;
  }
  return params;
}

/** The `fbq('track', name, params)` call for an event, or null when Meta has no standard event for it. */
export function toMetaCall(event: AnalyticsEvent): MetaCall | null {
  switch (event.name) {
    case 'page_view':
      return {name: 'PageView', params: {}};
    case 'view_item': {
      const params = commerceParams(event);
      const first = event.ecommerce?.items[0];
      if (!params || !first) return null;
      return {
        name: 'ViewContent',
        params: {...params, content_name: first.name},
      };
    }
    case 'add_to_cart': {
      const params = commerceParams(event);
      return params ? {name: 'AddToCart', params} : null;
    }
    case 'begin_checkout': {
      const params = commerceParams(event);
      const items = event.ecommerce?.items ?? [];
      if (!params) return null;
      return {
        name: 'InitiateCheckout',
        params: {
          ...params,
          num_items: items.reduce((sum, item) => sum + item.quantity, 0),
        },
      };
    }
    case 'search': {
      const term = sanitizeSearchTerm(event.params.search_term);
      return term === null
        ? null
        : {name: 'Search', params: {search_string: term}};
    }
    case 'view_item_list':
    case 'select_item':
    case 'remove_from_cart':
    case 'view_cart':
    case 'quiz_start':
    case 'quiz_complete':
    case 'quiz_result_click':
      return null;
    default: {
      const unreachable: never = event.name;
      return unreachable;
    }
  }
}

type Fbq = (...args: unknown[]) => void;

// Meta's documented bootstrap, written out: calls made before fbevents.js arrives are queued (as `arguments`
// objects, the shape the library reads) and replayed by it, which then supplies `callMethod`.
function ensureFbq(globals: Globals): Fbq {
  const existing = globals.get('fbq');
  if (typeof existing === 'function') {
    return (...args) => {
      Reflect.apply(existing, undefined, args);
    };
  }
  const queue: unknown[] = [];
  const fbq = function fbq() {
    const callMethod: unknown = Reflect.get(fbq, 'callMethod');
    if (typeof callMethod === 'function') {
      // eslint-disable-next-line prefer-rest-params
      Reflect.apply(callMethod, fbq, arguments);
    } else {
      // eslint-disable-next-line prefer-rest-params
      queue.push(arguments);
    }
  };
  Object.assign(fbq, {queue, loaded: true, version: '2.0', push: fbq});
  globals.set('fbq', fbq);
  globals.set('_fbq', fbq);
  return (...args) => {
    Reflect.apply(fbq, undefined, args);
  };
}

export type MetaAdapterOptions = {
  readonly pixelId: string;
  readonly globals: Globals;
  readonly loadScript: ScriptLoader;
  readonly clearCookies?: CookieClearer;
};

export function createMetaAdapter(
  options: MetaAdapterOptions,
): ProviderAdapter {
  const {pixelId, globals, loadScript, clearCookies} = options;
  let fbq: Fbq | null = null;
  let granted = true;

  return {
    id: 'meta',
    category: 'marketing',
    async load(): Promise<ProviderLoadResult> {
      try {
        const call = ensureFbq(globals);
        // Order matters: configuration first, then init. Consent is already given when this runs.
        call('set', 'autoConfig', false, pixelId);
        call('consent', 'grant');
        call('init', pixelId);
        const result = await loadScript(META_SCRIPT_URL);
        if (result.status === 'failed') {
          return {status: 'failed', reason: result.reason};
        }
        fbq = call;
        return {status: 'ready'};
      } catch {
        return {status: 'failed', reason: 'unavailable'};
      }
    },
    send(event) {
      if (!granted) return;
      try {
        const call = toMetaCall(event);
        if (call && fbq) fbq('track', call.name, call.params);
      } catch {
        // A provider error must never reach the page (NFR-013).
      }
    },
    grant() {
      granted = true;
      try {
        fbq?.('consent', 'grant');
      } catch {
        // See above.
      }
    },
    revoke() {
      granted = false;
      try {
        fbq?.('consent', 'revoke');
        clearCookies?.(['_fbp', '_fbc']);
      } catch {
        // Best effort; see cookies.ts.
      }
    },
  };
}
