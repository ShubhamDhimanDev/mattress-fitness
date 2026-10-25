// The 15 content pages and the blog the footer and the page routes know about (REQ-CNT-001, REQ-CNT-002, P6-09).
//
// The client's team writes the text in Shopify admin (Online Store > Pages, Settings > Policies, Blog posts); this
// registry only says which handle each page is expected at, what to call it when Shopify gives no title, and
// where its footer link sits. Nothing here is page text, and no policy, legal or warranty wording is invented
// (B-15). A link is shown only when the Shopify page exists and has content: see `footerPageLinks`.
//
// Pure data and functions with no framework imports. It is used on the server (the root loader and the page
// loaders); the browser only receives the resulting `FooterPageLink` list, so this module stays out of the bundle.

import type {FooterGroupId, FooterPageLink} from '~/lib/navigation';

/** The shop policies Shopify keeps under Settings > Policies that have a registry page. */
export type PolicyField = 'privacyPolicy' | 'termsOfService';

export type ContentPage = {
  /** The handle the page is expected to have in Shopify (the URL is `/pages/<handle>`). */
  readonly handle: string;
  /** Shown as the page title when Shopify returns none. */
  readonly title: string;
  /** Footer link text. */
  readonly label: string;
  readonly group: FooterGroupId;
  /** Position among the links of the group (static links use the same scale, see navigation.ts). */
  readonly order: number;
  /**
   * Privacy policy and terms live in Shopify Settings > Policies as ONE copy (owner decision, 2026-10-25): the
   * footer then links `/policies/<urlHandle>`, and `/pages/<handle>` redirects there when no page has that handle.
   */
  readonly policy?: {
    readonly field: PolicyField;
    readonly urlHandle: 'privacy-policy' | 'terms-of-service';
  };
  /** The FAQ page may carry FAQPage markup, when its text has a question and answer structure. */
  readonly faq?: true;
};

export const CONTENT_PAGES: readonly ContentPage[] = [
  {
    handle: 'contact',
    title: 'Contact us',
    label: 'Contact us',
    group: 'support',
    order: 10,
  },
  {
    handle: 'delivery-and-shipping',
    title: 'Delivery and shipping',
    label: 'Delivery and shipping',
    group: 'support',
    order: 30,
  },
  {
    handle: 'financing',
    title: 'Financing',
    label: 'Financing',
    group: 'support',
    order: 40,
  },
  {
    handle: 'warranty-and-returns',
    title: 'Warranty and returns',
    label: 'Warranty and returns',
    group: 'support',
    order: 50,
  },
  {
    handle: 'faq',
    title: 'Frequently asked questions',
    label: 'FAQ',
    group: 'support',
    order: 60,
    faq: true,
  },
  {
    handle: 'size-guide',
    title: 'Size guide',
    label: 'Size guide',
    group: 'sleep-guide',
    order: 30,
  },
  {
    handle: 'comfort-guide',
    title: 'Comfort guide',
    label: 'Comfort guide',
    group: 'sleep-guide',
    order: 40,
  },
  {
    handle: 'mattress-types-guide',
    title: 'Mattress types guide',
    label: 'Mattress types guide',
    group: 'sleep-guide',
    order: 50,
  },
  {
    handle: 'adjustable-base-guide',
    title: 'Adjustable base guide',
    label: 'Adjustable base guide',
    group: 'sleep-guide',
    order: 60,
  },
  {
    handle: 'about',
    title: 'About us',
    label: 'About us',
    group: 'about',
    order: 10,
  },
  {
    handle: 'comfort-guarantee',
    title: 'Comfort guarantee',
    label: 'Comfort guarantee',
    group: 'about',
    order: 30,
  },
  {
    handle: 'price-guarantee',
    title: 'Price guarantee',
    label: 'Price guarantee',
    group: 'about',
    order: 40,
  },
  {
    handle: 'privacy-policy',
    title: 'Privacy policy',
    label: 'Privacy policy',
    group: 'legal',
    order: 10,
    policy: {field: 'privacyPolicy', urlHandle: 'privacy-policy'},
  },
  {
    handle: 'terms',
    title: 'Terms of service',
    label: 'Terms',
    group: 'legal',
    order: 20,
    policy: {field: 'termsOfService', urlHandle: 'terms-of-service'},
  },
  {
    handle: 'accessibility',
    title: 'Accessibility',
    label: 'Accessibility',
    group: 'legal',
    order: 30,
  },
];

