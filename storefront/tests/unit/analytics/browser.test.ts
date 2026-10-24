// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {
  attachConsentRefresh,
  createBrowserConsentStorage,
  evaluateCurrentPage,
} from '~/lib/analytics/browser';
import {serializeConsent} from '~/lib/analytics/consent';
import {createConsentStore} from '~/lib/analytics/consent-store';

// P7-01 review 2026-10-24, L-6: a withdrawal made in another tab is applied here; and the browser glue for the
// safe-page guard.

afterEach(() => {
  vi.restoreAllMocks();
  document.cookie = 'mf_consent=; Max-Age=0; Path=/';
  localStorage.clear();
});

function decidedNow(analytics: boolean, marketing: boolean) {
  return serializeConsent({analytics, marketing}, Date.now() / 1000);
}

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  });
}

describe('consent changes made in another tab (L-6)', () => {
  function setup() {
    const storage = createBrowserConsentStorage(window);
    const store = createConsentStore({mode: 'opt-in', storage});
    const detach = attachConsentRefresh(store, window);
    return {storage, store, detach};
  }

  it('a withdrawal in the cookie (no storage event) is applied when the tab becomes visible', () => {
    const {storage, store, detach} = setup();
    store.acceptAll();
    expect(store.getSnapshot().choice.analytics).toBe(true);
    // The other tab wrote the cookie only: no `storage` event reaches this one.
    storage.write(decidedNow(false, false));
    expect(store.getSnapshot().choice.analytics).toBe(true);
    setVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(store.getSnapshot().choice).toEqual({
      analytics: false,
      marketing: false,
    });
    detach();
  });

  it('is applied on focus too', () => {
    const {storage, store, detach} = setup();
    store.acceptAll();
    storage.write(decidedNow(false, true));
    window.dispatchEvent(new Event('focus'));
    expect(store.getSnapshot().choice).toEqual({
      analytics: false,
      marketing: true,
    });
    detach();
  });

  it('is applied on a storage event', () => {
    const {storage, store, detach} = setup();
    store.acceptAll();
    storage.write(decidedNow(false, false));
    window.dispatchEvent(new Event('storage'));
    expect(store.getSnapshot().choice.analytics).toBe(false);
    detach();
  });

  it('a tab that is hidden does not re-read', () => {
    const {storage, store, detach} = setup();
    store.acceptAll();
    storage.write(decidedNow(false, false));
    setVisibility('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(store.getSnapshot().choice.analytics).toBe(true);
    detach();
  });

  it('after detach nothing is re-read, and a throwing store does not break the page', () => {
    const refresh = vi.fn();
    const detach = attachConsentRefresh({refresh}, window);
    window.dispatchEvent(new Event('focus'));
    expect(refresh).toHaveBeenCalledTimes(1);
    detach();
    window.dispatchEvent(new Event('focus'));
    expect(refresh).toHaveBeenCalledTimes(1);

    const bad = attachConsentRefresh(
      {
        refresh: () => {
          throw new Error('storage gone');
        },
      },
      window,
    );
    expect(() => window.dispatchEvent(new Event('focus'))).not.toThrow();
    bad();
  });
});

describe('the page verdict for the current window', () => {
  it('a normal page is safe; a private one and a personal search are not', () => {
    expect(evaluateCurrentPage(window).safe).toBe(true);
    window.history.pushState({}, '', '/account/orders/1234567890');
    expect(evaluateCurrentPage(window)).toEqual({
      safe: false,
      reason: 'private-path',
    });
    window.history.pushState({}, '', '/search?q=jane%40example.com');
    expect(evaluateCurrentPage(window)).toEqual({
      safe: false,
      reason: 'personal-search',
    });
    window.history.pushState({}, '', '/');
  });
});
