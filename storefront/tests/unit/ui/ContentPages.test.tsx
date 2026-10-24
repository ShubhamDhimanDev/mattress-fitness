// @vitest-environment jsdom
import {cleanup, render, screen, within} from '@testing-library/react';
import {createRoutesStub} from 'react-router';
import {afterEach, describe, expect, it} from 'vitest';
import {ArticleCard} from '~/components/pages/ArticleList';
import {ContentArticle} from '~/components/pages/ContentArticle';
import {SiteFooter} from '~/components/layout/SiteFooter';
import {buildFooterLinks} from '~/lib/navigation';
import {footerPageLinks} from '~/lib/pages/content-pages';
import {scanHeadings} from '~/lib/pages/content-pages-html';
import {sanitizeHtml} from '~/lib/shopify/sanitize-html';

afterEach(cleanup);

// REQ-CNT-001 (page layout, footer links), REQ-CNT-002 (article cards).

function renderIn(element: React.ReactNode) {
  const Stub = createRoutesStub([{path: '/', Component: () => element}]);
  return render(<Stub initialEntries={['/']} />);
}

const BODY =
  '<h1>Heading in the text</h1><p>Intro</p><h2>Zones</h2><p>a</p><h3>Same day</h3><p>b</p><script>window.hacked = true</script>';

function layout(overrides: Partial<Parameters<typeof ContentArticle>[0]> = {}) {
  const clean = sanitizeHtml(BODY);
  const {anchors, toc} = scanHeadings(clean);
  return (
    <ContentArticle
      title="Delivery and shipping"
      breadcrumb={[{label: 'Home', to: '/'}, {label: 'Delivery and shipping'}]}
      body={BODY}
      toc={toc}
      anchors={anchors}
      updated={{iso: '2026-10-05T10:00:00Z', text: 'October 5, 2026'}}
      {...overrides}
    />
  );
}

