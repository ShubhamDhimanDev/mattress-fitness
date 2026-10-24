import type {ConsentStore} from '~/lib/analytics/consent-store';

/**
 * Where focus goes when the shopper answers the banner (NFR-003, WCAG 2.4.3). Accept, Reject or Save removes the banner
 * (and closes the dialog) while a control inside it has focus, so focus would fall to the start of the document. It
 * is moved to the main landmark (it has `tabindex="-1"`), without scrolling. It is moved only when the focus really
 * was in the banner or its dialog, or nowhere after an answer given here, so an answer given in another tab (picked up
 * by `refresh`) never takes focus away from what the shopper is doing here, nor claims it when there is none. Returns the remover.
 */
export function moveFocusAfterDecision(
  store: Pick<ConsentStore, 'getSnapshot' | 'subscribe' | 'lastSource'>,
  win: Window,
): () => void {
  let wasDecided = store.getSnapshot().decided;
  let pending: number | undefined;
  const unsubscribe = store.subscribe(() => {
    const decided = store.getSnapshot().decided;
    const justDecided = decided && !wasDecided;
    wasDecided = decided;
    if (
      !justDecided ||
      !focusIsInBanner(win.document, store.lastSource() === 'local')
    ) {
      return;
    }
    // After React has removed the banner and the dialog has handed focus back (to a control that no longer exists).
    pending = win.setTimeout(() => {
      try {
        win.document
          .querySelector<HTMLElement>('main')
          ?.focus({preventScroll: true});
      } catch {
        // Focus is a courtesy; never break the page for it.
      }
    }, 0);
  });
  return () => {
    unsubscribe();
    if (pending !== undefined) win.clearTimeout(pending);
  };
}

/**
 * Focus was in the banner or its dialog, or nowhere (the document body) and the answer was given HERE: then the control
 * that had focus is gone with the banner. With no focus and an answer read back from another tab, nothing is moved.
 */
function focusIsInBanner(doc: Document, local: boolean): boolean {
  const active = doc.activeElement;
  if (!active || active === doc.body) return local;
  return active.closest('[data-consent="banner"], [role="dialog"]') !== null;
}
