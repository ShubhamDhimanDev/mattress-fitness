import type {PublicAnalyticsConfig} from '~/lib/analytics/config';
import type {ConsentStore} from '~/lib/analytics/consent-store';

// Types only: nothing here reaches a bundle.

/**
 * What the page shell hands the lazy consent chunk. The shell passes its helpers in as props instead of the chunk
 * importing them: a module imported by both the root route and the lazy chunk can end up as a chunk of its own,
 * which every route then downloads separately (bundle budget, scripts/perf).
 */
export type ConsentRuntimeProps = {
  readonly config: PublicAnalyticsConfig;
  /** Target of the banner's privacy link, or null to show none (P6-09); undefined keeps the banner's default. */
  readonly privacyPath?: string | null;
  readonly nonce: string | undefined;
  /** Publishes the chunk's consent store to the shell (null when the chunk unmounts). */
  readonly publishStore: (store: ConsentStore | null) => void;
  /** Hands over the page's first product and search views, kept by the shell (`earlyViews`). */
  readonly takeEarlyViews: () => Array<[string, unknown]>;
  /** Starts keeping the page's views again (the bridge went away; a remounted one will take them). */
  readonly resetEarlyViews: () => void;
  /** Tells the shell the shopper's choice changed, so Hydrogen's provider asks `canTrack` again. */
  readonly notify: () => void;
  /** Runs a callback when the browser is idle and returns the canceller. */
  readonly schedule: (callback: () => void) => () => void;
};
