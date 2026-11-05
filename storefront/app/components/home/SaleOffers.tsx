import {Link} from 'react-router';
import {Button} from '~/components/ui/Button';
import {cn} from '~/components/ui/cn';
import {SiteImage} from '~/components/ui/SiteImage';
import {brandPath} from '~/lib/shopify/brand-path';
import {SITE_IMAGES, type SiteImage as SiteImageData} from '~/lib/site-images';

// The brand offers under the home hero (owner request 2026-11-05, CR-35). Like the Black Friday banner above the hero, this
// is the client's own campaign and is fixed in code, not driven by Shopify content. Every word is live markup, so it can be
// read, selected and translated; only the photographs are pictures. They are the owner's supplied images (.sale-images/),
// cropped to the photograph alone because the originals had their headlines drawn in.
//
// The wording is the owner's, taken from those images. It is NOT checked against Shopify: a "free gift" or a "free base" is
// a promise that needs its own discount in Shopify admin (gift and bundle prices come only from Shopify discounts, ADR-0003),
// and every amount here must be true on this store before the page goes live. Each link goes to the brand's own page.

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

type Banner = {
  readonly brand: string;
  readonly handle: string;
  readonly heading: string;
  readonly text: string;
  readonly image: SiteImageData;
  readonly alt: string;
  /**
   * Where the words sit. `left`: white text over a dark fade from the left edge. `right`: dark text over the light wall
   * of the photograph, with a soft light fade behind it.
   */
  readonly side: 'left' | 'right';
};

const BANNERS: readonly Banner[] = [
  {
    brand: 'Sealy',
    handle: 'sealy',
    heading: 'Free adjustable base',
    text: 'on select Sealy styles',
    image: SITE_IMAGES.offerAdjustable,
    alt: 'A couple talking while sitting on a split adjustable bed',
    side: 'left',
  },
  {
    brand: 'Casper',
    handle: 'casper',
    heading: 'Casper',
    text: 'Mattresses, pillows and sheets.',
    image: SITE_IMAGES.offerCasper,
    alt: 'Two friends laughing on a mattress in a bright bedroom',
    side: 'right',
  },
  {
    brand: 'Helix',
    handle: 'helix',
    heading: 'Helix',
    text: 'Hybrid mattresses in plush, medium and firm feels.',
    image: SITE_IMAGES.offerHelix,
    alt: 'A hybrid mattress on a wooden bed frame in a calm bedroom',
    side: 'left',
  },
];

const HEADING_ID = 'brand-offers-heading';
// Gold with a fine sparkle laid over it. The sparkle is decoration only (aria-hidden), so the text keeps its contrast on
// the plain gold underneath.
const GOLD =
  'bg-[linear-gradient(135deg,var(--color-accent-200),var(--color-accent-300)_50%,var(--color-accent-400))]';
const SPARKLE =
  'bg-[radial-gradient(var(--color-accent-50)_1px,transparent_1.5px)] bg-[size:14px_14px] opacity-50';

function PhotoOfferCard({offer}: {offer: PhotoOffer}) {
  return (
    <li className="flex flex-col overflow-hidden rounded-panel border border-line bg-paper text-center">
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
      <div className="relative mt-5">
        <SiteImage
          image={offer.image}
          aspectRatio="5 / 4"
          sizes="(min-width: 768px) 33vw, 100vw"
          className="w-full object-cover"
        />
        <p className="on-dark absolute bottom-3 left-3 flex size-28 items-center justify-center rounded-full bg-ink-900 p-3 text-center text-sm leading-tight font-bold text-white md:size-32">
          {offer.badge}
        </p>
      </div>
      <div className="flex flex-1 flex-col items-center justify-end gap-3 p-5">
        <p className="on-dark rounded-pill bg-ink-900 px-5 py-2 text-lg font-extrabold text-white">
          {offer.gift}
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
        'relative flex min-h-80 flex-col items-center justify-center gap-3 overflow-hidden rounded-panel p-6 text-center text-ink-900',
        GOLD,
      )}
    >
      <span aria-hidden="true" className={cn('absolute inset-0', SPARKLE)} />
      <div className="relative flex flex-col items-center gap-3">
        <p className="font-display text-3xl font-extrabold">{offer.brand}</p>
        <p className="type-display flex items-center gap-2 text-display leading-none">
          <span className="text-lg leading-tight uppercase">
            Up
            <br />
            to
          </span>
          <span>{offer.percent}%</span>
        </p>
        <p className="type-display text-display leading-none uppercase">Off</p>
        <Link
          to={brandPath(offer.handle)}
          prefetch="intent"
          className="mt-2 inline-flex min-h-touch items-center text-base font-extrabold tracking-wide uppercase underline underline-offset-4 hover:no-underline"
        >
          Shop now
          <span className="sr-only"> {offer.brand}</span>
        </Link>
      </div>
    </li>
  );
}

function PhotoBanner({banner}: {banner: Banner}) {
  const left = banner.side === 'left';
  return (
    <div
      className={cn(
        'relative aspect-[4/3] overflow-hidden rounded-panel md:aspect-[21/9]',
        left ? 'on-dark text-white' : 'text-ink-900',
      )}
    >
      <SiteImage
        image={banner.image}
        aspectRatio="21 / 9"
        alt={banner.alt}
        sizes="100vw"
        className="absolute inset-0 h-full w-full object-cover"
      />
      {/* The fade sits behind the words only, so the rest of the photograph stays at full brightness. */}
      <div
        aria-hidden="true"
        className={cn(
          'absolute inset-0',
          left
            ? 'bg-gradient-to-t from-ink-900/80 via-ink-900/20 to-transparent md:bg-gradient-to-r md:from-ink-900/80 md:via-ink-900/40 md:to-transparent'
            : 'bg-gradient-to-t from-paper/90 via-paper/30 to-transparent md:bg-gradient-to-l md:from-paper/90 md:via-paper/40 md:to-transparent',
        )}
      />
      <div
        className={cn(
          'absolute inset-0 flex flex-col justify-end gap-2 p-6 md:justify-center md:gap-3 md:p-12',
          left ? 'items-start' : 'items-start md:items-end md:text-right',
        )}
      >
        <h3 className="type-display text-4xl md:text-5xl">{banner.heading}</h3>
        <p className="text-lg font-bold md:text-xl">{banner.text}</p>
        <Button
          to={brandPath(banner.handle)}
          prefetch="intent"
          size="lg"
          variant={left ? 'primary' : 'dark'}
        >
          Shop {banner.brand}
        </Button>
      </div>
    </div>
  );
}

/**
 * Brand offers under the hero: three photo cards ("Save up to ... on adjustable sets" and a gift), three gold percentage
 * tiles, and three full-photo banners with the words on top (free base, Casper, Helix). All text is markup; none of it is read from Shopify.
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

      <ul className="grid gap-4 md:grid-cols-3 md:gap-6">
        {PHOTO_OFFERS.map((offer) => (
          <PhotoOfferCard key={offer.handle} offer={offer} />
        ))}
      </ul>

      <ul className="grid gap-4 md:grid-cols-3 md:gap-6">
        {PERCENT_OFFERS.map((offer) => (
          <PercentTile key={offer.handle} offer={offer} />
        ))}
      </ul>

      {BANNERS.map((banner) => (
        <PhotoBanner key={banner.handle} banner={banner} />
      ))}

      <p className="text-caption text-fg-muted">*T&amp;C apply.</p>
    </section>
  );
}
