// A controllable consent store for the runtime tests. The app itself no longer has consent decisions (every provider
// always runs, owner decision 2026-11-14), but the runtime still honours a store that withdraws a category, so its
// tests drive that with this in-memory one.

import type {ConsentChoice} from '~/lib/analytics/consent';
import type {ConsentSnapshot} from '~/lib/analytics/consent-store';

type Options = {
  readonly mode?: 'opt-in' | 'opt-out';
  /** A decision already stored (the shape the app used to keep); read once at creation. */
  readonly storage?: {
    readonly read: () => string | null;
    readonly write?: (value: string) => void;
  };
};

const MAX_AGE_SECONDS = 180 * 24 * 60 * 60;

function storedChoice(raw: string | null | undefined): ConsentChoice | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return null;
    const analytics: unknown = Reflect.get(value, 'analytics');
    const marketing: unknown = Reflect.get(value, 'marketing');
    const decidedAt: unknown = Reflect.get(value, 'decidedAt');
    if (
      typeof analytics !== 'boolean' ||
      typeof marketing !== 'boolean' ||
      typeof decidedAt !== 'number' ||
      Date.now() / 1000 - decidedAt > MAX_AGE_SECONDS
    ) {
      return null;
    }
    return {analytics, marketing};
  } catch {
    return null;
  }
}

export function createConsentStore(options: Options = {}) {
  const listeners = new Set<() => void>();
  let snapshot: ConsentSnapshot = {
    choice:
      storedChoice(options.storage?.read()) ??
      (options.mode === 'opt-out'
        ? {analytics: true, marketing: true}
        : {analytics: false, marketing: false}),
  };
  const set = (choice: ConsentChoice) => {
    snapshot = {
      choice: {analytics: choice.analytics, marketing: choice.marketing},
    };
    for (const listener of [...listeners]) listener();
  };
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    acceptAll: () => set({analytics: true, marketing: true}),
    rejectAll: () => set({analytics: false, marketing: false}),
    save: (choice: ConsentChoice) => set(choice),
  };
}
