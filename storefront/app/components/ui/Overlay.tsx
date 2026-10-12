import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import {createPortal} from 'react-dom';
import {cn} from '~/components/ui/cn';

// Shared behaviour of Drawer and Dialog: a modal layer that traps focus, closes on Escape, locks page
// scroll, hides the rest of the page from assistive technology, and gives focus back when it closes
// (WAI-ARIA dialog pattern, WCAG 2.1.2, 2.4.3). No library is added for this (phase 2 note: an ADR is
// recorded by the orchestrator); the behaviour is covered by tests/unit/ui/Overlay.test.tsx.

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'summary',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/** Tabbable descendants in DOM order, skipping anything hidden or inert. */
export function getFocusable(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter((element) => {
    if (element.closest('[hidden], [inert]')) return false;
    // checkVisibility is missing in jsdom; there every element counts as visible.
    return typeof element.checkVisibility === 'function'
      ? element.checkVisibility()
      : true;
  });
}

// Only the top-most overlay reacts to the keyboard.
const overlayStack: symbol[] = [];

let scrollLocks = 0;
let overflowBeforeLock = '';

function lockScroll() {
  if (scrollLocks === 0) {
    overflowBeforeLock = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  scrollLocks += 1;
}

function unlockScroll() {
  scrollLocks = Math.max(0, scrollLocks - 1);
  if (scrollLocks === 0) document.body.style.overflow = overflowBeforeLock;
}

/** Marks every other child of <body> inert and returns the function that undoes exactly that. */
function makeOthersInert(host: HTMLElement): () => void {
  const changed: Element[] = [];
  for (const child of Array.from(document.body.children)) {
    if (
      child === host ||
      child.tagName === 'SCRIPT' ||
      child.hasAttribute('inert')
    ) {
      continue;
    }
    child.setAttribute('inert', '');
    changed.push(child);
  }
  return () => {
    for (const element of changed) element.removeAttribute('inert');
  };
}

export type OverlayPlacement = 'center' | 'left' | 'right';

type OverlayProps = {
  open: boolean;
  onClose: () => void;
  /** Id of the element that names the dialog. */
  labelledBy: string;
  describedBy?: string;
  placement: OverlayPlacement;
  /** Element to focus on open; defaults to the first tabbable element in the panel. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  closeOnBackdrop?: boolean;
  children: ReactNode;
};

const WRAPPER: Record<OverlayPlacement, string> = {
  center: 'flex items-center justify-center p-4',
  left: '',
  right: '',
};

const PANEL: Record<OverlayPlacement, string> = {
  center:
    'flex max-h-full w-full max-w-dialog flex-col overflow-hidden rounded-panel bg-surface shadow-lg animate-dialog-in',
  left: 'absolute inset-y-0 left-0 flex w-full max-w-drawer flex-col bg-surface shadow-drawer animate-drawer-in-left',
  right:
    'absolute inset-y-0 right-0 flex w-full max-w-drawer flex-col bg-surface shadow-drawer animate-drawer-in-right',
};

export function Overlay({open, children, ...rest}: OverlayProps) {
  const [host, setHost] = useState<HTMLElement | null>(null);

  // The host element is created on open and removed on close, so a closed overlay leaves nothing in the DOM.
  useEffect(() => {
    if (!open) return;
    const element = document.createElement('div');
    element.setAttribute('data-overlay-host', '');
    document.body.appendChild(element);
    setHost(element);
    return () => {
      element.remove();
      setHost(null);
    };
  }, [open]);

  if (!open || !host) return null;
  return createPortal(
    <OverlayContent host={host} {...rest}>
      {children}
    </OverlayContent>,
    host,
  );
}

type OverlayContentProps = Omit<OverlayProps, 'open'> & {host: HTMLElement};

function OverlayContent({
  host,
  onClose,
  labelledBy,
  describedBy,
  placement,
  initialFocusRef,
  closeOnBackdrop = true,
  children,
}: OverlayContentProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const pressStartedOnBackdrop = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;

    const token = Symbol('overlay');
    const returnTo =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    overlayStack.push(token);
    lockScroll();
    const restoreOthers = makeOthersInert(host);

    (initialFocusRef?.current ?? getFocusable(panel)[0] ?? panel).focus();

    function onKeyDown(event: KeyboardEvent) {
      if (overlayStack[overlayStack.length - 1] !== token || !panel) return;

      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = getFocusable(panel);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const active = document.activeElement;
      if (!(active instanceof Node) || !panel.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && (active === first || active === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      overlayStack.splice(overlayStack.indexOf(token), 1);
      restoreOthers();
      unlockScroll();
      // Inert is lifted first: an inert element cannot take focus back.
      if (returnTo?.isConnected) returnTo.focus();
    };
    // Mount-only on purpose: the overlay exists exactly while it is open, and the latest onClose is read
    // through a ref so a new callback each render does not restart focus handling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    // The backdrop is a pointer convenience; keyboard users close with Escape or the Close button.
    <div
      role="presentation"
      className={cn(
        'fixed inset-0 z-50 animate-fade-in bg-ink-900/60',
        WRAPPER[placement],
      )}
      onMouseDown={(event) => {
        pressStartedOnBackdrop.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        // Both press and release on the backdrop, so a text selection that ends outside does not close.
        if (
          closeOnBackdrop &&
          pressStartedOnBackdrop.current &&
          event.target === event.currentTarget
        ) {
          onClose();
        }
        pressStartedOnBackdrop.current = false;
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        tabIndex={-1}
        className={PANEL[placement]}
      >
        {children}
      </div>
    </div>
  );
}
