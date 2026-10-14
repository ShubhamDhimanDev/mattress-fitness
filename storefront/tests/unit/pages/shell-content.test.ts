import {describe, expect, it} from 'vitest';
import {
  FOOTER_SUPPORT_GROUPS,
  FOOTER_SUPPORT_GROUPS_DRAFT,
  HOME_ASSURANCE_ITEMS,
  REASSURANCE_DRAFT,
  REASSURANCE_ITEMS,
  publishedLinks,
} from '~/lib/navigation';
import {hasMyStoreCookie, summarizeMyStore} from '~/lib/pages/my-store-summary';
import {FIXTURE_STORES} from '~/lib/stores/fixtures';
import {buildStoreIndex} from '~/lib/stores/grouping';

// REQ-CNT-001 / B-15: unsupplied guarantees are held back. REQ-LOC-003 / P3B-10: the header's store.

describe('unsupplied guarantee wording (B-15)', () => {
  it('is kept in the draft lists but never in what is rendered', () => {
    const draftText = REASSURANCE_DRAFT.map((i) => i.text);
    expect(draftText).toContain('Comfort guarantee');
    expect(draftText).toContain('Price guarantee');
    const shown = REASSURANCE_ITEMS.map((i) => i.text);
    expect(shown).not.toContain('Comfort guarantee');
    expect(shown).not.toContain('Price guarantee');
    expect(shown).toEqual(['In-home delivery & setup']);
    expect(HOME_ASSURANCE_ITEMS).toEqual(REASSURANCE_ITEMS);
  });

  it('removes the footer guarantee links and keeps the others in order', () => {
    const labels = (groups: typeof FOOTER_SUPPORT_GROUPS) =>
      groups.flatMap((g) => g.links.map((l) => l.label));
    expect(labels(FOOTER_SUPPORT_GROUPS_DRAFT)).toEqual(
      expect.arrayContaining(['Comfort guarantee', 'Price guarantee']),
    );
    const shown = labels(FOOTER_SUPPORT_GROUPS);
    expect(shown).not.toContain('Comfort guarantee');
    expect(shown).not.toContain('Price guarantee');
    expect(shown).toEqual(
      expect.arrayContaining(['About us', 'Find a store', 'Accessibility']),
    );
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

describe('my store in the header', () => {
  const index = buildStoreIndex(FIXTURE_STORES);
  const buffalo = 'new-york.buffalo.buffalo-gallery';

  it('recognises a my_store cookie only when one is present', () => {
    expect(hasMyStoreCookie(null)).toBe(false);
    expect(hasMyStoreCookie('a=1; b=2')).toBe(false);
    expect(hasMyStoreCookie(`a=1; my_store=${buffalo}`)).toBe(true);
  });

  it('returns only the name and slug for a valid cookie', () => {
    expect(summarizeMyStore(index, `my_store=${buffalo}`)).toEqual({
      name: 'Wrenfield Sleep Gallery Buffalo',
      slug: 'buffalo-gallery',
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
