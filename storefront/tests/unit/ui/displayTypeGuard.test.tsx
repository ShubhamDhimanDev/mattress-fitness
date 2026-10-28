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

// REQ-NAV-001, NFR-003, BRAND_APPLICATION_SPEC 2.7: text typed into Shopify admin or the navigation data can be any
// length. CR-31: small labels (promo bar, header navigation, footer headings) use plain bold type, never `type-display`
// (too tight at 13 to 16 px) and never capitals, whatever the length. The mobile menu rows (ui/Accordion) and the mega-menu
// group headings keep the 40-character guard, because only those still use display type or capitals.

const SHORT = 'Free delivery this week';
const LONG =
  'Free delivery on every mattress ordered before the end of the month';

function renderIn(element: React.ReactNode) {
  const Stub = createRoutesStub([{path: '/', Component: () => element}]);
  return render(<Stub initialEntries={['/']} />);
}

describe('PromoBar display type guard', () => {
  it('uses plain bold type for a short and a long message alike, never capitals', () => {
    expect(SHORT.length).toBeLessThanOrEqual(DISPLAY_TYPE_MAX_LENGTH);
    expect(LONG.length).toBeGreaterThan(DISPLAY_TYPE_MAX_LENGTH);
    for (const text of [SHORT, LONG]) {
      renderIn(<PromoBar message={{text}} />);
      const node = screen.getByText(text);
      expect(node).toHaveClass('font-extrabold');
      expect(node).not.toHaveClass('type-display');
      expect(node).not.toHaveClass('uppercase');
      cleanup();
    }
  });

  it('styles a link label like the message', () => {
    renderIn(
      <PromoBar
        message={{text: SHORT, to: '/collections/sale', linkLabel: LONG}}
      />,
    );
    expect(screen.getByText(SHORT)).toHaveClass('font-extrabold');
    expect(screen.getByText(SHORT)).not.toHaveClass('type-display');
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
  it('sets every top-level label in plain bold type and guards each group heading by its own length', () => {
    renderIn(<MainNav items={NAV} />);
    for (const link of [
      screen.getByRole('link', {name: 'Sale'}),
      screen.getByRole('link', {name: LONG}),
      screen.getByRole('button', {name: LONG}),
    ]) {
      expect(link).toHaveClass('font-bold');
      expect(link).not.toHaveClass('type-display');
      expect(link).not.toHaveClass('uppercase');
    }
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
  it('sets the visible heading and the phone toggle in plain bold type, whatever the length', () => {
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
    // One plain heading (desktop) and one toggle button (phone) per group.
    for (const text of ['About', LONG]) {
      const nodes = screen.getAllByText(text);
      expect(nodes).toHaveLength(2);
      for (const node of nodes) {
        expect(node).toHaveClass('font-extrabold');
        expect(node).not.toHaveClass('type-display');
        expect(node).not.toHaveClass('uppercase');
      }
    }
  });
});
