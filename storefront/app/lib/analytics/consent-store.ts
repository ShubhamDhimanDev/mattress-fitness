// The consent store is now a constant: every category is allowed (owner decision 2026-11-14, see consent.ts).
// The shape is kept so the runtime, the chat gate and the Affirm gate read it exactly as before.

import {ALLOW_ALL, type ConsentChoice} from '~/lib/analytics/consent';

export type ConsentSnapshot = {
  readonly choice: ConsentChoice;
};

export type ConsentStore = {
  readonly getSnapshot: () => ConsentSnapshot;
  /** Nothing ever changes, so nothing is ever called; kept because React's `useSyncExternalStore` and the runtime subscribe. */
  readonly subscribe: (listener: () => void) => () => void;
};

const SNAPSHOT: ConsentSnapshot = {choice: ALLOW_ALL};

export function createAlwaysAllowedStore(): ConsentStore {
  return {
    getSnapshot: () => SNAPSHOT,
    subscribe: () => () => undefined,
  };
}
