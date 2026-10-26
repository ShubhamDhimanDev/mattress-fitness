// Which of the registry's pages exist in Shopify with content (REQ-CNT-001, P6-09), so links only go to pages that
// resolve. One batched Storefront request: every page is an aliased `page(handle:)` field in a single query, next
// to the two shop policies and the journal blog. A page has content by the rule the page route uses
// (`pageHasContent`: text or an image after sanitising), which needs the body; the response is cached for an hour and
// the rule is remembered per body, so the cost is one read per cache window.
//
// The answer holds no price, availability or shopper data, so it uses the long catalog cache (cache.ts): an edit
// in admin shows after the cache window. It never rejects: a failed or partial read means "nothing exists", which
// shows no registry link (a missing link is harmless, a link that 404s is not), and the failure is logged once
// per run of failures, by class name only (T-05).

import type {Storefront} from '~/lib/hydrogen/storefront';
import type {ContentPagesQuery} from 'storefrontapi.generated';
import {errorFields, logError} from '~/lib/logging/logger';
import {pageHasContent} from '~/lib/pages/content-pages-html';
import {
  CONTENT_BLOGS,
  CONTENT_PAGES,
  NO_CONTENT,
  footerPageLinks,
  readOnlySet,
  type ContentAvailability,
  type PolicyField,
} from '~/lib/pages/content-pages';
import type {FooterPageLink} from '~/lib/navigation';
import {catalogCache} from '~/lib/shopify/cache';

// The aliases are numbered in registry order (`page0` is CONTENT_PAGES[0], `blog0` is CONTENT_BLOGS[0]); a unit
// test pins every alias to its handle, because codegen needs the query as a literal string.
// NOTE: https://shopify.dev/docs/api/storefront/latest/queries/page
export const CONTENT_PAGES_QUERY = `#graphql
  query ContentPages($country: CountryCode, $language: LanguageCode)
    @inContext(country: $country, language: $language) {
    page0: page(handle: "contact") { body }
    page1: page(handle: "delivery-and-shipping") { body }
    page2: page(handle: "financing") { body }
    page3: page(handle: "warranty-and-returns") { body }
    page4: page(handle: "faq") { body }
    page5: page(handle: "size-guide") { body }
    page6: page(handle: "comfort-guide") { body }
    page7: page(handle: "mattress-types-guide") { body }
    page8: page(handle: "adjustable-base-guide") { body }
    page9: page(handle: "about") { body }
    page10: page(handle: "comfort-guarantee") { body }
    page11: page(handle: "price-guarantee") { body }
    page12: page(handle: "privacy-policy") { body }
    page13: page(handle: "terms") { body }
    page14: page(handle: "accessibility") { body }
    blog0: blog(handle: "journal") { handle articles(first: 1) { nodes { id } } }
    shop {
      privacyPolicy { id }
      termsOfService { id }
    }
  }
` as const;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

function hasContent(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.body === 'string' &&
    pageHasContent(value.body)
  );
}

/** A blog counts when it has at least one article: a link to an empty listing would promise reading that is not there. */
function hasArticles(value: Readonly<Record<string, unknown>>): boolean {
  const articles = value.articles;
  return (
    isRecord(articles) &&
    Array.isArray(articles.nodes) &&
    articles.nodes.length > 0
  );
}

/** Reads the answer by alias and registry position; anything that is not the expected shape counts as absent. */
export function availabilityFrom(
  data: ContentPagesQuery | null | undefined,
): ContentAvailability {
  if (!data) return NO_CONTENT;
  // Read by computed alias below, so the generated object type is viewed as a plain record.
  const record: Readonly<Record<string, unknown>> = data;
  const pages = new Set<string>();
  CONTENT_PAGES.forEach((page, index) => {
    if (hasContent(record[`page${index}`])) pages.add(page.handle);
  });
  const blogs = new Set<string>();
  CONTENT_BLOGS.forEach((blog, index) => {
    const found = record[`blog${index}`];
    if (isRecord(found) && found.handle === blog.handle && hasArticles(found)) {
      blogs.add(blog.handle);
    }
  });
  const policies = new Set<PolicyField>();
  const shop = record.shop;
  if (isRecord(shop)) {
    if (isRecord(shop.privacyPolicy)) policies.add('privacyPolicy');
    if (isRecord(shop.termsOfService)) policies.add('termsOfService');
  }
  return Object.freeze({
    pages: readOnlySet(pages),
    policies: readOnlySet(policies),
    blogs: readOnlySet(blogs),
  });
}

