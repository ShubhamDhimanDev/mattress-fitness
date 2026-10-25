// What the page shell shows of the chat (P7-03): a small, framework-free view derived from the controller's state. The
// shell (initial JavaScript) imports only the TYPE from here; the lazy chunk imports the function. Text is fixed, plain
// English, and says nothing about the vendor or the shopper.

import type {ChatNotice, ChatState} from '~/lib/chat/controller';

export type ChatView = {
  /**
   * hidden: no call-out. loading and ready: a button. failed: only after the shopper pressed it, a link to the contact
   * page instead (a passive failure just hides chat).
   */
  readonly phase: 'hidden' | 'loading' | 'ready' | 'failed';
  /** The shopper pressed the call-out and is waiting. */
  readonly busy: boolean;
  /** For the polite live region; empty says nothing. */
  readonly message: string;
};

export const HIDDEN_CHAT_VIEW: ChatView = {
  phase: 'hidden',
  busy: false,
  message: '',
};

const NOTICE_TEXT: Readonly<Record<Exclude<ChatNotice, null>, string>> = {
  starting: 'Starting chat.',
  unavailable: 'Chat is unavailable right now.',
  open_failed: 'Chat could not be opened. Please try again.',
};

export function toChatView(state: ChatState): ChatView {
  const message = state.notice === null ? '' : NOTICE_TEXT[state.notice];
  switch (state.phase) {
    case 'waiting':
      return HIDDEN_CHAT_VIEW;
    case 'loading':
      return {phase: 'loading', busy: state.requested, message};
    case 'ready':
      return {phase: 'ready', busy: false, message};
    case 'failed':
      return state.requested
        ? {phase: 'failed', busy: false, message}
        : HIDDEN_CHAT_VIEW;
    default: {
      const unreachable: never = state.phase;
      throw new Error(`unhandled phase ${String(unreachable)}`);
    }
  }
}
