// @vitest-environment jsdom
import {act, cleanup, render, screen} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {moveFocusAfterDecision} from '~/components/consent/focus-after-decision';
import {serializeConsent} from '~/lib/analytics/consent';
import {createConsentStore} from '~/lib/analytics/consent-store';

// Code re-review m-5: with no focus anywhere (the document body), focus moves to the page only when the answer was
// given HERE; an answer read back from another tab never claims focus.

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function setup() {
  let stored: string | null = null;
  const store = createConsentStore({
    mode: 'opt-in',
    storage: {read: () => stored, write: () => {}},
  });
  render(<main tabIndex={-1}>the page</main>);
  const remove = moveFocusAfterDecision(store, window);
  return {
    store,
    remove,
    other(analytics: boolean) {
      stored = serializeConsent(
        {analytics, marketing: false},
        Date.now() / 1000,
      );
      store.refresh();
    },
  };
}

describe('focus after an answer, by where the answer came from', () => {
  it('nothing has focus and the answer was given here: the page gets it', () => {
    const {store, remove} = setup();
    expect(document.activeElement).toBe(document.body);
    store.rejectAll();
    expect(store.lastSource()).toBe('local');
    act(() => {
      vi.runAllTimers();
    });
    expect(document.activeElement).toBe(screen.getByRole('main'));
    remove();
  });

  it('nothing has focus and the answer was read back from another tab: nothing is moved', () => {
    const {store, other, remove} = setup();
    other(false);
    expect(store.lastSource()).toBe('refresh');
    expect(store.getSnapshot().decided).toBe(true);
    act(() => {
      vi.runAllTimers();
    });
    expect(document.activeElement).toBe(document.body);
    remove();
  });

  it('a local answer after a read-back is local again', () => {
    const {store, other, remove} = setup();
    other(true);
    store.save({analytics: false, marketing: false});
    expect(store.lastSource()).toBe('local');
    remove();
  });
});
