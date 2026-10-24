// @vitest-environment jsdom
import {act, cleanup, fireEvent, render, screen} from '@testing-library/react';
import {StrictMode, useState, useSyncExternalStore} from 'react';
import {MemoryRouter} from 'react-router';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {
  BANNER_MAX_HEIGHT,
  CONSENT_BANNER_ANNOUNCEMENT,
  ConsentBanner,
} from '~/components/consent/ConsentBanner';
import {parseAnalyticsConfig} from '~/lib/analytics/config';
import {createConsentStore} from '~/lib/analytics/consent-store';

// QA-ANL-1 (WCAG 2.4.11, 1.4.10) and F-2: the fixed banner makes real room at the end of the page, is capped on a
// small window, and its announcement survives React StrictMode's immediate cleanup and re-run.

const GA = {PUBLIC_GA4_MEASUREMENT_ID: 'G-ABCD1234'};

let height = 120;
let compactMatches = false;
const listeners = new Set<() => void>();

beforeEach(() => {
  height = 120;
  compactMatches = false;
  listeners.clear();
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get: () => height,
  });
  Reflect.set(window, 'matchMedia', () => ({
    get matches() {
      return compactMatches;
    },
    addEventListener: (_type: string, listener: () => void) =>
      listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) =>
      listeners.delete(listener),
  }));
  document.body.style.paddingBottom = '';
  document.documentElement.style.scrollPaddingBottom = '';
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(HTMLElement.prototype, 'offsetHeight');
  Reflect.deleteProperty(window, 'matchMedia');
  vi.useRealTimers();
});

function Harness() {
  const [{config, store}] = useState(() => {
    const parsed = parseAnalyticsConfig(GA);
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
      <ConsentBanner config={config} store={store} />
    </MemoryRouter>
  );
}

describe('real room for the banner (QA-ANL-1)', () => {
  it('adds the banner height (plus 16 px) to the body padding and to the scroll padding while shown, and restores both', () => {
    render(<Harness />);
    expect(document.body.style.paddingBottom).toBe('136px');
    expect(document.documentElement.style.scrollPaddingBottom).toBe('136px');
    fireEvent.click(screen.getByRole('button', {name: 'Reject all'}));
    expect(document.body.style.paddingBottom).toBe('');
    expect(document.documentElement.style.scrollPaddingBottom).toBe('');
  });

  it('keeps padding the body already had, and puts it back', () => {
    document.body.style.paddingBottom = '10px';
    const {unmount} = render(<Harness />);
    expect(document.body.style.paddingBottom).toBe('146px');
    unmount();
    expect(document.body.style.paddingBottom).toBe('10px');
  });

  it('follows the window: a resize re-measures the banner', () => {
    render(<Harness />);
    height = 200;
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(document.body.style.paddingBottom).toBe('216px');
    expect(document.documentElement.style.scrollPaddingBottom).toBe('216px');
  });

  it('adds nothing when there is no provider (no banner)', () => {
    function None() {
      return <p>no banner</p>;
    }
    render(<None />);
    expect(document.body.style.paddingBottom).toBe('');
  });
});

describe('the banner is capped on a small window (QA-ANL-1, WCAG 1.4.10)', () => {
  it('never takes more than 40 percent of the window height; the text scrolls, the buttons do not', () => {
    render(<Harness />);
    const region = screen.getByRole('region', {name: 'Privacy choices'});
    expect(BANNER_MAX_HEIGHT).toBe('40dvh');
    expect(region.style.maxHeight).toBe('40dvh');
    const text = region.querySelector('p');
    expect(text?.className).toContain('overflow-y-auto');
    const buttons = screen.getByRole('button', {
      name: 'Accept all',
    }).parentElement;
    expect(buttons?.className).toContain('shrink-0');
  });

  it('is in the normal layout on a roomy window', () => {
    render(<Harness />);
    const region = screen.getByRole('region', {name: 'Privacy choices'});
    expect(region).not.toHaveAttribute('data-compact');
    expect(region.className).toContain('p-4');
    expect(
      screen.getByRole('button', {name: 'Accept all'}).parentElement,
    ).toHaveClass('flex-col');
  });

  it('switches to the compact layout on a narrow or short window: smaller type, buttons in one row, equal and 44 px', () => {
    compactMatches = true;
    render(<Harness />);
    const region = screen.getByRole('region', {name: 'Privacy choices'});
    expect(region).toHaveAttribute('data-compact');
    expect(region.className).toContain('p-2');
    expect(region.querySelector('p')?.className).toContain('text-xs');
    const accept = screen.getByRole('button', {name: 'Accept all'});
    const reject = screen.getByRole('button', {name: 'Reject all'});
    expect(accept.parentElement).toHaveClass('flex-row');
    // Same size classes, 44 px minimum, for Accept and Reject.
    for (const button of [accept, reject]) {
      expect(button).toHaveClass('w-full');
      expect(button).toHaveClass('min-h-touch');
    }
  });

  it('follows a change of the window (zoom, rotation)', () => {
    render(<Harness />);
    expect(
      screen.getByRole('region', {name: 'Privacy choices'}),
    ).not.toHaveAttribute('data-compact');
    compactMatches = true;
    act(() => {
      for (const listener of listeners) listener();
    });
    expect(
      screen.getByRole('region', {name: 'Privacy choices'}),
    ).toHaveAttribute('data-compact');
  });
});

describe('the announcement survives StrictMode (F-2)', () => {
  it('says "Cookie choices available" although the effect is cleaned up and run again at once', () => {
    vi.useFakeTimers();
    render(
      <StrictMode>
        <Harness />
      </StrictMode>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('');
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(screen.getByRole('status')).toHaveTextContent(
      CONSENT_BANNER_ANNOUNCEMENT,
    );
  });
});
