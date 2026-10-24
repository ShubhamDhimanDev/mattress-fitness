// The one running consent layer of the page (P7-01; code re-review M-1).
//
// The root renders its own <AnalyticsGate> in the App and another in the ErrorBoundary, and a 404 or a route error
// swaps one for the other, so the consent chunk's React component can unmount and mount again during one visit. The
// consent store, the runtime and the provider adapters must not follow it: a second runtime would load a second
// gtag.js or fbevents.js, send every hit twice, lose the events the first one held, and not hear a withdrawal made in
// another tab during the gap. So they live here, once per page, and a remounted component ADOPTS them.
//
// They are never stopped by an unmount. `releaseAnalytics` exists for a changed configuration and for tests; it
// removes the sink only if it is still this runtime's (a teardown that arrives late must not remove a newer sink).

import {clearTrackSink, setTrackSink} from '~/lib/analytics';
import {
  attachConsentRefresh,
  createBrowserAdapters,
  createBrowserConsentStore,
  evaluateCurrentPage,
} from '~/lib/analytics/browser';
import type {PublicAnalyticsConfig} from '~/lib/analytics/config';
import type {ConsentStore} from '~/lib/analytics/consent-store';
import {
  createAnalyticsRuntime,
  type AnalyticsRuntime,
} from '~/lib/analytics/runtime';
import {logWarn} from '~/lib/logging/logger';

export type LiveAnalytics = {
  readonly key: string;
  readonly store: ConsentStore;
  readonly runtime: AnalyticsRuntime;
};

type Held = LiveAnalytics & {readonly detach: () => void};

let live: Held | null = null;

function keyOf(config: PublicAnalyticsConfig): string {
  return `${config.consentMode}|${config.ga4MeasurementId}|${config.metaPixelId}`;
}

export function acquireAnalytics(args: {
  readonly config: PublicAnalyticsConfig;
  readonly nonce: string | undefined;
  readonly schedule: (callback: () => void) => () => void;
}): LiveAnalytics {
  const key = keyOf(args.config);
  if (live && live.key === key) {
    // A remount adopts the running layer. The decision is read again, in case it changed while no component was
    // listening, so a withdrawal made meanwhile reaches the resident tag at once.
    live.store.refresh();
    return live;
  }
  releaseAnalytics();

  const store = createBrowserConsentStore(args.config.consentMode, window);
  const adapters = createBrowserAdapters(args.config, window, args.nonce);
  const runtime = createAnalyticsRuntime({
    adapters,
    consent: store,
    schedule: args.schedule,
    // No event, and no script load, from a private or personal-looking page (review M-1, L-4).
    page: () => evaluateCurrentPage(window),
    // Fixed words only: which provider and why, never anything about the shopper.
    onFailure: (provider, reason) =>
      logWarn('analytics.provider_failed', {provider, reason}),
  });
  // Started BEFORE the sink is registered: registering it replays, synchronously, the events `track()` held while
  // the chunk loaded, and those only reach a provider that is already active.
  runtime.start();
  setTrackSink(runtime.track);
  // For the life of the page, not of a component: a withdrawal in another tab applies even while none is mounted.
  const detach = attachConsentRefresh(store, window);
  live = {key, store, runtime, detach};
  return live;
}

export function currentAnalytics(): LiveAnalytics | null {
  return live;
}

/** Stops the running layer (a changed configuration, or a test starting over). Removes only its own sink. */
export function releaseAnalytics(): void {
  const current = live;
  if (!current) return;
  live = null;
  current.detach();
  current.runtime.stop();
  clearTrackSink(current.runtime.track);
}
