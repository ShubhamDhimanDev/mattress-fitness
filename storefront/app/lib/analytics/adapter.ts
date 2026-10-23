// The contract between the analytics runtime and one provider (P7-01). Adapters are thin: the pure mapping lives
// beside them (`toGa4Call`, `toMetaCall`), and everything that touches the page (globals, script loading, cookies)
// is injected, so the tests drive them with fakes and a provider that fails to load is just another result.

import type {AnalyticsEvent} from '~/lib/analytics';
import type {ConsentCategory} from '~/lib/analytics/config';

export type ProviderId = 'ga4' | 'meta';

export type ProviderFailureReason =
  'error' | 'timeout' | 'unavailable' | 'origin-refused';

export type ProviderLoadResult =
  | {readonly status: 'ready'}
  | {readonly status: 'failed'; readonly reason: ProviderFailureReason};

export type ProviderAdapter = {
  readonly id: ProviderId;
  /** The consent category this provider needs. */
  readonly category: ConsentCategory;
  /** Sets the provider up and loads its script. Never rejects; failure is a result. */
  readonly load: () => Promise<ProviderLoadResult>;
  /** Sends one event. Only called after `load` reported ready and while consent holds. Never throws. */
  readonly send: (event: AnalyticsEvent) => void;
  /** Consent given again after a withdrawal in the same visit. */
  readonly grant: () => void;
  /** Consent withdrawn after the provider was loaded: stop sending and remove what it stored. */
  readonly revoke: () => void;
};

export type ScriptLoadResult =
  | {readonly status: 'loaded'}
  | {readonly status: 'failed'; readonly reason: ProviderFailureReason};

export type ScriptLoader = (src: string) => Promise<ScriptLoadResult>;

/** Reads and writes the page's globals (`window.dataLayer`, `window.fbq`) without casts. */
export type Globals = {
  readonly get: (name: string) => unknown;
  readonly set: (name: string, value: unknown) => void;
};

export function globalsOf(target: object): Globals {
  return {
    get: (name) => Reflect.get(target, name),
    set: (name, value) => {
      Reflect.set(target, name, value);
    },
  };
}

export type CookieClearer = (names: readonly string[]) => void;
