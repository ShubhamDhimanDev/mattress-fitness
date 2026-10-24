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
//  6. Like the page view, the page's own view events (view_item, search, view_item_list) are remembered in memory for
//     the page the shopper is on, never sent, and replayed to a provider when it becomes active on that same page: a
//     shopper who agrees on a product page is counted as having viewed it. view_cart and every cart or click event
//     are not remembered (they are actions, not the page).
//  7. The safe-page guard (`page-context.ts`): on a page that fails the check (the private area, a personal-looking
//     address) no event is sent, no script is loaded and a loaded Google tag is paused; the next safe page resumes.
//     On a safe page the adapters get the reduced address, title and referrer (`setPage`).

import type {AnalyticsEvent} from '~/lib/analytics';
import type {
  ProviderAdapter,
  ProviderFailureReason,
  ProviderLoadResult,
  ProviderId,
} from '~/lib/analytics/adapter';
import type {ConsentSnapshot} from '~/lib/analytics/consent-store';
import type {PageContext, PageDecision} from '~/lib/analytics/page-context';

export const MAX_QUEUED_EVENTS = 25;
const MAX_REMEMBERED_EVENTS = 10;
const PAGE_SCOPED_EVENTS: ReadonlySet<string> = new Set([
  'view_item',
  'search',
  'view_item_list',
]);

type ProviderState = 'idle' | 'scheduled' | 'loading' | 'ready' | 'failed';

type Entry = {
  readonly adapter: ProviderAdapter;
  state: ProviderState;
  queue: AnalyticsEvent[];
  /** The consent last applied to this adapter. */
  active: boolean;
  /** The adapter was told the current page sends nothing. */
  paused: boolean;
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
  /** The safety verdict for the page the shopper is on now. Omitted: every page is safe (unit tests only). */
  readonly page?: () => PageDecision;
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

const ANY_PAGE: PageDecision = {safe: true, context: null};
const UNKNOWN_PAGE: PageDecision = {safe: false, reason: 'unreadable'};

export function createAnalyticsRuntime(
  options: RuntimeOptions,
): AnalyticsRuntime {
  const entries: Entry[] = options.adapters.map((adapter) => ({
    adapter,
    state: 'idle',
    queue: [],
    active: false,
    paused: false,
    cancelSchedule: null,
  }));
  let lastPageView: AnalyticsEvent | null = null;
  let lastContext: PageContext | null = null;
  // The page's own view events, with the address of the page they belong to.
  let remembered: {key: string; events: AnalyticsEvent[]} = {
    key: '',
    events: [],
  };
  let unsubscribe: (() => void) | null = null;
  let stopped = false;

  function safely(action: () => void): void {
    try {
      action();
    } catch {
      // A provider error must never reach the page (NFR-013).
    }
  }

  function currentPage(): PageDecision {
    if (!options.page) return ANY_PAGE;
    try {
      return options.page();
    } catch {
      return UNKNOWN_PAGE;
    }
  }

  /** Aligns a loaded adapter with the page: paused on a page that sends nothing, resumed on a safe one. */
  function applyPageState(entry: Entry, safe: boolean): void {
    if (entry.state !== 'ready' || !entry.active) return;
    if (!safe && !entry.paused) {
      entry.paused = true;
      safely(() => entry.adapter.pause?.());
    } else if (safe && entry.paused) {
      entry.paused = false;
      safely(() => entry.adapter.resume?.());
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
    // Consent may have been withdrawn, or the shopper may have moved to a private page, while the script loaded.
    if (!entry.active) {
      entry.queue = [];
      safely(() => entry.adapter.revoke());
      return;
    }
    if (!currentPage().safe) {
      entry.queue = [];
      applyPageState(entry, false);
      return;
    }
    flush(entry);
  }

  /**
   * Schedules the load for idle time. The page the shopper is on is reported once they agree, so its page_view
   * seeds the queue (unless it is the event being tracked right now, which the caller queues itself).
   */
  function keyOf(page: PageDecision): string {
    return page.safe ? (page.context?.pageLocation ?? '') : '';
  }

  function startLoad(entry: Entry, current?: AnalyticsEvent): void {
    if (entry.state !== 'idle') return;
    if (lastContext) {
      const context = lastContext;
      safely(() => entry.adapter.setPage?.(context));
    }
    if (lastPageView && lastPageView !== current) {
      entry.queue.push(lastPageView);
    }
    if (remembered.key === keyOf(currentPage())) {
      for (const event of remembered.events) {
        if (event !== current && entry.queue.length < MAX_QUEUED_EVENTS) {
          entry.queue.push(event);
        }
      }
    }
    entry.state = 'scheduled';
    entry.cancelSchedule = options.schedule(() => {
      void load(entry);
    });
  }

  function activate(entry: Entry): void {
    entry.active = true;
    entry.paused = false;
    if (entry.state === 'ready') {
      safely(() => entry.adapter.grant());
      applyPageState(entry, currentPage().safe);
      return;
    }
    // On a page that sends nothing the script stays unloaded; the next safe page_view starts it.
    if (currentPage().safe) startLoad(entry);
  }

  function deactivate(entry: Entry): void {
    entry.active = false;
    entry.paused = false;
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
    const page = currentPage();
    if (!page.safe) {
      // Nothing is sent from this page, nothing is remembered for it, and a loaded Google tag stops its own hits.
      lastPageView = null;
      lastContext = null;
      remembered = {key: '', events: []};
      for (const entry of entries) {
        entry.queue = [];
        applyPageState(entry, false);
      }
      return;
    }
    if (event.name === 'page_view') {
      lastPageView = event;
      lastContext = page.context;
    }
    for (const entry of entries) {
      if (!entry.active || entry.state === 'failed') continue;
      applyPageState(entry, true);
      const context = page.context;
      if (event.name === 'page_view' && context) {
        safely(() => entry.adapter.setPage?.(context));
      }
      startLoad(entry, event);
      if (entry.state === 'ready') {
        safely(() => entry.adapter.send(event));
      } else if (entry.queue.length < MAX_QUEUED_EVENTS) {
        entry.queue.push(event);
      }
    }
    // After the loop, so a provider that starts loading on this very event is not given it twice.
    if (PAGE_SCOPED_EVENTS.has(event.name)) {
      const key = keyOf(page);
      if (remembered.key !== key) remembered = {key, events: []};
      if (remembered.events.length < MAX_REMEMBERED_EVENTS) {
        remembered.events.push(event);
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
