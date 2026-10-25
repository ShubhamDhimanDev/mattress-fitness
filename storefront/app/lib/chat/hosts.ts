// The third-party origins each chat provider needs, by Content Security Policy directive (P7-03, T-10).
//
// EMPTY on purpose: the only provider this build can run is the development fake, which loads no external host. A real
// provider adds its entry in the same change as its adapter, with the vendor's DOCUMENTED hosts and the source URL
// and date quoted here (rule for adding a provider: docs/security/SECURITY_HEADERS.md). Never a wildcard host, never a
// host guessed from a community guide without saying so. Hosts are added to the report-only and the enforced policy
// together, and only for the configured provider id (`chatCspHosts`).

import type {ChatProviderId} from '~/lib/chat/config';

export type ChatCsp = {
  readonly script: readonly string[];
  readonly img: readonly string[];
  readonly connect: readonly string[];
  /** Chat windows are usually an iframe; the policies otherwise send `frame-src 'none'`. */
  readonly frame: readonly string[];
};

export const NO_CHAT_CSP: ChatCsp = {
  script: [],
  img: [],
  connect: [],
  frame: [],
};

export const CHAT_CSP: Readonly<Partial<Record<ChatProviderId, ChatCsp>>> = {};

/** The hosts of the configured provider only; nothing for no provider or for one with no external host. */
export function chatCspHosts(providerId: ChatProviderId | null): ChatCsp {
  return providerId === null
    ? NO_CHAT_CSP
    : (CHAT_CSP[providerId] ?? NO_CHAT_CSP);
}
