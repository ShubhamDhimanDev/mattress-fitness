// Google Tag Manager (CR-33): a thin adapter that loads one container and feeds it the same events GA4 receives.
//
// The client's pasted snippet loaded gtm.js and ran `gtag('js', ...)` but never pushed the `gtm.start` event, which is
// what starts a container; as pasted it would load and do nothing. This adapter uses Google's documented bootstrap
// (the `gtm.start` push, then the script) instead.
//
// Events are pushed to the data layer in GA4's names and shapes (`toGa4Call`), ecommerce data under the `ecommerce` key
// as Google's data-layer convention expects, so a GA4 tag inside the container can use them as they are.
//
// WHAT CONSENT COVERS. The container loads only after ANALYTICS consent, and Google Consent Mode is set to denied for
// ad storage, ad user data and ad personalisation before it starts. A tag inside the container that needs marketing
// consent (an ad pixel) must be gated on those consent types in Tag Manager, or kept out of the container: this
// adapter cannot see inside it. Set PUBLIC_GA4_MEASUREMENT_ID as well only if the container does NOT contain a GA4
// tag, or every event is counted twice.
//
// WHAT IT CANNOT STOP. On a private page the adapter sends no event, but a container trigger of its own (history
// change, DOM ready) still runs. Keep such triggers out of the container; the owner reviews it before launch.

import type {AnalyticsEvent} from '~/lib/analytics';
import type {
  CookieClearer,
  Globals,
  ProviderAdapter,
  ProviderLoadResult,
  ScriptLoader,
} from '~/lib/analytics/adapter';
import {toGa4Call} from '~/lib/analytics/ga4';

export function gtmScriptUrl(containerId: string): string {
  return `https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(containerId)}`;
}

const ECOMMERCE_KEYS: readonly string[] = [
  'currency',
  'value',
  'items',
  'item_list_id',
  'item_list_name',
];

/** The objects to push for an event: a clearing push for ecommerce (Google's advice), then the event itself. */
export function toGtmPushes(
  event: AnalyticsEvent,
): Array<Record<string, unknown>> {
  const call = toGa4Call(event);
  if (!call) return [];
  const flat: Record<string, unknown> = {};
  const ecommerce: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(call.params)) {
    if (ECOMMERCE_KEYS.includes(key)) {
      ecommerce[key] = value;
    } else {
      flat[key] = value;
    }
  }
  const hasEcommerce = Object.keys(ecommerce).length > 0;
  const push = {
    event: call.name,
    ...flat,
    ...(hasEcommerce ? {ecommerce} : {}),
  };
  return hasEcommerce ? [{ecommerce: null}, push] : [push];
}

// Containers already started on a given data layer: a second adapter on the same page adopts the running container.
const started = new WeakMap<object, Set<string>>();

export type GtmAdapterOptions = {
  readonly containerId: string;
  readonly globals: Globals;
  readonly loadScript: ScriptLoader;
  readonly clearCookies?: CookieClearer;
};

export function createGtmAdapter(options: GtmAdapterOptions): ProviderAdapter {
  const {containerId, globals, loadScript, clearCookies} = options;
  let dataLayer: unknown[] | null = null;
  let ready = false;
  let granted = true;
  let paused = false;

  // Consent Mode commands must be `Arguments` objects on the data layer, like gtag's.
  function consent(
    command: 'default' | 'update',
    state: Record<string, string>,
  ): void {
    const layer = dataLayer;
    if (!layer) return;
    (function gtag(..._args: unknown[]) {
      // eslint-disable-next-line prefer-rest-params
      layer.push(arguments);
    })('consent', command, state);
  }

  function clearStored(): void {
    try {
      clearCookies?.(['_ga', '_gid', '_gat']);
    } catch {
      // Best effort; see cookies.ts. Cookies named for a GA4 property inside the container cannot be listed here.
    }
  }

  return {
    id: 'gtm',
    category: 'analytics',
    async load(): Promise<ProviderLoadResult> {
      try {
        const existing = globals.get('dataLayer');
        const layer: unknown[] = Array.isArray(existing) ? existing : [];
        globals.set('dataLayer', layer);
        dataLayer = layer;
        const done = started.get(layer) ?? new Set<string>();
        started.set(layer, done);
        if (!done.has(containerId)) {
          done.add(containerId);
          consent('default', {
            ad_storage: 'denied',
            ad_user_data: 'denied',
            ad_personalization: 'denied',
            analytics_storage: 'granted',
          });
          layer.push({'gtm.start': Date.now(), event: 'gtm.js'});
        }
        const result = await loadScript(gtmScriptUrl(containerId));
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
      if (!granted || paused || !ready || !dataLayer) return;
      try {
        for (const push of toGtmPushes(event)) dataLayer.push(push);
      } catch {
        // A provider error must never reach the page (NFR-013).
      }
    },
    pause() {
      paused = true;
    },
    resume() {
      paused = false;
    },
    grant() {
      granted = true;
      consent('update', {analytics_storage: 'granted'});
    },
    revoke() {
      granted = false;
      consent('update', {analytics_storage: 'denied'});
      clearStored();
    },
    clearStored,
  };
}
