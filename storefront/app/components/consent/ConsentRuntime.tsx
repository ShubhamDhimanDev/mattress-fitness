import {useEffect, useMemo} from 'react';
import {AnalyticsBridge} from '~/components/consent/AnalyticsBridge';
import type {ConsentRuntimeProps} from '~/components/consent/consent-context';
import {acquireAnalytics} from '~/lib/analytics/live';

/**
 * The analytics layer's React side (P7-01): the bridge from the page's events to `track()`. There is no banner or
 * preferences dialog any more (owner decision 2026-11-14): every configured provider always runs. The (constant) consent store, the runtime that loads the
 * providers when the browser is idle, and the provider adapters are NOT owned by this component: they are the page's single running layer
 * (`~/lib/analytics/live`), created by the first mount and adopted by every later one. The root renders one
 * `AnalyticsGate` in the App and another in the ErrorBoundary, and a 404 swaps them, so this component can unmount and
 * mount again; a second runtime would load the provider scripts twice and send every hit twice (code re-review M-1).
 *
 * This module is a lazy chunk. `AnalyticsGate` (in the initial JavaScript) mounts it only after hydration and only
 * when a provider id is set, so a store with neither id never downloads any of it (bundle budget, scripts/perf).
 * It publishes its store to the gate, which hands it to the footer button and Hydrogen's `canTrack`.
 */
export function ConsentRuntime({
  config,
  nonce,
  publishStore,
  notify,
  schedule,
  takeEarlyViews,
  resetEarlyViews,
}: ConsentRuntimeProps) {
  // During render, on purpose: the running layer has to exist (and have registered its sink, replaying the events
  // `track()` held) before the bridge's effects send the page view. Idempotent, so StrictMode's second render and a
  // later remount simply get the same layer back.
  const live = useMemo(
    () => acquireAnalytics({config, nonce, schedule}),
    [config, nonce, schedule],
  );
  const {store, runtime} = live;

  // Hand the store to the page shell (footer button, Hydrogen's `canTrack`).
  useEffect(() => {
    publishStore(store);
    // Hydrogen's provider asks canTrack again after every change of choice.
    const unsubscribe = store.subscribe(notify);
    return () => {
      unsubscribe();
      publishStore(null);
    };
  }, [store, publishStore, notify]);

  return (
    <>
      <AnalyticsBridge
        takeEarlyViews={takeEarlyViews}
        resetEarlyViews={resetEarlyViews}
        setNavigationTarget={runtime.setNavigationTarget}
      />
    </>
  );
}
