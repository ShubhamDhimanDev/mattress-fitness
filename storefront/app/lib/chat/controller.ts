// The chat state machine (P7-03, REQ-ANL-004, NFR-011, NFR-013). Pure: the provider, the timer and the failure sink are
// injected, so every path is unit-tested without a browser.
//
//   waiting  - not allowed (no consent yet, or withdrawn): nothing loaded, nothing visible
//   loading  - allowed; the provider's script is being added
//   ready    - the widget can be opened
//   failed   - the provider could not be created, loaded or confirmed; stays failed for the visit (no retry loop)
//
// Rules, each with a test:
//  - a failure (rejected load, timeout, a throwing adapter, a missing adapter) hides chat and nothing else, and reports
//    one fixed reason word to `onFailure`; it never throws into the page (NFR-013);
//  - `requestOpen` while loading is remembered and honoured the moment the widget is ready; while failed it only
//    records that the shopper asked, so the call-out can offer the contact page instead of a dead button;
//  - withdrawing consent unloads the provider (or reports that it cannot), also when it happens during the load;
//  - a fresh grant after a withdrawal or a failure tries once more (the shopper did something; there is no timer loop).

import type {ChatProvider} from '~/lib/chat/provider';

export type ChatPhase = 'waiting' | 'loading' | 'ready' | 'failed';
export type ChatNotice = 'starting' | 'unavailable' | 'open_failed' | null;

export type ChatState = {
  readonly phase: ChatPhase;
  /** The shopper pressed the call-out and has not been served yet. */
  readonly requested: boolean;
  /** What the polite live region should say, as a code; the text is the UI's. */
  readonly notice: ChatNotice;
};

/** Fixed words only: which step failed, never anything about the shopper or the vendor's reply. */
export type ChatFailureReason =
  | 'create_failed'
  | 'load_failed'
  | 'load_timeout'
  | 'not_ready'
  | 'open_threw'
  | 'unload_unsupported'
  | 'unload_threw';

export type ChatControllerOptions = {
  /** Builds the provider (the registry). Null or a rejection means it cannot run here. */
  readonly create: () => Promise<ChatProvider | null>;
  readonly onFailure: (reason: ChatFailureReason) => void;
  /** How long `load()` may take before the provider counts as failed. */
  readonly loadTimeoutMs?: number;
};

export type ChatController = {
  readonly getState: () => ChatState;
  readonly subscribe: (listener: () => void) => () => void;
  /** The shopper's consent (or, with no consent required, "always true"). Idempotent. */
  readonly setAllowed: (allowed: boolean) => void;
  readonly requestOpen: () => void;
  /** Unloads and forgets every listener: a changed configuration, or a test starting over. */
  readonly stop: () => void;
};

export const DEFAULT_LOAD_TIMEOUT_MS = 10_000;

const INITIAL: ChatState = {phase: 'waiting', requested: false, notice: null};

class LoadTimeout extends Error {}

function withTimeout(work: Promise<void>, ms: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new LoadTimeout()), ms);
    work.then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error('load rejected'));
      },
    );
  });
}

export function createChatController(
  options: ChatControllerOptions,
): ChatController {
  const timeoutMs = options.loadTimeoutMs ?? DEFAULT_LOAD_TIMEOUT_MS;
  const listeners = new Set<() => void>();
  let state: ChatState = INITIAL;
  let allowed = false;
  // Bumped by every start and every withdrawal; a step that finds it changed was overtaken and stands down.
  let generation = 0;
  let provider: ChatProvider | null = null;

  function report(reason: ChatFailureReason): void {
    try {
      options.onFailure(reason);
    } catch {
      // A broken failure sink must not break the page.
    }
  }

  function update(patch: Partial<ChatState>): void {
    const next = {...state, ...patch};
    if (
      next.phase === state.phase &&
      next.requested === state.requested &&
      next.notice === state.notice
    ) {
      return;
    }
    state = next;
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch {
        // A faulty listener must not stop the others or the page.
      }
    }
  }

  /** Removes what the provider added. An adapter without `unload` cannot honour a withdrawal: say so. */
  function teardown(): void {
    if (provider === null) return;
    if (provider.unload === undefined) {
      report('unload_unsupported');
      return;
    }
    try {
      provider.unload();
    } catch {
      report('unload_threw');
    }
  }

  function fail(reason: ChatFailureReason): void {
    // A shopper who asked is told once; a passive failure stays silent.
    update({phase: 'failed', notice: state.requested ? 'unavailable' : null});
    teardown();
    report(reason);
  }

  function openNow(): void {
    if (provider === null) return;
    try {
      provider.open();
      update({requested: false, notice: null});
    } catch {
      report('open_threw');
      update({requested: false, notice: 'open_failed'});
    }
  }

  async function start(): Promise<void> {
    const mine = ++generation;
    update({phase: 'loading', notice: state.requested ? 'starting' : null});
    try {
      provider ??= await options.create();
    } catch {
      if (mine === generation) fail('create_failed');
      return;
    }
    if (mine !== generation) return;
    if (provider === null) {
      fail('create_failed');
      return;
    }
    try {
      await withTimeout(provider.load(), timeoutMs);
    } catch (error) {
      if (mine !== generation) return;
      fail(error instanceof LoadTimeout ? 'load_timeout' : 'load_failed');
      return;
    }
    if (mine !== generation) {
      // Consent was withdrawn while the script loaded: take it out again. (A newer start is already running when
      // consent came back; an adapter's `load` is idempotent, so that one finishes the job.)
      if (!allowed) teardown();
      return;
    }
    if (!provider.isReady()) {
      fail('not_ready');
      return;
    }
    update({phase: 'ready'});
    if (state.requested) openNow();
  }

  function withdraw(): void {
    generation += 1;
    const hadSomethingLoaded =
      state.phase === 'loading' || state.phase === 'ready';
    update({phase: 'waiting', requested: false, notice: null});
    if (hadSomethingLoaded) teardown();
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setAllowed(next) {
      if (next === allowed) return;
      allowed = next;
      if (next) void start();
      else withdraw();
    },
    requestOpen() {
      switch (state.phase) {
        case 'ready':
          openNow();
          return;
        case 'loading':
          update({requested: true, notice: 'starting'});
          return;
        case 'failed':
          update({requested: true, notice: 'unavailable'});
          return;
        case 'waiting':
          return;
        default: {
          const unreachable: never = state.phase;
          throw new Error(`unhandled phase ${String(unreachable)}`);
        }
      }
    },
    stop() {
      // Listeners first: a stopped controller is being replaced, and nobody should be told about its last transition.
      listeners.clear();
      allowed = false;
      withdraw();
    },
  };
}
