// The one piece of chat state the initial JavaScript holds (P7-03; bundle budget, scripts/perf).
//
// The controller, the registry and the adapters are a lazy chunk, requested only when a provider is configured (and,
// with consent required, only after the shopper agreed). The header and the menu have to react to it, so the chunk
// publishes a small view here and the call-outs read it with `useSyncExternalStore`. Type-only imports: this file adds
// almost nothing to the bundle. Same pattern as `~/lib/analytics/gate`.

import type {ChatView} from '~/lib/chat/view';

const HIDDEN: ChatView = {phase: 'hidden', busy: false, message: ''};

let view: ChatView = HIDDEN;
let opener: (() => void) | null = null;
const listeners = new Set<() => void>();

export const chatHandle = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  getView: (): ChatView => view,
  /** Server and first client render: no chat, so the markup agrees. */
  getServerView: (): ChatView => HIDDEN,
  /** The chunk publishes its view and its open action; null takes the chat away (unmount, withdrawn consent). */
  publish(next: ChatView | null, open?: () => void): void {
    view = next ?? HIDDEN;
    opener = next === null ? null : (open ?? null);
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch {
        // A faulty subscriber must not stop the others or the page.
      }
    }
  },
  /** What a call-out does. Nothing happens when there is no chat, which the call-out never offers anyway. */
  open(): void {
    opener?.();
  },
};
