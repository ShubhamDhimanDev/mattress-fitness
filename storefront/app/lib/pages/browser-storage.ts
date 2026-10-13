// Browser storage that never throws. Reading `window.localStorage` itself can
// raise a SecurityError (blocked cookies, some private modes), and the server
// has no window at all, so both cases return null and callers carry on without
// saving. The shape is the same small interface the quiz storage module uses.

import type {KeyValueStorage} from '~/lib/quiz/storage';

function pick(read: (target: Window) => Storage): KeyValueStorage | null {
  if (typeof window === 'undefined') return null;
  try {
    return read(window);
  } catch {
    return null;
  }
}

/** Remembers across visits: quiz results, comparison selection. */
export function getLocalStorage(): KeyValueStorage | null {
  return pick((target) => target.localStorage);
}

/** Lasts for the tab only: quiz run bookkeeping for analytics. */
export function getSessionStorage(): KeyValueStorage | null {
  return pick((target) => target.sessionStorage);
}
