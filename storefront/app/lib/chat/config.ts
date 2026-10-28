// Live-chat configuration read from the public environment (P7-03, REQ-ANL-004, NFR-011, NFR-013).
//
// Fail closed: with PUBLIC_CHAT_PROVIDER unset (the default) there is no chat at all: no code is requested, no script or
// host exists, and "Chat with us" is shown nowhere. The ids this build can run are `tawk` (tawk.to, chosen by the owner
// 2026-10-28, needs its two public ids) and `fake`, which runs only in development. Shopify Inbox, the default named
// in REQ-ANL-004, has no verified way to run on this storefront (docs/integrations/CHAT.md), so it is named here as BLOCKED and refused, never
// half-implemented.
//
// Pure: the caller passes the environment in.

export const CHAT_PROVIDER_IDS = ['tawk', 'fake'] as const;
export type ChatProviderId = (typeof CHAT_PROVIDER_IDS)[number];

/**
 * Provider ids that are known and deliberately NOT runnable, with the reason in docs/integrations/CHAT.md. Listed so
 * the startup warning can say "blocked" instead of "unknown", which is what a developer needs to read.
 */
export const BLOCKED_CHAT_PROVIDER_IDS: readonly string[] = ['shopify-inbox'];

export type ChatEnv = {
  readonly PUBLIC_CHAT_PROVIDER?: string | undefined;
  readonly PUBLIC_CHAT_REQUIRES_CONSENT?: string | undefined;
  readonly PUBLIC_TAWK_PROPERTY_ID?: string | undefined;
  readonly PUBLIC_TAWK_WIDGET_ID?: string | undefined;
};

/** The two ids in the widget address `embed.tawk.to/<propertyId>/<widgetId>`. Public by design: the page source shows them. */
export type TawkIds = {
  readonly propertyId: string;
  readonly widgetId: string;
};

/** What the browser is told. Public by design; carries no key. */
export type PublicChatConfig = {
  readonly providerId: ChatProviderId;
  /** True: the widget waits for the shopper's `analytics` consent. Only the exact text `false` turns this off. */
  readonly requiresConsent: boolean;
  /** Present only for `tawk`. */
  readonly tawk?: TawkIds;
};

export type ChatOffReason =
  | 'unset'
  | 'provider_blocked'
  | 'provider_unknown'
  | 'provider_misconfigured'
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

// The ids become part of a script address, so only plain letters and digits pass: no slash, dot, quote or whitespace can
// change which host or path is requested.
const TAWK_ID = /^[A-Za-z0-9]{1,40}$/;

export function parseTawkIds(env: ChatEnv): TawkIds | null {
  const propertyId = (env.PUBLIC_TAWK_PROPERTY_ID ?? '').trim();
  const widgetId = (env.PUBLIC_TAWK_WIDGET_ID ?? '').trim();
  return TAWK_ID.test(propertyId) && TAWK_ID.test(widgetId)
    ? {propertyId, widgetId}
    : null;
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
  const tawk = raw === 'tawk' ? parseTawkIds(env) : null;
  if (raw === 'tawk' && tawk === null) {
    return {status: 'off', reason: 'provider_misconfigured'};
  }
  const requiresConsent = parseChatRequiresConsent(
    env.PUBLIC_CHAT_REQUIRES_CONSENT,
  );
  if (requiresConsent && !options.analyticsCategoryConfigured) {
    return {status: 'off', reason: 'needs_consent_category'};
  }
  if (tawk !== null) {
    return {status: 'on', config: {providerId: raw, requiresConsent, tawk}};
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