describe('REQ-CNT-001 content page layout', () => {
  it('is one article with exactly one h1, even when the text has an h1 of its own', async () => {
    renderIn(layout());
    expect(await screen.findAllByRole('heading', {level: 1})).toHaveLength(1);
    expect(screen.getByRole('heading', {level: 1})).toHaveTextContent(
      'Delivery and shipping',
    );
    expect(screen.getByRole('article')).toBeInTheDocument();
    // The h1 written in the text is demoted, not dropped.
    expect(
      screen.getByRole('heading', {level: 2, name: 'Heading in the text'}),
    ).toBeInTheDocument();
  });

  it('shows the breadcrumb with the page as the current item', async () => {
    renderIn(layout());
    const nav = await screen.findByRole('navigation', {name: 'Breadcrumb'});
    expect(within(nav).getByRole('link', {name: 'Home'})).toHaveAttribute(
      'href',
      '/',
    );
    expect(within(nav).getByText('Delivery and shipping')).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('lists the contents with links to anchors that exist on the headings', async () => {
    const {container} = renderIn(layout());
    const nav = await screen.findByRole('navigation', {name: 'On this page'});
    const links = within(nav).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual([
      'Heading in the text',
      'Zones',
      'Same day',
    ]);
    for (const link of links) {
      const id = link.getAttribute('href')?.slice(1) ?? '';
      expect(id).toMatch(/^section-/);
      expect(container.querySelector(`#${id}`), id).not.toBeNull();
    }
    // Each target is a heading of the text, never an element Shopify supplied.
    expect(container.querySelector('#section-zones')?.tagName).toBe('H2');
    expect(container.querySelector('#section-same-day')?.tagName).toBe('H3');
  });

  it('renders no contents list without entries', async () => {
    renderIn(layout({toc: [], anchors: undefined}));
    await screen.findByRole('heading', {level: 1});
    expect(
      screen.queryByRole('navigation', {name: 'On this page'}),
    ).not.toBeInTheDocument();
  });

  it('strips scripts from the text', async () => {
    const {container} = renderIn(layout());
    await screen.findByRole('heading', {level: 1});
    expect(container.querySelector('script')).toBeNull();
    expect(container.innerHTML).not.toContain('window.hacked');
  });

  it('shows the last-updated date as a time element, or nothing without one', async () => {
    renderIn(layout());
    const time = await screen.findByText('October 5, 2026');
    expect(time.tagName).toBe('TIME');
    expect(time).toHaveAttribute('datetime', '2026-10-05T10:00:00Z');
    cleanup();
    renderIn(layout({updated: null}));
    await screen.findByRole('heading', {level: 1});
    expect(screen.queryByText(/Last updated/)).not.toBeInTheDocument();
  });

  it('says plainly that an empty page has no content, and invents none', async () => {
    renderIn(layout({body: '', toc: [], anchors: [], empty: true}));
    expect(
      await screen.findByText('This page has no content yet.'),
    ).toBeInTheDocument();
  });

  it('hides the breadcrumb and the contents when printing', async () => {
    renderIn(layout());
    expect(
      await screen.findByRole('navigation', {name: 'Breadcrumb'}),
    ).toHaveClass('print:hidden');
    expect(screen.getByRole('navigation', {name: 'On this page'})).toHaveClass(
      'print:hidden',
    );
  });
});

describe('REQ-CNT-001 footer links to Shopify pages', () => {
  const available = (pages: string[]) =>
    footerPageLinks({
      pages: new Set(pages),
      policies: new Set<'privacyPolicy' | 'termsOfService'>([
        'privacyPolicy',
        'termsOfService',
      ]),
      blogs: new Set(['journal']),
    });

  async function footer(pageLinks: ReturnType<typeof available> = []) {
    renderIn(<SiteFooter links={buildFooterLinks(pageLinks)} />);
    return screen.findByRole('contentinfo');
  }

  it('shows no registry link at all without page data (no 404 links)', async () => {
    const element = await footer();
    for (const name of [
      'Contact us',
      'FAQ',
      'Financing',
      'Warranty and returns',
      'Comfort guarantee',
      'Price guarantee',
      'About us',
      'Accessibility',
      'Privacy policy',
      'Terms',
      'Sleep journal',
    ]) {
      expect(
        within(element).queryByRole('link', {name}),
        name,
      ).not.toBeInTheDocument();
    }
    // The fixed links are still there.
    expect(
      within(element).getAllByRole('link', {name: 'Find a store'}).length,
    ).toBeGreaterThan(0);
    expect(
      within(element).getByRole('link', {name: 'Sleep quiz'}),
    ).toBeInTheDocument();
  });

  it('shows no Shopify-dependent link when the footer is given no link data at all', async () => {
    renderIn(<SiteFooter />);
    const element = await screen.findByRole('contentinfo');
    for (const name of ['Privacy policy', 'Terms', 'FAQ', 'Sleep journal']) {
      expect(
        within(element).queryByRole('link', {name}),
        name,
      ).not.toBeInTheDocument();
    }
  });

  it('shows exactly the links of the pages that exist, and the legal ones at the policy URLs', async () => {
    const element = await footer(available(['faq', 'financing']));
    expect(within(element).getByRole('link', {name: 'FAQ'})).toHaveAttribute(
      'href',
      '/pages/faq',
    );
    expect(
      within(element).getByRole('link', {name: 'Financing'}),
    ).toHaveAttribute('href', '/pages/financing');
    expect(
      within(element).getByRole('link', {name: 'Privacy policy'}),
    ).toHaveAttribute('href', '/policies/privacy-policy');
    expect(within(element).getByRole('link', {name: 'Terms'})).toHaveAttribute(
      'href',
      '/policies/terms-of-service',
    );
    expect(
      within(element).getByRole('link', {name: 'Sleep journal'}),
    ).toHaveAttribute('href', '/blogs/journal');
    // Pages that do not exist stay out.
    expect(
      within(element).queryByRole('link', {name: 'Contact us'}),
    ).not.toBeInTheDocument();
    expect(
      within(element).queryByRole('link', {name: 'Warranty and returns'}),
    ).not.toBeInTheDocument();
  });

  it('puts a page link in its registry order inside the group', async () => {
    const element = await footer(
      available(['size-guide', 'comfort-guide', 'adjustable-base-guide']),
    );
    const group = within(element)
      .getAllByRole('list')
      .find((list) => within(list).queryByRole('link', {name: 'Sleep quiz'}));
    expect(group).toBeDefined();
    if (!group) return;
    expect(
      within(group)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual([
      'Sleep quiz',
      'Compare mattresses',
      'Size guide',
      'Comfort guide',
      'Adjustable base guide',
      'Sleep journal',
    ]);
  });

  it('shows the delivery and contact quick links only when those pages exist', async () => {
    const element = await footer(available(['delivery-and-shipping']));
    expect(
      within(element).getByRole('link', {name: 'Delivery information'}),
    ).toHaveAttribute('href', '/pages/delivery-and-shipping');
    expect(
      within(element).queryByRole('link', {name: 'Get in touch'}),
    ).not.toBeInTheDocument();
  });
});

describe('REQ-CNT-002 article card', () => {
  const article = {
    id: '1',
    handle: 'choosing',
    title: 'Choosing a mattress',
    publishedAt: '2026-10-05T10:00:00Z',
    excerpt: 'A short guide.',
    authorName: 'Sam Sleeper',
    blogHandle: 'journal',
    image: null,
  };

  it('links the title to the article and shows date, author and excerpt', async () => {
    renderIn(
      <ul>
        <ArticleCard article={article} />
      </ul>,
    );
    expect(
      await screen.findByRole('link', {name: 'Choosing a mattress'}),
    ).toHaveAttribute('href', '/blogs/journal/choosing');
    expect(screen.getByText('October 5, 2026')).toHaveAttribute(
      'datetime',
      article.publishedAt,
    );
    expect(screen.getByText(/Sam Sleeper/)).toBeInTheDocument();
    expect(screen.getByText('A short guide.')).toBeInTheDocument();
  });

  it('leaves out the author and excerpt when there are none', async () => {
    renderIn(
      <ul>
        <ArticleCard article={{...article, excerpt: '', authorName: null}} />
      </ul>,
    );
    await screen.findByRole('link', {name: 'Choosing a mattress'});
    expect(screen.queryByText(/Sam Sleeper/)).not.toBeInTheDocument();
    expect(screen.queryByText('A short guide.')).not.toBeInTheDocument();
  });
});
