// A tiny observable store for the consent decision (P7-01, NFR-011). No framework imports: React reads it with
// `useSyncExternalStore`, the analytics runtime reads it directly, and the tests drive it with a fake storage.
//
// The decision lives in memory first and in storage second. If storage is blocked or full, the choice still holds
// for the rest of the visit; it is simply asked again next time. Reading never throws.

import type {ConsentMode} from '~/lib/analytics/config';
import {
  ALLOW_ALL,
  CONSENT_POLICY_VERSION,
  DENY_ALL,
  effectiveChoice,
  parseStoredConsent,
  serializeConsent,
  type ConsentChoice,
  type StoredConsent,
} from '~/lib/analytics/consent';

export type ConsentStorage = {
  /** The raw stored text, or null. Must not throw. */
  readonly read: () => string | null;
  /** Best effort. Must not throw. */
  readonly write: (value: string) => void;
};

export type ConsentSnapshot = {
  /** True once the shopper has chosen (or a valid earlier choice was found). */
  readonly decided: boolean;
  /** What applies right now: the choice, or the mode's default while undecided. */
  readonly choice: ConsentChoice;
  /** The preferences dialog is open (the banner's "Choose" or a footer link opened it). */
  readonly preferencesOpen: boolean;
};

export type ConsentStore = {
  readonly getSnapshot: () => ConsentSnapshot;
  readonly subscribe: (listener: () => void) => () => void;
  /** Re-reads storage, for a change made in another tab. */
  readonly refresh: () => void;
  /** Where the last change of the decision came from: an answer given here, or one read back from storage. */
  readonly lastSource: () => 'local' | 'refresh' | null;
  readonly acceptAll: () => void;
  readonly rejectAll: () => void;
  readonly save: (choice: ConsentChoice) => void;
  readonly openPreferences: () => void;
  readonly closePreferences: () => void;
};

export type ConsentStoreOptions = {
  readonly mode: ConsentMode;
  readonly storage: ConsentStorage;
  /** Epoch seconds. */
  readonly nowSeconds?: () => number;
  /** Global Privacy Control; read each time because a browser setting can change. */
  readonly gpc?: () => boolean;
};

export function createConsentStore(options: ConsentStoreOptions): ConsentStore {
  const {mode, storage} = options;
  const now = options.nowSeconds ?? (() => Date.now() / 1000);
  const gpc = options.gpc ?? (() => false);
  const listeners = new Set<() => void>();

  let stored: StoredConsent | null = null;
  let preferencesOpen = false;
  let source: 'local' | 'refresh' | null = null;
  let snapshot: ConsentSnapshot;

  function compute(): ConsentSnapshot {
    return {
      decided: stored !== null,
      choice: effectiveChoice(mode, stored, gpc()),
      preferencesOpen,
    };
  }

  function sameSnapshot(a: ConsentSnapshot, b: ConsentSnapshot): boolean {
    return (
      a.decided === b.decided &&
      a.choice.analytics === b.choice.analytics &&
      a.choice.marketing === b.choice.marketing &&
      a.preferencesOpen === b.preferencesOpen
    );
  }

  // The snapshot object changes only when its content does, which is what useSyncExternalStore requires.
  function update(): void {
    const next = compute();
    if (sameSnapshot(snapshot, next)) return;
    snapshot = next;
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch {
        // A faulty listener must not stop the others or the page.
      }
    }
  }

  function readStored(): StoredConsent | null {
    try {
      return parseStoredConsent(storage.read(), now());
    } catch {
      return null;
    }
  }

  function decide(choice: ConsentChoice): void {
    const nowSeconds = now();
    stored = {
      version: CONSENT_POLICY_VERSION,
      analytics: choice.analytics,
      marketing: choice.marketing,
      decidedAt: Math.floor(nowSeconds),
    };
    try {
      storage.write(serializeConsent(choice, nowSeconds));
    } catch {
      // Kept in memory for this visit; asked again next time.
    }
    preferencesOpen = false;
    source = 'local';
    update();
  }

  stored = readStored();
  snapshot = compute();

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    refresh() {
      stored = readStored();
      source = 'refresh';
      update();
    },
    lastSource: () => source,
    acceptAll: () => decide(ALLOW_ALL),
    rejectAll: () => decide(DENY_ALL),
    save: (choice) =>
      decide({analytics: choice.analytics, marketing: choice.marketing}),
    openPreferences() {
      preferencesOpen = true;
      update();
    },
    closePreferences() {
      preferencesOpen = false;
      update();
    },
  };
}
