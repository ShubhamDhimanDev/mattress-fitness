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
  resolveSupportPhone,
  visibleQuickLinks,
} from '~/lib/navigation';
import {hasMyStoreCookie, summarizeMyStore} from '~/lib/pages/my-store-summary';
import {FIXTURE_STORES} from '~/lib/stores/fixtures';
import {buildStoreIndex} from '~/lib/stores/grouping';

// REQ-CNT-001 / B-15: unsupplied claims and contact details are held back. REQ-LOC-003 / P3B-10: the header's store.

describe('unsupplied claims (B-15)', () => {
  it('keeps the reassurance wording in the draft list but renders none of it', () => {
    const draftText = REASSURANCE_DRAFT.map((i) => i.text);
    expect(draftText).toEqual(
      expect.arrayContaining([
        'In-home delivery & setup',
        'Comfort guarantee',
        'Price guarantee',
      ]),
    );
    // Every draft item is invented wording until the client supplies it, so the strip has nothing to show.
    expect(REASSURANCE_DRAFT.every((i) => i.awaitingContent === true)).toBe(
      true,
    );
    expect(REASSURANCE_ITEMS).toEqual([]);
    expect(HOME_ASSURANCE_ITEMS).toEqual(REASSURANCE_ITEMS);
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
      expect.arrayContaining([
        'Sleep quiz',
        'Compare mattresses',
        'Find a store',
      ]),
    );
  });

  it('shows no quick link to a page that does not exist (awaitingContent and page links)', () => {
    const draft = [
      ...FOOTER_QUICK_LINKS_START_DRAFT,
      ...FOOTER_QUICK_LINKS_END_DRAFT,
    ];
    // Without page data only the links that need no Shopify page remain; /track-order still waits (P6-08 flag).
    const shown = visibleQuickLinks(draft, []);
    expect(shown.map((l) => l.id)).toEqual(['account', 'stores']);
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

describe('support phone (B-15: never the invented number)', () => {
  it.each([
    ['(312) 555-0142', '(312) 555-0142', 'tel:+13125550142'],
    ['312-555-0142', '(312) 555-0142', 'tel:+13125550142'],
    ['+1 312 555 0142', '(312) 555-0142', 'tel:+13125550142'],
  ])('formats the configured number %s', (raw, display, href) => {
    expect(resolveSupportPhone(raw, false)).toEqual({display, href});
    expect(resolveSupportPhone(raw, true)).toEqual({display, href});
  });

  it.each([
    undefined,
    null,
    '',
    '   ',
    'call us',
    '555-0142',
    'tel:+1; DROP',
    42,
  ])('shows nothing in production for %j', (raw) => {
    expect(resolveSupportPhone(raw, false)).toBeNull();
  });

  it('falls back to a clearly labelled placeholder only in development', () => {
    const dev = resolveSupportPhone(undefined, true);
    expect(dev?.display).toMatch(/placeholder/i);
    expect(dev?.href).toBe('tel:+18005550100');
    expect(resolveSupportPhone(undefined, false)).toBeNull();
  });
});

describe('my store in the header', () => {
  const index = buildStoreIndex(FIXTURE_STORES);
  const buffalo = 'new-york.buffalo.buffalo-gallery';

  it('recognises a my_store cookie only when one is present', () => {
    expect(hasMyStoreCookie(null)).toBe(false);
    expect(hasMyStoreCookie('a=1; b=2')).toBe(false);
    expect(hasMyStoreCookie(`a=1; my_store=${buffalo}`)).toBe(true);
  });

  it('returns only the name, slug, public key and page path for a valid cookie', () => {
    expect(summarizeMyStore(index, `my_store=${buffalo}`)).toEqual({
      name: 'Wrenfield Sleep Gallery Buffalo',
      slug: 'buffalo-gallery',
      key: buffalo,
      path: '/stores/new-york/buffalo/buffalo-gallery',
    });
  });

  it.each([
    null,
    'my_store=',
    'my_store=new-york.buffalo.nope',
    'my_store=a.b',
    'my_store=%E0%A4%A',
    `my_store=${encodeURIComponent('new-york.buffalo.<script>')}`,
    `my_store=${'x'.repeat(500)}`,
  ])('selects nothing for %j', (header) => {
    expect(summarizeMyStore(index, header)).toBeNull();
  });
});
