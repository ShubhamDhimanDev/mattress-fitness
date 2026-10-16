// Runs a callback when the browser is idle, after first paint and hydration have had their turn. Returns the
// function that cancels it (for an effect cleanup). `requestIdleCallback` is missing in Safari, where a short
// timeout stands in; the `timeout` option bounds the wait on a busy page.

const IDLE_TIMEOUT_MS = 3000;
const FALLBACK_DELAY_MS = 1500;

export function whenIdle(callback: () => void): () => void {
  if (typeof window.requestIdleCallback === 'function') {
    const handle = window.requestIdleCallback(callback, {
      timeout: IDLE_TIMEOUT_MS,
    });
    return () => window.cancelIdleCallback(handle);
  }
  const handle = window.setTimeout(callback, FALLBACK_DELAY_MS);
  return () => window.clearTimeout(handle);
}
