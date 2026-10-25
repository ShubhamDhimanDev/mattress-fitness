import {useSyncExternalStore} from 'react';
import type {ChatCalloutProps} from '~/components/chat/chat-types';
import {ChatIcon} from '~/components/ui/Icons';
import {chatHandle} from '~/lib/chat/handle';

/**
 * "Chat with us" (P7-03, REQ-ANL-004). A real button that opens the provider's widget. It exists only while chat is
 * loading or ready, so there is never a button with nothing behind it; if chat fails after the shopper pressed it, it
 * goes away and the page-level notice (`ChatNotice`) says why and offers the contact page. Returns the whole list item, so
 * a hidden call-out leaves no empty item in the list.
 */
export function ChatCallout({className, dense, onActivate}: ChatCalloutProps) {
  const view = useSyncExternalStore(
    chatHandle.subscribe,
    chatHandle.getView,
    chatHandle.getServerView,
  );
  if (view.phase !== 'loading' && view.phase !== 'ready') return null;
  return (
    <li>
      <button
        type="button"
        className={className}
        aria-busy={view.busy || undefined}
        onClick={() => {
          if (onActivate === undefined) {
            chatHandle.open();
            return;
          }
          // Opened from the menu drawer: let the drawer close and give focus back first (its cleanup runs when the close
          // is committed), then open the widget, so focus lands in the widget and not on the menu button behind it. The
          // drawer made the rest of the page inert while it was open; the widget is not opened into that state.
          onActivate();
          setTimeout(chatHandle.open, 0);
        }}
      >
        <ChatIcon className={dense ? 'size-4' : 'size-5'} />
        Chat with us
      </button>
    </li>
  );
}
