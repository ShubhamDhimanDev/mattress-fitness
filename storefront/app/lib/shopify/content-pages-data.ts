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

import type {Storefront} from '@shopify/hydrogen';
import type {ContentPagesQuery} from 'storefrontapi.generated';
import {errorFields, logError} from '~/lib/logging/logger';
import {pageHasContent} from '~/lib/pages/content-pages-html';
import {
  CONTENT_BLOGS,
  CONTENT_PAGES,
  NO_CONTENT,
  footerPageLinks,
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
  return {pages, policies, blogs};
}

// A shop outage would otherwise write the same line on every request of every page.
let failureLogged = false;

/** Test seam: forgets the logged failure, so each test starts like a fresh isolate. */
export function resetContentPagesLogMemory(): void {
  failureLogged = false;
}

export async function loadContentAvailability(
  storefront: Storefront,
): Promise<ContentAvailability> {
  try {
    const data = await storefront.query(CONTENT_PAGES_QUERY, {
      cache: catalogCache(storefront),
    });
    failureLogged = false;
    return availabilityFrom(data);
  } catch (error: unknown) {
    if (!failureLogged) {
      failureLogged = true;
      logError('content.pages_read_failed', errorFields(error));
    }
    return NO_CONTENT;
  }
}

/** The footer's Shopify page links; an empty list when nothing exists or the read failed. */
export async function loadFooterPageLinks(
  storefront: Storefront,
): Promise<FooterPageLink[]> {
  return footerPageLinks(await loadContentAvailability(storefront));
}
