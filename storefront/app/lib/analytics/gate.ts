// The one piece of consent state the initial JavaScript holds (P7-01; bundle budget, scripts/perf).
//
// Everything that decides, stores and acts on consent (the store, the runtime, the adapters, the banner and the
// event mappers) is a lazy chunk (`ConsentRuntime`), loaded after hydration and only when a provider id is set. The
// page shell cannot import any of it, but it has to react to it: the footer's "Privacy choices" button needs the
// store, and Hydrogen's provider needs the `canTrack` answer and a re-render when it changes. So the chunk publishes
// its consent store here when it starts and calls `notify` whenever the choice changes; the shell subscribes.
// Imports are type-only: this file adds almost nothing to the bundle.

import type {ConsentStore} from '~/lib/analytics/consent-store';

let published: ConsentStore | null = null;
let version = 0;
const listeners = new Set<() => void>();

function bump(): void {
  version += 1;
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      // A faulty subscriber must not stop the others or the page.
    }
  }
}

/** Shopify's own consent answer, the same check Hydrogen's default uses. Guarded: it must never throw. */
function shopifyAllowsAnalytics(): boolean {
  try {
    const shopify: unknown = Reflect.get(window, 'Shopify');
    if (typeof shopify !== 'object' || shopify === null) return false;
    const privacy: unknown = Reflect.get(shopify, 'customerPrivacy');
    if (typeof privacy !== 'object' || privacy === null) return false;
    if (Reflect.get(privacy, 'consentStatus') !== 'loaded') return false;
    const allowed: unknown = Reflect.get(privacy, 'analyticsProcessingAllowed');
    return typeof allowed === 'function'
      ? allowed.call(privacy) === true
      : false;
  } catch {
    return false;
  }
}

export const consentHandle = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  /** Changes whenever the store is published or the choice changes; what `useSyncExternalStore` watches. */
  getVersion: (): number => version,
  /** Server and first client render: nothing has happened yet. */
  getServerVersion: (): number => 0,
  getStore: (): ConsentStore | null => published,
  getNoStore: (): ConsentStore | null => null,
  /** The lazy chunk publishes its store when it starts, and null when it unmounts. */
  publish(next: ConsentStore | null): void {
    if (published === next) return;
    published = next;
    bump();
  },
  /** The lazy chunk calls this when the shopper's choice changed, so the shell re-renders. */
  notify: bump,
  /**
   * Hydrogen's `canTrack`: any consented provider counts (the runtime then routes each event to the providers whose
   * own category is allowed), and Shopify's own answer still counts, so its sales-channel analytics behave as before.
   * Hydrogen recomputes what it publishes whenever the provider re-renders, which `notify` causes.
   */
  canTrack(): boolean {
    const choice = published?.getSnapshot().choice;
    return (
      (choice !== undefined && (choice.analytics || choice.marketing)) ||
      shopifyAllowsAnalytics()
    );
  },
};

const IDLE_TIMEOUT_MS = 3000;
const IDLE_FALLBACK_MS = 1500;

/**
 * Runs the callback when the browser is idle (`requestIdleCallback`; a timer in Safari) and returns the canceller.
 * Written here, next to the gate, rather than imported from `~/lib/when-idle`: that module is used by the header in
 * the initial JavaScript, and importing it from the consent chunk as well makes it a chunk of its own that every
 * route downloads separately (bundle budget, scripts/perf). Same behaviour.
 */
export function scheduleIdle(callback: () => void): () => void {
  if (typeof requestIdleCallback === 'function') {
    const id = requestIdleCallback(callback, {timeout: IDLE_TIMEOUT_MS});
    return () => cancelIdleCallback(id);
  }
  const id = setTimeout(callback, IDLE_FALLBACK_MS);
  return () => clearTimeout(id);
}
