// @vitest-environment jsdom
import {act, render, renderHook} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {useDelayedFlag} from '~/lib/use-delayed-flag';

// NFR-001 / NFR-013: a slow page load gives the shopper feedback, a fast one does not flicker. The hook is the timing
// rule behind the loading bar (components/layout/NavigationProgress.tsx).

describe('useDelayedFlag (the loading bar timing)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function flag(active: boolean) {
    return renderHook(({on}) => useDelayedFlag(on, 150, 400), {
      initialProps: {on: active},
    });
  }

  it('stays off for a navigation that finishes within the delay', () => {
    const {result, rerender} = flag(false);
    rerender({on: true});
    act(() => void vi.advanceTimersByTime(100));
    rerender({on: false});
    act(() => void vi.advanceTimersByTime(1000));
    expect(result.current).toBe(false);
  });

  it('turns on after the delay while the navigation is still running', () => {
    const {result, rerender} = flag(false);
    rerender({on: true});
    act(() => void vi.advanceTimersByTime(149));
    expect(result.current).toBe(false);
    act(() => void vi.advanceTimersByTime(2));
    expect(result.current).toBe(true);
  });

  it('stays on for the minimum time even when the navigation ends at once', () => {
    const {result, rerender} = flag(false);
    rerender({on: true});
    act(() => void vi.advanceTimersByTime(150));
    expect(result.current).toBe(true);
    rerender({on: false});
    act(() => void vi.advanceTimersByTime(399));
    expect(result.current).toBe(true);
    act(() => void vi.advanceTimersByTime(2));
    expect(result.current).toBe(false);
  });

  it('turns off at once when it has already been visible for the minimum time', () => {
    const {result, rerender} = flag(false);
    rerender({on: true});
    act(() => void vi.advanceTimersByTime(150));
    act(() => void vi.advanceTimersByTime(1000));
    rerender({on: false});
    act(() => void vi.advanceTimersByTime(1));
    expect(result.current).toBe(false);
  });
});

describe('NavigationProgress', () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('react-router');
  });

  async function mountWith(state: 'idle' | 'loading') {
    vi.resetModules();
    vi.doMock('react-router', () => ({useNavigation: () => ({state})}));
    const {NavigationProgress} =
      await import('~/components/layout/NavigationProgress');
    return render(<NavigationProgress />);
  }

  it('renders no bar and an empty status while idle', async () => {
    const {container} = await mountWith('idle');
    expect(container.querySelector('[data-navigation-progress]')).toBeNull();
    expect(container.querySelector('[role="status"]')?.textContent).toBe('');
  });

  it('shows the bar and announces it once a navigation has run past the delay', async () => {
    vi.useFakeTimers();
    try {
      const {container} = await mountWith('loading');
      expect(container.querySelector('[data-navigation-progress]')).toBeNull();
      act(() => void vi.advanceTimersByTime(160));
      expect(
        container.querySelector('[data-navigation-progress]'),
      ).not.toBeNull();
      expect(container.querySelector('[role="status"]')?.textContent).toBe(
        'Loading page',
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
