import {useEffect, useMemo} from 'react';
import type {ChatRuntimeProps} from '~/components/chat/chat-types';
import {acquireChat} from '~/lib/chat/live';
import {toChatView} from '~/lib/chat/view';

/**
 * The chat's React side (P7-03): it adopts the page's single controller (`~/lib/chat/live`), hands the shell a view
 * the call-outs render, and tells the controller whether the widget may load. It renders nothing itself.
 *
 * This module is a lazy chunk. `ChatGate` (in the initial JavaScript) mounts it only when a provider is configured, after
 * hydration and when the browser is idle, and with consent required only once the shopper has allowed the analytics
 * category; a store with no `PUBLIC_CHAT_PROVIDER` never downloads any of it.
 */
export function ChatRuntime({config, allowed, publish}: ChatRuntimeProps) {
  // Idempotent: StrictMode's second render and a later remount get the same controller back.
  const controller = useMemo(() => acquireChat(config), [config]);

  useEffect(() => {
    const push = () =>
      publish(toChatView(controller.getState()), controller.requestOpen);
    push();
    const unsubscribe = controller.subscribe(push);
    return () => {
      unsubscribe();
      publish(null);
    };
  }, [controller, publish]);

  // A withdrawal or a grant reaches the running controller, which unloads or loads the provider.
  useEffect(() => {
    controller.setAllowed(allowed);
  }, [controller, allowed]);

  return null;
}
