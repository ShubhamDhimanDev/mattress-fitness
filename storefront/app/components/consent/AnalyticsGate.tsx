import {Analytics, useNonce} from '@shopify/hydrogen';
import {
  Suspense,
  lazy,
  useEffect,
  useState,
  useSyncExternalStore,
  type ComponentProps,
  type ComponentType,
  type ReactNode,
} from 'react';
import type {ConsentRuntimeProps} from '~/components/consent/consent-context';
import type {PublicAnalyticsConfig} from '~/lib/analytics/config';
import {consentHandle, scheduleIdle} from '~/lib/analytics/gate';

// Everything in this file is part of every route's JavaScript, which has a budget (scripts/perf). It imports no
// helper module that the consent chunk also uses (they would become small shared chunks, each with its own
// overhead): the shell's helpers live in gate.ts and reach the chunk as props.

type HydrogenProviderProps = ComponentProps<typeof Analytics.Provider>;

type AnalyticsGateProps = {
  readonly cart: HydrogenProviderProps['cart'];
  readonly shop: HydrogenProviderProps['shop'];
  readonly consent: HydrogenProviderProps['consent'];
  readonly config: PublicAnalyticsConfig;
  readonly children: ReactNode;
};

// The consent layer is a separate chunk. A failed download hides it and nothing else: a rejected lazy import would
// otherwise throw into the page (NFR-013).
const Nothing: ComponentType<ConsentRuntimeProps> = () => null;
const ConsentRuntime = lazy(
  (): Promise<{default: ComponentType<ConsentRuntimeProps>}> =>
    import('~/components/consent/ConsentRuntime').then(
      (module) => ({default: module.ConsentRuntime}),
      () => ({default: Nothing}),
    ),
);

/** True once the browser is idle after hydration; never on the server or on the first client render. */
function useAfterIdle(enabled: boolean): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    return scheduleIdle(() => setReady(true));
  }, [enabled]);
  return ready;
}

/**
 * Replaces `<Analytics.Provider>` in the root (P7-01): the same provider, in the initial JavaScript, plus a request
 * for the lazy `ConsentRuntime` chunk.
 *
 * With neither provider configured (the default) this renders Hydrogen's provider exactly as before and nothing
 * else: the chunk is never requested, no store, no runtime, no banner, no script.
 *
 * With a provider configured, the chunk is requested after hydration and when the browser is idle. It publishes its
 * consent store to `consentHandle` (the footer button reads it) and notifies on every change, which re-renders this
 * component so Hydrogen asks `canTrack` again and publishes what the new choice allows. `track()` holds the first
 * events meanwhile and replays them when the chunk registers its sink.
 */
export function AnalyticsGate({
  cart,
  shop,
  consent,
  config,
  children,
}: AnalyticsGateProps) {
  const providers =
    config.ga4MeasurementId !== null || config.metaPixelId !== null;
  const nonce = useNonce();
  useSyncExternalStore(
    consentHandle.subscribe,
    consentHandle.getVersion,
    consentHandle.getServerVersion,
  );
  const mountRuntime = useAfterIdle(providers);

  return (
    <Analytics.Provider
      cart={cart}
      shop={shop}
      consent={consent}
      {...(providers ? {canTrack: consentHandle.canTrack} : {})}
    >
      {providers && mountRuntime ? (
        <Suspense fallback={null}>
          <ConsentRuntime
            config={config}
            nonce={nonce}
            publishStore={consentHandle.publish}
            notify={consentHandle.notify}
            schedule={scheduleIdle}
          />
        </Suspense>
      ) : null}
      {children}
    </Analytics.Provider>
  );
}
