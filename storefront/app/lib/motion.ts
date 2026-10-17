// The scroll behaviour for script-driven scrolling (`scrollIntoView`, `scrollTo`, `scrollBy`). Every smooth scroll
// in the app goes through here so a shopper who asks for reduced motion (WCAG 2.3.3, NFR-003) gets an instant jump.
// Class-based motion uses Tailwind's `motion-safe:` variant instead; tests/unit/lib/motionSafeApp.test.ts guards both.

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/**
 * True when the shopper prefers reduced motion. Where the preference cannot be read (on the server, or without
 * `matchMedia`) it is treated as set: the safe answer cannot animate by mistake.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return true;
  if (typeof window.matchMedia !== 'function') return true;
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

/**
 * `'auto'` (an instant jump) under reduced motion, `'smooth'` otherwise. Read at call time, not at import, so a
 * change of the setting while the page is open takes effect.
 */
export function scrollBehavior(): 'auto' | 'smooth' {
  return prefersReducedMotion() ? 'auto' : 'smooth';
}
