import {useEffect, useMemo} from 'react';
import {AnalyticsBridge} from '~/components/consent/AnalyticsBridge';
import {ConsentBanner} from '~/components/consent/ConsentBanner';
import {ConsentPreferences} from '~/components/consent/ConsentPreferences';
import {setTrackSink} from '~/lib/analytics';
import {
  attachConsentRefresh,
  createBrowserAdapters,
  createBrowserConsentStore,
  evaluateCurrentPage,
} from '~/lib/analytics/browser';
import type {ConsentRuntimeProps} from '~/components/consent/consent-context';
import {moveFocusAfterDecision} from '~/components/consent/focus-after-decision';
import {createAnalyticsRuntime} from '~/lib/analytics/runtime';
import {logWarn} from '~/lib/logging/logger';

/**
 * The consent layer proper (P7-01): the consent store, the runtime that loads GA4 and the Meta pixel only after
 * agreement and on idle, the bridge from the page's events to `track()`, the banner and the preferences dialog.
 *
 * This module is a lazy chunk. `AnalyticsGate` (in the initial JavaScript) mounts it only after hydration and only
 * when a provider id is set, so a store with neither id never downloads any of it (bundle budget, scripts/perf).
 * It publishes its store to the gate, which hands it to the footer button, the banner and the Hydrogen provider.
 * It renders inside `<Analytics.Provider>` and the consent context, both supplied by the gate.
 */
export function ConsentRuntime({
  config,
  nonce,
  publishStore,
  notify,
  schedule,
  takeEarlyViews,
}: ConsentRuntimeProps) {
  const {consentMode, ga4MeasurementId, metaPixelId} = config;
  const store = useMemo(
    () => createBrowserConsentStore(consentMode, window),
    [consentMode],
  );

  // The runtime must be started BEFORE the sink is registered: registering the sink replays, synchronously, the events
  // `track()` held while this chunk was loading, and those only reach a provider that is already active (a started
  // runtime has marked the consented providers active and queued their load). The other way round every replayed
  // event met an inactive provider and was dropped.
  useEffect(() => {
    const adapters = createBrowserAdapters(
      {consentMode, ga4MeasurementId, metaPixelId},
      window,
      nonce,
    );
    const runtime = createAnalyticsRuntime({
      adapters,
      consent: store,
      schedule,
      // No event, and no script load, from a private or personal-looking page (review M-1, L-4).
      page: () => evaluateCurrentPage(window),
      // Fixed words only: which provider and why, never anything about the shopper.
      onFailure: (provider, reason) =>
        logWarn('analytics.provider_failed', {provider, reason}),
    });
    runtime.start();
    setTrackSink(runtime.track);
    return () => {
      runtime.stop();
      setTrackSink(null);
    };
  }, [store, consentMode, ga4MeasurementId, metaPixelId, nonce, schedule]);

  // Hand the store to the page shell (footer button, banner context, Hydrogen's `canTrack`).
  useEffect(() => {
    publishStore(store);
    // Hydrogen's provider asks canTrack again after every change of choice.
    const unsubscribe = store.subscribe(notify);
    return () => {
      unsubscribe();
      publishStore(null);
    };
  }, [store, publishStore, notify]);

  // The shopper's choice in another tab (storage event, and a re-read when this tab is shown or focused).
  useEffect(() => attachConsentRefresh(store, window), [store]);

  // After the shopper answers the banner (or its dialog), the element that had focus is gone: put focus on the page.
  useEffect(() => moveFocusAfterDecision(store, window), [store]);

  return (
    <>
      <AnalyticsBridge takeEarlyViews={takeEarlyViews} />
      <ConsentBanner config={config} store={store} />
      <ConsentPreferences config={config} store={store} />
    </>
  );
}
