// What the providers learn about the page, and the "safe page" guard (T-05, T-10, T-16; review 2026-10-24, M-1, L-4).
//
// Google's and Meta's scripts read the document address, the title and the referrer on their own and attach them to
// every hit. We cannot change what Meta reads, and for Google we can only override it (`gtag('set', ...)`, which is
// UNVERIFIED against GA4 DebugView). So there are two controls, both pure and both applied by the runtime:
//
//  1. A page that fails the check sends NOTHING: no event of any kind (Meta PageView included), no script is
//     loaded for it, and an already loaded Google tag is paused there (its automatic events stop too).
//       - private area: the account and order pages, the guest order lookup, the delivery ZIP form, the
//         pre-checkout steps and discount links (`PRIVATE_PATH_PREFIXES`);
//       - any query value or an email in the path that looks like personal data (an email, seven or more digits),
//         except opaque click ids, which look like numbers but are tokens;
//       - a search page whose term looks personal.
//  2. On a page that passes, the address we hand Google is reduced (no search words, filters or ZIP; campaign tags
//     only), the title is a fixed word on search pages (the real one is `Search: <term>`), and the referrer is
//     reduced to its origin, or to the section of an own page.
//
// What this does NOT do: on a search page whose term passes the check, Meta's script still reads the real address,
// including `?q=<term>`. That term is also sent as `search_string`, so no new data leaves; it is a residual risk,
// recorded in docs/integrations/ANALYTICS.md.

import {
  EMAIL,
  fragmentLooksPersonal,
  isPrivatePath,
  looksPersonal,
  queryValueLooksPersonal,
  sanitizePageLocation,
  sanitizeSearchTerm,
} from '~/lib/analytics/privacy';

export type PageContext = {
  readonly pageLocation: string;
  readonly pageReferrer: string;
  readonly pageTitle: string;
};

export type UnsafePageReason =
  | 'unreadable'
  | 'private-path'
  | 'personal-path'
  | 'personal-query'
  | 'personal-fragment'
  | 'personal-search';

export type PageDecision =
  | {readonly safe: true; readonly context: PageContext | null}
  | {readonly safe: false; readonly reason: UnsafePageReason};

export type PageInput = {
  /** `window.location.href` */
  readonly href: string;
  /** `document.referrer` */
  readonly referrer: string;
  /** `document.title` */
  readonly title: string;
};

const SEARCH_TITLE = 'Search';
const FALLBACK_TITLE = 'Page';
const MAX_TITLE_LENGTH = 150;
// "Order #1001", "Order 1001", "order no. 12": an order page's title, which names an order (four digits are enough).
const ORDER_TITLE = /\border\b[^a-z0-9]{0,4}(?:no\.?|number)?[^a-z0-9]{0,3}\d/i;

function isSearchPath(pathname: string): boolean {
  const path = pathname.toLowerCase();
  return path === '/search' || path.startsWith('/search/');
}

function cleanTitle(title: string): string {
  const text = title.replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE_LENGTH);
  return text === '' || looksPersonal(text) || ORDER_TITLE.test(text)
    ? FALLBACK_TITLE
    : text;
}

/** An own page keeps its (sanitised, section-cut) address; another site is reduced to its origin; junk is nothing. */
function cleanReferrer(referrer: string, ownOrigin: string): string {
  let url: URL;
  try {
    url = new URL(referrer);
  } catch {
    return '';
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
  if (url.origin === ownOrigin) return sanitizePageLocation(referrer) ?? '';
  return url.origin;
}

function decodedPath(pathname: string): string {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
}

export function evaluatePage(input: PageInput): PageDecision {
  let url: URL;
  try {
    url = new URL(input.href);
  } catch {
    return {safe: false, reason: 'unreadable'};
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return {safe: false, reason: 'unreadable'};
  }
  if (isPrivatePath(url.pathname)) return {safe: false, reason: 'private-path'};
  if (EMAIL.test(decodedPath(url.pathname))) {
    return {safe: false, reason: 'personal-path'};
  }

  const search = isSearchPath(url.pathname);
  for (const [key, value] of url.searchParams) {
    const isSearchTerm = search && key === 'q';
    // The search term has its own, stricter rule (seven digits) that also covers the page's title; the other values
    // are judged as address parts.
    if (
      isSearchTerm
        ? !looksPersonal(value)
        : !queryValueLooksPersonal(key, value)
    )
      continue;
    return {
      safe: false,
      reason: isSearchTerm ? 'personal-search' : 'personal-query',
    };
  }
  // The fragment is never sent, but a page whose fragment holds an email or a phone number is not reported either.
  if (fragmentLooksPersonal(url.hash)) {
    return {safe: false, reason: 'personal-fragment'};
  }
  const term = url.searchParams.get('q');
  if (search && term !== null && term.trim() !== '') {
    // Redundant with the loop above on purpose: the search term has its own, stricter rule.
    if (sanitizeSearchTerm(term) === null) {
      return {safe: false, reason: 'personal-search'};
    }
  }

  const pageLocation = sanitizePageLocation(input.href);
  if (pageLocation === null) return {safe: false, reason: 'unreadable'};
  return {
    safe: true,
    context: {
      pageLocation,
      pageReferrer: cleanReferrer(input.referrer, url.origin),
      pageTitle: search ? SEARCH_TITLE : cleanTitle(input.title),
    },
  };
}

/** Reads the three facts from a window-like object; any failure is an unreadable (so unsafe) page. */
export function readPageInput(win: {
  readonly location: {readonly href: string};
  readonly document: {readonly referrer: string; readonly title: string};
}): PageInput | null {
  try {
    return {
      href: win.location.href,
      referrer: win.document.referrer,
      title: win.document.title,
    };
  } catch {
    return null;
  }
}
