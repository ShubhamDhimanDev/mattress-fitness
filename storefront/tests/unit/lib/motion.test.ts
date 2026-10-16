import {afterEach, describe, expect, it, vi} from 'vitest';
import {prefersReducedMotion, scrollBehavior} from '~/lib/motion';

// NFR-003 (WCAG 2.3.3): script-driven scrolling is instant when the shopper asks for reduced motion. The unit
// environment is plain Node, so `window` is stubbed per test.

function stubWindow(reduce: boolean) {
  const matchMedia = vi.fn((query: string) => ({
    matches: query === '(prefers-reduced-motion: reduce)' && reduce,
  }));
  vi.stubGlobal('window', {matchMedia});
  return matchMedia;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('scrollBehavior', () => {
  it('is instant when the shopper prefers reduced motion', () => {
    const matchMedia = stubWindow(true);
    expect(scrollBehavior()).toBe('auto');
    expect(prefersReducedMotion()).toBe(true);
    expect(matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
  });

  it('is smooth when there is no preference', () => {
    stubWindow(false);
    expect(scrollBehavior()).toBe('smooth');
    expect(prefersReducedMotion()).toBe(false);
  });

  it('reads the setting at call time, so a change while the page is open counts', () => {
    stubWindow(false);
    expect(scrollBehavior()).toBe('smooth');
    stubWindow(true);
    expect(scrollBehavior()).toBe('auto');
  });

  it('is instant where the preference cannot be read (no matchMedia)', () => {
    vi.stubGlobal('window', {});
    expect(scrollBehavior()).toBe('auto');
  });

  it('is instant on the server, where there is no window', () => {
    expect(typeof window).toBe('undefined');
    expect(scrollBehavior()).toBe('auto');
  });
});
