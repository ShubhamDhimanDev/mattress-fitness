// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import {createRoutesStub} from 'react-router';
import {afterEach, describe, expect, it} from 'vitest';
import {MainNav} from '~/components/layout/MainNav';
import {MobileNav} from '~/components/layout/MobileNav';
import {buildMainNav, mainNavWithQuizCta} from '~/lib/nav-menu';
import {MAIN_NAV} from '~/lib/navigation';

afterEach(cleanup);

// REQ-NAV-002 (P3B-02): the navigation built from the Shopify menu renders as a keyboard-operable disclosure menu
// on desktop and as the same tree in accordions on mobile.

const SHOP = 'https://example-shop.myshopify.com';

const node = (
  title: string,
  handle: string,
  items: unknown[] = [],
  type = 'COLLECTION',
) => ({title, type, url: `${SHOP}/collections/${handle}`, items});

const SHOPIFY_MENU = {
  items: [
    node('Sale', 'sale'),
    node('Mattresses', 'mattresses', [
      node('Shop by size', 'by-size', [
        node('Queen', 'queen'),
        node('King', 'king'),
      ]),
      node('Hybrid', 'hybrid'),
      node('Plush', 'plush'),
    ]),
    {
      title: 'Guides',
      type: 'HTTP',
      url: null,
      items: [node('Size guide', 'size-guide')],
    },
    {title: 'Partner', type: 'HTTP', url: 'https://partner.example.org/offer'},
  ],
};

const ITEMS = mainNavWithQuizCta(
  buildMainNav(SHOPIFY_MENU, {ownHosts: ['example-shop.myshopify.com']}).items,
  MAIN_NAV,
);

function renderIn(element: React.ReactNode) {
  const Stub = createRoutesStub([{path: '/', Component: () => element}]);
  return render(<Stub initialEntries={['/']} />);
}

describe('REQ-NAV-002 desktop menu from the Shopify menu', () => {
  it('items without children are links and items with children are disclosure buttons', () => {
    renderIn(<MainNav items={ITEMS} />);
    const nav = screen.getByRole('navigation', {name: 'Main'});
    expect(within(nav).getByRole('link', {name: 'Sale'})).toHaveAttribute(
      'href',
      '/collections/sale',
    );
    for (const name of ['Mattresses', 'Guides']) {
      const button = within(nav).getByRole('button', {name});
      expect(button).toHaveAttribute('aria-expanded', 'false');
      expect(button).toHaveAttribute('aria-controls');
    }
    expect(
      within(nav).getByRole('link', {name: 'Find your mattress'}),
    ).toBeInTheDocument();
  });

  it('opens on click, shows groups, a heading link, a heading-less group and View all', () => {
    renderIn(<MainNav items={ITEMS} />);
    const button = screen.getByRole('button', {name: 'Mattresses'});
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');

    const panel = document.getElementById(
      button.getAttribute('aria-controls') ?? '',
    );
    expect(panel).not.toBeNull();
    if (!panel) return;
    expect(
      within(panel).getByRole('link', {name: 'Shop by size'}),
    ).toHaveAttribute('href', '/collections/by-size');
    expect(
      within(within(panel).getByRole('list', {name: 'Shop by size'}))
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Queen', 'King']);
    // The links with no group above them are labelled by their top-level item.
    expect(
      within(within(panel).getByRole('list', {name: 'Mattresses'}))
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Hybrid', 'Plush']);
    expect(
      within(panel).getByRole('link', {name: 'View all mattresses'}),
    ).toHaveAttribute('href', '/collections/mattresses');
  });

  it('Arrow Down opens the panel and focuses its first link; Escape closes it and returns focus', () => {
    renderIn(<MainNav items={ITEMS} />);
    const button = screen.getByRole('button', {name: 'Mattresses'});
    button.focus();
    fireEvent.keyDown(button, {key: 'ArrowDown'});
    expect(button).toHaveAttribute('aria-expanded', 'true');
    const first = screen.getByRole('link', {name: 'Shop by size'});
    expect(first).toHaveFocus();

    fireEvent.keyDown(first, {key: 'Escape'});
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveFocus();
  });

  it('Escape on the trigger closes an open panel', () => {
    renderIn(<MainNav items={ITEMS} />);
    const button = screen.getByRole('button', {name: 'Mattresses'});
    fireEvent.click(button);
    fireEvent.keyDown(button, {key: 'Escape'});
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  it('a top-level item with children but no link of its own has no View all', () => {
    renderIn(<MainNav items={ITEMS} />);
    const button = screen.getByRole('button', {name: 'Guides'});
    fireEvent.click(button);
    const panel = document.getElementById(
      button.getAttribute('aria-controls') ?? '',
    );
    if (!panel) throw new Error('panel missing');
    expect(
      within(panel).getByRole('link', {name: 'Size guide'}),
    ).toBeInTheDocument();
    expect(within(panel).queryByRole('link', {name: /view all/i})).toBeNull();
  });

  it('renders an external menu link as a plain anchor with rel, no new tab', () => {
    renderIn(<MainNav items={ITEMS} />);
    const link = screen.getByRole('link', {name: 'Partner'});
    expect(link).toHaveAttribute('href', 'https://partner.example.org/offer');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link).not.toHaveAttribute('target');
  });

  it('keeps arrow-key movement between top-level items across links and buttons', () => {
    renderIn(<MainNav items={ITEMS} />);
    const sale = screen.getByRole('link', {name: 'Sale'});
    sale.focus();
    fireEvent.keyDown(sale, {key: 'ArrowRight'});
    expect(screen.getByRole('button', {name: 'Mattresses'})).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('button', {name: 'Mattresses'}), {
      key: 'End',
    });
    expect(
      screen.getByRole('link', {name: 'Find your mattress'}),
    ).toHaveFocus();
  });

  it('the fixed fallback navigation still renders when the Shopify menu is absent', () => {
    renderIn(<MainNav items={mainNavWithQuizCta(null, MAIN_NAV)} />);
    expect(
      screen.getByRole('button', {name: 'Mattresses'}),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', {name: 'Sale'})).toHaveAttribute(
      'href',
      '/collections/sale',
    );
  });
});

describe('REQ-NAV-002 mobile accordion from the Shopify menu', () => {
  it('shows a row per top-level item: links as links, groups as accordion buttons', () => {
    renderIn(<MobileNav items={ITEMS} onNavigate={() => {}} />);
    expect(screen.getByRole('link', {name: 'Sale'})).toHaveAttribute(
      'href',
      '/collections/sale',
    );
    expect(screen.getByRole('link', {name: 'Partner'})).toHaveAttribute(
      'rel',
      'noopener noreferrer',
    );
    const button = screen.getByRole('button', {name: 'Mattresses'});
    expect(button).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('link', {name: 'Shop by size'})).toHaveAttribute(
      'href',
      '/collections/by-size',
    );
    expect(screen.getByRole('link', {name: 'Queen'})).toHaveAttribute(
      'href',
      '/collections/queen',
    );
    expect(screen.getByRole('link', {name: 'Hybrid'})).toBeInTheDocument();
    expect(
      screen.getByRole('link', {name: 'View all mattresses'}),
    ).toBeInTheDocument();
  });

  it('closes the drawer when a link is followed', () => {
    let navigated = 0;
    renderIn(<MobileNav items={ITEMS} onNavigate={() => (navigated += 1)} />);
    fireEvent.click(screen.getByRole('button', {name: 'Mattresses'}));
    fireEvent.click(screen.getByRole('link', {name: 'Queen'}));
    expect(navigated).toBe(1);
  });
});
