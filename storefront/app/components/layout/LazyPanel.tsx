import {
  Component,
  createElement,
  lazy,
  Suspense,
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

/**
 * `React.lazy` plus a preload hook. When the chunk was preloaded before the panel mounts, the component renders
 * at once on the first pass instead of showing the fallback for a tick.
 */
export function createLazyPanel<P extends object>(
  load: () => Promise<ComponentType<P>>,
): LazyPanel<P> {
  let loaded: ComponentType<P> | null = null;
  let started: Promise<ComponentType<P>> | null = null;

  function start(): Promise<ComponentType<P>> {
    started ??= load().then(
      (component) => {
        loaded = component;
        return component;
      },
      (error: unknown) => {
        // A failed download may be tried again by the next preload (a flaky network, a stale chunk after a deploy).
        started = null;
        throw error;
      },
    );
    return started;
  }

  // The lazy component takes the real props in one field: `lazy` cannot be typed over a generic props type directly.
  type Wrapped = {panelProps: P};
  const Lazy = lazy<ComponentType<Wrapped>>(() =>
    start().then((component) => ({
      default: ({panelProps}: Wrapped) => createElement(component, panelProps),
    })),
  );

  function Panel(props: P) {
    // Decided once per mount, so the element type never changes under a mounted panel (that would remount it).
    const [Ready] = useState<ComponentType<P> | null>(() => loaded);
    return Ready ? <Ready {...props} /> : <Lazy panelProps={props} />;
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

class FailureBoundary extends Component<
  {failed: ReactNode; children: ReactNode},
  {hasFailed: boolean}
> {
  override state = {hasFailed: false};

  static getDerivedStateFromError() {
    return {hasFailed: true};
  }

  override render() {
    return this.state.hasFailed ? this.props.failed : this.props.children;
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

/**
 * The way forward when a panel cannot load. A new document load fetches fresh HTML and chunks, which also
 * repairs a stale chunk URL after a deployment: with `href` it is a plain `a` (a full-page link on purpose),
 * without one it is a button that reloads the current page.
 */
export function PanelFailed({
  href,
  linkText,
}: {
  href?: string;
  linkText: string;
}) {
  return (
    <div role="alert" className="flex flex-col items-start gap-2 py-2">
      <p className="text-base text-fg">This panel could not be loaded.</p>
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
  );
}
