import {lazy, Suspense, type ComponentType} from 'react';
import {Link} from 'react-router';
import {BannerSection} from '~/components/home/BannerSection';
import {
  BrandTiles,
  CategoryTiles,
  FeaturedProducts,
  SizeTiles,
} from '~/components/home/CatalogSections';
import type {SignupFormProps} from '~/components/signup/SignupForm';
import {Button} from '~/components/ui/Button';
import {
  HOME_ASSURANCE_ITEMS,
  SITE_NAME,
  SLEEP_QUIZ_LINK,
  STORE_LOCATOR_PATH,
} from '~/lib/navigation';
import type {SignupPublicConfig} from '~/lib/signup/shared';
import type {HomeData} from '~/lib/shopify/home-data';
import type {HomeSection} from '~/lib/shopify/home-sections';

// The signup form is a lazy chunk requested only where a form renders, which is nowhere when the signup is off: this
// file names a dynamic import and nothing else about it (bundle budget, scripts/perf; review m7). A chunk that cannot be
// downloaded hides the form and nothing else (NFR-013).
const NoSignup: ComponentType<SignupFormProps> = () => null;
const SignupForm = lazy(
  (): Promise<{default: ComponentType<SignupFormProps>}> =>
    import('~/components/signup/SignupForm').then(
      (module) => ({default: module.SignupForm}),
      () => ({default: NoSignup}),
    ),
);

type HomeSectionsProps = {
  home: HomeData;
  /** The email signup (P7-02); null when it is not configured, which leaves the admin `signup` block empty. */
  signup?: SignupPublicConfig | null;
};

function isTitleSection(section: HomeSection): boolean {
  return (
    section.kind === 'placeholder-hero' ||
    (section.kind === 'banner' &&
      section.type === 'hero' &&
      section.heading !== null)
  );
}

/**
 * The home page body (REQ-HOME-001): the blocks the client placed in Shopify admin, in their order. The
 * first hero with a heading is the page's only h1; if admin has none, a visually hidden h1 keeps the page
 * titled. Catalog blocks hide themselves when the catalog has nothing for them.
 */
export function HomeSections({home, signup = null}: HomeSectionsProps) {
  const titleId = home.sections.find(isTitleSection)?.id ?? null;

  return (
    <div>
      {titleId === null ? <h1 className="sr-only">{SITE_NAME}</h1> : null}
      {home.sections.map((section) => (
        <SectionView
          key={section.id}
          section={section}
          home={home}
          signup={signup}
          asPageTitle={section.id === titleId}
        />
      ))}
    </div>
  );
}

function SectionView({
  section,
  home,
  signup,
  asPageTitle,
}: {
  section: HomeSection;
  home: HomeData;
  signup: SignupPublicConfig | null;
  asPageTitle: boolean;
}) {
  switch (section.kind) {
    case 'banner':
      return <BannerSection section={section} asPageTitle={asPageTitle} />;
    case 'catalog':
      switch (section.type) {
        case 'shop-by-size':
          return (
            <SizeTiles
              id={section.id}
              heading={section.heading}
              tiles={home.sizeTiles}
            />
          );
        case 'featured':
          return (
            <FeaturedProducts
              id={section.id}
              heading={section.heading}
              featured={home.featured}
            />
          );
        case 'brands':
          return (
            <BrandTiles
              id={section.id}
              heading={section.heading}
              tiles={home.brandTiles}
            />
          );
        case 'categories':
          return (
            <CategoryTiles
              id={section.id}
              heading={section.heading}
              tiles={home.collectionTiles}
            />
          );
        default: {
          const unreachable: never = section;
          return unreachable;
        }
      }
    case 'signup':
      // The `signup` block placed in admin (P7-02). Nothing renders unless Klaviyo is configured (`signup` is null):
      // a form that discards what the shopper typed would be worse than no form.
      return signup ? (
        <section className="my-8 rounded-panel bg-surface-muted px-6 py-8">
          <div className="max-w-xl">
            <Suspense fallback={<div aria-hidden="true" className="h-72" />}>
              <SignupForm config={signup} surface="home" />
            </Suspense>
          </div>
        </section>
      ) : null;
    case 'placeholder-hero':
      return <PlaceholderHero />;
    case 'placeholder-assurance':
      return <PlaceholderAssurance />;
    default: {
      const unreachable: never = section;
      return unreachable;
    }
  }
}

// TODO(P3B-13): placeholder copy, shown only while the store has no `homepage_section` hero entry. Our own wording,
// kept under 40 characters so it can use the display type (lib/display-type.ts).
function PlaceholderHero() {
  return (
    <section
      aria-labelledby="home-hero-heading"
      className="on-dark mt-4 rounded-panel bg-primary-500 px-6 py-12 text-center text-white md:px-12 md:py-16"
    >
      <h1
        id="home-hero-heading"
        className="mx-auto max-w-prose type-display text-3xl text-balance sm:text-4xl md:text-5xl xl:text-display"
      >
        Find the mattress that fits you
      </h1>
      <p className="mx-auto mt-3 max-w-prose text-lg">
        Browse by size, comfort and type, or take the sleep quiz.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Button to={SLEEP_QUIZ_LINK.to} variant="inverse" size="lg">
          Take the sleep quiz
        </Button>
        <Button to={STORE_LOCATOR_PATH} variant="inverse-outline" size="lg">
          Find a store
        </Button>
      </div>
    </section>
  );
}

/** Shown only with the placeholder layout; the client's wording replaces it through REQ-CNT-001. */
function PlaceholderAssurance() {
  if (HOME_ASSURANCE_ITEMS.length === 0) return null;
  return (
    <section
      aria-labelledby="assurance-heading"
      className="rounded-panel bg-primary-50 px-6 py-8"
    >
      <h2 id="assurance-heading" className="type-display text-2xl">
        Buy with confidence
      </h2>
      <ul className="mt-4 grid gap-3 md:grid-cols-3">
        {HOME_ASSURANCE_ITEMS.map((item) => (
          <li key={item.id}>
            <Link
              to={item.to}
              className="inline-flex min-h-touch items-center font-bold text-primary-800 underline underline-offset-2"
            >
              {item.text}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
