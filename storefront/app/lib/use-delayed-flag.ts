import {useEffect, useRef, useState} from 'react';

/**
 * A busy flag that does not flicker. It turns on only after `showAfterMs` of continuous activity (a navigation that
 * answers in 100 ms never shows a loader), and once on it stays on for at least `minVisibleMs` (a loader that blinks for
 * 30 ms looks like a glitch, not feedback). Time is the only input, so it can be tested with fake timers.
 */
export function useDelayedFlag(
  active: boolean,
  showAfterMs = 150,
  minVisibleMs = 400,
): boolean {
  const [visible, setVisible] = useState(false);
  const shownAt = useRef(0);

  useEffect(() => {
    if (active) {
      if (visible) return;
      const timer = setTimeout(() => {
        shownAt.current = Date.now();
        setVisible(true);
      }, showAfterMs);
      return () => clearTimeout(timer);
    }
    if (!visible) return;
    const remaining = Math.max(
      0,
      minVisibleMs - (Date.now() - shownAt.current),
    );
    const timer = setTimeout(() => setVisible(false), remaining);
    return () => clearTimeout(timer);
  }, [active, visible, showAfterMs, minVisibleMs]);

  return visible;
}
