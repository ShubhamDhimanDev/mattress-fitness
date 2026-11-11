// @vitest-environment jsdom
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {cleanup, render, screen, within} from '@testing-library/react';
import {MemoryRouter} from 'react-router';
import {afterEach, describe, expect, it} from 'vitest';
import {SaleOffers} from '~/components/home/SaleOffers';
import {SITE_IMAGES} from '~/lib/site-images';

// CR-35: the brand offers under the home hero. The wording is the owner's (taken from the supplied sale images); the test
// pins that it is live text with working brand links, and that every photograph it uses exists in public/images.

afterEach(cleanup);

function renderOffers() {
  render(
    <MemoryRouter>
      <SaleOffers />
    </MemoryRouter>,
  );
}

describe('SaleOffers: the offer text is markup, not part of a picture', () => {
  it('has one labelled section with the three photo offers as headings with real text', () => {
    renderOffers();
    expect(
      screen.getByRole('region', {name: 'Brand offers'}),
    ).toBeInTheDocument();
    const headings = screen
      .getAllByRole('heading', {level: 3})
      .map((heading) => heading.textContent?.replace(/\s+/g, ' ').trim());
    expect(headings).toContain('Save up to $1000');
    expect(headings).toContain('Save up to $500');
    expect(screen.getAllByText('Plus, $300 free gift!')).toHaveLength(3);
    expect(screen.getAllByText(/on adjustable sets/i)).toHaveLength(3);
  });

  it('shows the gold percentage tiles and the free-base banner as text', () => {
    renderOffers();
    expect(screen.getAllByText('70%')).toHaveLength(2);
    expect(screen.getByText('60%')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', {level: 3, name: 'Free adjustable base'}),
    ).toBeInTheDocument();
    expect(
      screen.getByText('on Aireloom, Kingsdown and Molecule mattresses'),
    ).toBeInTheDocument();
    expect(screen.getByText('*T&C apply.')).toBeInTheDocument();
  });

  it('puts a live "up to --% off" stamp on the Casper and Helix banners, and no dollar amount', () => {
    renderOffers();
    expect(
      screen.getByRole('heading', {level: 3, name: 'Casper'}),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Mattresses, pillows and sheets.'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', {level: 3, name: 'Helix'}),
    ).toBeInTheDocument();
    const text =
      screen.getByRole('region', {name: 'Brand offers'}).textContent ?? '';
    // The stamps are text: the owner's figures (Casper 35%, Helix 30%).
    expect(screen.getByText('35%')).toBeInTheDocument();
    expect(screen.getByText('30%')).toBeInTheDocument();
    // Only the owner's offers carry a dollar amount: three headings, three gifts.
    expect((text.match(/\$\d/g) ?? []).length).toBe(6);
  });

  it('keeps the moving ticker out of the accessibility tree, as it repeats the offers written out below', () => {
    renderOffers();
    const ticker = screen
      .getByRole('region', {name: 'Brand offers'})
      .querySelector('[aria-hidden="true"].overflow-hidden');
    expect(ticker?.textContent).toMatch(/Beautyrest: up to 70% off/);
  });

  it('sends the free-base banner to Aireloom, Kingsdown and Molecule, and to no other brand', () => {
    renderOffers();
    const banner = screen
      .getByRole('heading', {level: 3, name: 'Free adjustable base'})
      .closest('div')?.parentElement;
    const hrefs = within(banner as HTMLElement)
      .getAllByRole('link')
      .map((link) => link.getAttribute('href'));
    expect(hrefs).toEqual([
      '/brands/aireloom?sort=mattress-first',
      '/brands/kingsdown?sort=mattress-first',
      '/brands/molecule?sort=mattress-first',
    ]);
  });

  it('does not offer a brand the store does not carry', () => {
    renderOffers();
    expect(screen.queryByText(/purple/i)).toBeNull();
  });
});

describe('SaleOffers: links and pictures', () => {
  it('sends every action to a brand page of a brand the store carries', () => {
    renderOffers();
    const section = screen.getByRole('region', {name: 'Brand offers'});
    const hrefs = within(section)
      .getAllByRole('link')
      .map((link) => link.getAttribute('href'));
    expect(hrefs.length).toBeGreaterThanOrEqual(11);
    const allowed = [
      'stearns-and-foster',
      'aireloom',
      'kingsdown',
      'molecule',
      'beautyrest',
      'tempur-pedic',
      'serta',
      'sealy',
      'casper',
      'helix',
    ].map((handle) => `/brands/${handle}?sort=mattress-first`);
    for (const href of hrefs) expect(allowed).toContain(href);
  });

  it('gives every link a name that says where it goes', () => {
    renderOffers();
    for (const link of within(
      screen.getByRole('region', {name: 'Brand offers'}),
    ).getAllByRole('link')) {
      expect(link).toHaveAccessibleName(/shop/i);
    }
  });

  it('uses only photographs that ship in public/images, each in both widths', () => {
    const offerImages = Object.entries(SITE_IMAGES).filter(([name]) =>
      name.startsWith('offer'),
    );
    expect(offerImages).toHaveLength(6);
    for (const [, image] of offerImages) {
      if (!('src' in image)) continue;
      const files = [
        image.src,
        ...image.srcSet.split(',').map((part) => part.trim().split(' ')[0]),
      ];
      for (const file of files) {
        expect(existsSync(resolve('public', `.${file}`)), file).toBe(true);
      }
    }
  });

  it('describes the pictures that carry meaning and leaves decorative ones empty', () => {
    renderOffers();
    expect(
      screen.getByRole('img', {name: /split adjustable bed/}),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('img').length).toBeGreaterThanOrEqual(3);
  });
});
