import {AdminLinkAction} from '~/components/home/AdminLinkAction';
import {buttonStyles, type ButtonVariant} from '~/components/ui/Button';
import {cn} from '~/components/ui/cn';
import {displayHeadingClass} from '~/lib/display-type';
import type {PromoBannerSection} from '~/lib/shopify/home-sections';
import {keyedText} from '~/lib/shopify/keys';

// Solid-colour cards in the order the banners come: ink, brand red, amber, then round again. Text on a band is white or ink
// only, never a tint. The ink and red cards carry `on-dark` (yellow focus ring); amber is a light surface (blue ring).
const CARD_LOOKS: readonly {
  frame: string;
  action: ButtonVariant;
}[] = [
  {frame: 'on-dark bg-ink-900 text-white', action: 'primary'},
  {frame: 'on-dark bg-primary-500 text-white', action: 'white'},
  {frame: 'bg-accent-400 text-ink-900', action: 'dark'},
];

const COLUMNS: Record<number, string> = {
  1: '',
  2: 'md:grid-cols-2',
  3: 'md:grid-cols-3',
};

/** Fixed section title: a structural label, not a claim (the offers themselves are the admin banners). */
const OFFERS_HEADING = 'Latest offers';

function OfferCard({
  banner,
  look,
  wide,
}: {
  banner: PromoBannerSection;
  look: (typeof CARD_LOOKS)[number];
  wide: boolean;
}) {
  const [text, ...ends] = banner.body;
  const headingLink = banner.link !== null && banner.linkLabel === null;

  return (
    <li
      className={cn(
        'flex min-h-72 flex-col gap-3 rounded-panel p-6 md:p-9',
        look.frame,
      )}
    >
      {banner.heading ? (
        <h3
          className={cn(
            displayHeadingClass(banner.heading),
            wide ? 'text-4xl md:text-5xl' : 'text-3xl xl:text-4xl',
          )}
        >
          {banner.link && headingLink ? (
            <AdminLinkAction
              link={banner.link}
              className="underline underline-offset-4 hover:no-underline"
            >
              {banner.heading}
            </AdminLinkAction>
          ) : (
            banner.heading
          )}
        </h3>
      ) : null}
      {/* The first paragraph is the offer, the others are small print such as an end date. */}
      {text ? (
        <p className="mt-auto max-w-prose text-lg font-bold">{text}</p>
      ) : null}
      {keyedText(ends).map((line) => (
        <p key={line.key} className="text-sm">
          {line.text}
        </p>
      ))}
      {banner.link && banner.linkLabel ? (
        <div className={cn(!text && 'mt-auto')}>
          <AdminLinkAction
            link={banner.link}
            className={buttonStyles({variant: look.action})}
          >
            {banner.linkLabel}
          </AdminLinkAction>
        </div>
      ) : null}
    </li>
  );
}

/**
 * The latest offers (REQ-HOME-001, CR-31): consecutive `promo-banner` blocks as one row of up to three solid cards, or a
 * single full-width card. Every word comes from the banners' own fields in admin.
 */
export function OfferCards({
  id,
  banners,
}: {
  id: string;
  banners: readonly PromoBannerSection[];
}) {
  if (banners.length === 0) return null;
  const headingId = `${id}-offers-heading`;
  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId} className="type-display text-3xl md:text-heading">
        {OFFERS_HEADING}
      </h2>
      <ul
        className={cn(
          'mt-6 grid gap-4 md:mt-8 md:gap-6',
          COLUMNS[banners.length],
        )}
      >
        {banners.map((banner, index) => (
          <OfferCard
            key={banner.id}
            banner={banner}
            look={CARD_LOOKS[index % CARD_LOOKS.length]}
            wide={banners.length === 1}
          />
        ))}
      </ul>
    </section>
  );
}
