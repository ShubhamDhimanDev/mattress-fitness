import {Fragment, lazy, Suspense, type ComponentType} from 'react';
import {AssuranceBlock} from '~/components/home/AssuranceBlock';
import {BannerSection} from '~/components/home/BannerSection';
import {
  BrandTiles,
  CategoryTiles,
  FeaturedProducts,
  SizeTiles,
} from '~/components/home/CatalogSections';
import {
  FaqBlock,
  HowItWorks,
  QuizBand,
  SetupCards,
} from '~/components/home/ContentBlocks';
import {HeroSection} from '~/components/home/HeroSection';
import {OfferCards} from '~/components/home/OfferCards';
import type {SignupFormProps} from '~/components/signup/SignupForm';
import {SITE_NAME, SLEEP_QUIZ_LINK} from '~/lib/navigation';
import type {SignupPublicConfig} from '~/lib/signup/shared';
import type {HomeData} from '~/lib/shopify/home-data';
import {
  groupHomeSections,
  type BlockSection,
  type HomeSection,
  type HomeSectionGroup,
} from '~/lib/shopify/home-sections';

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

function isHeroGroup(group: HomeSectionGroup): boolean {
  return (
    group.kind === 'section' &&
    (group.section.kind === 'placeholder-hero' ||
      (group.section.kind === 'banner' && group.section.type === 'hero'))
  );
}

function groupId(group: HomeSectionGroup): string {
  return group.kind === 'offers' ? group.id : group.section.id;
}

/**
 * The home page body (REQ-HOME-001, CR-31): the blocks the client placed in Shopify admin, in their order. The
 * first hero with a heading is the page's only h1; if admin has none, a visually hidden h1 keeps the page
 * titled. Catalog and content blocks hide themselves when they have nothing to show. Consecutive promo banners
 * are one row of offers. The assurance row sits under the first hero when the client has published items.
 */
export function HomeSections({home, signup = null}: HomeSectionsProps) {
  const titleId = home.sections.find(isTitleSection)?.id ?? null;
  const groups = groupHomeSections(home.sections);
  const heroGroup = groups.findIndex(isHeroGroup);

  return (
    <div className="flex flex-col gap-11 pt-4 md:gap-22 md:pt-6">
      {titleId === null ? <h1 className="sr-only">{SITE_NAME}</h1> : null}
      {groups.map((group, position) => {
        const view = (
          <GroupView
            group={group}
            home={home}
            signup={signup}
            titleId={titleId}
          />
        );
        // The hero and the assurance row under it are one unit, closer together than the sections below.
        return position === heroGroup ? (
          <div key={groupId(group)} className="flex flex-col gap-4 md:gap-6">
            {view}
            <AssuranceBlock />
          </div>
        ) : (
          <Fragment key={groupId(group)}>{view}</Fragment>
        );
      })}
    </div>
  );
}

function GroupView({
  group,
  home,
  signup,
  titleId,
}: {
  group: HomeSectionGroup;
  home: HomeData;
  signup: SignupPublicConfig | null;
  titleId: string | null;
}) {
  if (group.kind === 'offers') {
    return <OfferCards id={group.id} banners={group.banners} />;
  }
  return (
    <SectionView
      section={group.section}
      home={home}
      signup={signup}
      asPageTitle={group.section.id === titleId}
    />
  );
}

function BlockView({block, home}: {block: BlockSection; home: HomeData}) {
  switch (block.type) {
    case 'quiz-band':
      return <QuizBand block={block} />;
    case 'setup-cards':
      return <SetupCards block={block} />;
    case 'how-it-works':
      return <HowItWorks block={block} />;
    case 'faq':
      return <FaqBlock block={block} faqs={home.faqs} />;
    default: {
      const unreachable: never = block.type;
      return unreachable;
    }
  }
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
      switch (section.type) {
        case 'hero':
          return (
            <HeroSection
              id={section.id}
              heading={section.heading}
              body={section.body}
              image={section.image}
              link={section.link}
              linkLabel={section.linkLabel}
              finder={home.finder}
              asPageTitle={asPageTitle}
            />
          );
        case 'financing':
          return <BannerSection section={section} />;
        case 'promo-banner':
          // Normally grouped into OfferCards (groupHomeSections); a lone one that gets here is shown the same way.
          return (
            <OfferCards
              id={section.id}
              banners={[{...section, type: 'promo-banner'}]}
            />
          );
        default: {
          const unreachable: never = section;
          return unreachable;
        }
      }
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
    case 'block':
      return <BlockView block={section} home={home} />;
    case 'signup':
      // The `signup` block placed in admin (P7-02). Nothing renders unless Klaviyo is configured (`signup` is null):
      // a form that discards what the shopper typed would be worse than no form.
      return signup ? (
        <section className="on-dark rounded-hero bg-primary-500 px-4 py-11 md:px-12 md:py-14">
          <Suspense fallback={<div aria-hidden="true" className="h-72" />}>
            <SignupForm config={signup} surface="home" layout="band" />
          </Suspense>
        </section>
      ) : null;
    case 'placeholder-hero':
      return (
        <HeroSection
          id={section.id}
          heading={PLACEHOLDER_HERO.heading}
          body={PLACEHOLDER_HERO.body}
          image={null}
          link={{href: SLEEP_QUIZ_LINK.to, external: false}}
          linkLabel={PLACEHOLDER_HERO.linkLabel}
          finder={home.finder}
          asPageTitle
        />
      );
    default: {
      const unreachable: never = section;
      return unreachable;
    }
  }
}

// TODO(P3B-13): placeholder copy, shown only while the store has no `homepage_section` hero entry. Our own wording; the
// client's replaces it through admin.
const PLACEHOLDER_HERO = {
  heading: 'Find the mattress that [[fits you]]',
  body: ['Browse by size, comfort and type, or take the sleep quiz.'],
  linkLabel: 'Take the sleep quiz',
} as const;
