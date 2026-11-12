// @vitest-environment jsdom
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {cleanup, render, screen} from '@testing-library/react';
import {MemoryRouter} from 'react-router';
import {afterEach, describe, expect, it} from 'vitest';
import {PartnerBanner} from '~/components/home/PartnerBanner';
import {SITE_IMAGES} from '~/lib/site-images';

// REQ-HOME-001: the Skechers by Serta banner under the sale banner (owner request 2026-11-06). The words are in the picture,
// so the alt text carries them; the banner is one link to the Skechers brand page and its files ship in public/images.

afterEach(cleanup);

describe('PartnerBanner', () => {
  it('is one labelled section with a link to the Skechers brand page', () => {
    render(
      <MemoryRouter>
        <PartnerBanner />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole('region', {name: 'Skechers by Serta'}),
    ).toBeInTheDocument();
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute(
      'href',
      '/brands/skechers?sort=mattress-first',
    );
    expect(link).toHaveAccessibleName(/shop skechers/i);
  });

  it('describes the picture, including the words drawn into it', () => {
    render(
      <MemoryRouter>
        <PartnerBanner />
      </MemoryRouter>,
    );
    const picture = screen.getByRole('img');
    const alt = picture.getAttribute('alt') ?? '';
    expect(alt).toMatch(/Skechers/);
    expect(alt).toMatch(/powered by Serta/i);
    expect(alt).toMatch(/Everyday Comfort/i);
    expect(alt).toMatch(/\(281\) 758-5279/);
  });

  it('uses image files that exist, in both widths', () => {
    const image = SITE_IMAGES.partnerSkechers;
    const files = [
      image.src,
      ...image.srcSet.split(',').map((part) => part.trim().split(' ')[0]),
    ];
    expect(files).toHaveLength(3);
    for (const file of files) {
      expect(existsSync(resolve('public', `.${file}`)), file).toBe(true);
    }
  });
});
