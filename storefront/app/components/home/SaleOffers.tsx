import {Link} from 'react-router';
import {Button} from '~/components/ui/Button';
import {cn} from '~/components/ui/cn';
import {SiteImage} from '~/components/ui/SiteImage';
import {brandPath} from '~/lib/shopify/brand-path';
import {SITE_IMAGES, type SiteImage as SiteImageData} from '~/lib/site-images';

// The brand offers under the home hero (owner request 2026-11-05, CR-35; creative and motion reworked 2026-11-06). Like the
// Black Friday banner above the hero, this is the client's own campaign and is fixed in code, not driven by Shopify content.
// Every word is live markup, so it can be read, selected and translated; only the photographs are pictures. They are the
// owner's supplied images (.sale-images/), cropped to the photograph alone because the originals had their headlines drawn in.
//
// The wording is the owner's, taken from those images. It is NOT checked against Shopify: a "free gift" or a "free base" is
// a promise that needs its own discount in Shopify admin (gift and bundle prices come only from Shopify discounts, ADR-0003),
// and every amount here must be true on this store before the page goes live. Each link goes to the brand's own page.
//
// Motion is CSS only and every piece is decoration (aria-hidden): the sweep, sparkle, sunburst, float and ticker run under
// `motion-safe:`, and the scroll reveal under a no-preference media query (tailwind.css), so reduced-motion visitors get a
// still page with the same content.

type PhotoOffer = {
  readonly brand: string;
  readonly handle: string;
  readonly isNew?: boolean;
  readonly amount: string;
  readonly on: string;
  /** The round badge on the photo: a one-line selling point. */
  readonly badge: string;
  readonly gift: string;
  readonly image: SiteImageData;
};

const PHOTO_OFFERS: readonly PhotoOffer[] = [
  {
    brand: 'Stearns & Foster',
    handle: 'stearns-and-foster',
    isNew: true,
    amount: '$1000',
    on: 'on adjustable sets',
    badge: 'IntelliCoil technology for all-night support',
    gift: 'Plus, $300 free gift!',
    image: SITE_IMAGES.offerStearns,
  },
  {
    brand: 'Beautyrest Black',
    handle: 'beautyrest',
    amount: '$1000',
    on: 'on adjustable sets',
    badge: 'Pocketed coil technology for individualized support',
    gift: 'Plus, $300 free gift!',
    image: SITE_IMAGES.offerBeautyrestBlack,
  },
  {
    brand: 'Tempur-Pedic',
    handle: 'tempur-pedic',
    amount: '$500',
    on: 'on adjustable sets',
    badge: 'Legendary pressure relief',
    gift: 'Plus, $300 free gift!',
    image: SITE_IMAGES.offerTempur,
  },
];

type PercentOffer = {
  readonly brand: string;
  readonly handle: string;
  readonly percent: number;
};

const PERCENT_OFFERS: readonly PercentOffer[] = [
  {brand: 'Beautyrest', handle: 'beautyrest', percent: 70},
  {brand: 'Serta', handle: 'serta', percent: 70},
  {brand: 'Sealy', handle: 'sealy', percent: 60},
];

// The owner's figures (2026-11-06): Casper up to 35%, Helix up to 30%. Like every amount here they are not checked against
// Shopify; each must exist as a real discount in Shopify admin before the page goes live.
const CASPER_PERCENT = 35;
const HELIX_PERCENT = 30;

type BrandLink = {readonly brand: string; readonly handle: string};

type Banner = {
  /** One button per brand: a banner may cover several brands, each going to its own page. */
  readonly links: readonly BrandLink[];
  readonly heading: string;
  readonly text: string;
  readonly image: SiteImageData;
  readonly alt: string;
  /**
   * Where the words sit on a full-width banner. `left`: white text over a dark fade from the left edge. `right`: dark text
   * over the light wall of the photograph, with a soft light fade behind it. Half-width banners always put the words at
   * the bottom.
   */
  readonly side: 'left' | 'right';
  /** A "--% off" stamp on the photograph, when the banner carries a percentage offer. */
  readonly percent?: number;
};

