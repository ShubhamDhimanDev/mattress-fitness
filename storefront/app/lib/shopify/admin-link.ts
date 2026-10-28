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
  '/quiz',
  '/compare',
  '/search',
  '/policies',
];

/** Percent-decodes up to three times, so a double-encoded dot segment ("%252e%252e") is seen as what it is. */
function fullyDecoded(path: string): string | null {
  let current = path;
  for (let pass = 0; pass < 3; pass += 1) {
    let next: string;
    try {
      next = decodeURIComponent(current);
    } catch {
      return null;
    }
    if (next === current) return current;
    current = next;
  }
  return current;
}

/** Runs on the entity-decoded text, which is what the browser will receive (S-L1). */
function isPublicPath(link: string): boolean {
  const end = link.search(/[?#]/);
  const path = end === -1 ? link : link.slice(0, end);
  if (path === '/') return true;
  // Dot segments (also percent-encoded) would let "/pages/../api" walk out of an allowed prefix.
  const decoded = fullyDecoded(path);
  if (decoded === null) return false;
  if (
    decoded
      .split(/[/\\]/)
      .some((segment) => segment === '.' || segment === '..')
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

  // The shared checker also rejects encoded schemes and backslashes, and returns the text with HTML entities
  // decoded ("&#46;" becomes "."). Everything below is judged on that decoded value, the one that is returned
  // and rendered, never on the raw text (S-L1).
  const safe = safeUrl(text, {schemes: ['https']});
  if (safe === null) return null;
  if (safe.length > MAX_LINK_LENGTH) return null;
  if (/\s/.test(safe) || hasControlCharacter(safe)) return null;

  const internal = safe.startsWith('/') && !safe.startsWith('//');
  const external = /^https:\/\//i.test(safe);
  if (!internal && !external) return null;
  if (internal && !isPublicPath(safe)) return null;
  return {href: safe, external};
}
