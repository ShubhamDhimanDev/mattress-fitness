// robots.txt content (P7-04, REQ-SEO-001, docs/architecture/SEO_POLICY.md).
//
// Pure: the route passes the site origin and this returns text. Crawling is blocked for private and per-shopper
// pages, endpoints, quiz result URLs and every filtered or sorted collection view (the filter
// parameters come from the filter codec, so a new filter dimension is blocked without editing this file).
// Everything else is open and listed in the sitemap.

import {ROBOTS_DISALLOWED_PREFIXES} from '~/lib/seo/canonical';

export type RobotsOptions = {
  /** The configured site origin; without one the Sitemap line is left out (a relative one is invalid). */
  readonly origin: string | null;
  /** URL parameters that make a collection or brand view a filtered or sorted variant (MANAGED_FILTER_PARAMS). */
  readonly facetParams: readonly string[];
};

/** Quiz answers and results travel in the query string (`?step=results&a.feel=soft`); the bare quiz page is open. */
const QUIZ_STATE_RULE = 'Disallow: /quiz?';

function disallowRules(facetParams: readonly string[]): string[] {
  return [
    // Segment-safe: robots rules are prefixes, so `/cart` alone would also block `/cartridge`. The path itself,
    // anything below it and its query string are three forms (`$` ends the URL).
    ...ROBOTS_DISALLOWED_PREFIXES.flatMap((prefix) => [
      `Disallow: ${prefix}$`,
      `Disallow: ${prefix}/`,
      `Disallow: ${prefix}?`,
    ]),
    QUIZ_STATE_RULE,
    // A parameter name must start right after `?` or `&`, so `size=` does not match `resize=`. `*` spans the path.
    ...facetParams.flatMap((param) => [
      `Disallow: /*?${param}=`,
      `Disallow: /*&${param}=`,
    ]),
  ];
}

function group(
  agent: string,
  options: {crawlDelay?: number; rules: readonly string[]},
): string {
  return [
    `User-agent: ${agent}`,
    ...(options.crawlDelay === undefined
      ? []
      : [`Crawl-delay: ${options.crawlDelay}`]),
    ...options.rules,
  ].join('\n');
}

export function buildRobotsTxt(options: RobotsOptions): string {
  const rules = disallowRules(options.facetParams);
  // A crawler that has its own group ignores the `*` group, so every named group repeats the rules.
  const groups = [
    group('*', {rules}),
    // Google's ads crawler ignores the `*` group unless it is named.
    group('adsbot-google', {rules}),
    group('Nutch', {rules: ['Disallow: /']}),
    group('AhrefsBot', {crawlDelay: 10, rules}),
    group('AhrefsSiteAudit', {crawlDelay: 10, rules}),
    group('MJ12bot', {crawlDelay: 10, rules}),
    group('Pinterest', {crawlDelay: 1, rules}),
  ];
  const sitemap = options.origin
    ? [`Sitemap: ${options.origin}/sitemap.xml`]
    : [];
  return [...groups, ...sitemap].join('\n\n') + '\n';
}
