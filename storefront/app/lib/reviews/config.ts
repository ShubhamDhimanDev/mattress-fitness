// Reviews configuration (P3B-12, REQ-PDP-005). SERVER ONLY.
//
// Fail closed: with REVIEWS_PROVIDER unset (the default) reviews are OFF: no section, no request, no structured data. No
// provider is chosen yet (Q-011, CLR-005); Judge.me is the documented default and stays unverified without an account.
// The development-only `fake` is refused outside development. Pure: the caller passes the environment in.

export const REVIEWS_PROVIDER_IDS = ['judgeme', 'fake'] as const;
export type ReviewsProviderId = (typeof REVIEWS_PROVIDER_IDS)[number];

export type ReviewsEnv = {
  readonly REVIEWS_PROVIDER?: string | undefined;
  readonly JUDGEME_PRIVATE_API_TOKEN?: string | undefined;
  readonly JUDGEME_SHOP_DOMAIN?: string | undefined;
};

export type ReviewsConfig =
  | {readonly provider: 'fake'}
  | {
      readonly provider: 'judgeme';
      readonly token: string;
      readonly shopDomain: string;
    };

export type ReviewsOffReason =
  | 'unset'
  | 'provider_unknown'
  | 'fake_outside_development'
  | 'judgeme_not_configured';

export type ReviewsConfigResult =
  | {readonly status: 'on'; readonly config: ReviewsConfig}
  | {readonly status: 'off'; readonly reason: ReviewsOffReason};

// A myshopify.com domain: the form Judge.me's docs show (example.myshopify.com).
const SHOP_DOMAIN = /^[a-z0-9][a-z0-9-]{0,60}\.myshopify\.com$/;
// Opaque token characters only; a space or a quote means a pasted note, not a token.
const TOKEN = /^[A-Za-z0-9_-]{8,200}$/;

export function parseReviewsConfig(
  env: ReviewsEnv,
  options: {readonly development: boolean},
): ReviewsConfigResult {
  const raw = (env.REVIEWS_PROVIDER ?? '').trim().toLowerCase();
  if (raw === '') return {status: 'off', reason: 'unset'};
  if (raw === 'fake') {
    return options.development
      ? {status: 'on', config: {provider: 'fake'}}
      : {status: 'off', reason: 'fake_outside_development'};
  }
  if (raw !== 'judgeme') return {status: 'off', reason: 'provider_unknown'};
  const token = (env.JUDGEME_PRIVATE_API_TOKEN ?? '').trim();
  const shopDomain = (env.JUDGEME_SHOP_DOMAIN ?? '').trim().toLowerCase();
  if (!TOKEN.test(token) || !SHOP_DOMAIN.test(shopDomain)) {
    return {status: 'off', reason: 'judgeme_not_configured'};
  }
  return {status: 'on', config: {provider: 'judgeme', token, shopDomain}};
}
