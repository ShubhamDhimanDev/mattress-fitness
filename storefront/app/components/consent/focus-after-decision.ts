import type {ConsentStore} from '~/lib/analytics/consent-store';

/**
 * Where focus goes when the shopper answers the banner (NFR-003, WCAG 2.4.3). Accept, Reject or Save removes the banner
 * (and closes the dialog) while a control inside it has focus, so focus would fall to the start of the document. It
 * is moved to the main landmark (it has `tabindex="-1"`), without scrolling. It is moved only when the focus really
 * was in the banner or its dialog, or nowhere, so an answer given in another tab (picked up by `refresh`) never takes
 * focus away from what the shopper is doing here. Returns the remover.
 */
export function moveFocusAfterDecision(
  store: Pick<ConsentStore, 'getSnapshot' | 'subscribe'>,
  win: Window,
): () => void {
  let wasDecided = store.getSnapshot().decided;
  let pending: number | undefined;
  const unsubscribe = store.subscribe(() => {
    const decided = store.getSnapshot().decided;
    const justDecided = decided && !wasDecided;
    wasDecided = decided;
    if (!justDecided || !focusIsInBanner(win.document)) return;
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

function focusIsInBanner(doc: Document): boolean {
  const active = doc.activeElement;
  if (!active || active === doc.body) return true;
  return active.closest('[data-consent="banner"], [role="dialog"]') !== null;
}
