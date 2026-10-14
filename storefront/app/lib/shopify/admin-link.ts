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

/**
 * Where an admin-typed internal link may point: the shopper-facing pages only. A link to /api, /webhooks,
 * /cart or an account route has no business in editable content, and an allow-list stays correct as routes
 * are added. Matched on whole path segments, so "/pagesx" does not pass for "/pages".
 */
const PUBLIC_PATH_PREFIXES: readonly string[] = [
  '/collections',
  '/products',
  '/pages',
  '/brands',
  '/blogs',
  '/stores',
  '/quiz',
  '/compare',
  '/search',
  '/policies',
];

function isPublicPath(link: string): boolean {
  const end = link.search(/[?#]/);
  const path = end === -1 ? link : link.slice(0, end);
  if (path === '/') return true;
  // Dot segments (also percent-encoded) would let "/pages/../api" walk out of an allowed prefix.
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return false;
  }
  if (
    decoded.split('/').some((segment) => segment === '.' || segment === '..')
  ) {
    return false;
  }
  return PUBLIC_PATH_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}

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
  if (internal && !isPublicPath(text)) return null;

  // The shared checker also rejects encoded schemes and backslashes.
  const safe = safeUrl(text, {schemes: ['https']});
  if (safe === null) return null;
  return {href: safe, external};
}
