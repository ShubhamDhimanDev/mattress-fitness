import {useEffect, useSyncExternalStore} from 'react';
import {isCartActionResult} from '~/lib/cart/messages';

// The newest answer of the `/cart` action, reported by the component that submitted it (B-20).
//
// Why this exists: React Router removes a MOUNTED fetcher from `state.fetchers` as soon as it is idle again, before
// the render that could read it (react-router 7.16, `updateState`: `mountedFetchers.forEach(key =>
// state.fetchers.delete(key))`), so `useFetchers()` never shows a finished cart action. The submitting component's own
// `useFetcher().data` does survive, so that component reports it here and `CartMessages` (a different part of the page,
// for example the drawer or the buy box) reads it.
//
// A module-level store on purpose: the reporters and the readers sit in different subtrees, and a context provider
// would have to be mounted at the root and would silently do nothing wherever it was forgotten. Nothing is ever
// reported on the server (effects do not run there), so the server snapshot is always empty and requests cannot leak
// into each other.

export type CartResultSnapshot = {
  /** Counts results reported since the page loaded; 0 means none. */
  readonly seq: number;
  readonly data: Record<string, unknown> | null;
};

const EMPTY: CartResultSnapshot = {seq: 0, data: null};
let latest: CartResultSnapshot = EMPTY;
const listeners = new Set<() => void>();
// The same result object can be offered again (a remounted form, a second effect pass); it counts once.
let reported = new WeakSet<object>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot(): CartResultSnapshot {
  return latest;
}

/** The sequence number now: a reader remembers it at mount so older results are not shown to it. */
export function currentCartResultSeq(): number {
  return latest.seq;
}

export function reportCartResult(data: unknown): void {
  if (!isCartActionResult(data) || reported.has(data)) return;
  reported.add(data);
  latest = {seq: latest.seq + 1, data};
  listeners.forEach((listener) => listener());
}

export function useLatestCartResult(): CartResultSnapshot {
  return useSyncExternalStore(subscribe, snapshot, () => EMPTY);
}

/**
 * Call with a cart fetcher's `data`. Reported as soon as it is there, even while the fetcher is still reloading the
 * page data: a form that the reload removes (a deleted line) would otherwise be gone before it ever reached idle.
 */
export function useReportCartResult(data: unknown): void {
  useEffect(() => {
    reportCartResult(data);
  }, [data]);
}

export function resetCartResultsForTests(): void {
  latest = EMPTY;
  reported = new WeakSet();
  listeners.forEach((listener) => listener());
}
