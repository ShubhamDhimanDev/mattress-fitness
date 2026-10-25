import {ChatCallout} from '~/components/chat/ChatCallout';
import type {ChatEntryProps} from '~/components/chat/chat-types';
import {ChatShell} from '~/components/chat/ChatShell';
import {contactFallback} from '~/lib/chat/fallback';
import type {UtilityLink} from '~/lib/navigation';

function isChat(link: UtilityLink): boolean {
  return link.id === 'chat';
}

/**
 * The one lazy entry to the chat UI (P7-03): the gate (`ChatShell`, no markup) and the call-out are two parts of a
 * single chunk, so a store with a provider downloads one extra file and the initial JavaScript names one dynamic import
 * (bundle budget, scripts/perf). The header bar's instance carries `consent`, and finds the provider in the chat link; the mobile menu's does not.
 */
export function ChatEntry({consent, ...callout}: ChatEntryProps) {
  const config = consent && callout.links.find(isChat)?.chat;
  return (
    <>
      {config && consent ? (
        <ChatShell
          config={config}
          consent={consent}
          contactTo={contactFallback(callout.links)}
        />
      ) : null}
      <ChatCallout
        className={callout.className}
        dense={callout.dense}
        onActivate={callout.onActivate}
      />
    </>
  );
}
