import {
  Component,
  createContext,
  createElement,
  lazy,
  Suspense,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentType,
  type ReactNode,
} from 'react';
import {getFocusable} from '~/components/ui/Overlay';
import {logWarn} from '~/lib/logging/logger';

// Route-independent lazy loading for the shell's panels (P7-06): the cart drawer contents, the mobile menu, the
// ZIP form and the search suggestions are needed only after the shopper acts, so they leave the entry bundle.
// None of them is rendered on the server (the overlays mount their content on the client when opened), so no
// markup depends on these chunks for first paint, SEO or the no-JavaScript path (the cart link is a real /cart link).

/** Where the panel's download stands: not settled yet, downloaded, or the last attempt failed. */
export type PanelStatus = 'pending' | 'loaded' | 'failed';

export type PanelStatusSource = {
  /** For `useSyncExternalStore`; the listener runs when the status changes (a download finished or failed). */
  subscribe: (listener: () => void) => () => void;
  getStatus: () => PanelStatus;
};

export type LazyPanel<P extends object> = PanelStatusSource & {
  /** Renders the component; suspends only if its chunk has not been downloaded yet. */
  Panel: ComponentType<P>;
  /**
   * Starts the download. Safe to call repeatedly (hover, focus, pointer down, before opening). After a failure the
   * next preload is ignored for `RETRY_AFTER_FAILURE_MS`, so a handler that fires on every keystroke makes one
   * request per interval instead of one per event. Mounting the panel is always a new attempt.
   */
  preload: () => Promise<void>;
};

/** Shortest wait before `preload` tries a download again after one failed. */
export const RETRY_AFTER_FAILURE_MS = 5_000;

// Identifies one attempt to show a panel: a boundary's mount, renewed by its "Try again". Null outside a boundary.
const AttemptContext = createContext<object | null>(null);

/** The panel's status as React state: the component re-renders when a download finishes or fails. */
export function usePanelStatus(panel: PanelStatusSource): PanelStatus {
  // On the server nothing has been requested, so the status is "pending".
  return useSyncExternalStore(
    panel.subscribe,
    panel.getStatus,
    () => 'pending',
  );
}

/**
 * `React.lazy` plus a preload hook. When the chunk was preloaded before the panel mounts, the component renders
 * at once on the first pass instead of showing the fallback for a tick.
 */
