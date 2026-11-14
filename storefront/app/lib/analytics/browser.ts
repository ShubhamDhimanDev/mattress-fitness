// The only module that touches `window`, `document` and cookies for analytics (P7-01). Everything else is pure
// or injected; this wires the real browser into those seams. Every access is guarded: a browser that blocks
// cookies or scripts leaves the page working (NFR-013).

import type {PublicAnalyticsConfig} from '~/lib/analytics/config';
import {buildExpiredCookies} from '~/lib/analytics/cookies';
import {createGa4Adapter} from '~/lib/analytics/ga4';
import {
  evaluatePage,
  readPageInput,
  type PageDecision,
} from '~/lib/analytics/page-context';
import {createGtmAdapter} from '~/lib/analytics/gtm';
import {createMetaAdapter} from '~/lib/analytics/meta';
import {createOpenaiAdapter} from '~/lib/analytics/openai';
import {globalsOf, type ProviderAdapter} from '~/lib/analytics/adapter';
import {createScriptLoader} from '~/lib/analytics/script-loader';

/** The safety verdict for the page in `win` right now (see `page-context.ts`); unreadable counts as unsafe. */
export function evaluateCurrentPage(win: Window): PageDecision {
  const input = readPageInput(win);
  return input ? evaluatePage(input) : {safe: false, reason: 'unreadable'};
}

/** Expires the named cookies on this host; used when a provider is asked to clear what it stored. */
export function clearCookiesIn(
  win: Window,
): (names: readonly string[]) => void {
  return (names) => {
    try {
      for (const line of buildExpiredCookies(names, win.location.hostname)) {
        win.document.cookie = line;
      }
    } catch {
      // Best effort.
    }
  };
}

/** One adapter per configured provider; none when no id is set, so nothing is loaded and no host is needed. */
export function createBrowserAdapters(
  config: PublicAnalyticsConfig,
  win: Window,
  nonce: string | undefined,
): ProviderAdapter[] {
  const globals = globalsOf(win);
  const loadScript = createScriptLoader({
    doc: win.document,
    nonce: () => nonce,
  });
  const clearCookies = clearCookiesIn(win);
  const adapters: ProviderAdapter[] = [];
  if (config.ga4MeasurementId) {
    adapters.push(
      createGa4Adapter({
        measurementId: config.ga4MeasurementId,
        globals,
        loadScript,
        clearCookies,
      }),
    );
  }
  if (config.metaPixelId) {
    adapters.push(
      createMetaAdapter({
        pixelId: config.metaPixelId,
        globals,
        loadScript,
        clearCookies,
      }),
    );
  }
  if (config.gtmContainerId) {
    adapters.push(
      createGtmAdapter({
        containerId: config.gtmContainerId,
        globals,
        loadScript,
        clearCookies,
      }),
    );
  }
  if (config.openaiPixelId) {
    adapters.push(
      createOpenaiAdapter({
        pixelId: config.openaiPixelId,
        globals,
        loadScript,
        clearCookies,
      }),
    );
  }
  return adapters;
}
