// The third-party origins the financing messages and the Extend logo need, by Content Security Policy directive
// (P4-08, REQ-EXT-004, T-10). Same rule as `~/lib/chat/hosts` and `~/lib/analytics/hosts`: a host exists only for a
// provider that is configured, is added to the report-only and the enforced policy together (both read the same merged
// object in `entry.server.tsx`), and is never a wildcard.
//
// AFFIRM. Verified (docs.affirm.com "Set Up Promotional Messaging", updated 2026-07-15, read 2026-10-26): Affirm.js is
// loaded from `https://cdn1-sandbox.affirm.com/js/v2/affirm.js` (sandbox) or `https://cdn1.affirm.com/js/v2/affirm.js`
// (production). UNVERIFIED: Affirm publishes no Content Security Policy list in the pages read, so the hosts Affirm.js
// itself calls (the promotional-message request, the "learn more" modal frame, its images) are NOT listed here. Until
// they are known the message may stay empty under the enforced policy: that is the safe failure. Run staging in
// report-only with a real sandbox key, open every placement and the modal, and add only a host seen blocked, quoting
// where it was seen. Nothing is guessed from community guides.
//
// EXTEND LOGO. The logo URL is hosted by the client or Extend and set in PUBLIC_EXTEND_LOGO_URL; only that one origin is
// added to `img-src`, and only when the variable holds a valid https URL.

import type {ChatCsp} from '~/lib/chat/hosts';
import type {PublicFinancingConfig} from '~/lib/financing/config';

export const AFFIRM_SCRIPT_URL = {
  sandbox: 'https://cdn1-sandbox.affirm.com/js/v2/affirm.js',
  production: 'https://cdn1.affirm.com/js/v2/affirm.js',
} as const;

const AFFIRM_SCRIPT_ORIGIN = {
  sandbox: 'https://cdn1-sandbox.affirm.com',
  production: 'https://cdn1.affirm.com',
} as const;

export const NO_EXTRA_CSP: ChatCsp = {
  script: [],
  img: [],
  connect: [],
  frame: [],
};

/** The hosts of the configured financing provider only; nothing for none, Shop Pay Installments or the store card. */
export function financingCspHosts(
  config: PublicFinancingConfig | null,
): ChatCsp {
  if (config === null || config.provider !== 'affirm') return NO_EXTRA_CSP;
  const origin =
    AFFIRM_SCRIPT_ORIGIN[config.sandbox ? 'sandbox' : 'production'];
  return {script: [origin], img: [], connect: [], frame: []};
}

/** The one origin of a configured Extend logo, for `img-src`. */
export function extendLogoCspHosts(logoOrigin: string | null): ChatCsp {
  return logoOrigin === null
    ? NO_EXTRA_CSP
    : {script: [], img: [logoOrigin], connect: [], frame: []};
}

/** Several sources merged per directive, duplicates removed. */
export function mergeCspHosts(...parts: readonly ChatCsp[]): ChatCsp {
  const join = (key: keyof ChatCsp): string[] => [
    ...new Set(parts.flatMap((part) => part[key])),
  ];
  return {
    script: join('script'),
    img: join('img'),
    connect: join('connect'),
    frame: join('frame'),
  };
}
