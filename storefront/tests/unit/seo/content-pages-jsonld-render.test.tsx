import {renderToStaticMarkup} from 'react-dom/server';
import {
  Meta,
  RouterProvider,
  UNSAFE_FrameworkContext as FrameworkContext,
  createMemoryRouter,
} from 'react-router';
import {describe, expect, it} from 'vitest';
import {buildArticleJsonLd, buildSeo} from '~/lib/pages/content-pages-seo';
import {buildContentDocument} from '~/lib/pages/content-pages-view';

// Security review C-I1 / RR-L4: a </script> payload in page text must not leave the JSON-LD data. This renders the real
// React Router <Meta> (the component that writes the script element), not a copy of its escaping, so a change in
// the installed react-router that weakens the escaping fails here.

const ORIGIN = 'https://www.example.com';

type Descriptor = Record<string, unknown>;

function renderHead(descriptors: readonly Descriptor[]): string {
  const router = createMemoryRouter(
    [{id: 'root', path: '/', Component: () => <Meta />}],
    {initialEntries: ['/'], hydrationData: {loaderData: {root: null}}},
  );
  const context = {
    future: {},
    manifest: {
      routes: {
        root: {
          id: 'root',
          path: '/',
          hasLoader: false,
          hasAction: false,
          hasErrorBoundary: false,
          module: '',
          imports: [],
        },
      },
      entry: {imports: [], module: ''},
      url: '',
      version: '',
    },
    routeModules: {root: {meta: () => descriptors}},
    ssr: false,
    isSpaMode: false,
    routeDiscovery: {mode: 'lazy', manifestPath: '/__manifest'},
  };
  return renderToStaticMarkup(
    // The framework context is built by hand because the real one needs a server build; only `Meta` reads it here.
    <FrameworkContext.Provider value={context as never}>
      <RouterProvider router={router} />
    </FrameworkContext.Provider>,
  );
}

/** The contents of every ld+json script element in the markup. */
function scriptBodies(markup: string): string[] {
  return [
    ...markup.matchAll(
      /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g,
    ),
  ].map((match) => match[1] ?? '');
}

const ENCODED = '&lt;/script&gt;&lt;script&gt;alert(1)&lt;/script&gt;';
const PAYLOAD = '</script><script>alert(1)</script><!-- &amp; -->';

describe('REQ-CNT-001 a </script> payload cannot leave the JSON-LD data (security C-I1, RR-L4)', () => {
  it('FAQPage text that contains the payload comes out as one inert script element', () => {
    const view = buildContentDocument({
      title: 'FAQ',
      // Entities, so the sanitiser keeps it as text, which the markup then carries as a string.
      body: `<h2>Safe?</h2><p>${ENCODED}</p><h2>Really?</h2><p>${ENCODED}</p>`,
      faq: true,
      path: '/pages/faq',
      origin: ORIGIN,
      canonical: `${ORIGIN}/pages/faq`,
      siteName: 'Example Sleep',
    });
    const faq = view.jsonLd.find((entry) => entry['@type'] === 'FAQPage');
    expect(JSON.stringify(faq)).toContain('</script>');

    const markup = renderHead(
      view.jsonLd.map((jsonLd) => ({'script:ld+json': jsonLd})),
    );
    expect(scriptBodies(markup)).toHaveLength(view.jsonLd.length);
    // Exactly one closing tag per element: the payload's own `</script>` is escaped.
    expect(markup.match(/<\/script/gi)).toHaveLength(view.jsonLd.length);
    expect(markup.match(/<script/gi)).toHaveLength(view.jsonLd.length);
    for (const body of scriptBodies(markup)) {
      expect(body).not.toMatch(/[<>]/);
      expect(() => JSON.parse(body)).not.toThrow();
    }
    // The browser's JSON parser gets the same data back.
    const parsed = scriptBodies(markup).map((body): unknown =>
      JSON.parse(body),
    );
    expect(parsed).toContainEqual(faq);
  });

  it('Article markup built from hostile title, author, description and tags is just as inert', () => {
    const json = buildArticleJsonLd({
      headline: `Title ${PAYLOAD}`,
      description: PAYLOAD,
      canonical: `${ORIGIN}/blogs/j/a`,
      imageUrl: null,
      publishedAt: '2026-10-05T10:00:00Z',
      authorName: PAYLOAD,
      tags: [PAYLOAD],
    });
    const markup = renderHead([{'script:ld+json': json}]);
    expect(markup.match(/<\/script/gi)).toHaveLength(1);
    expect(scriptBodies(markup)[0]).not.toMatch(/[<>&]/);
  });

  it('hostile SEO fields never become markup in the meta tags', () => {
    const seo = buildSeo({
      title: 'T',
      seoTitle: PAYLOAD,
      seoDescription: PAYLOAD,
      canonical: `${ORIGIN}/pages/x`,
      indexable: true,
      type: 'website',
      siteName: 'Example Sleep',
    });
    const markup = renderHead(seo.tags);
    expect(markup.toLowerCase()).not.toContain('<script');
  });
});