// Black Friday gift (owner request 2026-11-06): a free adjustable base with these three brands only. The base is the Twin
// baselogic Platform (serta-baselogic-platform); the Shopify discount that makes it free is created by
// scripts/setup/free-base-offer.mjs and must be active before this goes live.
const WIDE_BANNER: Banner = {
  links: [
    {brand: 'Aireloom', handle: 'aireloom'},
    {brand: 'Kingsdown', handle: 'kingsdown'},
    {brand: 'Molecule', handle: 'molecule'},
  ],
  heading: 'Free adjustable base',
  text: 'on Aireloom, Kingsdown and Molecule mattresses',
  image: SITE_IMAGES.offerAdjustable,
  alt: 'A hand holding an adjustable base remote on a made bed in a calm bedroom',
  side: 'left',
};

const HALF_BANNERS: readonly Banner[] = [
  {
    links: [{brand: 'Casper', handle: 'casper'}],
    heading: 'Casper',
    text: 'Mattresses, pillows and sheets.',
    image: SITE_IMAGES.offerCasper,
    alt: 'Two friends laughing on a mattress in a bright bedroom',
    side: 'right',
    percent: CASPER_PERCENT,
  },
  {
    links: [{brand: 'Helix', handle: 'helix'}],
    heading: 'Helix',
    text: 'Hybrid mattresses in plush, medium and firm feels.',
    image: SITE_IMAGES.offerHelix,
    alt: 'A hybrid mattress on a wooden bed frame in a calm bedroom',
    side: 'left',
    percent: HELIX_PERCENT,
  },
];

const HEADING_ID = 'brand-offers-heading';
// Gold with a fine sparkle laid over it. The sparkle is decoration only (aria-hidden), so the text keeps its contrast on
// the plain gold underneath.
const GOLD =
  'bg-[linear-gradient(135deg,var(--color-accent-200),var(--color-accent-300)_50%,var(--color-accent-400))]';
const SPARKLE =
  'bg-[radial-gradient(var(--color-accent-50)_1px,transparent_1.5px)] bg-[size:14px_14px] opacity-50 motion-safe:animate-twinkle';
// A slow sunburst behind the number, faded out toward the edges.
const BURST =
  'absolute top-1/2 left-1/2 size-[220%] -translate-x-1/2 -translate-y-1/2 bg-[repeating-conic-gradient(from_0deg,var(--color-accent-50)_0_7deg,transparent_7deg_15deg)] opacity-40 [mask-image:radial-gradient(circle,black_10%,transparent_55%)] motion-safe:animate-burst';

/** A bar of light that sweeps across its (relatively positioned, overflow-hidden) parent every few seconds. */
function Shine({className}: {className?: string}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'pointer-events-none absolute inset-y-0 left-0 w-1/4 bg-gradient-to-r from-transparent via-white/45 to-transparent motion-safe:animate-shine',
        className,
      )}
    />
  );
}

/** The ticker above the offers: every discount in one moving line. Decoration; the same offers are written out below. */
function DealTicker() {
  const deals = [
    ...PERCENT_OFFERS.map(
      (offer) => `${offer.brand}: up to ${offer.percent}% off`,
    ),
    ...HALF_BANNERS.flatMap((banner) =>
      banner.percent && banner.links[0]
        ? [`${banner.links[0].brand}: up to ${banner.percent}% off`]
        : [],
    ),
    'Free adjustable base on Aireloom, Kingsdown and Molecule',
    'Free gift with adjustable sets',
  ];
  const line = (
    <>
      {deals.map((deal) => (
        <span
          key={deal}
          className="flex shrink-0 items-center gap-6 text-sm font-extrabold tracking-wide uppercase"
        >
          {deal}
          <span className="size-1.5 rotate-45 bg-accent-300" />
        </span>
      ))}
    </>
  );
  return (
    <div
      aria-hidden="true"
      className="on-dark overflow-hidden rounded-pill bg-ink-900 py-3 text-white"
    >
      <div className="flex w-max gap-6 motion-safe:animate-marquee">
        <div className="flex gap-6">{line}</div>
        <div className="hidden gap-6 motion-safe:flex">{line}</div>
      </div>
    </div>
  );
}

