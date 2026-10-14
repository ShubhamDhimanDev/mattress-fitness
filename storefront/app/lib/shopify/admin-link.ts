// Links typed into Shopify admin (homepage sections, promo tiles). They are untrusted text (threats T-07,
// T-08): only a site-relative path or an https URL is accepted, anything else (javascript:, data:, a
// protocol-relative "//host", a backslash trick, whitespace) means "no link".

import {hasControlCharacter} from '~/lib/catalog/text';
import {safeUrl} from '~/lib/shopify/sanitize-html';

export type AdminLink = {
  readonly href: string;
  /** True for an https URL on another site; internal paths use the client-side router. */
  readonly external: boolean;
};

const MAX_LINK_LENGTH = 500;

export function parseAdminLink(
  raw: string | null | undefined,
): AdminLink | null {
  if (!raw) return null;
  const text = raw.trim();
  if (text === '' || text.length > MAX_LINK_LENGTH) return null;
  if (/\s/.test(text) || hasControlCharacter(text)) return null;

  const internal = text.startsWith('/') && !text.startsWith('//');
  const external = /^https:\/\//i.test(text);
  if (!internal && !external) return null;

  // The shared checker also rejects encoded schemes and backslashes.
  const safe = safeUrl(text, {schemes: ['https']});
  if (safe === null) return null;
  return {href: safe, external};
}
