import {createContext, useContext} from 'react';
import type {PublicAnalyticsConfig} from '~/lib/analytics/config';
import {
  SERVER_CONSENT_SNAPSHOT,
  type ConsentSnapshot,
  type ConsentStore,
} from '~/lib/analytics/consent-store';

export type ConsentContextValue = {
  readonly config: PublicAnalyticsConfig;
  /** Null on the server and before hydration; the banner and dialog render nothing then (no layout shift). */
  readonly store: ConsentStore | null;
  readonly snapshot: ConsentSnapshot;
};

export const ConsentContext = createContext<ConsentContextValue | null>(null);

/** The consent state, or an inert one outside the provider (an isolated component test, an error page). */
export function useConsent(): ConsentContextValue | null {
  return useContext(ConsentContext);
}

export {SERVER_CONSENT_SNAPSHOT};
