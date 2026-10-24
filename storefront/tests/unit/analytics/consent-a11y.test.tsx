// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import {useEffect, useState, useSyncExternalStore} from 'react';
import {MemoryRouter} from 'react-router';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {
  CONSENT_BANNER_ANNOUNCEMENT,
  ConsentBanner,
  bannerSentence,
} from '~/components/consent/ConsentBanner';
import {ConsentPreferences} from '~/components/consent/ConsentPreferences';
import {moveFocusAfterDecision} from '~/components/consent/focus-after-decision';
import {parseAnalyticsConfig} from '~/lib/analytics/config';
import {createConsentStore} from '~/lib/analytics/consent-store';

// P7-01 review 2026-10-24 (m-2, m-3), NFR-003, NFR-011: the banner names only the configured tools; focus goes to the
// page after an answer; a focused element is not hidden behind the fixed banner; the banner is announced politely.

const GA = {PUBLIC_GA4_MEASUREMENT_ID: 'G-ABCD1234'};
const META = {PUBLIC_META_PIXEL_ID: '123456789012345'};

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  document.documentElement.style.scrollPaddingBottom = '';
});

describe('the banner sentence names only what is configured (m-2)', () => {
  it.each([
    [GA, false, 'We only load analytics tools from Google after you agree. '],
    [META, false, 'We only load advertising tools from Meta after you agree. '],
    [
      {...GA, ...META},
      false,
      'We only load analytics tools from Google and advertising tools from Meta after you agree. ',
    ],
    [
      GA,
      true,
      'We use analytics tools from Google to see how the site is used. You can turn it off at any time. ',
    ],
    [
      META,
      true,
      'We use advertising tools from Meta to measure our advertising. You can turn it off at any time. ',
    ],
    [
      {...GA, ...META},
      true,
      'We use analytics tools from Google and advertising tools from Meta to see how the site is used and measure our advertising. You can turn them off at any time. ',
    ],
  ])('%j, opt-out %s', (env, optOut, expected) => {
    expect(bannerSentence(parseAnalyticsConfig(env), optOut)).toBe(expected);
  });

  it('never mentions Meta for a GA4-only store, or Google for a Meta-only store', () => {
    expect(bannerSentence(parseAnalyticsConfig(GA), false)).not.toMatch(/Meta/);
    expect(bannerSentence(parseAnalyticsConfig(META), false)).not.toMatch(
      /Google/,
    );
  });
});

function Harness({env}: {env: Record<string, string>}) {
  const [{config, store}] = useState(() => {
    const parsed = parseAnalyticsConfig(env);
    return {
      config: parsed,
      store: createConsentStore({
        mode: parsed.consentMode,
        storage: {read: () => null, write: () => {}},
      }),
    };
  });
  useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return (
    <MemoryRouter>
      <main tabIndex={-1}>the page</main>
      <ConsentBanner config={config} store={store} />
      <ConsentPreferences config={config} store={store} />
      <FocusMover store={store} />
    </MemoryRouter>
  );
}

function FocusMover({
  store,
}: {
  store: Parameters<typeof moveFocusAfterDecision>[0];
}) {
  useEffect(() => moveFocusAfterDecision(store, window), [store]);
  return null;
}

describe('focus after an answer (m-3)', () => {
  it.each(['Accept all', 'Reject all'])(
    'moves focus to the main landmark after %s',
    (name) => {
      render(<Harness env={GA} />);
      const button = screen.getByRole('button', {name});
      button.focus();
      fireEvent.click(button);
      act(() => {
        vi.runAllTimers();
      });
      expect(document.activeElement).toBe(screen.getByRole('main'));
    },
  );

  it('moves focus to the main landmark after Save choices in the dialog opened from the banner', () => {
    render(<Harness env={GA} />);
    const choose = screen.getByRole('button', {name: 'Choose'});
    choose.focus();
    fireEvent.click(choose);
    const dialog = screen.getByRole('dialog', {name: 'Privacy choices'});
    within(dialog).getByRole('button', {name: 'Save choices'}).focus();
    fireEvent.click(within(dialog).getByRole('button', {name: 'Save choices'}));
    act(() => {
      vi.runAllTimers();
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('main'));
  });

  it('closing the dialog with Escape gives focus back to Choose, and the banner stays', () => {
    render(<Harness env={GA} />);
    const choose = screen.getByRole('button', {name: 'Choose'});
    choose.focus();
    fireEvent.click(choose);
    fireEvent.keyDown(screen.getByRole('dialog'), {key: 'Escape'});
    act(() => {
      vi.runAllTimers();
    });
    expect(document.activeElement).toBe(choose);
    expect(screen.getByRole('region', {name: 'Privacy choices'})).toBeVisible();
  });

  it('an answer given in another tab does not take focus away from what the shopper is doing', () => {
    const store = createConsentStore({
      mode: 'opt-in',
      storage: {
        read: () => {
          return stored;
        },
        write: () => {},
      },
    });
    let stored: string | null = null;
    render(
      <>
        <main tabIndex={-1}>the page</main>
        <input aria-label="search" />
      </>,
    );
    const remove = moveFocusAfterDecision(store, window);
    screen.getByLabelText('search').focus();
    stored = JSON.stringify({
      version: 1,
      analytics: true,
      marketing: false,
      decidedAt: Math.floor(Date.now() / 1000),
    });
    store.refresh();
    act(() => {
      vi.runAllTimers();
    });
    expect(store.getSnapshot().decided).toBe(true);
    expect(document.activeElement).toBe(screen.getByLabelText('search'));
    remove();
  });
});

describe('the fixed banner does not hide a focused element (m-3, WCAG 2.4.11)', () => {
  it('sets the bottom scroll padding to the banner height while it is shown, and puts it back after', () => {
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get: () => 120,
    });
    try {
      render(<Harness env={GA} />);
      expect(document.documentElement.style.scrollPaddingBottom).toBe('136px');
      fireEvent.click(screen.getByRole('button', {name: 'Reject all'}));
      expect(document.documentElement.style.scrollPaddingBottom).toBe('');
    } finally {
      Reflect.deleteProperty(HTMLElement.prototype, 'offsetHeight');
    }
  });

  it('leaves a value that was there before as it was', () => {
    document.documentElement.style.scrollPaddingBottom = '10px';
    const {unmount} = render(<Harness env={GA} />);
    unmount();
    expect(document.documentElement.style.scrollPaddingBottom).toBe('10px');
  });

  it('sets nothing when there is no provider (no banner)', () => {
    render(<Harness env={{}} />);
    expect(document.documentElement.style.scrollPaddingBottom).toBe('');
  });
});

describe('the banner is announced politely, once (m-3)', () => {
  it('has a status region that is empty at first and then says "Cookie choices available", without moving focus', () => {
    render(<Harness env={GA} />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('');
    expect(status).toHaveClass('sr-only');
    const before = document.activeElement;
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(status).toHaveTextContent(CONSENT_BANNER_ANNOUNCEMENT);
    expect(document.activeElement).toBe(before);
  });

  it('marks the banner for the focus mover', () => {
    render(<Harness env={GA} />);
    expect(
      screen.getByRole('region', {name: 'Privacy choices'}),
    ).toHaveAttribute('data-consent', 'banner');
  });
});
