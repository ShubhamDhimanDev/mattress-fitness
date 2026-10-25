// Live-chat configuration read from the public environment (P7-03, REQ-ANL-004, NFR-011, NFR-013).
//
// Fail closed: with PUBLIC_CHAT_PROVIDER unset (the default) there is no chat at all: no code is requested, no script or
// host exists, and "Chat with us" is shown nowhere. No provider is chosen or approved (Q-011, CLR-005), so the only
// id this build can run is `fake`, and only in development. Shopify Inbox, the default named in REQ-ANL-004, has no
// verified way to run on this storefront (docs/integrations/CHAT.md), so it is named here as BLOCKED and refused, never
// half-implemented.
//
// Pure: the caller passes the environment in.

export const CHAT_PROVIDER_IDS = ['fake'] as const;
export type ChatProviderId = (typeof CHAT_PROVIDER_IDS)[number];

/**
 * Provider ids that are known and deliberately NOT runnable, with the reason in docs/integrations/CHAT.md. Listed so
 * the startup warning can say "blocked" instead of "unknown", which is what a developer needs to read.
 */
export const BLOCKED_CHAT_PROVIDER_IDS: readonly string[] = ['shopify-inbox'];

export type ChatEnv = {
  readonly PUBLIC_CHAT_PROVIDER?: string | undefined;
  readonly PUBLIC_CHAT_REQUIRES_CONSENT?: string | undefined;
};

/** What the browser is told. Public by design; carries no key. */
export type PublicChatConfig = {
  readonly providerId: ChatProviderId;
  /** True: the widget waits for the shopper's `analytics` consent. Only the exact text `false` turns this off. */
  readonly requiresConsent: boolean;
};

export type ChatOffReason =
  | 'unset'
  | 'provider_blocked'
  | 'provider_unknown'
  | 'fake_outside_development'
  | 'needs_consent_category';

export type ChatConfigResult =
  | {readonly status: 'on'; readonly config: PublicChatConfig}
  | {readonly status: 'off'; readonly reason: ChatOffReason};

export type ChatConfigOptions = {
  /** True only for the dev server (`import.meta.env.DEV`): the fake provider is refused everywhere else. */
  readonly development: boolean;
  /**
   * True when the consent layer asks about the `analytics` category (a GA4 id is set, so the banner has that checkbox).
   * The chat gate reads that category; without it a shopper could never agree, so a consent-gated chat stays off.
   */
  readonly analyticsCategoryConfigured: boolean;
};

function isRunnable(value: string): value is ChatProviderId {
  return (CHAT_PROVIDER_IDS as readonly string[]).includes(value);
}

/** Exact match on purpose, like `PUBLIC_CONSENT_MODE`: only the text `false` loosens the stricter default. */
export function parseChatRequiresConsent(value: string | undefined): boolean {
  return value !== 'false';
}

export function parseChatConfig(
  env: ChatEnv,
  options: ChatConfigOptions,
): ChatConfigResult {
  const raw = (env.PUBLIC_CHAT_PROVIDER ?? '').trim();
  if (raw === '') return {status: 'off', reason: 'unset'};
  if (BLOCKED_CHAT_PROVIDER_IDS.includes(raw)) {
    return {status: 'off', reason: 'provider_blocked'};
  }
  if (!isRunnable(raw)) return {status: 'off', reason: 'provider_unknown'};
  if (raw === 'fake' && !options.development) {
    return {status: 'off', reason: 'fake_outside_development'};
  }
  const requiresConsent = parseChatRequiresConsent(
    env.PUBLIC_CHAT_REQUIRES_CONSENT,
  );
  if (requiresConsent && !options.analyticsCategoryConfigured) {
    return {status: 'off', reason: 'needs_consent_category'};
  }
  return {status: 'on', config: {providerId: raw, requiresConsent}};
}

const warned = new Set<ChatOffReason>();

/**
 * For the root loader: the public config, or null. A configured-but-refused provider is written to the server log
 * once per reason (reason only, never the value: a typo is more likely a pasted secret than anything else).
 */
export function resolvePublicChatConfig(
  env: ChatEnv,
  options: ChatConfigOptions,
  warn: (event: string, fields: Readonly<Record<string, string>>) => void,
): PublicChatConfig | null {
  const result = parseChatConfig(env, options);
  if (result.status === 'on') return result.config;
  if (result.reason !== 'unset' && !warned.has(result.reason)) {
    warned.add(result.reason);
    warn('chat.config_refused', {reason: result.reason});
  }
  return null;
}

/** For tests: forget which refusals were already logged. */
export function resetChatConfigWarnings(): void {
  warned.clear();
}
