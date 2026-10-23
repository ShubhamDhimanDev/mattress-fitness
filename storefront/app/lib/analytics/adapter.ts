// The contract between the analytics runtime and one provider (P7-01). Adapters are thin: the pure mapping lives
// beside them (`toGa4Call`, `toMetaCall`), and everything that touches the page (globals, script loading, cookies)
// is injected, so the tests drive them with fakes and a provider that fails to load is just another result.

import type {AnalyticsEvent} from '~/lib/analytics';
import type {ConsentCategory} from '~/lib/analytics/config';
import type {PageContext} from '~/lib/analytics/page-context';

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
  /**
   * The reduced address, title and referrer for the page the shopper is on (see `page-context.ts`). Called on each
   * navigation and before a load starts; a provider that can override what its script reads applies it.
   */
  readonly setPage?: (context: PageContext) => void;
  /**
   * The shopper is on a page that must send nothing (private area): stop the provider's own automatic hits too.
   * Unlike `revoke` this keeps the cookies and the consent; `resume` undoes it on the next safe page.
   */
  readonly pause?: () => void;
  readonly resume?: () => void;
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
