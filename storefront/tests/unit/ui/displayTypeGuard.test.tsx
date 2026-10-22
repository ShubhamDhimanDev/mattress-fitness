// @vitest-environment jsdom
import {cleanup, render, screen} from '@testing-library/react';
import {createRoutesStub} from 'react-router';
import {afterEach, describe, expect, it} from 'vitest';
import {MainNav} from '~/components/layout/MainNav';
import {MobileNav} from '~/components/layout/MobileNav';
import {PromoBar} from '~/components/layout/PromoBar';
import {FooterGroups} from '~/components/layout/SiteFooter';
import {Accordion} from '~/components/ui/Accordion';
import {DISPLAY_TYPE_MAX_LENGTH} from '~/lib/display-type';
import type {MainNavItem} from '~/lib/navigation';

afterEach(cleanup);

// REQ-NAV-001, NFR-003, BRAND_APPLICATION_SPEC 2.7: heavy uppercase display type only for short labels. Text typed into
// Shopify admin or the navigation data can be any length, so past 40 characters it goes back to sentence case.

const SHORT = 'Free delivery this week';
const LONG =
  'Free delivery on every mattress ordered before the end of the month';

function renderIn(element: React.ReactNode) {
  const Stub = createRoutesStub([{path: '/', Component: () => element}]);
  return render(<Stub initialEntries={['/']} />);
}

describe('PromoBar display type guard', () => {
  it('uses display type for a short message and plain heavy type for a long one', () => {
    expect(SHORT.length).toBeLessThanOrEqual(DISPLAY_TYPE_MAX_LENGTH);
    expect(LONG.length).toBeGreaterThan(DISPLAY_TYPE_MAX_LENGTH);
    renderIn(<PromoBar message={{text: SHORT}} />);
    expect(screen.getByText(SHORT)).toHaveClass('type-display');
    cleanup();
    renderIn(<PromoBar message={{text: LONG}} />);
    const long = screen.getByText(LONG);
    expect(long).toHaveClass('font-extrabold');
    expect(long).not.toHaveClass('type-display');
  });

  it('judges a link label on its own length', () => {
    renderIn(
      <PromoBar
        message={{text: SHORT, to: '/collections/sale', linkLabel: LONG}}
      />,
    );
    expect(screen.getByText(SHORT)).toHaveClass('type-display');
    expect(screen.getByRole('link', {name: LONG})).toHaveClass(
      'font-extrabold',
    );
    expect(screen.getByRole('link', {name: LONG})).not.toHaveClass(
      'type-display',
    );
  });

  it('applies the same guard when the whole message is the link', () => {
    renderIn(<PromoBar message={{text: LONG, to: '/collections/sale'}} />);
    expect(screen.getByRole('link', {name: LONG})).not.toHaveClass(
      'type-display',
    );
  });
});

const NAV: readonly MainNavItem[] = [
  {kind: 'link', id: 'short', label: 'Sale', to: '/collections/sale'},
  {kind: 'link', id: 'long', label: LONG, to: '/collections/long'},
  {
    kind: 'menu',
    id: 'menu-long',
    label: LONG,
    to: '/collections/menu',
    groups: [
      {
        id: 'g1',
        heading: LONG,
        links: [{label: 'Queen', to: '/collections/queen'}],
      },
      {
        id: 'g2',
        heading: 'Shop by size',
        links: [{label: 'King', to: '/collections/king'}],
      },
    ],
  },
];

describe('MainNav display type guard', () => {
  it('guards each top-level label and each group heading by its own length', () => {
    renderIn(<MainNav items={NAV} />);
    expect(screen.getByRole('link', {name: 'Sale'})).toHaveClass(
      'type-display',
    );
    const long = screen.getByRole('link', {name: LONG});
    expect(long).toHaveClass('font-extrabold');
    expect(long).not.toHaveClass('type-display');
    expect(screen.getByRole('button', {name: LONG})).not.toHaveClass(
      'type-display',
    );
    expect(screen.getByText(LONG, {selector: 'p'})).not.toHaveClass(
      'uppercase',
    );
    expect(screen.getByText('Shop by size')).toHaveClass('uppercase');
  });
});

describe('mobile menu display type guard', () => {
  it('guards the rows and the group headings', () => {
    renderIn(<MobileNav items={NAV} onNavigate={() => {}} />);
    expect(screen.getByRole('link', {name: 'Sale'})).toHaveClass(
      'type-display',
    );
    expect(screen.getByRole('link', {name: LONG})).not.toHaveClass(
      'type-display',
    );
    expect(screen.getByRole('button', {name: LONG})).not.toHaveClass(
      'type-display',
    );
    expect(screen.getByText(LONG, {selector: 'p'})).not.toHaveClass(
      'uppercase',
    );
  });

  it('leaves non-text titles of a menu accordion in display type', () => {
    render(
      <Accordion
        variant="menu"
        items={[{id: 'x', title: <span>Rich</span>, content: <p>c</p>}]}
      />,
    );
    expect(screen.getByRole('button')).toHaveClass('type-display');
  });
});

describe('footer group heading display type guard', () => {
  it('guards the visible heading and the phone toggle by the heading length', () => {
    renderIn(
      <FooterGroups
        className=""
        groups={[
          {
            id: 'a',
            heading: 'About',
            links: [{label: 'Us', to: '/pages/about'}],
          },
          {id: 'b', heading: LONG, links: [{label: 'Them', to: '/pages/them'}]},
        ]}
      />,
    );
    const shortHeadings = screen.getAllByText('About');
    const longHeadings = screen.getAllByText(LONG);
    // One plain heading (desktop) and one toggle button (phone) per group.
    expect(shortHeadings).toHaveLength(2);
    for (const node of shortHeadings) expect(node).toHaveClass('type-display');
    expect(longHeadings).toHaveLength(2);
    for (const node of longHeadings) {
      expect(node).toHaveClass('font-extrabold');
      expect(node).not.toHaveClass('type-display');
    }
  });
});