function PhotoOfferCard({offer}: {offer: PhotoOffer}) {
  return (
    <li className="reveal group flex flex-col overflow-hidden rounded-panel border border-line bg-paper text-center motion-safe:transition-[transform,box-shadow] motion-safe:duration-300 hover:-translate-y-1 hover:shadow-lg">
      <div className="px-5 pt-6">
        <p className="text-base font-bold tracking-wide uppercase">
          {offer.brand}
          {offer.isNew ? (
            <span className="ml-2 rounded-pill bg-primary-500 px-2 py-0.5 text-caption font-extrabold text-white">
              New
            </span>
          ) : null}
        </p>
        <h3 className="type-display mt-2 text-5xl">
          Save <span className="text-xl align-middle md:text-2xl">up to</span>{' '}
          {offer.amount}
        </h3>
        <p className="mt-1 text-base font-bold tracking-wide uppercase">
          {offer.on}
        </p>
      </div>
      <div className="relative mt-5 overflow-hidden">
        <SiteImage
          image={offer.image}
          aspectRatio="5 / 4"
          sizes="(min-width: 768px) 33vw, 100vw"
          className="w-full object-cover motion-safe:transition-transform motion-safe:duration-700 group-hover:scale-105"
        />
        <p className="on-dark absolute bottom-3 left-3 flex size-28 items-center justify-center rounded-full bg-ink-900 p-3 text-center text-sm leading-tight font-bold text-white [--float-tilt:-4deg] motion-safe:animate-float md:size-32">
          {offer.badge}
        </p>
      </div>
      <div className="flex flex-1 flex-col items-center justify-end gap-3 p-5">
        <p className="on-dark relative overflow-hidden rounded-pill bg-ink-900 px-5 py-2 text-lg font-extrabold text-white">
          {offer.gift}
          <Shine />
        </p>
        <Button to={brandPath(offer.handle)} prefetch="intent">
          Shop {offer.brand}
        </Button>
      </div>
    </li>
  );
}

function PercentTile({offer}: {offer: PercentOffer}) {
  return (
    <li
      className={cn(
        'reveal group relative flex min-h-64 w-[78%] shrink-0 snap-center flex-col items-center justify-center overflow-hidden rounded-panel p-6 text-center text-ink-900 motion-safe:transition-transform motion-safe:duration-300 hover:-translate-y-1 md:min-h-80 md:w-auto',
        GOLD,
      )}
    >
      <span aria-hidden="true" className={cn('absolute inset-0', SPARKLE)} />
      <span aria-hidden="true" className={BURST} />
      <Shine />
      <div className="relative flex flex-col items-center gap-2">
        <p className="font-display text-3xl font-extrabold">{offer.brand}</p>
        <p className="type-display flex items-center gap-2 text-display leading-none motion-safe:transition-transform motion-safe:duration-300 group-hover:scale-110">
          <span className="text-lg leading-tight uppercase">
            Up
            <br />
            to
          </span>
          <span>{offer.percent}%</span>
        </p>
        <p className="type-display rounded-pill bg-ink-900 px-6 py-1 text-4xl leading-tight text-accent-200 uppercase on-dark">
          Off
        </p>
        <Link
          to={brandPath(offer.handle)}
          prefetch="intent"
          className="mt-3 inline-flex min-h-touch items-center text-base font-extrabold tracking-wide uppercase underline underline-offset-4 hover:no-underline"
        >
          Shop now
          <span className="sr-only"> {offer.brand}</span>
        </Link>
      </div>
    </li>
  );
}

/** The round "--% off" stamp pinned to a banner photograph. */
function PercentStamp({percent}: {percent: number}) {
  return (
    <p
      className={cn(
        'absolute top-3 right-3 flex size-24 flex-col items-center justify-center rounded-full text-center text-ink-900 [--float-tilt:8deg] motion-safe:animate-float md:top-4 md:right-4 md:size-28',
        GOLD,
      )}
    >
      <span
        aria-hidden="true"
        className="absolute inset-0 rounded-full motion-safe:animate-pulse-ring"
      />
      <span className="text-xs leading-none font-extrabold uppercase">
        Up to
      </span>
      <span className="type-display text-4xl leading-none md:text-5xl">
        {percent}%
      </span>
      <span className="text-sm leading-none font-extrabold uppercase">Off</span>
    </p>
  );
}