// A shop outage would otherwise write the same line on every request of every page.
let failureLogged = false;

// In front of the Storefront cache sits a small memory of the DERIVED answer (security review C-M2): which pages exist,
// not their bodies. The root loader waits for it on every document request, and Hydrogen's in-memory cache holds only
// 500 entries, so junk URLs could evict the 15-page entry and make every request parse 15 bodies again. The
// memory holds booleans and paths only, so nothing a shopper sent and nothing from a shopper can be in it, and it is
// the same for everyone. After FRESH_MS the next request refreshes it (through the Storefront cache); if that read
// fails, the last good answer keeps serving for MAX_STALE_MS (stale-if-error) before the links are dropped. A refresh
// is awaited, never left running after the response: a runtime may cut such work off, and a promise that never
// settles would block every later refresh.
export const AVAILABILITY_FRESH_MS = 60_000;
export const AVAILABILITY_MAX_STALE_MS = 600_000;
// A caller waits at most this long for the shared read (security re-review RR-L2): past it, the page is built with the
// last answer or none, and the read carries on for the next request. After a failure or a timeout the read is not
// tried again for BACKOFF_MS (RR-L3), so a slow or broken Shopify costs each page nothing instead of a wait.
export const AVAILABILITY_TIMEOUT_MS = 3_000;
export const AVAILABILITY_BACKOFF_MS = 15_000;

let memory: {readonly value: ContentAvailability; readonly at: number} | null =
  null;
let refresh: Promise<ContentAvailability> | null = null;
let backoffUntil = 0;

/** Test seam: forgets the logged failure and the remembered answer, so each test starts like a fresh isolate. */
export function resetContentPagesLogMemory(): void {
  failureLogged = false;
  memory = null;
  refresh = null;
  backoffUntil = 0;
}

/** The last good answer while it is young enough, otherwise nothing. */
function fallbackAnswer(now: number): ContentAvailability {
  return memory && now - memory.at < AVAILABILITY_MAX_STALE_MS
    ? memory.value
    : NO_CONTENT;
}

/** The first of the read and the timer; the read is not cancelled, so it can still finish for the next request. */
function raceTimeout(
  work: Promise<ContentAvailability>,
  onTimeout: () => ContentAvailability,
): Promise<ContentAvailability> {
  return new Promise((resolve) => {
    const timer = setTimeout(
      () => resolve(onTimeout()),
      AVAILABILITY_TIMEOUT_MS,
    );
    const done = (value: ContentAvailability) => {
      clearTimeout(timer);
      resolve(value);
    };
    work.then(done, () => done(onTimeout()));
  });
}

async function readAvailability(
  storefront: Storefront,
  now: number,
): Promise<ContentAvailability> {
  try {
    const data = await storefront.query(CONTENT_PAGES_QUERY, {
      cache: catalogCache(storefront),
    });
    failureLogged = false;
    backoffUntil = 0;
    const value = availabilityFrom(data);
    memory = {value, at: now};
    return value;
  } catch (error: unknown) {
    if (!failureLogged) {
      failureLogged = true;
      logError('content.pages_read_failed', errorFields(error));
    }
    backoffUntil = now + AVAILABILITY_BACKOFF_MS;
    return fallbackAnswer(now);
  }
}

/**
 * Which registry pages, policies and blogs exist with content. Never rejects. Requests that arrive while a refresh
 * is running share it, so a busy minute makes one read, not one per request.
 */
export async function loadContentAvailability(
  storefront: Storefront,
  now: number = Date.now(),
): Promise<ContentAvailability> {
  if (memory && now - memory.at < AVAILABILITY_FRESH_MS) return memory.value;
  if (now < backoffUntil) return fallbackAnswer(now);
  refresh ??= readAvailability(storefront, now).finally(() => {
    refresh = null;
  });
  return raceTimeout(refresh, () => {
    // A read that does not answer in time is treated like a failed one for the next BACKOFF_MS.
    backoffUntil = now + AVAILABILITY_BACKOFF_MS;
    return fallbackAnswer(now);
  });
}

/** The footer's Shopify page links; an empty list when nothing exists or the read failed. */
export async function loadFooterPageLinks(
  storefront: Storefront,
  now?: number,
): Promise<FooterPageLink[]> {
  return footerPageLinks(await loadContentAvailability(storefront, now));
}
