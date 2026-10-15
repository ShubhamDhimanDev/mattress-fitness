import {describe, expect, it} from 'vitest';
import {
  dropProductEntries,
  isEmptySitemapBody,
  EMPTY_SITEMAP_MARKER,
} from '~/lib/seo/sitemap';
import {offerOnlyHandlesFrom} from '~/lib/shopify/offer-only';

// Security review K-L3 and K-L9: offer-only products stay out of the sitemap; an empty page is detectable.

const block = (handle: string) =>
  `<url>\n  <loc>https://www.example.com/products/${handle}</loc>\n  <lastmod>2026-10-01T10:00:00Z</lastmod>\n</url>`;
const xml = (...handles: string[]) =>
  `<?xml version="1.0"?><urlset>${handles.map(block).join('\n')}</urlset>`;

describe('dropProductEntries', () => {
  it('removes exactly the listed handles, keeping lookalikes and other entries', () => {
    const out = dropProductEntries(
      xml('a', 'plan', 'plan-2', 'b'),
      new Set(['plan']),
    );
    expect(out).toContain('/products/a<');
    expect(out).toContain('/products/plan-2<');
    expect(out).toContain('/products/b<');
    expect(out).not.toContain('/products/plan<');
    expect(out.match(/<url>/g)).toHaveLength(3);
  });

  it('matches encoded handles and ignores a hostile one', () => {
    const out = dropProductEntries(
      xml('matelas-%C3%A9t%C3%A9', 'ok'),
      new Set(['matelas-été', '</url><url>']),
    );
    expect(out).not.toContain('matelas');
    expect(out).toContain('/products/ok<');
  });

  it('returns the input untouched when nothing is excluded', () => {
    const input = xml('a');
    expect(dropProductEntries(input, new Set())).toBe(input);
  });
});

describe('empty page marker', () => {
  it('is recognised in the body Hydrogen writes for a page without items', () => {
    expect(
      isEmptySitemapBody(
        `<url><loc>https://x.test${EMPTY_SITEMAP_MARKER}</loc></url>`,
      ),
    ).toBe(true);
    expect(isEmptySitemapBody(xml('a'))).toBe(false);
  });
});

describe('offerOnlyHandlesFrom', () => {
  it('collects handles and tolerates missing data', () => {
    expect(
      offerOnlyHandlesFrom({
        products: {nodes: [{handle: 'a'}, {handle: ''}, {handle: 'b'}]},
      }),
    ).toEqual(new Set(['a', 'b']));
    expect(offerOnlyHandlesFrom(null)).toEqual(new Set());
    expect(offerOnlyHandlesFrom(undefined)).toEqual(new Set());
  });
});
