import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
} from 'react';
import {cn} from '~/components/ui/cn';
import {IconButton} from '~/components/ui/IconButton';
import {AlertIcon, CheckIcon, CloseIcon, InfoIcon} from '~/components/ui/Icons';
import {
  dismissToast,
  enqueueToast,
  liveRegionFor,
  resumeDelay,
  toToastEntry,
  type ToastEntry,
  type ToastInput,
  type ToastVariant,
} from '~/lib/toast';

// Short, non-blocking confirmations ("Added to cart") and errors that do not need a dialog (P2-03).
//
// Accessibility: two live regions are always mounted, so a screen reader is already watching them when text
// arrives (WCAG 4.1.3): `role="status"` (polite) for info, success and warning, `role="alert"` (assertive) for
// errors. Hovering or focusing a toast pauses its timer (WCAG 2.2.1), it can be dismissed with its button or
// Escape, it never takes focus, and it carries an icon and text so meaning is not colour-only. Entry motion is
// `motion-safe` only. While a modal overlay is open the whole page, this region included, is inert, so a toast
// raised from inside an overlay should be shown after it closes.
//
// Use: `const {toasts, show, dismiss} = useToastQueue();`, render
// `<ToastRegion toasts={toasts} onDismiss={dismiss} />` once near the end of the page layout, and call
// `show({message: 'Added to cart', variant: 'success'})`.

type VariantStyle = {frame: string; Icon: typeof InfoIcon};

// Text and surface pairs are the documented ones in styles/tailwind.css (all at least 4.5:1).
const VARIANT: Record<ToastVariant, VariantStyle> = {
  // Neutral ink, not red: a red-tinted info toast looked almost the same as an error beside the brand red (UXD-19).
  // The error toast keeps its red frame, its alert icon and its assertive role; info has the info icon and is polite.
  info: {
    frame: 'border-ink-900 bg-ink-50 text-ink-900',
    Icon: InfoIcon,
  },
  success: {
    frame: 'border-success-fg bg-success-bg text-success-fg',
    Icon: CheckIcon,
  },
  warning: {
    frame: 'border-warning-fg bg-warning-bg text-warning-fg',
    Icon: AlertIcon,
  },
  error: {
    frame: 'border-error-fg bg-error-bg text-error-fg',
    Icon: AlertIcon,
  },
};

/** Calls `onExpire` after `duration` ms of un-paused time. A null duration never expires. */
function useAutoDismiss(
  duration: number | null,
  paused: boolean,
  onExpire: () => void,
) {
  const remaining = useRef(duration);
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  useEffect(() => {
    if (duration === null || paused) return;
    const wait = remaining.current ?? duration;
    const startedAt = Date.now();
    const timer = setTimeout(() => onExpireRef.current(), wait);
    return () => {
      clearTimeout(timer);
      remaining.current = resumeDelay(wait - (Date.now() - startedAt));
    };
  }, [duration, paused]);
}

type ToastProps = {
  toast: ToastEntry;
  onDismiss: (id: string) => void;
  dismissLabel: string;
};

function Toast({toast, onDismiss, dismissLabel}: ToastProps) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const dismiss = () => onDismiss(toast.id);
  useAutoDismiss(toast.duration, hovered || focused, dismiss);
  const {frame, Icon} = VARIANT[toast.variant];

  function onBlur(event: FocusEvent<HTMLDivElement>) {
    // Focus moving between the toast's own controls is not leaving it.
    if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
  }

  // The dismiss button is the toast's only tab stop, so Escape is handled there.
  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      dismiss();
    }
  }

  return (
    <div
      data-toast-variant={toast.variant}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={onBlur}
      className={cn(
        'pointer-events-auto mt-2 flex w-full max-w-md items-start gap-3 rounded-card border-2 py-1 pr-1 pl-4 shadow-lg motion-safe:animate-dialog-in',
        frame,
      )}
    >
      <Icon className="mt-3 size-5" />
      <div className="min-w-0 flex-1 py-3 text-sm">
        {toast.title ? <p className="font-bold">{toast.title}</p> : null}
        <p>{toast.message}</p>
      </div>
      <IconButton
        label={dismissLabel}
        icon={<CloseIcon className="size-5" />}
        onClick={dismiss}
        onKeyDown={onKeyDown}
      />
    </div>
  );
}

type LiveRole = 'status' | 'alert';

type ToastListProps = {
  role: LiveRole;
  toasts: readonly ToastEntry[];
  onDismiss: (id: string) => void;
  dismissLabel: string;
};

function ToastList({role, toasts, onDismiss, dismissLabel}: ToastListProps) {
  return (
    <div
      role={role}
      data-toast-region={role}
      aria-live={role === 'alert' ? 'assertive' : 'polite'}
      aria-atomic="false"
      aria-relevant="additions text"
      className="flex w-full flex-col items-center"
    >
      {toasts
        .filter((toast) => liveRegionFor(toast.variant) === role)
        .map((toast) => (
          <Toast
            key={`${toast.id}-${toast.serial}`}
            toast={toast}
            onDismiss={onDismiss}
            dismissLabel={dismissLabel}
          />
        ))}
    </div>
  );
}

type ToastRegionProps = {
  toasts: readonly ToastEntry[];
  onDismiss: (id: string) => void;
  /** Accessible name of each dismiss button. */
  dismissLabel?: string;
  className?: string;
};

/**
 * The stack. Render it once, always (not only while a toast exists), so the live regions are already in the
 * page when the first message arrives. Fixed to the bottom of the viewport above the overlays (z-60).
 */
export function ToastRegion({
  toasts,
  onDismiss,
  dismissLabel = 'Dismiss notification',
  className,
}: ToastRegionProps) {
  return (
    <div
      className={cn(
        'pointer-events-none fixed inset-x-0 bottom-0 z-60 flex flex-col items-center px-4 pb-4',
        className,
      )}
    >
      <ToastList
        role="status"
        toasts={toasts}
        onDismiss={onDismiss}
        dismissLabel={dismissLabel}
      />
      <ToastList
        role="alert"
        toasts={toasts}
        onDismiss={onDismiss}
        dismissLabel={dismissLabel}
      />
    </div>
  );
}

/** State for a `ToastRegion`. `show` returns the toast's id so a caller can dismiss it early. */
export function useToastQueue() {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const counter = useRef(0);

  const show = useCallback((input: ToastInput): string => {
    counter.current += 1;
    const entry = toToastEntry(input, counter.current);
    setToasts((current) => enqueueToast(current, entry));
    return entry.id;
  }, []);

  const dismiss = useCallback((id: string) => {
    setToasts((current) => dismissToast(current, id));
  }, []);

  return {toasts, show, dismiss};
}
