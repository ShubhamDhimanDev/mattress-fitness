// Provider id to adapter (P7-03). Only adapters that exist and are approved appear here: tawk.to (chosen by the owner
// 2026-10-28) and the development-only fake. Shopify Inbox, the default in REQ-ANL-004, is NOT here:
// docs/integrations/CHAT.md records why.
//
// The development-only fake is behind `import.meta.env.DEV`, a build-time constant, so a production build contains
// neither the adapter nor a request for it (verified by searching the build output, docs/integrations/CHAT.md).
// `parseChatConfig` also refuses `fake` outside development, so this is the second lock, not the only one.

import type {ChatProviderId, PublicChatConfig} from '~/lib/chat/config';
import type {ChatProvider} from '~/lib/chat/provider';

export type ChatProviderFactories = Partial<
  Record<ChatProviderId, (config: PublicChatConfig) => Promise<ChatProvider>>
>;

// A dynamic import, so the adapter is in its own chunk that only a configured tawk store ever requests.
const tawkFactory: NonNullable<ChatProviderFactories['tawk']> = async (
  config,
) => {
  const {tawk} = config;
  if (tawk === undefined) throw new Error('tawk ids missing');
  const module = await import('~/lib/chat/providers/tawk');
  return module.createTawkProvider(tawk);
};

export const CHAT_PROVIDER_FACTORIES: ChatProviderFactories = import.meta.env
  .DEV
  ? {
      tawk: tawkFactory,
      fake: () =>
        import('~/lib/chat/providers/fake').then((module) =>
          module.createFakeProvider(),
        ),
    }
  : {tawk: tawkFactory};

/** The adapter for an id, or null when this build has none. Never throws for an unknown id. */
export async function createChatProvider(
  config: PublicChatConfig,
  factories: ChatProviderFactories = CHAT_PROVIDER_FACTORIES,
): Promise<ChatProvider | null> {
  const factory = factories[config.providerId];
  return factory === undefined ? null : factory(config);
}
