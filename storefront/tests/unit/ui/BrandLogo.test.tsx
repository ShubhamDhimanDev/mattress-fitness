// @vitest-environment jsdom
import {cleanup, render, screen} from '@testing-library/react';
import {createRoutesStub} from 'react-router';
import {afterEach, describe, expect, it} from 'vitest';
import {FooterLogo, HeaderLogo} from '~/components/layout/BrandLogo';
import {SiteFooter} from '~/components/layout/SiteFooter';
import {
  BRAND_HEAD_LINKS,
  BRAND_NAME,
  BRAND_TAGLINE,
  BRAND_THEME_COLOR,
  FOOTER_LOGO,
  HEADER_LOGO,
  logoPath,
} from '~/lib/brand';
import {SITE_NAME} from '~/lib/navigation';

afterEach(cleanup);

// The client's logo in the header and footer, and the head tags built from it (REQ-NAV-001, NFR-003).

function renderIn(element: React.ReactNode) {
  const Stub = createRoutesStub([{path: '/', Component: () => element}]);
  return render(<Stub initialEntries={['/']} />);
}

describe('the brand constants', () => {
  it('uses one store name everywhere', () => {
    expect(BRAND_NAME).toBe('Mattress Fitness');
    expect(SITE_NAME).toBe(BRAND_NAME);
  });

  it('never points at the 543 kB original', () => {
    const everyUrl = [
      HEADER_LOGO.src,
      HEADER_LOGO.srcSet,
      FOOTER_LOGO.src,
      FOOTER_LOGO.srcSet,
      ...BRAND_HEAD_LINKS.map((link) => link.href),
    ].join(' ');
    expect(everyUrl).not.toContain('original');
    expect(everyUrl).not.toContain('1254');
  });

  it('builds the favicon and touch icon links from the resized files', () => {
    expect(BRAND_HEAD_LINKS).toEqual([
      {
        rel: 'icon',
        type: 'image/png',
        sizes: '48x48',
        href: '/brand/mattress-fitness-logo-48.png',
      },
      {
        rel: 'apple-touch-icon',
        sizes: '180x180',
        href: '/brand/mattress-fitness-logo-180.png',
      },
    ]);
  });

  it('uses the logo red for the theme colour', () => {
    expect(BRAND_THEME_COLOR).toBe('#DE0510');
  });
});

describe('HeaderLogo', () => {
  it('is a link to the home page named "Mattress Fitness home"', () => {
    renderIn(<HeaderLogo />);
    const link = screen.getByRole('link', {name: 'Mattress Fitness home'});
    expect(link).toHaveAttribute('href', '/');
  });

  it('has one image with the brand alt, explicit size and the 1x/2x files', () => {
    renderIn(<HeaderLogo />);
    const img = screen.getByRole('img', {name: BRAND_NAME});
    expect(screen.getAllByRole('img')).toHaveLength(1);
    expect(img).toHaveAttribute('src', logoPath(96));
    expect(img).toHaveAttribute(
      'srcset',
      `${logoPath(96)} 1x, ${logoPath(180)} 2x`,
    );
    expect(img).toHaveAttribute('width', '56');
    expect(img).toHaveAttribute('height', '56');
  });

  it('loads eagerly at high priority, as it is above the fold', () => {
    renderIn(<HeaderLogo />);
    const img = screen.getByRole('img', {name: BRAND_NAME});
    expect(img).toHaveAttribute('loading', 'eager');
    expect(img).toHaveAttribute('fetchpriority', 'high');
  });

  it('shows no visible wordmark text that would repeat the name', () => {
    renderIn(<HeaderLogo />);
    expect(screen.queryByText(BRAND_NAME)).toBeNull();
    // Exactly one accessible name for the logo: the link's (the image's alt is not read inside it).
    expect(screen.getAllByRole('link')).toHaveLength(1);
  });
});

describe('FooterLogo and the footer', () => {
  it('uses the 256 and 512 files with sizes, explicit dimensions and lazy loading', () => {
    renderIn(<FooterLogo />);
    const img = screen.getByRole('img', {name: BRAND_NAME});
    expect(img).toHaveAttribute('src', logoPath(256));
    expect(img).toHaveAttribute(
      'srcset',
      `${logoPath(256)} 256w, ${logoPath(512)} 512w`,
    );
    expect(img).toHaveAttribute('sizes', '112px');
    expect(img).toHaveAttribute('width', '112');
    expect(img).toHaveAttribute('height', '112');
    expect(img).toHaveAttribute('loading', 'lazy');
  });

  it('shows the logo once and the tagline as plain text, not as an image or link', () => {
    renderIn(<SiteFooter />);
    expect(screen.getAllByRole('img', {name: BRAND_NAME})).toHaveLength(1);
    const tagline = screen.getByText(BRAND_TAGLINE);
    expect(BRAND_TAGLINE).toBe('Rest. Recover. Perform.');
    expect(tagline.tagName).toBe('P');
    expect(tagline.closest('a')).toBeNull();
  });
});
