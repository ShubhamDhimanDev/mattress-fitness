import {useEffect, useRef, useSyncExternalStore} from 'react';
import {Link} from 'react-router';
import type {ChatCalloutProps} from '~/components/chat/chat-types';
import {ChatIcon} from '~/components/ui/Icons';
import {contactFallback} from '~/lib/chat/fallback';
import {chatHandle} from '~/lib/chat/handle';

/**
 * "Chat with us" (P7-03, REQ-ANL-004). A real button that opens the provider's widget. It exists only while chat is
 * loading or ready, so there is never a button with nothing behind it. If chat fails after the shopper pressed it, it
 * becomes a link to the contact page (keeping focus) or goes away; the polite live region beside it says what happened.
 * Returns the whole list item (button or link plus the live region), so a hidden call-out leaves no empty item in the list.
 */
export function ChatCallout({
  className,
  dense,
  links,
  onActivate,
}: ChatCalloutProps) {
  const view = useSyncExternalStore(
    chatHandle.subscribe,
    chatHandle.getView,
    chatHandle.getServerView,
  );
  const fallbackTo = contactFallback(links);
  const hadFocus = useRef(false);
  const fallback = useRef<HTMLAnchorElement>(null);

  // The button is replaced by a link; the shopper who was on it must not lose their place.
  useEffect(() => {
    if (view.phase === 'failed' && hadFocus.current) {
      hadFocus.current = false;
      fallback.current?.focus();
    }
  }, [view.phase]);

  if (view.phase === 'hidden') return null;
  return (
    <li>
      {view.phase === 'failed' ? (
        fallbackTo === null ? null : (
          <Link ref={fallback} to={fallbackTo} className={className}>
            Chat unavailable: contact us
          </Link>
        )
      ) : (
        <button
          type="button"
          className={className}
          aria-busy={view.busy || undefined}
          onFocus={() => {
            hadFocus.current = true;
          }}
          onBlur={() => {
            hadFocus.current = false;
          }}
          onClick={() => {
            onActivate?.();
            chatHandle.open();
          }}
        >
          <ChatIcon className={dense ? 'size-4' : 'size-5'} />
          Chat with us
        </button>
      )}
      {/* Inside the item so it exists whenever the call-out does: the text changes after the shopper pressed it. */}
      <span role="status" className="sr-only">
        {view.message}
      </span>
    </li>
  );
}
