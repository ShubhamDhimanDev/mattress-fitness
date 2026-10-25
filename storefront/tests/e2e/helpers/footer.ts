import {expect, type APIRequestContext, type Page} from '@playwright/test';

// The footer's Shopify-content link contract (REQ-CNT-001, P6-09), checked from the outside.
//
// The footer shows a link to a registry page only when that page, or for privacy and terms the Shopify policy,
// exists with content (app/lib/pages/content-pages.ts). The existence read is server-side, so a browser test cannot
// stub it: the same contract is proved here against whatever store the server is connected to, by comparing the
// footer with what the page routes answer. The unit tests (content-pages.test.ts, shell-content.test.ts,
// content-pages-routes.test.ts) hold the deterministic fixtures; this is the end-to-end check of the same rule.
//
// The registry below is a deliberate copy: if a handle or label changes in the app, this must change with it.

type Entry = {
  /** Footer link text of the group link. */
  label: string;
  /** Other link texts that go to the same page (the quick-links row). */
  otherLabels?: readonly string[];
  /** Paths whose answer decides whether the link may show; the first is the preferred target. */
  targets: readonly string[];
  /** Set for privacy and terms: a Shopify policy with this path existing means the link MUST show. */
  policyPath?: string;
  /** Set for a blog: the blog existing means the link MUST show. */
  blogPath?: string;
};

export const FOOTER_ENTRIES: readonly Entry[] = [
  {
    label: 'Contact us',
    otherLabels: ['Get in touch'],
    targets: ['/pages/contact'],
  },
  {
    label: 'Delivery and shipping',
    otherLabels: ['Delivery information'],
    targets: ['/pages/delivery-and-shipping'],
  },
  {label: 'Financing', targets: ['/pages/financing']},
  {label: 'Warranty and returns', targets: ['/pages/warranty-and-returns']},
  {label: 'FAQ', targets: ['/pages/faq']},
  {label: 'Size guide', targets: ['/pages/size-guide']},
  {label: 'Comfort guide', targets: ['/pages/comfort-guide']},
  {label: 'Mattress types guide', targets: ['/pages/mattress-types-guide']},
  {
    label: 'Adjustable base guide',
    targets: ['/pages/adjustable-base-guide'],
  },
  {label: 'About us', targets: ['/pages/about']},
  {label: 'Comfort guarantee', targets: ['/pages/comfort-guarantee']},
  {label: 'Price guarantee', targets: ['/pages/price-guarantee']},
  {
    label: 'Privacy policy',
    targets: ['/policies/privacy-policy', '/pages/privacy-policy'],
    policyPath: '/policies/privacy-policy',
  },
  {
    label: 'Terms',
    targets: ['/policies/terms-of-service', '/pages/terms'],
    policyPath: '/policies/terms-of-service',
  },
  {label: 'Accessibility', targets: ['/pages/accessibility']},
  {
    label: 'Sleep journal',
    targets: ['/blogs/journal'],
    blogPath: '/blogs/journal',
  },
];

const CONTENT_HREF = /^\/(pages|policies|blogs)\//;

export type FooterLink = {href: string; text: string};

export type FooterContractReport = {
  /** Registry labels that have a footer link, with their href. */
  linked: Record<string, string>;
  /** Registry labels with no footer link. */
  notLinked: string[];
  /** The status every checked path answered (redirects not followed). */
  statuses: Record<string, number>;
  /** Every broken rule, each one sentence; empty means the contract holds. */
  problems: string[];
};

/** Every anchor in the footer (collapsed groups keep their links in the HTML, so this works on a phone too). */
export async function footerLinks(page: Page): Promise<FooterLink[]> {
  return page.locator('footer a').evaluateAll((anchors) =>
    anchors.map((anchor) => ({
      href: anchor.getAttribute('href') ?? '',
      text: (anchor.textContent ?? '').replace(/\s+/g, ' ').trim(),
    })),
  );
}

/** Footer hrefs that lead to Shopify content (pages, policies, blogs), distinct and in page order. */
export function contentHrefs(links: readonly FooterLink[]): string[] {
  return [
    ...new Set(
      links.map((link) => link.href).filter((href) => CONTENT_HREF.test(href)),
    ),
  ];
}

/**
 * Compares the footer on the current page with what the server answers for each registry page:
 * - a content link in the footer always resolves with 200 (no 404 or redirecting link);
 * - a registry page whose every target is not a 200 has no link, under any of its labels;
 * - a Shopify policy that answers 200 has its footer link, and so does an existing journal blog.
 * A page that answers 200 with no footer link is fine: it may have no text, which the footer treats as absent.
 */
export async function checkFooterContract(
  page: Page,
  request: APIRequestContext,
): Promise<FooterContractReport> {
  const links = await footerLinks(page);
  const statuses: Record<string, number> = {};
  const probe = async (path: string): Promise<number> => {
    const known = statuses[path];
    if (known !== undefined) return known;
    const response = await request.get(path, {maxRedirects: 0});
    statuses[path] = response.status();
    return response.status();
  };

  const problems: string[] = [];
  for (const href of contentHrefs(links)) {
    const status = await probe(href);
    if (status !== 200)
      problems.push(`footer links ${href} but it answers ${status}`);
  }

  const linked: Record<string, string> = {};
  const notLinked: string[] = [];
  for (const entry of FOOTER_ENTRIES) {
    const labels = [entry.label, ...(entry.otherLabels ?? [])];
    const answers = await Promise.all(entry.targets.map((path) => probe(path)));
    const found = links.filter(
      (link) => entry.targets.includes(link.href) || labels.includes(link.text),
    );
    const first = found[0];
    if (first) linked[entry.label] = first.href;
    else notLinked.push(entry.label);

    if (answers.every((status) => status !== 200) && found.length > 0) {
      problems.push(
        `${entry.label}: no target answers 200 (${answers.join(', ')}) but the footer links ${found
          .map((link) => `"${link.text}" -> ${link.href}`)
          .join('; ')}`,
      );
    }
    const mustShow = entry.policyPath ?? entry.blogPath;
    if (mustShow && (await probe(mustShow)) === 200) {
      if (!links.some((link) => link.href === mustShow)) {
        problems.push(
          `${entry.label}: ${mustShow} answers 200 but the footer has no link to it`,
        );
      }
    }
  }
  return {linked, notLinked, statuses, problems};
}

/** Asserts the contract holds; the failure message lists every broken rule. */
export async function expectFooterContract(
  page: Page,
  request: APIRequestContext,
): Promise<FooterContractReport> {
  const report = await checkFooterContract(page, request);
  expect(report.problems, 'footer content-link contract').toEqual([]);
  return report;
}

/**
 * Opens the collapsed footer group a link sits in (a phone), so the link can be clicked. Does nothing when the
 * link is already visible (desktop, or the legal row).
 */
export async function revealFooterLink(
  link: ReturnType<Page['locator']>,
): Promise<void> {
  if (await link.isVisible()) return;
  await link
    .locator('xpath=ancestor::div[./h2][1]')
    .getByRole('button')
    .click();
  await expect(link).toBeVisible();
}

/** Heading text of each footer link group with the number of links under it. */
export async function footerGroupSizes(
  page: Page,
): Promise<Record<string, number>> {
  return page.evaluate(() => {
    const sizes: Record<string, number> = {};
    document.querySelectorAll('footer nav h2').forEach((heading) => {
      const group = heading.closest('div');
      const name = (heading.textContent ?? '').trim();
      if (!group || name === '') return;
      sizes[name] = group.querySelectorAll('ul a').length;
    });
    return sizes;
  });
}
