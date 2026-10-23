import {Analytics, useNonce} from '@shopify/hydrogen';
import {
  useCallback,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ComponentProps,
  type ReactNode,
} from 'react';
import {AnalyticsBridge} from '~/components/consent/AnalyticsBridge';
import {
  ConsentContext,
  SERVER_CONSENT_SNAPSHOT,
} from '~/components/consent/consent-context';
import {ConsentBanner} from '~/components/consent/ConsentBanner';
import {ConsentPreferences} from '~/components/consent/ConsentPreferences';
import {setTrackSink} from '~/lib/analytics';
import {
  createBrowserAdapters,
  createBrowserConsentStore,
} from '~/lib/analytics/browser';
import {hasProviders, type PublicAnalyticsConfig} from '~/lib/analytics/config';
import type {
  ConsentSnapshot,
  ConsentStore,
} from '~/lib/analytics/consent-store';
import {createAnalyticsRuntime} from '~/lib/analytics/runtime';
import {logWarn} from '~/lib/logging/logger';
import {whenIdle} from '~/lib/when-idle';

type HydrogenProviderProps = ComponentProps<typeof Analytics.Provider>;

type ConsentAnalyticsProps = {
  readonly cart: HydrogenProviderProps['cart'];
  readonly shop: HydrogenProviderProps['shop'];
  readonly consent: HydrogenProviderProps['consent'];
  readonly config: PublicAnalyticsConfig;
  readonly children: ReactNode;
};

const NO_STORE_SUBSCRIBE = () => () => {};
const getServerSnapshot = (): ConsentSnapshot => SERVER_CONSENT_SNAPSHOT;

/** Creates the runtime for one consent store and registers it as the `track()` sink. Renders nothing. */
function AnalyticsRuntimeHost({
  store,
  config,
  nonce,
}: {
  store: ConsentStore | null;
  config: PublicAnalyticsConfig;
  nonce: string | undefined;
}) {
  const {consentMode, ga4MeasurementId, metaPixelId} = config;
  useEffect(() => {
    if (!store) return;
    const adapters = createBrowserAdapters(
      {consentMode, ga4MeasurementId, metaPixelId},
      window,
      nonce,
    );
    const runtime = createAnalyticsRuntime({
      adapters,
      consent: store,
      schedule: whenIdle,
      // Fixed words only: which provider and why, never anything about the shopper.
      onFailure: (provider, reason) =>
        logWarn('analytics.provider_failed', {provider, reason}),
    });
    setTrackSink(runtime.track);
    runtime.start();
    return () => {
      runtime.stop();
      setTrackSink(null);
    };
  }, [store, consentMode, ga4MeasurementId, metaPixelId, nonce]);
  return null;
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

/**
 * Replaces `<Analytics.Provider>` in the root (P7-01): the same provider, plus the consent state, the banner and
 * dialog, the consent-aware runtime that loads GA4 and the Meta pixel only after agreement and on idle, and the
 * bridge from the page's events to `track()`.
 *
 * With neither provider configured this adds nothing: no store, no runtime, no banner, no script and the Hydrogen
 * provider is called exactly as before.
 *
 * Server and first client render show no banner (the consent snapshot is "decided"), so the server HTML and the
 * hydrating HTML match and the banner, which is fixed to the viewport, appears without moving anything.
 */
export function ConsentAnalytics({
  cart,
  shop,
  consent,
  config,
  children,
}: ConsentAnalyticsProps) {
  const providers = hasProviders(config);
  const nonce = useNonce();
  const mode = config.consentMode;

  const store: ConsentStore | null = useMemo(
    () =>
      providers && typeof window !== 'undefined'
        ? createBrowserConsentStore(mode, window)
        : null,
    [providers, mode],
  );

  const snapshot = useSyncExternalStore(
    store?.subscribe ?? NO_STORE_SUBSCRIBE,
    store?.getSnapshot ?? getServerSnapshot,
    getServerSnapshot,
  );

  // The shopper's choice in another tab.
  useEffect(() => {
    if (!store) return;
    const onStorage = () => store.refresh();
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [store]);

  // Hydrogen only publishes what `canTrack` allows. When we ask, any consented provider counts; the runtime then
  // routes each event to the providers whose own category is allowed. Shopify's own answer still counts, so its
  // sales-channel analytics behave as before.
  const anyAllowed = snapshot.choice.analytics || snapshot.choice.marketing;
  const canTrack = useCallback(
    () => anyAllowed || shopifyAllowsAnalytics(),
    [anyAllowed],
  );

  const contextValue = useMemo(
    () => ({config, store, snapshot}),
    [config, store, snapshot],
  );

  return (
    <ConsentContext.Provider value={contextValue}>
      <Analytics.Provider
        cart={cart}
        shop={shop}
        consent={consent}
        {...(providers ? {canTrack} : {})}
      >
        {/* Before the page content, so the track sink is set before any child's effect sends an event (effects run in tree order) and keyboard users reach the banner early. */}
        <AnalyticsRuntimeHost store={store} config={config} nonce={nonce} />
        <AnalyticsBridge />
        <ConsentBanner />
        <ConsentPreferences />
        {children}
      </Analytics.Provider>
    </ConsentContext.Provider>
  );
}
