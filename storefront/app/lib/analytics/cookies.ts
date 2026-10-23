// Best-effort removal of the cookies a provider set, when consent is withdrawn after its script ran (NFR-011).
// A script cannot list cookies it did not set, but the names GA4 and Meta use are documented, so those are expired
// on the host, with and without a leading dot, and on every parent suffix of two or more labels
// (www.shop.example.com -> shop.example.com, example.com): GA4 and the pixel set them on the registrable domain, which
// for a `www.` host is a parent. No public-suffix list is needed: a suffix such as `co.uk` that a browser refuses
// to set a cookie for is simply refused when we try to expire it, and a name we expire that was never set does
// nothing. A cookie scoped some other way (a path other than `/`) may survive; the docs list this as a limit.

const SAFE_COOKIE_NAME = /^[A-Za-z0-9_-]{1,64}$/;
const SAFE_HOST = /^[a-z0-9.-]{1,253}$/i;
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/** `a.b.c` gives `a.b.c`, `b.c` (two labels or more). An IP address or a single label has no parent. */
export function hostSuffixes(hostname: string): string[] {
  if (!SAFE_HOST.test(hostname) || IPV4.test(hostname)) return [];
  const labels = hostname.toLowerCase().split('.').filter(Boolean);
  const suffixes: string[] = [];
  for (let start = 0; labels.length - start >= 2; start += 1) {
    suffixes.push(labels.slice(start).join('.'));
  }
  return suffixes;
}

export function buildExpiredCookies(
  names: readonly string[],
  hostname: string,
): string[] {
  const expired = 'Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/';
  const hosts = hostSuffixes(hostname).flatMap((suffix) => [
    suffix,
    `.${suffix}`,
  ]);
  const lines: string[] = [];
  for (const name of names) {
    if (!SAFE_COOKIE_NAME.test(name)) continue;
    lines.push(`${name}=; ${expired}`);
    for (const host of hosts)
      lines.push(`${name}=; ${expired}; Domain=${host}`);
  }
  return lines;
}