export function createLazyPanel<P extends object>(
  load: () => Promise<ComponentType<P>>,
): LazyPanel<P> {
  let loaded: ComponentType<P> | null = null;
  let started: Promise<ComponentType<P>> | null = null;
  let status: PanelStatus = 'pending';
  let failedAt: number | null = null;
  const listeners = new Set<() => void>();
  function settle(next: PanelStatus) {
    if (status === next) return;
    status = next;
    for (const listener of listeners) listener();
  }

  // The lazy component takes the real props in one field: `lazy` cannot be typed over a generic props type directly.
  type Wrapped = {panelProps: P};
  const makeLazy = () =>
    lazy<ComponentType<Wrapped>>(() =>
      start().then((component) => ({
        default: ({panelProps}: Wrapped) =>
          createElement(component, panelProps),
      })),
    );
  // `React.lazy` keeps its rejected result for good, so one failed download would poison every later open of the
  // panel (QA-P7-L1). After a failure the next attempt gets a fresh lazy component and so a new download. An
  // "attempt" is one mount of a boundary, or one "Try again" inside it: React discards a suspended first render and
  // renders again when the chunk arrives or fails, so the choice must be remembered per attempt and cannot be
  // made in the render itself, or the failure would be retried in a loop instead of reaching the boundary.
  let Lazy = makeLazy();
  let lazyFailed = false;
  const lazyByAttempt = new WeakMap<object, typeof Lazy>();
  function lazyFor(attempt: object) {
    let chosen = lazyByAttempt.get(attempt);
    if (!chosen) {
      if (lazyFailed) {
        Lazy = makeLazy();
        lazyFailed = false;
      }
      chosen = Lazy;
      lazyByAttempt.set(attempt, chosen);
    }
    return chosen;
  }

  function start(): Promise<ComponentType<P>> {
    started ??= load().then(
      (component) => {
        loaded = component;
        settle('loaded');
        return component;
      },
      (error: unknown) => {
        // A failed download may be tried again by the next preload or open (a flaky network, a stale chunk after a deploy).
        started = null;
        lazyFailed = true;
        failedAt = Date.now();
        settle('failed');
        throw error;
      },
    );
    return started;
  }

  // Panels are always rendered inside a LazyBoundary, which supplies the attempt. Without one a failed download
  // cannot be retried (there is nobody to catch the error and renew the attempt), so say so while developing.
  const withoutBoundary: object = {};
  let warnedWithoutBoundary = false;
  function attemptOf(fromBoundary: object | null): object {
    if (fromBoundary) return fromBoundary;
    if (import.meta.env.DEV && !warnedWithoutBoundary) {
      warnedWithoutBoundary = true;
      // A fixed event name and no fields: the message is for the developer, and the logger keeps it structured.
      logWarn('lazy_panel.without_boundary');
    }
    return withoutBoundary;
  }

  function Panel(props: P) {
    const attempt = attemptOf(useContext(AttemptContext));
    // Decided once per mount, so the element type never changes under a mounted panel (that would remount it).
    const [chosen] = useState<
      {ready: ComponentType<P>} | {pending: typeof Lazy}
    >(() => (loaded ? {ready: loaded} : {pending: lazyFor(attempt)}));
    if ('ready' in chosen) {
      const Ready = chosen.ready;
      return <Ready {...props} />;
    }
    const Pending = chosen.pending;
    return <Pending panelProps={props} />;
  }

  return {
    Panel,
    // A failure is handled by the boundary around the panel; a preload has nobody to tell.
    preload: () => {
      const justFailed =
        failedAt !== null && Date.now() - failedAt < RETRY_AFTER_FAILURE_MS;
      if (!started && justFailed) return Promise.resolve();
      return start().then(
        () => undefined,
        () => undefined,
      );
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getStatus: () => status,
  };
}

type BoundaryProps = {
  /** Shown while the chunk downloads. Give it the panel's size so nothing shifts. */
  loading: ReactNode;
  /** Shown when the chunk cannot be loaded or the panel throws; it should offer a way forward. */
  failed: ReactNode;
  children: ReactNode;
};

/** What a "Try again" press leaves for the next thing that mounts, so focus can follow the shopper. */
type Handoff = {
  /** The dialog that held the pressed button; the press moved focus onto it, so the page behind was not reached. */
  dialog: HTMLElement | null;
};

type Retry = {
  /** Mounts the panel again, which starts a new download in place (no page reload). */
  retry: (dialog: HTMLElement | null) => void;
  /** Returns the pending focus handoff once (null if none), so only the first mount after a press acts on it. */
  takeHandoff: () => Handoff | null;
};

// Lets the failure message offer "Try again" without knowing which boundary it sits in; absent outside a boundary.
const RetryContext = createContext<Retry | null>(null);
// Lets the panel's successful re-mount take the handoff.
const HandoffContext = createContext<(() => Handoff | null) | null>(null);

class FailureBoundary extends Component<
  {failed: ReactNode; children: ReactNode},
  {hasFailed: boolean}
> {
  override state = {hasFailed: false};
  // Stable while a suspended panel renders again; replaced by "Try again" so the panel makes a new attempt.
  private attemptToken: object = {};
  private handoff: Handoff | null = null;

  static getDerivedStateFromError() {
    return {hasFailed: true};
  }

  // A fresh render of the failure message must not rebuild these, or every render would look like a new press.
  private readonly takeHandoff = () => {
    const taken = this.handoff;
    this.handoff = null;
    return taken;
  };

  private readonly retry = (dialog: HTMLElement | null) => {
    this.attemptToken = {};
    this.handoff = {dialog};
    this.setState({hasFailed: false});
  };

  private readonly retryApi: Retry = {
    retry: this.retry,
    takeHandoff: this.takeHandoff,
  };

  override render() {
    if (this.state.hasFailed) {
      return (
        <RetryContext.Provider value={this.retryApi}>
          {this.props.failed}
        </RetryContext.Provider>
      );
    }
    // The provider above is a different element type from the one used for the failure message, so React mounts the
    // panel afresh after a failure; a fresh mount picks up the renewed lazy component (see createLazyPanel).
    return (
      <AttemptContext.Provider value={this.attemptToken}>
        <HandoffContext.Provider value={this.takeHandoff}>
          {this.props.children}
        </HandoffContext.Provider>
      </AttemptContext.Provider>
    );
  }
}

/**
 * Rendered after the panel inside the Suspense boundary, so its effect runs only once the panel itself is on screen.
 * After a successful "Try again" the shopper's focus is still on the dialog container (the pressed button is gone),
 * so it moves to the first tabbable element in the dialog (Close; the ZIP form focuses its own field first, and
 * then there is nothing left to do). Focus that has gone anywhere else is left alone.
 */
function RetryFocus() {
  const takeHandoff = useContext(HandoffContext);
  useEffect(() => {
    const dialog = takeHandoff?.()?.dialog;
    if (dialog && document.activeElement === dialog) {
      getFocusable(dialog)[0]?.focus();
    }
  }, [takeHandoff]);
  return null;
}

/**
 * Suspense with a stable fallback, inside a boundary that keeps a failed download from taking the whole page
 * to the root error screen (NFR-013: the rest of the shell keeps working).
 */
export function LazyBoundary({loading, failed, children}: BoundaryProps) {
  return (
    <FailureBoundary failed={failed}>
      <Suspense fallback={loading}>
        {children}
        <RetryFocus />
      </Suspense>
    </FailureBoundary>
  );
}

const FAILED_ACTION_CLASSES =
  'inline-flex min-h-touch items-center font-bold text-primary-700 underline underline-offset-4';

function TryAgainButton({retry, takeHandoff}: Retry) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    // Only a press leaves a handoff, so a failure that happens later (a render error long after a good retry) does
    // not pull focus. When the retry fails again the pressed button is gone: keep the keyboard user where they were,
    // unless they have already moved focus elsewhere.
    const handoff = takeHandoff();
    if (!handoff) return;
    const active = document.activeElement;
    if (!active || active === document.body || active === handoff.dialog) {
      ref.current?.focus();
    }
  }, [takeHandoff]);
  return (
    <button
      ref={ref}
      type="button"
      onClick={(event) => {
        // The pressed button unmounts with the failure message; the dialog panel (tabIndex -1) takes focus so it
        // is not lost to the page behind (WCAG 2.4.3).
        const dialog =
          event.currentTarget.closest<HTMLElement>('[role="dialog"]');
        dialog?.focus();
        retry(dialog);
      }}
      className={FAILED_ACTION_CLASSES}
    >
      Try again
    </button>
  );
}

/**
 * The way forward when a panel cannot load. "Try again" (inside a lazy boundary) downloads the panel again in place.
 * If that fails too, a new document load fetches fresh HTML and chunks, which also repairs a stale chunk URL after a
 * deployment: with `href` it is a plain `a` (a full-page link on purpose), without one it is a button that reloads
 * the current page.
 */
export function PanelFailed({
  href,
  linkText,
}: {
  href?: string;
  linkText: string;
}) {
  const retry = useContext(RetryContext);
  return (
    <div role="alert" className="flex flex-col items-start gap-2 py-2">
      <p className="text-base text-fg">This panel could not be loaded.</p>
      <div className="flex flex-wrap items-center gap-x-6">
        {retry ? <TryAgainButton {...retry} /> : null}
        {href ? (
          <a href={href} className={FAILED_ACTION_CLASSES}>
            {linkText}
          </a>
        ) : (
          <button
            type="button"
            onClick={() => window.location.reload()}
            className={FAILED_ACTION_CLASSES}
          >
            {linkText}
          </button>
        )}
      </div>
    </div>
  );
}
