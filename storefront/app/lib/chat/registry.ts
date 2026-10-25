// Provider id to adapter (P7-03). Only adapters that exist and are approved appear here; today that is none for
// production. Shopify Inbox, the default in REQ-ANL-004, is NOT here: docs/integrations/CHAT.md records why.
//
// The development-only fake is behind `import.meta.env.DEV`, a build-time constant, so a production build contains
// neither the adapter nor a request for it (verified by searching the build output, docs/integrations/CHAT.md).
// `parseChatConfig` also refuses `fake` outside development, so this is the second lock, not the only one.

import type {ChatProviderId} from '~/lib/chat/config';
import type {ChatProvider} from '~/lib/chat/provider';

export type ChatProviderFactories = Partial<
  Record<ChatProviderId, () => Promise<ChatProvider>>
>;

export const CHAT_PROVIDER_FACTORIES: ChatProviderFactories = import.meta.env
  .DEV
  ? {
      fake: () =>
        import('~/lib/chat/providers/fake').then((module) =>
          module.createFakeProvider(),
        ),
    }
  : {};

/** The adapter for an id, or null when this build has none. Never throws for an unknown id. */
export async function createChatProvider(
  id: ChatProviderId,
  factories: ChatProviderFactories = CHAT_PROVIDER_FACTORIES,
): Promise<ChatProvider | null> {
  const factory = factories[id];
  return factory === undefined ? null : factory();
}
