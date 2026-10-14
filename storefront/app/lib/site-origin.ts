// The storefront's own public origin, for canonical links and structured data (P-L2, T-07/T-08).
//
// It must not come from the request: the Host header is chosen by the caller, and on a host that does not
// fix it (an own server behind a CDN that ignores Host, Q-003) a forged value would be cached into canonical
// URLs and JSON-LD. The origin therefore comes from `PUBLIC_SITE_URL` in the request-context env. Only
// development falls back to the request, so `npm run dev` works without configuration.

type EnvLike = {readonly PUBLIC_SITE_URL?: string};

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set([
  'localhost',
  '127.0.0.1',
  '[::1]',
]);

/**
 * The origin from a configured site URL: `https` only (plain `http` only for loopback, for local previews).
 * Any path, query, fragment or credentials in the value are dropped. Anything unparseable gives null.
 */
export function parseSiteOrigin(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.username !== '' || url.password !== '') return null;
  const secure = url.protocol === 'https:';
  const localPlain =
    url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname);
  return secure || localPlain ? url.origin : null;
}

/**
 * The origin to use in absolute URLs, or null when none is configured outside development. Callers treat
 * null as "emit relative URLs and no canonical link": a missing canonical is harmless, a forged one is not.
 */
export function resolveSiteOrigin(options: {
  readonly env: EnvLike;
  readonly requestUrl: string;
  readonly isDev: boolean;
}): string | null {
  const configured = parseSiteOrigin(options.env.PUBLIC_SITE_URL);
  if (configured) return configured;
  if (!options.isDev) return null;
  try {
    return new URL(options.requestUrl).origin;
  } catch {
    return null;
  }
}