function PhotoBanner({banner, half}: {banner: Banner; half?: boolean}) {
  const left = banner.side === 'left';
  return (
    <div
      className={cn(
        // A flex column with the words in the flow: the box keeps the photograph's ratio as its MINIMUM height and grows with the
        // words, so a banner with several buttons (the free base) is never cut off at the top on a phone.
        'reveal group relative flex flex-col justify-end overflow-hidden rounded-panel',
        // A minimum height, not an aspect ratio, on a phone: the box is clipped (overflow-hidden), and a clipped box does not
        // grow to fit its words, so the free-base banner's three buttons pushed its heading out of sight.
        half
          ? 'min-h-64 md:min-h-96'
          : 'min-h-64 md:aspect-[21/9] md:min-h-0 md:justify-center',
        left ? 'on-dark text-white' : 'text-ink-900',
      )}
    >
      <SiteImage
        image={banner.image}
        aspectRatio={half ? '4 / 3' : '21 / 9'}
        alt={banner.alt}
        sizes={half ? '(min-width: 768px) 50vw, 100vw' : '100vw'}
        className="absolute inset-0 h-full w-full object-cover motion-safe:transition-transform motion-safe:duration-1000 group-hover:scale-105"
      />
      {/* The fade sits behind the words only, so the rest of the photograph stays at full brightness. */}
      <div
        aria-hidden="true"
        className={cn(
          'absolute inset-0',
          left
            ? half
              ? 'bg-gradient-to-t from-ink-900/80 via-ink-900/20 to-transparent'
              : // The wide banner's words fill the whole box on a phone, so the dark fade covers all of it.
                'bg-gradient-to-t from-ink-900/85 via-ink-900/55 to-ink-900/30'
            : 'bg-gradient-to-t from-paper/90 via-paper/30 to-transparent',
          !half &&
            (left
              ? 'md:bg-gradient-to-r md:from-ink-900/80 md:via-ink-900/40 md:to-transparent'
              : 'md:bg-gradient-to-l md:from-paper/90 md:via-paper/40 md:to-transparent'),
        )}
      />
      {banner.percent ? <PercentStamp percent={banner.percent} /> : null}
      <div
        className={cn(
          'relative flex flex-col gap-2 p-6',
          half
            ? 'items-start md:gap-3 md:p-8'
            : cn(
                'md:gap-3 md:p-12',
                left ? 'items-start' : 'items-start md:items-end md:text-right',
              ),
        )}
      >
        <h3 className="type-display text-4xl md:text-5xl">{banner.heading}</h3>
        <p className="text-lg font-bold md:text-xl">{banner.text}</p>
        <div className="flex flex-wrap gap-2 md:gap-3">
          {banner.links.map((link) => (
            <Button
              key={link.handle}
              to={brandPath(link.handle)}
              prefetch="intent"
              // Several brands on one banner get the smaller button, so three of them fit in two rows on a phone.
              size={banner.links.length > 1 ? 'md' : 'lg'}
              variant={left ? 'primary' : 'dark'}
            >
              Shop {link.brand}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Brand offers under the hero: a moving ticker of every deal, the gold percentage tiles (a swipeable row on a phone), three
 * photo cards ("Save up to ... on adjustable sets" and a gift), the free-base banner (Aireloom, Kingsdown, Molecule) and a Casper and a Helix banner side by
 * side, each with a "--% off" stamp. All text is markup; none of it is read from Shopify.
 */
export function SaleOffers() {
  return (
    <section
      aria-labelledby={HEADING_ID}
      className="flex flex-col gap-6 md:gap-8"
    >
      <h2 id={HEADING_ID} className="type-display text-3xl md:text-heading">
        Brand offers
      </h2>

      <DealTicker />

      <ul className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 md:mx-0 md:grid md:grid-cols-3 md:gap-6 md:overflow-visible md:px-0 md:pb-0">
        {PERCENT_OFFERS.map((offer) => (
          <PercentTile key={offer.handle} offer={offer} />
        ))}
      </ul>

      <ul className="grid gap-4 md:grid-cols-3 md:gap-6">
        {PHOTO_OFFERS.map((offer) => (
          <PhotoOfferCard key={offer.handle} offer={offer} />
        ))}
      </ul>

      <PhotoBanner banner={WIDE_BANNER} />

      <div className="grid gap-4 md:grid-cols-2 md:gap-6">
        {HALF_BANNERS.map((banner) => (
          <PhotoBanner key={banner.heading} banner={banner} half />
        ))}
      </div>

      <p className="text-caption text-fg-muted">*T&amp;C apply.</p>
    </section>
  );
}
