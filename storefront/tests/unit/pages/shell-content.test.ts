import {describe, expect, it} from 'vitest';
import {
  FOOTER_QUICK_LINKS_END_DRAFT,
  FOOTER_QUICK_LINKS_START_DRAFT,
  FOOTER_SUPPORT_GROUPS,
  FOOTER_SUPPORT_GROUPS_DRAFT,
  HOME_ASSURANCE_ITEMS,
  REASSURANCE_DRAFT,
  REASSURANCE_ITEMS,
  publishedLinks,
  visibleQuickLinks,
} from '~/lib/navigation';

// REQ-CNT-001 / B-15: unsupplied claims and contact details are held back.

describe('unsupplied claims (B-15)', () => {
  it('shows the three promises from the reference strip under the menu (CR-31)', () => {
    expect(REASSURANCE_ITEMS.map((i) => i.text)).toEqual([
      'Free in-home delivery & setup',
      '100% comfort guarantee',
      'Price guarantee',
    ]);
    // The home page has no second row or hero note: the strip under the menu is the one place.
    expect(HOME_ASSURANCE_ITEMS).toEqual([]);
    expect(REASSURANCE_DRAFT).toHaveLength(REASSURANCE_ITEMS.length);
  });

  it('holds back every Shopify-written footer link until the page exists (no page data, no link)', () => {
    const labels = (groups: typeof FOOTER_SUPPORT_GROUPS) =>
      groups.flatMap((g) => g.links.map((l) => l.label));
    // The links to client-written pages are no longer fixed footer data: the registry adds them when the page
    // exists with content (tests/unit/pages/content-pages.test.ts), so none is listed here, claims included.
    const pageLabels = [
      'Contact us',
      'Delivery and shipping',
      'Financing',
      'Warranty and returns',
      'FAQ',
      'Size guide',
      'Comfort guide',
      'Mattress types guide',
      'Adjustable base guide',
      'About us',
      'Comfort guarantee',
      'Price guarantee',
      'Accessibility',
      'Sleep journal',
    ];
    for (const label of pageLabels) {
      expect(labels(FOOTER_SUPPORT_GROUPS_DRAFT), label).not.toContain(label);
      expect(labels(FOOTER_SUPPORT_GROUPS), label).not.toContain(label);
    }
    expect(labels(FOOTER_SUPPORT_GROUPS)).toEqual(
      expect.arrayContaining(['Sleep quiz']),
    );
  });

  it('shows no quick link to a page that does not exist (awaitingContent and page links)', () => {
    const draft = [
      ...FOOTER_QUICK_LINKS_START_DRAFT,
      ...FOOTER_QUICK_LINKS_END_DRAFT,
    ];
    // Without page data only the links that need no Shopify page remain; /track-order still waits (P6-08 flag).
    const shown = visibleQuickLinks(draft, []);
    expect(shown.map((l) => l.id)).toEqual([]);
    for (const to of [
      '/track-order',
      '/pages/delivery-and-shipping',
      '/pages/contact',
    ]) {
      expect(
        draft.map((l) => l.to),
        to,
      ).toContain(to);
      expect(
        shown.map((l) => l.to),
        to,
      ).not.toContain(to);
    }
    const support = FOOTER_SUPPORT_GROUPS.flatMap((g) =>
      g.links.map((l) => l.to),
    );
    expect(support).not.toContain('/track-order');
  });

  it('publishedLinks drops only entries marked awaitingContent', () => {
    expect(
      publishedLinks([
        {a: 1},
        {a: 2, awaitingContent: true},
        {a: 3, awaitingContent: false},
      ]),
    ).toEqual([{a: 1}, {a: 3, awaitingContent: false}]);
  });
});
