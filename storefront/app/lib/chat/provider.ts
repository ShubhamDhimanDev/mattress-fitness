// The contract every chat provider adapter implements (P7-03, REQ-ANL-004). The page never talks to a vendor: it talks to
// a controller (`controller.ts`) that drives one of these. Swapping the provider (Q-011) is a new adapter and a
// registry line, not a change to the call-outs.

import type {ChatProviderId} from '~/lib/chat/config';

export interface ChatProvider {
  readonly id: ChatProviderId;
  /**
   * Loads the vendor's script and resolves when the widget can be opened. Rejects on any failure (blocked, offline,
   * refused by the policy). The controller adds the timeout and the failure handling; an adapter must not retry.
   */
  load(): Promise<void>;
  /** Opens the chat window. Only called after `isReady()` is true. May throw; the controller isolates that. */
  open(): void;
  isReady(): boolean;
  /**
   * Removes what `load` added and stops the vendor's tracking, for a withdrawn consent. An adapter that cannot do
   * this MUST leave it out: the controller then hides our call-outs and reports `chat.unload_unsupported`, and the
   * adapter is not fit for a consent-gated store (docs/integrations/CHAT.md).
   */
  unload?(): void;
}
