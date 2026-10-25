import {
  Suspense,
  lazy,
  useEffect,
  useState,
  useSyncExternalStore,
  type ComponentType,
} from 'react';
import type {ChatConsent, ChatRuntimeProps} from '~/components/chat/chat-types';
import type {PublicChatConfig} from '~/lib/chat/config';
import {chatHandle} from '~/lib/chat/handle';

// A chunk that fails to download hides the chat and nothing else (NFR-013).
const Nothing: ComponentType<ChatRuntimeProps> = () => null;
const ChatRuntime = lazy(
  (): Promise<{default: ComponentType<ChatRuntimeProps>}> =>
    import('~/components/chat/ChatRuntime').then(
      (module) => ({default: module.ChatRuntime}),
      (error: unknown) => {
        const reason = error instanceof Error ? error.name : 'unknown';
        // The logger is fetched only on this path: importing it statically adds weight.
        void import('~/lib/logging/logger').then(
          ({logWarn}) => logWarn('chat.chunk_failed', {reason}),
          () => {},
        );
        return {default: Nothing};
      },
    ),
);

// Not imported from ~/lib/when-idle or the analytics gate: a module shared with the initial JavaScript becomes a chunk of
// its own that every route downloads (bundle budget, scripts/perf). Same behaviour as scheduleIdle in the analytics gate.
function whenIdle(callback: () => void): () => void {
  if (typeof requestIdleCallback === 'function') {
    const id = requestIdleCallback(callback, {timeout: 3000});
    return () => cancelIdleCallback(id);
  }
  const id = setTimeout(callback, 1500);
  return () => clearTimeout(id);
}

/**
 * The chat's gate (P7-03, REQ-ANL-004, NFR-011). Renders no markup. It is part of the lazy chunk that the header bar
 * requests only when a provider is configured, so a store with none (the default) carries no chat code in any route. It
 * holds no vendor code and makes no vendor request.
 *
 * It requests the `ChatRuntime` chunk (the controller, the registry, the adapter) when the browser is idle and, when
 * consent is required, only once the shopper has allowed the `analytics` category. Once requested, the runtime stays
 * mounted so a later withdrawal reaches it and unloads the provider.
 */
export function ChatShell({
  config,
  consent,
}: {
  readonly config: PublicChatConfig;
  readonly consent: ChatConsent;
}) {
  useSyncExternalStore(
    consent.subscribe,
    consent.getVersion,
    consent.getServerVersion,
  );
  const allowed =
    !config.requiresConsent ||
    consent.getStore()?.getSnapshot().choice.analytics === true;

  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!allowed || armed) return;
    return whenIdle(() => setArmed(true));
  }, [allowed, armed]);

  return armed ? (
    <Suspense fallback={null}>
      <ChatRuntime
        config={config}
        allowed={allowed}
        publish={chatHandle.publish}
      />
    </Suspense>
  ) : null;
}
