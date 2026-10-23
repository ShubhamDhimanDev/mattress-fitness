// The consent-aware dispatcher between `track()` and the provider adapters (P7-01, NFR-011, NFR-013).
//
// Rules, each covered by a test:
//  1. Nothing is loaded or sent for a provider whose consent category is not allowed. An event that arrives then
//     is dropped; the one exception is the latest page_view, remembered in memory (never sent) so the page the
//     shopper is on is reported once they agree.
//  2. A provider script is loaded only after consent, and only when the browser is idle (`schedule`), so it never
//     competes with first paint, hydration or the shopper's first interaction.
//  3. Events that arrive while a consented provider is still loading are queued (bounded) and replayed in order.
//  4. A provider that fails to load (blocked, down, timed out) is marked failed for this visit, logged once with a
//     fixed vocabulary (no shopper data) and skipped. It never throws into the page and never retries in a loop.
//  5. Consent withdrawn mid-visit stops sending at once, asks the adapter to revoke and drops its queue; consent
//     given again re-enables the loaded adapter without loading the script a second time.

import type {AnalyticsEvent} from '~/lib/analytics';
import type {
  ProviderAdapter,
  ProviderFailureReason,
  ProviderLoadResult,
  ProviderId,
} from '~/lib/analytics/adapter';
import type {ConsentSnapshot} from '~/lib/analytics/consent-store';

export const MAX_QUEUED_EVENTS = 25;

type ProviderState = 'idle' | 'scheduled' | 'loading' | 'ready' | 'failed';

type Entry = {
  readonly adapter: ProviderAdapter;
  state: ProviderState;
  queue: AnalyticsEvent[];
  /** The consent last applied to this adapter. */
  active: boolean;
  cancelSchedule: (() => void) | null;
};

export type RuntimeOptions = {
  readonly adapters: readonly ProviderAdapter[];
  readonly consent: {
    readonly getSnapshot: () => ConsentSnapshot;
    readonly subscribe: (listener: () => void) => () => void;
  };
  /** Runs the callback when the browser is idle and returns the canceller (see `whenIdle`). */
  readonly schedule: (callback: () => void) => () => void;
  readonly onFailure?: (
    provider: ProviderId,
    reason: ProviderFailureReason,
  ) => void;
};

export type AnalyticsRuntime = {
  readonly track: (event: AnalyticsEvent) => void;
  readonly start: () => void;
  readonly stop: () => void;
  /** For tests and diagnostics: the state of each provider. */
  readonly states: () => Readonly<Record<string, ProviderState>>;
};

export function createAnalyticsRuntime(
  options: RuntimeOptions,
): AnalyticsRuntime {
  const entries: Entry[] = options.adapters.map((adapter) => ({
    adapter,
    state: 'idle',
    queue: [],
    active: false,
    cancelSchedule: null,
  }));
  let lastPageView: AnalyticsEvent | null = null;
  let unsubscribe: (() => void) | null = null;
  let stopped = false;

  function safely(action: () => void): void {
    try {
      action();
    } catch {
      // A provider error must never reach the page (NFR-013).
    }
  }

  function flush(entry: Entry): void {
    const pending = entry.queue;
    entry.queue = [];
    for (const event of pending) safely(() => entry.adapter.send(event));
  }

  function fail(entry: Entry, reason: ProviderFailureReason): void {
    entry.state = 'failed';
    entry.queue = [];
    safely(() => options.onFailure?.(entry.adapter.id, reason));
  }

  async function load(entry: Entry): Promise<void> {
    if (stopped) return;
    entry.state = 'loading';
    entry.cancelSchedule = null;
    let result: ProviderLoadResult;
    try {
      result = await entry.adapter.load();
    } catch {
      result = {status: 'failed', reason: 'error'};
    }
    if (stopped) return;
    if (result.status === 'failed') {
      fail(entry, result.reason);
      return;
    }
    entry.state = 'ready';
    // Consent may have been withdrawn while the script loaded.
    if (entry.active) {
      flush(entry);
    } else {
      entry.queue = [];
      safely(() => entry.adapter.revoke());
    }
  }

  function activate(entry: Entry): void {
    entry.active = true;
    if (entry.state === 'ready') {
      safely(() => entry.adapter.grant());
      return;
    }
    if (entry.state !== 'idle') return;
    // The page the shopper is on is reported once they agree; nothing older than that.
    if (lastPageView) entry.queue.push(lastPageView);
    entry.state = 'scheduled';
    entry.cancelSchedule = options.schedule(() => {
      void load(entry);
    });
  }

  function deactivate(entry: Entry): void {
    entry.active = false;
    entry.queue = [];
    if (entry.state === 'scheduled') {
      entry.cancelSchedule?.();
      entry.cancelSchedule = null;
      entry.state = 'idle';
    } else if (entry.state === 'ready') {
      safely(() => entry.adapter.revoke());
    }
    // 'loading': load() sees `active` is false when it finishes and revokes then.
  }

  function sync(): void {
    if (stopped) return;
    const {choice} = options.consent.getSnapshot();
    for (const entry of entries) {
      const allowed = choice[entry.adapter.category];
      if (allowed && !entry.active) activate(entry);
      else if (!allowed && entry.active) deactivate(entry);
    }
  }

  function track(event: AnalyticsEvent): void {
    if (stopped) return;
    if (event.name === 'page_view') lastPageView = event;
    for (const entry of entries) {
      if (!entry.active || entry.state === 'failed') continue;
      if (entry.state === 'ready') {
        safely(() => entry.adapter.send(event));
      } else if (entry.queue.length < MAX_QUEUED_EVENTS) {
        entry.queue.push(event);
      }
    }
  }

  return {
    track,
    start() {
      if (unsubscribe || stopped) return;
      unsubscribe = options.consent.subscribe(sync);
      sync();
    },
    stop() {
      stopped = true;
      unsubscribe?.();
      unsubscribe = null;
      for (const entry of entries) {
        entry.cancelSchedule?.();
        entry.queue = [];
      }
    },
    states: () =>
      Object.fromEntries(entries.map((e) => [e.adapter.id, e.state])),
  };
}
