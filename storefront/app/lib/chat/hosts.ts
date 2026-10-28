// The third-party origins each chat provider needs, by Content Security Policy directive (P7-03, T-10).
//
// The fake provider loads no external host, so it has no entry. A real
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

// TAWK.TO. Source: tawk.to help centre, "Resolving Content Security Policy (CSP) issues blocking the widget, images, and
// Knowledge Base articles" (https://help.tawk.to/article/why-are-images-not-showing-up-in-the-widget), read 2026-10-28.
// tawk.to documents only wildcard hosts (`*.tawk.to`; the widget uses several tawk.to subdomains), so this entry is the
// exception to the no-wildcard rule and needs the owner's written approval, recorded in docs/security/SECURITY_HEADERS.md.
// Taken from that list: script-src, connect-src (https and wss), frame-src and img-src (`*.tawk.to`, `tawk.link`).
// NOT added, though the article lists them: `cdn.jsdelivr.net`, `s3.amazonaws.com` (broad third-party hosts, only for
// some images), `fonts.googleapis.com`, `fonts.gstatic.com`, and the style-src, font-src and form-action entries: the
// widget draws in tawk.to's own frame, which has its own policy. If the report-only policy shows a violation, add
// only that host here and say where it was seen.
export const CHAT_CSP: Readonly<Partial<Record<ChatProviderId, ChatCsp>>> = {
  tawk: {
    script: ['https://*.tawk.to'],
    img: ['https://*.tawk.to', 'https://tawk.link'],
    connect: ['https://*.tawk.to', 'wss://*.tawk.to'],
    frame: ['https://*.tawk.to'],
  },
};

/** The hosts of the configured provider only; nothing for no provider or for one with no external host. */
export function chatCspHosts(providerId: ChatProviderId | null): ChatCsp {
  return providerId === null
    ? NO_CHAT_CSP
    : (CHAT_CSP[providerId] ?? NO_CHAT_CSP);
}
