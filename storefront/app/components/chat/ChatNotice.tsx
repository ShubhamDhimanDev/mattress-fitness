import {useEffect, useRef, useState, useSyncExternalStore} from 'react';
import {chatHandle} from '~/lib/chat/handle';

/**
 * The page-level voice of the chat (P7-03, NFR-003). Rendered into the document body by ChatShell, outside the header
 * (which is hidden below 1024 px) and outside the menu drawer (which unmounts when it closes), so a phone shopper hears
 * "Starting chat." and sees why chat did not start.
 *
 * - A polite live region (role="status", present from the first render so a later change is read out) carries the message.
 * - When chat is unavailable or could not be opened, a visible notice repeats it, with a link to the contact page when
 *   that page exists (contactTo, the root loader's existence rule) and a Dismiss button. If the call-out that was
 *   pressed has just gone away and focus fell to the page, focus moves to the notice; focus anywhere else is left alone.
 */
export function ChatNotice({contactTo}: {readonly contactTo: string | null}) {
  const view = useSyncExternalStore(
    chatHandle.subscribe,
    chatHandle.getView,
    chatHandle.getServerView,
  );
  const [dismissed, setDismissed] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const shown = view.alert && !dismissed;

  useEffect(() => {
    if (!view.alert) setDismissed(false);
  }, [view.alert]);

  useEffect(() => {
    if (!shown) return;
    const active = document.activeElement;
    if (!active || active === document.body) box.current?.focus();
  }, [shown]);

  return (
    <>
      <div role="status" className="sr-only">
        {view.message}
      </div>
      {shown ? (
        <div
          ref={box}
          tabIndex={-1}
          className="fixed inset-x-4 top-4 z-40 mx-auto flex max-w-dialog flex-col gap-2 rounded-panel border border-line bg-surface p-4 text-sm text-fg shadow-lg"
        >
          <p>{view.message}</p>
          <div className="flex flex-wrap items-center gap-x-6">
            {contactTo === null ? null : (
              <a
                href={contactTo}
                className="inline-flex min-h-touch items-center font-bold text-primary-700 underline underline-offset-4"
              >
                Contact us instead
              </a>
            )}
            <button
              type="button"
              onClick={() => setDismissed(true)}
              className="inline-flex min-h-touch items-center font-bold text-primary-700 underline underline-offset-4"
            >
              Dismiss
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
