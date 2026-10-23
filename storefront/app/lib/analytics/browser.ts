// The only module that touches `window`, `document` and cookies for analytics (P7-01). Everything else is pure
// or injected; this wires the real browser into those seams. Every access is guarded: a browser that blocks
// storage, cookies or scripts leaves the page working and the shopper asked again next visit (NFR-013).

import type {ConsentMode, PublicAnalyticsConfig} from '~/lib/analytics/config';
import {
  buildConsentCookie,
  CONSENT_STORAGE_KEY,
  readCookieValue,
} from '~/lib/analytics/consent';
import {
  createConsentStore,
  type ConsentStorage,
  type ConsentStore,
} from '~/lib/analytics/consent-store';
import {buildExpiredCookies} from '~/lib/analytics/cookies';
import {createGa4Adapter} from '~/lib/analytics/ga4';
import {createMetaAdapter} from '~/lib/analytics/meta';
import {globalsOf, type ProviderAdapter} from '~/lib/analytics/adapter';
import {createScriptLoader} from '~/lib/analytics/script-loader';

/** Cookie first (it can later be read by the server), localStorage as a fallback; each guarded on its own. */
export function createBrowserConsentStorage(win: Window): ConsentStorage {
  return {
    read() {
      try {
        const fromCookie = readCookieValue(
          win.document.cookie,
          CONSENT_STORAGE_KEY,
        );
        if (fromCookie) return fromCookie;
      } catch {
        // Cookies blocked.
      }
      try {
        return win.localStorage.getItem(CONSENT_STORAGE_KEY);
      } catch {
        return null;
      }
    },
    write(value) {
      try {
        win.document.cookie = buildConsentCookie(value, {
          secure: win.location.protocol === 'https:',
        });
      } catch {
        // Cookies blocked.
      }
      try {
        win.localStorage.setItem(CONSENT_STORAGE_KEY, value);
      } catch {
        // Storage blocked or full.
      }
    },
  };
}

/** Global Privacy Control, a browser-level opt-out signal (`navigator.globalPrivacyControl`). */
export function readGlobalPrivacyControl(win: Window): boolean {
  try {
    return Reflect.get(win.navigator, 'globalPrivacyControl') === true;
  } catch {
    return false;
  }
}

export function createBrowserConsentStore(
  mode: ConsentMode,
  win: Window,
): ConsentStore {
  return createConsentStore({
    mode,
    storage: createBrowserConsentStorage(win),
    gpc: () => readGlobalPrivacyControl(win),
  });
}

/** Expires the named cookies on this host; used when consent is withdrawn after a provider ran. */
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
  return adapters;
}
