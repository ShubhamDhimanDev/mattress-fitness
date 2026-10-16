// Pure rules for the toast queue (P2-03): how long a toast stays, which live region announces it and how the
// stack is bounded. No framework imports so the rules are unit-tested on their own; the component is
// `components/ui/Toast.tsx`.

export const TOAST_VARIANTS = ['info', 'success', 'warning', 'error'] as const;
export type ToastVariant = (typeof TOAST_VARIANTS)[number];

/**
 * A toast that disappears by itself must stay long enough to read (WCAG 2.2.1 Timing Adjustable): no requested
 * duration is honoured below this, and the shopper can also pause it by hovering or focusing it.
 */
export const MIN_TOAST_DURATION_MS = 4000;
export const DEFAULT_TOAST_DURATION_MS = 6000;
/** After a pause the toast gets at least this long again, so it never vanishes the instant the pointer leaves. */
export const RESUME_FLOOR_MS = 2000;
/** More than this at once is noise; the oldest is dropped when a new one arrives. */
export const MAX_VISIBLE_TOASTS = 4;

export type ToastInput = {
  /** Reusing an id replaces the toast with that id instead of stacking a duplicate. */
  id?: string;
  variant?: ToastVariant;
  title?: string;
  message: string;
  /** Milliseconds until it closes by itself; `null` keeps it until dismissed. Raised to the minimum. */
  duration?: number | null;
};

export type ToastEntry = {
  id: string;
  /** Increases with every `show`, so a replaced toast is a new element: its timer restarts and it is announced again. */
  serial: number;
  variant: ToastVariant;
  title?: string;
  message: string;
  /** Resolved duration in ms, or null when the toast stays until dismissed. */
  duration: number | null;
};

/**
 * Milliseconds until auto-dismissal, or null for a toast that stays. Errors stay unless the caller asks
 * otherwise: a message that needs action must not vanish before it is read.
 */
export function toastDuration(
  variant: ToastVariant,
  requested?: number | null,
): number | null {
  if (requested === null) return null;
  if (requested === undefined || !Number.isFinite(requested)) {
    return variant === 'error' ? null : DEFAULT_TOAST_DURATION_MS;
  }
  return Math.max(MIN_TOAST_DURATION_MS, requested);
}

/** Errors interrupt (role="alert"); everything else waits its turn (role="status"). */
export function liveRegionFor(variant: ToastVariant): 'status' | 'alert' {
  return variant === 'error' ? 'alert' : 'status';
}

/** Time left to schedule when a paused toast resumes. */
export function resumeDelay(remainingMs: number): number {
  const remaining = Number.isFinite(remainingMs) ? remainingMs : 0;
  return Math.max(RESUME_FLOOR_MS, remaining);
}

export function toToastEntry(input: ToastInput, serial: number): ToastEntry {
  const variant = input.variant ?? 'info';
  return {
    id: input.id ?? `toast-${serial}`,
    serial,
    variant,
    title: input.title,
    message: input.message,
    duration: toastDuration(variant, input.duration),
  };
}

/** Adds a toast at the end of the stack (newest last), replacing one with the same id and capping the stack. */
export function enqueueToast(
  list: readonly ToastEntry[],
  entry: ToastEntry,
  max: number = MAX_VISIBLE_TOASTS,
): ToastEntry[] {
  const withoutSame = list.filter((item) => item.id !== entry.id);
  const next = [...withoutSame, entry];
  return next.length > max ? next.slice(next.length - max) : next;
}

export function dismissToast(
  list: readonly ToastEntry[],
  id: string,
): ToastEntry[] {
  return list.filter((item) => item.id !== id);
}
