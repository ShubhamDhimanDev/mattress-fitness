import {createContext, useContext} from 'react';
import type {PublicAnalyticsConfig} from '~/lib/analytics/config';
import type {
  ConsentSnapshot,
  ConsentStore,
} from '~/lib/analytics/consent-store';

// Kept to React and type imports only: the footer imports this file, so it is part of every route's JavaScript.

export type ConsentContextValue = {
  readonly config: PublicAnalyticsConfig;
  /** Null on the server and until the consent chunk has loaded; the banner and dialog render nothing then. */
  readonly store: ConsentStore | null;
  readonly snapshot: ConsentSnapshot;
};

/**
 * An override for the footer button (`PrivacyChoicesButton`): tests and isolated components provide a store here.
 * In the running site nothing provides it and the button reads the store the consent chunk publishes to
 * `consentHandle` (`~/lib/analytics/gate`), which keeps a React context provider out of the initial JavaScript.
 */
export const ConsentContext = createContext<ConsentContextValue | null>(null);

/** The override, or null. */
export function useConsent(): ConsentContextValue | null {
  return useContext(ConsentContext);
}

/**
 * What the page shell hands the lazy consent chunk. The shell passes its helpers in as props instead of the chunk
 * importing them: a module imported by both the root route and the lazy chunk can end up as a chunk of its own,
 * which every route then downloads separately (bundle budget, scripts/perf).
 */
export type ConsentRuntimeProps = {
  readonly config: PublicAnalyticsConfig;
  readonly nonce: string | undefined;
  /** Publishes the chunk's consent store to the shell (null when the chunk unmounts). */
  readonly publishStore: (store: ConsentStore | null) => void;
  /** Tells the shell the shopper's choice changed, so Hydrogen's provider asks `canTrack` again. */
  readonly notify: () => void;
  /** Runs a callback when the browser is idle and returns the canceller. */
  readonly schedule: (callback: () => void) => () => void;
};
