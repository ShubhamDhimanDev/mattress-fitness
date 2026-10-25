// Financing message configuration read from the environment (P4-08, REQ-CART-005, SD-11, Q-016, CLR-007, CLR-008).
//
// Fail closed: with PUBLIC_FINANCING_PROVIDER unset, or anything but one of the three exact ids, nothing is shown, no
// script is requested and no host is added to the Content Security Policy. A message is a promise to the shopper about
// a payment option, so it exists only when the client has switched that option on in their own accounts.
//
// No monthly figure is ever computed here (SD-11): the only figure on the page is one a provider component draws itself
// (Affirm's own "as low as" element, from the Shopify amount we hand it in cents). Pure: the caller passes the
// environment in.

export const FINANCING_PROVIDER_IDS = [
  'shop-pay-installments',
  'affirm',
  'store-card',
] as const;
export type FinancingProviderId = (typeof FINANCING_PROVIDER_IDS)[number];

export type FinancingEnv = {
  readonly PUBLIC_FINANCING_PROVIDER?: string | undefined;
  readonly PUBLIC_AFFIRM_PUBLIC_KEY?: string | undefined;
  readonly PUBLIC_AFFIRM_REQUIRES_CONSENT?: string | undefined;
  readonly PUBLIC_AFFIRM_ENVIRONMENT?: string | undefined;
  readonly STORE_CARD_MESSAGE?: string | undefined;
};

/** What the browser is told. Public by design: an Affirm public key is meant for the page, the card text is shown. */
export type PublicFinancingConfig =
  | {readonly provider: 'shop-pay-installments'}
  | {
      readonly provider: 'affirm';
      readonly publicKey: string;
      /** True: Affirm's sandbox script. Anything but the exact text `production` for the environment means sandbox. */
      readonly sandbox: boolean;
      /** True: the script waits for the shopper's `analytics` consent. Only the exact text `false` turns this off. */
      readonly requiresConsent: boolean;
    }
  | {readonly provider: 'store-card'; readonly text: string};

export type FinancingOffReason =
  | 'unset'
  | 'provider_unknown'
  | 'affirm_key_missing'
  | 'affirm_key_invalid'
  | 'affirm_needs_consent_category'
  | 'store_card_text_missing';

export type FinancingConfigResult =
  | {readonly status: 'on'; readonly config: PublicFinancingConfig}
  | {readonly status: 'off'; readonly reason: FinancingOffReason};

export type FinancingConfigOptions = {
  /**
   * True when the consent layer asks about the `analytics` category (a GA4 id is set, so the banner has that checkbox).
   * Affirm follows the chat's rule: a consent-gated script needs that category, or a shopper could never agree.
   */
  readonly analyticsCategoryConfigured: boolean;
};

/**
 * Default wording for Shop Pay Installments. PLACEHOLDER pending the client's approval (REQ-CART-005, Q-016). It names
 * the option and says it is chosen at checkout; it states no amount, term or fee because Shopify decides eligibility
 * and terms, and none of that is verified on the client's store (CLR-007).
 */
export const SHOP_PAY_INSTALLMENTS_COPY =
  'Pay over time with Shop Pay Installments. Eligible orders can choose it at checkout.';

/** The longest store-card message accepted. A longer one is a pasted paragraph, not a one-line promotion. */
export const STORE_CARD_MESSAGE_MAX = 200;

// Affirm's public keys are short alphanumeric tokens in its dashboard; the exact format is not documented in the pages
// read (docs.affirm.com, 2026-10-26), so only the characters that could break out of an attribute or script are refused.
const AFFIRM_KEY = /^[A-Za-z0-9_-]{6,80}$/;

/** Control characters (C0, DEL, C1), the line and paragraph separators, and the angle brackets of markup. */
function isDroppedChar(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  return (
    code <= 0x1f ||
    (code >= 0x7f && code <= 0x9f) ||
    code === 0x2028 ||
    code === 0x2029 ||
    char === '<' ||
    char === '>'
  );
}

/**
 * Plain text only, one line. Control characters and angle brackets are removed and whitespace is collapsed. React escapes
 * text anyway; this keeps markup-looking input out of the page, the logs and the root loader payload. Returns null when
 * nothing is left, or when the text had to be cut: a half message is worse than none.
 */
export function sanitizeStoreCardMessage(
  raw: string | undefined,
): string | null {
  if (raw === undefined) return null;
  const cleaned = Array.from(raw, (char) => (isDroppedChar(char) ? ' ' : char))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned === '' || cleaned.length > STORE_CARD_MESSAGE_MAX) return null;
  return cleaned;
}

/** Exact match on purpose, like the chat switch: only the text `false` loosens the stricter default. */
export function parseAffirmRequiresConsent(value: string | undefined): boolean {
  return value !== 'false';
}

export function parseFinancingConfig(
  env: FinancingEnv,
  options: FinancingConfigOptions,
): FinancingConfigResult {
  const raw = env.PUBLIC_FINANCING_PROVIDER;
  if (raw === undefined || raw === '') return {status: 'off', reason: 'unset'};
  switch (raw) {
    case 'shop-pay-installments':
      return {status: 'on', config: {provider: 'shop-pay-installments'}};
    case 'store-card': {
      const text = sanitizeStoreCardMessage(env.STORE_CARD_MESSAGE);
      return text === null
        ? {status: 'off', reason: 'store_card_text_missing'}
        : {status: 'on', config: {provider: 'store-card', text}};
    }
    case 'affirm': {
      const key = (env.PUBLIC_AFFIRM_PUBLIC_KEY ?? '').trim();
      if (key === '') return {status: 'off', reason: 'affirm_key_missing'};
      if (!AFFIRM_KEY.test(key)) {
        return {status: 'off', reason: 'affirm_key_invalid'};
      }
      const requiresConsent = parseAffirmRequiresConsent(
        env.PUBLIC_AFFIRM_REQUIRES_CONSENT,
      );
      if (requiresConsent && !options.analyticsCategoryConfigured) {
        return {status: 'off', reason: 'affirm_needs_consent_category'};
      }
      return {
        status: 'on',
        config: {
          provider: 'affirm',
          publicKey: key,
          sandbox: env.PUBLIC_AFFIRM_ENVIRONMENT !== 'production',
          requiresConsent,
        },
      };
    }
    default:
      return {status: 'off', reason: 'provider_unknown'};
  }
}

const warned = new Set<FinancingOffReason>();

/**
 * For the root loader: the public config, or null. A configured-but-refused provider is written to the server log once
 * per reason (the reason only, never a value: a typo is more likely a pasted secret than anything else).
 */
export function resolvePublicFinancingConfig(
  env: FinancingEnv,
  options: FinancingConfigOptions,
  warn: (event: string, fields: Readonly<Record<string, string>>) => void,
): PublicFinancingConfig | null {
  const result = parseFinancingConfig(env, options);
  if (result.status === 'on') return result.config;
  if (result.reason !== 'unset' && !warned.has(result.reason)) {
    warned.add(result.reason);
    warn('financing.config_refused', {reason: result.reason});
  }
  return null;
}