export type ContentBlog = {
  readonly handle: string;
  readonly label: string;
  readonly group: FooterGroupId;
  readonly order: number;
};

/**
 * The blog the site links to (the sleep journal). The handle is one constant, so a client whose blog has another
 * handle changes it here; the footer link appears only when a blog with this handle exists in Shopify.
 */
export const JOURNAL_BLOG_HANDLE = 'journal';

export const CONTENT_BLOGS: readonly ContentBlog[] = [
  {
    handle: JOURNAL_BLOG_HANDLE,
    label: 'Sleep journal',
    group: 'sleep-guide',
    order: 70,
  },
];

/** What exists in Shopify, with content: the input of every visibility rule below. */
export type ContentAvailability = {
  /** Handles of Shopify pages whose body has text. */
  readonly pages: ReadonlySet<string>;
  readonly policies: ReadonlySet<PolicyField>;
  /** Handles of Shopify blogs. */
  readonly blogs: ReadonlySet<string>;
};

/**
 * A set that cannot be changed: the answer is remembered and shared by every request, so one consumer adding to it
 * would change what all the others see (security re-review RR-L4). `add`, `delete` and `clear` throw.
 */
class FrozenSet<T> extends Set<T> {
  constructor(items: Iterable<T> = []) {
    super();
    for (const item of items) super.add(item);
    Object.freeze(this);
  }
  override add(): never {
    throw new TypeError('This set is read-only');
  }
  override delete(): never {
    throw new TypeError('This set is read-only');
  }
  override clear(): never {
    throw new TypeError('This set is read-only');
  }
}

export function readOnlySet<T>(items: Iterable<T> = []): ReadonlySet<T> {
  return new FrozenSet(items);
}

export const NO_CONTENT: ContentAvailability = Object.freeze({
  pages: readOnlySet<string>(),
  policies: readOnlySet<PolicyField>(),
  blogs: readOnlySet<string>(),
});

export function contentPageByHandle(handle: unknown): ContentPage | null {
  if (typeof handle !== 'string') return null;
  const wanted = handle.toLowerCase();
  return CONTENT_PAGES.find((page) => page.handle === wanted) ?? null;
}

/** The site path of a registry page's own Shopify page. */
export function contentPagePath(page: ContentPage): string {
  return `/pages/${page.handle}`;
}

function policyPath(page: ContentPage): string | null {
  return page.policy ? `/policies/${page.policy.urlHandle}` : null;
}

/**
 * Where a registry page's footer link goes, or null when there is nothing to show. A policy-type page prefers
 * the Shopify policy (one copy), and falls back to a Shopify page with the same handle if the client wrote it
 * there instead; every other page needs its Shopify page.
 */
export function contentPageTarget(
  page: ContentPage,
  available: ContentAvailability,
): string | null {
  if (page.policy && available.policies.has(page.policy.field)) {
    return policyPath(page);
  }
  return available.pages.has(page.handle) ? contentPagePath(page) : null;
}

/**
 * The footer links of everything that exists: the registry pages and the blog. Missing pages and an empty
 * availability (a failed read) give no link at all, never a link that could 404 (REQ-CNT-001).
 */
export function footerPageLinks(
  available: ContentAvailability,
): FooterPageLink[] {
  const pages = CONTENT_PAGES.flatMap((page) => {
    const to = contentPageTarget(page, available);
    return to
      ? [
          {
            id: `page:${page.handle}`,
            label: page.label,
            to,
            group: page.group,
            order: page.order,
          },
        ]
      : [];
  });
  const blogs = CONTENT_BLOGS.filter((blog) =>
    available.blogs.has(blog.handle),
  ).map((blog) => ({
    id: `blog:${blog.handle}`,
    label: blog.label,
    to: `/blogs/${blog.handle}`,
    group: blog.group,
    order: blog.order,
  }));
  return [...pages, ...blogs];
}

/**
 * The policy URL a `/pages/<handle>` request should be redirected to: the handle is a policy-type registry
 * page, no Shopify page has it, and the Shopify policy exists. Anything else stays a 404.
 */
export function policyRedirectFor(
  handle: unknown,
  available: ContentAvailability,
): string | null {
  const page = contentPageByHandle(handle);
  if (!page?.policy || !available.policies.has(page.policy.field)) return null;
  return policyPath(page);
}
