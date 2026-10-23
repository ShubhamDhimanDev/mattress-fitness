// Best-effort removal of the cookies a provider set, when consent is withdrawn after its script ran (NFR-011).
// A script cannot list cookies it did not set, but the names GA4 and Meta use are documented, so those are expired
// on the host and on the host with a leading dot. A cookie set on a parent domain we cannot name (a registrable
// domain such as example.co.uk cannot be derived without a public-suffix list) may survive until the provider
// stops refreshing it; the docs list this as a known limit.

const SAFE_COOKIE_NAME = /^[A-Za-z0-9_-]{1,64}$/;
const SAFE_HOST = /^[a-z0-9.-]{1,253}$/i;

export function buildExpiredCookies(
  names: readonly string[],
  hostname: string,
): string[] {
  const expired = 'Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/';
  const hosts = SAFE_HOST.test(hostname) ? [hostname, `.${hostname}`] : [];
  const lines: string[] = [];
  for (const name of names) {
    if (!SAFE_COOKIE_NAME.test(name)) continue;
    lines.push(`${name}=; ${expired}`);
    for (const host of hosts)
      lines.push(`${name}=; ${expired}; Domain=${host}`);
  }
  return lines;
}
