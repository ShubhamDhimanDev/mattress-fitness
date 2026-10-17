import {
  Component,
  createContext,
  createElement,
  Fragment,
  lazy,
  Suspense,
  useContext,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react';

// Route-independent lazy loading for the shell's panels (P7-06): the cart drawer contents, the mobile menu, the
// ZIP form and the search suggestions are needed only after the shopper acts, so they leave the entry bundle.
// None of them is rendered on the server (the overlays mount their content on the client when opened), so no
// markup depends on these chunks for first paint, SEO or the no-JavaScript path (the cart link is a real /cart link).

export type LazyPanel<P extends object> = {
  /** Renders the component; suspends only if its chunk has not been downloaded yet. */
  Panel: ComponentType<P>;
  /** Starts the download. Safe to call repeatedly (hover, focus, pointer down, idle time, before opening). */
  preload: () => Promise<void>;
};

// Identifies one attempt to show a panel: a boundary's mount, renewed by its "Try again". Panels outside a boundary
// share the default.
const AttemptContext = createContext<object>({});

/**
 * `React.lazy` plus a preload hook. When the chunk was preloaded before the panel mounts, the component renders
 * at once on the first pass instead of showing the fallback for a tick.
 */
export function createLazyPanel<P extends object>(
  load: () => Promise<ComponentType<P>>,
): LazyPanel<P> {
  let loaded: ComponentType<P> | null = null;
  let started: Promise<ComponentType<P>> | null = null;

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
        return component;
      },
      (error: unknown) => {
        // A failed download may be tried again by the next preload or open (a flaky network, a stale chunk after a deploy).
        started = null;
        lazyFailed = true;
        throw error;
      },
    );
    return started;
  }

  function Panel(props: P) {
    const attempt = useContext(AttemptContext);
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
    preload: () =>
      start().then(
        () => undefined,
        () => undefined,
      ),
  };
}

type BoundaryProps = {
  /** Shown while the chunk downloads. Give it the panel's size so nothing shifts. */
  loading: ReactNode;
  /** Shown when the chunk cannot be loaded or the panel throws; it should offer a way forward. */
  failed: ReactNode;
  children: ReactNode;
};

type Retry = {
  /** Mounts the panel again, which starts a new download in place (no page reload). */
  retry: () => void;
  /** True once the shopper has pressed "Try again" at least once, so focus can be put back on the new button. */
  retried: boolean;
};

// Lets the failure message offer "Try again" without knowing which boundary it sits in; absent outside a boundary.
const RetryContext = createContext<Retry | null>(null);

class FailureBoundary extends Component<
  {failed: ReactNode; children: ReactNode},
  {hasFailed: boolean; attempt: number}
> {
  override state = {hasFailed: false, attempt: 0};
  // Stable while a suspended panel renders again; replaced by "Try again" so the panel makes a new attempt.
  private attemptToken: object = {};

  static getDerivedStateFromError() {
    return {hasFailed: true};
  }

  retry = () => {
    this.attemptToken = {};
    this.setState((state) => ({hasFailed: false, attempt: state.attempt + 1}));
  };

  override render() {
    if (this.state.hasFailed) {
      return (
        <RetryContext.Provider
          value={{retry: this.retry, retried: this.state.attempt > 0}}
        >
          {this.props.failed}
        </RetryContext.Provider>
      );
    }
    // A new key mounts the panel afresh, and a fresh mount picks up the renewed lazy component (see createLazyPanel).
    return (
      <AttemptContext.Provider value={this.attemptToken}>
        <Fragment key={this.state.attempt}>{this.props.children}</Fragment>
      </AttemptContext.Provider>
    );
  }
}

/**
 * Suspense with a stable fallback, inside a boundary that keeps a failed download from taking the whole page
 * to the root error screen (NFR-013: the rest of the shell keeps working).
 */
export function LazyBoundary({loading, failed, children}: BoundaryProps) {
  return (
    <FailureBoundary failed={failed}>
      <Suspense fallback={loading}>{children}</Suspense>
    </FailureBoundary>
  );
}

const FAILED_ACTION_CLASSES =
  'inline-flex min-h-touch items-center font-bold text-primary-700 underline underline-offset-4';

function TryAgainButton({retry, retried}: Retry) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    // The button that was pressed is gone when the retry fails again; keep the keyboard user where they were.
    if (retried) ref.current?.focus();
  }, [retried]);
  return (
    <button
      ref={ref}
      type="button"
      onClick={(event) => {
        // The pressed button unmounts with the failure message; the dialog panel (tabIndex -1) takes focus so it
        // is not lost to the page behind (WCAG 2.4.3).
        event.currentTarget.closest<HTMLElement>('[role="dialog"]')?.focus();
        retry();
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
